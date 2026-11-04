import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildReviewArgs, buildTaskArgs, type ReviewMode } from "./args.js";
import { clampTimeout, type Effort, type SandboxMode, type WorkerConfig } from "./config.js";
import { ExecError, resolveBinary, startExec, TailBuffer } from "./exec.js";
import { diffChanges, readGitChanges } from "./git.js";
import type { OutcomeState, TaskOutcome } from "./format.js";

export interface RunTaskInput {
  prompt: string;
  cwd: string;
  sandbox: SandboxMode;
  model?: string;
  effort?: Effort;
  ephemeral?: boolean;
  /** Resume an earlier Codex session id. */
  resume?: string;
  /** Compare `git status` before and after the run. Defaults to true. */
  includeChanges?: boolean;
  timeoutMs?: number;
  extraArgs?: string[];
}

export interface RunReviewInput {
  cwd: string;
  sandbox: SandboxMode;
  mode: ReviewMode;
  base?: string;
  commit?: string;
  prompt?: string;
  model?: string;
  effort?: Effort;
  timeoutMs?: number;
  extraArgs?: string[];
}

export interface RunHooks {
  signal?: AbortSignal;
  onLog?: (chunk: string) => void;
}

interface ExecuteInput {
  cwd: string;
  sandbox: SandboxMode;
  timeoutMs: number;
  includeChanges: boolean;
  build: (outputFile: string) => string[];
  hooks: RunHooks;
}

const SESSION_PATTERN = /session id:\s*([0-9a-fA-F][0-9a-fA-F-]{7,})/i;

function classify(exitCode: number | null, timedOut: boolean, aborted: boolean): OutcomeState {
  if (aborted) return "cancelled";
  if (timedOut) return "timed_out";
  return exitCode === 0 ? "completed" : "failed";
}

async function readTextFile(file: string): Promise<string | undefined> {
  try {
    const text = await readFile(file, "utf8");
    return text.trim().length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

async function execute(config: WorkerConfig, input: ExecuteInput): Promise<TaskOutcome> {
  const binary = resolveBinary(config.binary);
  if (!binary) {
    throw new ExecError(
      `Codex CLI not found (looked for "${config.binary}"). Install it from https://github.com/openai/codex ` +
        `or set the plugin's "binary" option to its absolute path.`,
    );
  }

  const outputFile = path.join(tmpdir(), `opencode-codex-worker-${randomUUID()}.txt`);
  const log = new TailBuffer(8_000);
  const before = input.includeChanges ? await readGitChanges(input.cwd) : undefined;

  try {
    const running = startExec({
      binary,
      args: input.build(outputFile),
      cwd: input.cwd,
      env: { ...process.env, ...config.env },
      timeoutMs: input.timeoutMs,
      signal: input.hooks.signal,
      onData: (_stream, chunk) => {
        log.push(chunk);
        input.hooks.onLog?.(chunk);
      },
    });

    const result = await running.promise;
    const lastMessage = await readTextFile(outputFile);
    const sessionID = SESSION_PATTERN.exec(result.stderr)?.[1];
    const after = input.includeChanges ? await readGitChanges(input.cwd) : undefined;
    const changes = diffChanges(before, after);

    const outcome: TaskOutcome = {
      state: classify(result.exitCode, result.timedOut, result.aborted),
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      sandbox: input.sandbox,
      message: (lastMessage ?? result.stdout).trim(),
      stderrTail: result.stderr.trim().split("\n").slice(-25).join("\n"),
      logTail: log.toString(),
      timedOut: result.timedOut,
      aborted: result.aborted,
    };
    if (sessionID) outcome.sessionID = sessionID;
    if (changes) outcome.changes = changes;
    return outcome;
  } finally {
    await rm(outputFile, { force: true }).catch(() => {});
  }
}

export function runTask(config: WorkerConfig, input: RunTaskInput, hooks: RunHooks = {}): Promise<TaskOutcome> {
  const timeoutMs = clampTimeout(input.timeoutMs, config);
  const model = input.model ?? config.defaultModel;
  const effort = input.effort ?? config.defaultEffort;

  return execute(config, {
    cwd: input.cwd,
    sandbox: input.sandbox,
    timeoutMs,
    includeChanges: input.includeChanges !== false,
    hooks,
    build: (outputFile) =>
      buildTaskArgs(
        {
          prompt: input.prompt,
          outputFile,
          sandbox: input.sandbox,
          ...(model ? { model } : {}),
          ...(effort ? { effort } : {}),
          ...(input.ephemeral === undefined ? {} : { ephemeral: input.ephemeral }),
          ...(input.resume ? { resume: input.resume } : {}),
          ...(input.extraArgs ? { extraArgs: input.extraArgs } : {}),
        },
        config,
      ),
  });
}

export function runReview(config: WorkerConfig, input: RunReviewInput, hooks: RunHooks = {}): Promise<TaskOutcome> {
  const timeoutMs = clampTimeout(input.timeoutMs, config);
  const model = input.model ?? config.defaultModel;
  const effort = input.effort ?? config.defaultEffort;

  return execute(config, {
    cwd: input.cwd,
    sandbox: input.sandbox,
    timeoutMs,
    includeChanges: true,
    hooks,
    build: (outputFile) =>
      buildReviewArgs(
        {
          outputFile,
          sandbox: input.sandbox,
          mode: input.mode,
          ...(input.base ? { base: input.base } : {}),
          ...(input.commit ? { commit: input.commit } : {}),
          ...(input.prompt ? { prompt: input.prompt } : {}),
          ...(model ? { model } : {}),
          ...(effort ? { effort } : {}),
          ...(input.extraArgs ? { extraArgs: input.extraArgs } : {}),
        },
        config,
      ),
  });
}
