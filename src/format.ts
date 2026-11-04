/**
 * Human-readable rendering of task outcomes and jobs.
 *
 * The model reads these strings, so they are written for prose, not logs: a status line, the answer,
 * the files touched, and diagnostics only when something went wrong.
 */
import type { SandboxMode } from "./config.js";

/** Terminal states a Codex run can reach. */
export type OutcomeState = "completed" | "failed" | "timed_out" | "cancelled";

/** Everything the plugin returns about one run. */
export interface TaskOutcome {
  state: OutcomeState;
  exitCode: number | null;
  durationMs: number;
  sandbox: SandboxMode;
  /** Codex's final message, from `--output-last-message` or stdout. */
  message: string;
  /** Diagnostics from stderr, useful when a run fails. */
  stderrTail: string;
  /** Tail of the live log, used for background job previews. */
  logTail: string;
  sessionID?: string;
  changes?: string[];
  timedOut: boolean;
  aborted: boolean;
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

/** Keeps the start and end of long text, marking how much was dropped in the middle. */
export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const marker = `\n... [${text.length - max} characters truncated] ...\n`;
  const budget = Math.max(max - marker.length, 0);
  const head = Math.ceil(budget * 0.7);
  const tail = Math.floor(budget * 0.3);
  return `${text.slice(0, head)}${marker}${tail > 0 ? text.slice(text.length - tail) : ""}`;
}

const STATE_LABEL: Record<OutcomeState, string> = {
  completed: "finished",
  failed: "failed",
  timed_out: "timed out",
  cancelled: "cancelled",
};

export function formatOutcome(outcome: TaskOutcome, maxChars: number): string {
  const lines: string[] = [];
  const exit = outcome.exitCode === null ? "no exit code" : `exit ${outcome.exitCode}`;
  lines.push(
    `Codex ${STATE_LABEL[outcome.state]} · ${formatDuration(outcome.durationMs)} · ${exit} · sandbox ${outcome.sandbox}`,
  );
  if (outcome.sessionID) lines.push(`Session: ${outcome.sessionID}`);

  if (outcome.changes && outcome.changes.length > 0) {
    lines.push(`Files touched (${outcome.changes.length}):`);
    for (const file of outcome.changes.slice(0, 40)) lines.push(`  ${file}`);
    if (outcome.changes.length > 40) lines.push(`  ... and ${outcome.changes.length - 40} more`);
  }

  const message = outcome.message.trim();
  lines.push("");
  if (message) {
    lines.push(truncateMiddle(message, maxChars));
  } else if (outcome.state === "completed") {
    lines.push("(Codex returned no final message.)");
  }

  const diagnostics = outcome.stderrTail.trim();
  if (diagnostics && outcome.state !== "completed") {
    lines.push("", "stderr (tail):", truncateMiddle(diagnostics, Math.min(4_000, maxChars)));
  }

  if (outcome.timedOut) lines.push("", "The task exceeded its timeout and was terminated.");
  if (outcome.aborted) lines.push("", "The task was cancelled.");

  return lines.join("\n");
}

/** A resolved, serializable projection of a job, safe to format or return as metadata. */
export interface JobSummaryView {
  id: string;
  label: string;
  state: string;
  cwd: string;
  sandbox: SandboxMode;
  createdAt: number;
  finishedAt?: number;
  prompt: string;
  outcome?: TaskOutcome;
  error?: string;
  preview: string;
}

export function formatJobView(job: JobSummaryView): string {
  const elapsed = (job.finishedAt ?? Date.now()) - job.createdAt;
  const lines = [
    `Job ${job.id} · ${job.state} · ${formatDuration(elapsed)} · sandbox ${job.sandbox}`,
    `Label: ${job.label}`,
    `Directory: ${job.cwd}`,
  ];
  if (job.outcome?.sessionID) lines.push(`Session: ${job.outcome.sessionID}`);
  if (job.outcome?.changes?.length) {
    lines.push(`Files touched (${job.outcome.changes.length}):`);
    for (const file of job.outcome.changes.slice(0, 20)) lines.push(`  ${file}`);
  }
  if (job.error) lines.push("", `Error: ${job.error}`);
  if (job.preview.trim()) lines.push("", "Latest output:", truncateMiddle(job.preview.trim(), 2_000));
  return lines.join("\n");
}

export function formatJobList(jobs: readonly JobSummaryView[]): string {
  if (jobs.length === 0) return "No Codex jobs have been started in this session.";
  const lines = [`${jobs.length} Codex job${jobs.length === 1 ? "" : "s"}:`];
  for (const job of jobs) {
    const elapsed = (job.finishedAt ?? Date.now()) - job.createdAt;
    lines.push(`- ${job.id} · ${job.state} · ${formatDuration(elapsed)} · ${job.label}`);
  }
  return lines.join("\n");
}
