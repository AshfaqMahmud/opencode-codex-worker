/**
 * Background job bookkeeping.
 *
 * A job is a promise plus a process handle. The registry enforces concurrency, keeps a bounded tail
 * of live output for previews, and prunes finished entries. It is intentionally in-memory: a job
 * cannot outlive the server process, so persisting the record would only create zombies that report
 * `running` forever.
 */
import { randomUUID } from "node:crypto";
import type { SandboxMode, WorkerConfig } from "./config.js";
import { TailBuffer } from "./exec.js";
import type { JobSummaryView, OutcomeState, TaskOutcome } from "./format.js";
import type { RunTaskInput } from "./runner.js";

/** `running` before the executor settles, then the terminal outcome state. */
export type JobState = "running" | OutcomeState;

/** A live job: the serializable view plus a completion promise and a live output preview. */
export interface Job extends Omit<JobSummaryView, "preview"> {
  readonly prompt: string;
  done: Promise<void>;
  /** Live tail of the worker's output, truncated as the job runs. */
  previewText(): string;
}

/** Raised when `maxConcurrent` would be exceeded. The message names the current count and the limit. */
export class JobLimitError extends Error {
  constructor(
    readonly running: number,
    readonly limit: number,
  ) {
    super(
      `Too many Codex jobs running (${running}/${limit}). Wait for one to finish, cancel one, ` +
        `or raise the plugin's "maxConcurrent" option.`,
    );
  }
}

/** Raised for an unknown job id, with a hint to list jobs. */
export class JobNotFoundError extends Error {
  constructor(readonly jobID: string) {
    super(`No Codex job with id "${jobID}". Use codex_status to list jobs.`);
  }
}

/**
 * The work a job performs. Injected so the registry can be tested without Codex, and so the plugin
 * can pass `runTask` without `jobs.ts` importing the runner.
 */
export type JobExecutor = (
  input: RunTaskInput,
  hooks: { signal: AbortSignal; onLog: (chunk: string) => void },
) => Promise<TaskOutcome>;

interface JobRecord extends Job {
  readonly controller: AbortController;
  readonly log: TailBuffer;
}

function defaultLabel(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 60) return collapsed;
  return `${collapsed.slice(0, 57)}...`;
}

function createJobID(): string {
  return `cx_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

/**
 * Registry of background jobs for one plugin instance.
 *
 * Not thread-safe by design: OpenCode runs plugin code on a single event loop, and all mutation
 * happens synchronously around async boundaries.
 */
export class JobManager {
  private readonly jobs = new Map<string, JobRecord>();

  constructor(
    private readonly config: WorkerConfig,
    private readonly execute: JobExecutor,
  ) {}

  runningCount(): number {
    let count = 0;
    for (const job of this.jobs.values()) if (job.state === "running") count += 1;
    return count;
  }

/**
 * Starts a job and returns immediately.
 *
 * @throws {JobLimitError} when `maxConcurrent` jobs are already running. The executor's failures are
 * captured on the job (`state: "failed"`, `error`) instead of rejecting, so a forgotten job never
 * produces an unhandled rejection.
 */
  start(input: RunTaskInput, label?: string): Job {
    const running = this.runningCount();
    if (running >= this.config.maxConcurrent) throw new JobLimitError(running, this.config.maxConcurrent);

    const controller = new AbortController();
    const log = new TailBuffer(8_000);
    const job: JobRecord = {
      id: createJobID(),
      label: label?.trim() || defaultLabel(input.prompt),
      prompt: input.prompt,
      cwd: input.cwd,
      sandbox: input.sandbox as SandboxMode,
      createdAt: Date.now(),
      state: "running",
      previewText: () => log.toString().trim(),
      done: Promise.resolve(),
      controller,
      log,
    };

    this.jobs.set(job.id, job);
    job.done = this.execute(input, {
      signal: controller.signal,
      onLog: (chunk) => log.push(chunk),
    })
      .then((outcome) => {
        job.outcome = outcome;
        job.state = outcome.state;
      })
      .catch((error: unknown) => {
        job.error = error instanceof Error ? error.message : String(error);
        job.state = "failed";
      })
      .finally(() => {
        job.finishedAt = Date.now();
        this.prune();
      });

    return job;
  }

  get(jobID: string): Job {
    const job = this.jobs.get(jobID);
    if (!job) throw new JobNotFoundError(jobID);
    return job;
  }

  find(jobID: string): Job | undefined {
    return this.jobs.get(jobID);
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Aborts a running job. Returns false when it had already finished. */
  cancel(jobID: string): boolean {
    const job = this.jobs.get(jobID);
    if (!job) throw new JobNotFoundError(jobID);
    if (job.state !== "running") return false;
    job.controller.abort();
    return true;
  }

  /** Aborts every running job and clears the registry. Called when the plugin unloads. */
  dispose(): void {
    for (const job of this.jobs.values()) {
      if (job.state === "running") job.controller.abort();
    }
    this.jobs.clear();
  }

  private prune(): void {
    const finished = [...this.jobs.values()]
      .filter((job) => job.state !== "running")
      .sort((a, b) => a.createdAt - b.createdAt);

    while (finished.length > this.config.maxJobs) {
      const oldest = finished.shift();
      if (!oldest) break;
      this.jobs.delete(oldest.id);
    }
  }
}

/** Projects a live job onto the serializable view used by formatting helpers. */
export function toJobView(job: Job): JobSummaryView {
  return {
    id: job.id,
    label: job.label,
    state: job.state,
    cwd: job.cwd,
    sandbox: job.sandbox,
    createdAt: job.createdAt,
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
    prompt: job.prompt,
    ...(job.outcome ? { outcome: job.outcome } : {}),
    ...(job.error ? { error: job.error } : {}),
    preview: job.previewText(),
  };
}

/** Waits up to `timeoutMs` for a job to finish. Returns false when it is still running. */
export function waitForJob(job: Job, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  if (job.state !== "running") return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const onAbort = () => {
      cleanup();
      resolve(false);
    };
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = () => {
      cleanup();
      resolve(true);
    };

    void job.done.then(finish, finish);
    timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}
