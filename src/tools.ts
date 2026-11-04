import {
  clampTimeout,
  isEffort,
  isSandboxMode,
  resolveWorkingDirectory,
  type Effort,
  type SandboxMode,
  type WorkerConfig,
} from "./config.js";
import { formatJobList, formatJobView, formatOutcome, type TaskOutcome } from "./format.js";
import { readGitChanges } from "./git.js";
import type { JobManager } from "./jobs.js";
import { toJobView, waitForJob } from "./jobs.js";
import { runReview, runTask, type RunTaskInput } from "./runner.js";
import type { ReviewMode } from "./args.js";

export interface ToolCallContext {
  sessionID: string;
  agent?: string;
  messageID?: string;
  id?: string;
  signal: AbortSignal;
  progress?: (update: Record<string, unknown>) => Promise<void>;
}

export interface ToolResult {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface PermissionRequest {
  sessionID: string;
  agent?: string;
  action: string;
  resources: string[];
  save?: string[];
  source?: { type: "tool"; messageID: string; id: string };
  metadata?: Record<string, unknown>;
}

export interface PermissionGate {
  assert(request: PermissionRequest): Promise<void>;
}

export interface ToolDeps {
  config: WorkerConfig;
  jobs: JobManager;
  /** Directory of the plugin's location, used to resolve relative `cwd` values. */
  directory: string;
  permission: PermissionGate;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input: Record<string, unknown>;
  execute(input: unknown, context: ToolCallContext): Promise<ToolResult>;
}

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ToolInputError("Tool input must be an object.");
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolInputError(`"${field}" must be a non-empty string when provided.`);
  }
  return value.trim();
}

function requireString(value: unknown, field: string): string {
  const parsed = optionalString(value, field);
  if (!parsed) throw new ToolInputError(`"${field}" is required.`);
  return parsed;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new ToolInputError(`"${field}" must be a boolean.`);
  return value;
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ToolInputError(`"${field}" must be an array of strings.`);
  }
  return value as string[];
}

function parseSandbox(value: unknown, config: WorkerConfig): SandboxMode {
  if (value === undefined) return config.defaultSandbox;
  if (!isSandboxMode(value)) {
    throw new ToolInputError(
      `Invalid sandbox ${JSON.stringify(value)}. Use "read-only", "workspace-write", or "danger-full-access".`,
    );
  }
  if (value === "danger-full-access" && !config.allowDangerFullAccess) {
    throw new ToolInputError(
      '"danger-full-access" is disabled. Enable the plugin\'s "allowDangerFullAccess" option to permit it.',
    );
  }
  return value;
}

function parseEffort(value: unknown): Effort | undefined {
  if (value === undefined) return undefined;
  if (!isEffort(value)) {
    throw new ToolInputError(`Invalid effort ${JSON.stringify(value)}. Use "minimal", "low", "medium", or "high".`);
  }
  return value;
}

function parseTaskInput(raw: unknown, deps: ToolDeps): RunTaskInput {
  const value = asRecord(raw);
  const model = optionalString(value.model, "model");
  const resume = optionalString(value.resume, "resume");
  const effort = parseEffort(value.effort);
  const ephemeral = optionalBoolean(value.ephemeral, "ephemeral");
  const includeChanges = optionalBoolean(value.includeChanges, "includeChanges");
  const extraArgs = optionalStringArray(value.extraArgs, "extraArgs");

  const input: RunTaskInput = {
    prompt: requireString(value.prompt, "prompt"),
    cwd: resolveWorkingDirectory(value.cwd, deps.directory),
    sandbox: parseSandbox(value.sandbox, deps.config),
  };
  if (model) input.model = model;
  if (effort) input.effort = effort;
  if (ephemeral !== undefined) input.ephemeral = ephemeral;
  if (includeChanges !== undefined) input.includeChanges = includeChanges;
  if (resume) input.resume = resume;
  if (extraArgs) input.extraArgs = extraArgs;
  if (value.timeoutMs !== undefined) input.timeoutMs = clampTimeout(value.timeoutMs, deps.config);
  return input;
}

