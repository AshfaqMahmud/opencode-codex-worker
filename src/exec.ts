/**
 * Process supervision for the Codex CLI.
 *
 * Responsibilities: locate the binary, spawn without a shell, capture bounded output, enforce a
 * timeout, and terminate the whole process group on timeout or abort. Nothing here knows about
 * OpenCode or about jobs; it is plain Node.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

/** Wraps a failure to start or resolve the Codex binary, rather than a Codex run that failed. */
export class ExecError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ExecError";
  }
}

/**
 * Keeps the first `headShare` of a buffer and the most recent remainder, so a runaway process
 * cannot exhaust memory while the tail (where errors live) stays readable.
 */
export class TailBuffer {
  private head = "";
  private tail = "";
  private omitted = 0;
  private readonly headLimit: number;
  private readonly tailLimit: number;

  constructor(
    readonly limit: number,
    headShare = 0.25,
  ) {
    this.headLimit = Math.floor(limit * headShare);
    this.tailLimit = limit - this.headLimit;
  }

  static readonly DEFAULT_LIMIT = 200_000;

  push(chunk: string): void {
    let rest = chunk;
    if (this.head.length < this.headLimit) {
      const take = Math.min(this.headLimit - this.head.length, rest.length);
      this.head += rest.slice(0, take);
      rest = rest.slice(take);
    }
    if (!rest) return;

    this.tail += rest;
    if (this.tail.length > this.tailLimit) {
      const drop = this.tail.length - this.tailLimit;
      this.tail = this.tail.slice(drop);
      this.omitted += drop;
    }
  }

  get truncated(): boolean {
    return this.omitted > 0;
  }

  toString(): string {
    if (this.omitted === 0) return this.head + this.tail;
    return `${this.head}\n... [${this.omitted} characters omitted] ...\n${this.tail}`;
  }
}

function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Finds an executable on `PATH`, honouring `PATHEXT` on Windows. */
export function resolveBinary(binary: string): string | undefined {
  const hasSeparator = binary.includes("/") || binary.includes("\\");
  if (hasSeparator || path.isAbsolute(binary)) {
    return isExecutableFile(binary) ? binary : undefined;
  }

  const searchPath = process.env.PATH ?? "";
  const directories = searchPath.split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, process.platform === "win32" ? binary + extension : binary);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return undefined;
}

export interface ExecSpec {
  binary: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Character budget for each of stdout and stderr. */
  captureLimit?: number;
  /** Called for every chunk, letting callers stream a live log while the process runs. */
  onData?: (stream: "stdout" | "stderr", chunk: string) => void;
}

/** The captured result of one finished process. Non-zero exits are results, not errors. */
export interface ExecResult {
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

/**
 * A started process.
 *
 * `kill()` exists for callers that need to stop a job imperatively; it does not mark the run as
 * aborted, so the result reports the true exit reason instead of a synthetic cancellation.
 */
export interface RunningExec {
  readonly promise: Promise<ExecResult>;
  /** Terminates the process group without marking the run as aborted. */
  kill(): void;
}

const KILL_GRACE_MS = 2_000;

function terminate(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  if (pid === undefined) return;

  if (process.platform === "win32") {
    child.kill();
    return;
  }

  // Codex may spawn its own children, so signal the whole process group.
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const escalation = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // already gone
    }
  }, KILL_GRACE_MS);
  escalation.unref();
}

/**
 * Spawns a process and resolves once it closes.
 *
 * The promise never rejects for a non-zero exit code and never rejects on timeout or abort: those
 * are recorded in the result so callers can classify them. It rejects only when the process could
 * not be started at all.
 */
export function startExec(spec: ExecSpec): RunningExec {
  const startedAt = Date.now();
  const limit = spec.captureLimit ?? TailBuffer.DEFAULT_LIMIT;
  const stdout = new TailBuffer(limit);
  const stderr = new TailBuffer(limit);

  let timedOut = false;
  let aborted = false;
  let settled = false;

  const child = spawn(spec.binary, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });

  const timer =
    spec.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          terminate(child);
        }, spec.timeoutMs)
      : undefined;
  timer?.unref?.();

  const onAbort = () => {
    aborted = true;
    terminate(child);
  };
  spec.signal?.addEventListener("abort", onAbort, { once: true });
  if (spec.signal?.aborted) onAbort();

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    spec.signal?.removeEventListener("abort", onAbort);
  };

  const promise = new Promise<ExecResult>((resolve, reject) => {
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout.push(chunk);
      spec.onData?.("stdout", chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr.push(chunk);
      spec.onData?.("stderr", chunk);
    });

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new ExecError(
          `Failed to start "${spec.binary}": ${error.message}. Is the Codex CLI installed and on PATH?`,
          { cause: error },
        ),
      );
    });

    child.once("close", (exitCode, exitSignal) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        exitCode,
        exitSignal,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        durationMs: Date.now() - startedAt,
        timedOut,
        aborted,
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
      });
    });
  });

  return {
    promise,
    kill: () => terminate(child),
  };
}
