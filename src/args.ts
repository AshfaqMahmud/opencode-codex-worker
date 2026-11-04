/**
 * Argv construction for the three Codex entry points: `exec`, `exec resume` and `exec review`.
 *
 * This module is the only place that knows the CLI's asymmetries. `exec` accepts `-s` for the
 * sandbox, while `resume` and `review` do not and need `-c sandbox_mode="..."` instead. Options are
 * always placed before positionals, and prompts are never interpolated into a shell string.
 */
import type { Effort, SandboxMode, WorkerConfig } from "./config.js";

/** Inputs for `codex exec` and `codex exec resume`. */
export interface TaskArgsInput {
  prompt: string;
  outputFile: string;
  sandbox: SandboxMode;
  model?: string;
  effort?: Effort;
  ephemeral?: boolean;
  resume?: string;
  extraArgs?: string[];
}

/** What `codex exec review` should compare. */
export type ReviewMode = "uncommitted" | "base" | "commit";

/** Inputs for `codex exec review`. */
export interface ReviewArgsInput {
  outputFile: string;
  sandbox: SandboxMode;
  mode: ReviewMode;
  base?: string;
  commit?: string;
  prompt?: string;
  model?: string;
  effort?: Effort;
  ephemeral?: boolean;
  extraArgs?: string[];
}

function commonFlags(input: {
  outputFile: string;
  model?: string;
  effort?: Effort;
  ephemeral?: boolean;
  extraArgs?: string[];
}): string[] {
  const args: string[] = ["--skip-git-repo-check", "-o", input.outputFile];
  if (input.model) args.push("-m", input.model);
  if (input.effort) args.push("-c", `model_reasoning_effort="${input.effort}"`);
  if (input.ephemeral) args.push("--ephemeral");
  if (input.extraArgs?.length) args.push(...input.extraArgs);
  return args;
}

/**
 * `codex exec` and `codex exec resume` accept `-s`; `codex exec review` does not, so review and
 * resume fall back to the equivalent `sandbox_mode` config override.
 */
/**
 * Builds the argv for a task.
 *
 * A resumed run uses `exec resume <id>` plus a `sandbox_mode` override; a fresh run uses `exec -s`.
 */
export function buildTaskArgs(input: TaskArgsInput, config: WorkerConfig): string[] {
  const args = ["exec"];
  if (input.resume) {
    args.push("resume", input.resume, "-c", `sandbox_mode="${input.sandbox}"`);
  } else {
    args.push("-s", input.sandbox);
  }

  args.push(...commonFlags(input));
  args.push(input.prompt);
  return args;
}

/**
 * Builds the argv for a review.
 *
 * @throws when `mode` is `base` without `base`, or `commit` without `commit`. Failing before spawn
 * keeps the error attributable to the caller rather than to Codex.
 */
export function buildReviewArgs(input: ReviewArgsInput, config: WorkerConfig): string[] {
  const args = ["exec", "review", "-c", `sandbox_mode="${input.sandbox}"`];
  args.push(...commonFlags(input));

  if (input.mode === "base") {
    if (!input.base) throw new Error("review mode \"base\" requires a base branch");
    args.push("--base", input.base);
  } else if (input.mode === "commit") {
    if (!input.commit) throw new Error("review mode \"commit\" requires a commit SHA");
    args.push("--commit", input.commit);
  } else {
    args.push("--uncommitted");
  }

  if (input.prompt) args.push(input.prompt);
  return args;
}

/** Human-readable command preview, used in dry runs and job metadata. */
export function describeArgs(args: readonly string[]): string {
  return ["codex", ...args]
    .map((part) => (/[^A-Za-z0-9_./:=@-]/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}