async function assertPermission(
  deps: ToolDeps,
  context: ToolCallContext,
  cwd: string,
  sandbox: SandboxMode,
  action: string,
): Promise<void> {
  if (sandbox === "read-only") return;

  await deps.permission.assert({
    sessionID: context.sessionID,
    ...(context.agent ? { agent: context.agent } : {}),
    action,
    resources: [cwd, sandbox],
    ...(context.messageID && context.id
      ? { source: { type: "tool" as const, messageID: context.messageID, id: context.id } }
      : {}),
    metadata: { sandbox },
  });
}

async function notify(context: ToolCallContext, update: Record<string, unknown>): Promise<void> {
  try {
    await context.progress?.(update);
  } catch {
    // Progress reporting is best-effort; never fail a task because of it.
  }
}

function outcomeMetadata(outcome: TaskOutcome, cwd: string): Record<string, unknown> {
  return {
    state: outcome.state,
    exitCode: outcome.exitCode,
    durationMs: outcome.durationMs,
    sandbox: outcome.sandbox,
    cwd,
    ...(outcome.sessionID ? { sessionID: outcome.sessionID } : {}),
    ...(outcome.changes ? { changes: outcome.changes } : {}),
  };
}

const TASK_PROPERTIES = {
  prompt: {
    type: "string",
    description:
      "Task instructions for the Codex worker. Be specific: state the goal, files to touch, and how to verify the result.",
  },
  cwd: {
    type: "string",
    description: "Working directory for the task. Defaults to the current project directory.",
  },
  sandbox: {
    type: "string",
    enum: ["read-only", "workspace-write", "danger-full-access"],
    description:
      "Codex sandbox. read-only inspects without writing; workspace-write can edit the project directory; " +
      "danger-full-access disables sandboxing and must be enabled in plugin options.",
  },
  model: { type: "string", description: "Override the Codex model, for example gpt-6.1-sol." },
  effort: {
    type: "string",
    enum: ["minimal", "low", "medium", "high"],
    description: "Reasoning effort for the worker.",
  },
  timeoutMs: { type: "number", description: "Maximum run time in milliseconds." },
  ephemeral: {
    type: "boolean",
    description: "Do not persist the Codex session to disk. Defaults to false so the run can be resumed.",
  },
  includeChanges: {
    type: "boolean",
    description: "Report files changed during the run by comparing git status before and after. Defaults to true.",
  },
  resume: { type: "string", description: "Resume a previous Codex session id returned by an earlier run." },
  extraArgs: {
    type: "array",
    items: { type: "string" },
    description: "Additional arguments appended to the codex exec invocation. Use sparingly.",
  },
} as const;

const TASK_SCHEMA = {
  type: "object",
  properties: TASK_PROPERTIES,
  required: ["prompt"],
  additionalProperties: false,
} as const;

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    mode: {
      type: "string",
      enum: ["uncommitted", "base", "commit"],
      description: "What to review. Defaults to uncommitted working-tree changes.",
    },
    base: { type: "string", description: "Base branch when mode is base." },
    commit: { type: "string", description: "Commit SHA when mode is commit." },
    prompt: { type: "string", description: "Extra review instructions, such as a focus area." },
    cwd: { type: "string", description: "Repository directory. Defaults to the current project directory." },
    sandbox: {
      type: "string",
      enum: ["read-only", "workspace-write", "danger-full-access"],
      description: "Sandbox for the reviewer. Defaults to read-only.",
    },
    model: { type: "string", description: "Override the Codex model." },
    effort: { type: "string", enum: ["minimal", "low", "medium", "high"] },
    timeoutMs: { type: "number", description: "Maximum run time in milliseconds." },
    extraArgs: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
} as const;

export function createTools(deps: ToolDeps): ToolDefinition[] {
  return [
    {
      name: "task",
      description:
        "Delegate a coding task to the Codex CLI and wait for it to finish. Codex runs as an independent agent " +
        "with its own tools and edits files directly in the working directory, so use it for bulk implementation, " +
        "refactors, or a second opinion. Returns Codex's final message plus files it touched. For long tasks, " +
        "prefer codex_job so the conversation is not blocked.",
      input: TASK_SCHEMA,
      async execute(raw, context) {
        const input = parseTaskInput(raw, deps);
        await assertPermission(deps, context, input.cwd, input.sandbox, "codex.task");
        await notify(context, { status: "Codex task running", cwd: input.cwd, sandbox: input.sandbox });

        const outcome = await runTask(deps.config, input, { signal: context.signal });
        return {
          content: formatOutcome(outcome, deps.config.maxOutputChars),
          metadata: outcomeMetadata(outcome, input.cwd),
        };
      },
    },
    {
      name: "job",
      description:
        "Start a coding task on a Codex worker in the background and return a job id immediately. Use this for " +
        "long-running work, then poll with codex_status or codex_result and stop it with codex_cancel. The job " +
        "keeps running after this tool call returns.",
      input: {
        ...TASK_SCHEMA,
        properties: {
          ...TASK_PROPERTIES,
          label: { type: "string", description: "Short label shown in codex_status listings." },
        },
      },
      async execute(raw, context) {
        const value = asRecord(raw);
        const input = parseTaskInput(raw, deps);
        await assertPermission(deps, context, input.cwd, input.sandbox, "codex.job");

        const job = deps.jobs.start(input, optionalString(value.label, "label"));
        return {
          content: [
            `Started Codex job ${job.id}.`,
            `Label: ${job.label}`,
            `Directory: ${job.cwd} · sandbox ${job.sandbox}`,
            "",
            `Check progress with codex_status ({"jobID":"${job.id}"}) or wait with codex_result.`,
            `Cancel with codex_cancel ({"jobID":"${job.id}"}).`,
          ].join("\n"),
          metadata: { jobID: job.id, state: job.state, cwd: job.cwd, sandbox: job.sandbox },
        };
      },
    },
    {
      name: "status",
      description:
        "List Codex background jobs, or show one job's state, elapsed time, changed files, and latest output. " +
        "Omit jobID to list every job from this session.",
      input: {
        type: "object",
        properties: {
          jobID: { type: "string", description: "Job id returned by codex_job." },
        },
        additionalProperties: false,
      },
      async execute(raw) {
        const value = asRecord(raw);
        const jobID = optionalString(value.jobID, "jobID");
        if (!jobID) {
          const jobs = deps.jobs.list();
          return {
            content: formatJobList(jobs.map(toJobView)),
            metadata: {
              count: jobs.length,
              running: jobs.filter((job) => job.state === "running").length,
            },
          };
        }

        const job = deps.jobs.get(jobID);
        return { content: formatJobView(toJobView(job)), metadata: { jobID: job.id, state: job.state } };
      },
    },
    {
      name: "result",
      description:
        "Wait for a Codex background job and return its final message. Waits up to waitMs (default 30s, max 120s); " +
        "if the job is still running it says so and you can call again.",
      input: {
        type: "object",
        properties: {
          jobID: { type: "string", description: "Job id returned by codex_job." },
          waitMs: { type: "number", description: "How long to wait before returning, in milliseconds." },
        },
        required: ["jobID"],
        additionalProperties: false,
      },
      async execute(raw, context) {
        const value = asRecord(raw);
        const job = deps.jobs.get(requireString(value.jobID, "jobID"));
        const requested = typeof value.waitMs === "number" && Number.isFinite(value.waitMs) ? value.waitMs : 30_000;
        const waitMs = Math.min(Math.max(requested, 0), 120_000);

        const finished = await waitForJob(job, waitMs, context.signal);
        if (!finished) {
          return {
            content: [
              `Job ${job.id} is still running after ${Math.round(waitMs / 1000)}s.`,
              "",
              formatJobView(toJobView(job)),
            ].join("\n"),
            metadata: { jobID: job.id, state: job.state, running: true },
          };
        }

        if (job.error) {
          return {
            content: `Job ${job.id} failed before Codex produced a result: ${job.error}`,
            metadata: { jobID: job.id, state: job.state, error: job.error },
          };
        }

        const outcome = job.outcome;
        if (!outcome) {
          return {
            content: `Job ${job.id} finished with state "${job.state}" but produced no output.`,
            metadata: { jobID: job.id, state: job.state },
          };
        }

        return {
          content: formatOutcome(outcome, deps.config.maxOutputChars),
          metadata: { jobID: job.id, ...outcomeMetadata(outcome, job.cwd) },
        };
      },
    },
    {
      name: "cancel",
      description: "Stop a running Codex background job. The job's process group is terminated.",
      input: {
        type: "object",
        properties: { jobID: { type: "string", description: "Job id returned by codex_job." } },
        required: ["jobID"],
        additionalProperties: false,
      },
      async execute(raw) {
        const value = asRecord(raw);
        const job = deps.jobs.get(requireString(value.jobID, "jobID"));
        const cancelled = deps.jobs.cancel(job.id);

        return {
          content: cancelled
            ? `Cancelling Codex job ${job.id}. Its state becomes "cancelled" once the process exits.`
            : `Job ${job.id} is not running (state: ${job.state}); nothing to cancel.`,
          metadata: { jobID: job.id, state: job.state, cancelled },
        };
      },
    },
    {
      name: "review",
      description:
        "Run a Codex code review over the repository: uncommitted changes, a diff against a base branch, or a " +
        "specific commit. Read-only by default. Returns the review as Codex's final message.",
      input: REVIEW_SCHEMA,
      async execute(raw, context) {
        const value = asRecord(raw);
        const cwd = resolveWorkingDirectory(value.cwd, deps.directory);
        const sandbox = parseSandbox(value.sandbox ?? "read-only", deps.config);
        const effort = parseEffort(value.effort);
        const modeValue = value.mode ?? "uncommitted";
        if (modeValue !== "uncommitted" && modeValue !== "base" && modeValue !== "commit") {
          throw new ToolInputError('"mode" must be "uncommitted", "base", or "commit".');
        }
        const mode: ReviewMode = modeValue;

        const changes = await readGitChanges(cwd);
        if (changes === undefined) {
          throw new ToolInputError(`Codex review needs a Git repository, but ${cwd} is not inside one.`);
        }

        await assertPermission(deps, context, cwd, sandbox, "codex.review");
        await notify(context, { status: "Codex review running", cwd, mode });

        const review = {
          cwd,
          sandbox,
          mode,
          ...(optionalString(value.base, "base") ? { base: optionalString(value.base, "base")! } : {}),
          ...(optionalString(value.commit, "commit") ? { commit: optionalString(value.commit, "commit")! } : {}),
          ...(optionalString(value.prompt, "prompt") ? { prompt: optionalString(value.prompt, "prompt")! } : {}),
          ...(optionalString(value.model, "model") ? { model: optionalString(value.model, "model")! } : {}),
          ...(effort ? { effort } : {}),
          ...(value.timeoutMs === undefined ? {} : { timeoutMs: clampTimeout(value.timeoutMs, deps.config) }),
          ...(optionalStringArray(value.extraArgs, "extraArgs")
            ? { extraArgs: value.extraArgs as string[] }
            : {}),
        };

        const outcome = await runReview(deps.config, review, { signal: context.signal });

        return {
          content: formatOutcome(outcome, deps.config.maxOutputChars),
          metadata: outcomeMetadata(outcome, cwd),
        };
      },
    },
  ];
}
