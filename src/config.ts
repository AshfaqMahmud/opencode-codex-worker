import { statSync } from "node:fs";
import path from "node:path";

export const SANDBOX_MODES = ["read-only", "workspace-write", "danger-full-access"] as const;
export type SandboxMode = (typeof SANDBOX_MODES)[number];

export const EFFORTS = ["minimal", "low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];

/** Plugin options accepted from `opencode.json(c)` under the plugin's `options` key. */
export interface WorkerConfig {
  /** Codex executable name on `PATH`, or an absolute path. Defaults to `codex`. */
  binary: string;
  /** Sandbox used when a tool call does not specify one. Defaults to `workspace-write`. */
  defaultSandbox: SandboxMode;
  /** Model passed to `-m` when a tool call does not specify one. */
  defaultModel?: string;
  /** Reasoning effort used when a tool call does not specify one. */
  defaultEffort?: Effort;
  /** Default task timeout in milliseconds. */
  timeoutMs: number;
  /** Hard ceiling for a per-call timeout. */
  maxTimeoutMs: number;
  /** Maximum number of background jobs running at once. */
  maxConcurrent: number;
  /** Maximum number of finished background jobs kept in memory. */
  maxJobs: number;
  /** Maximum characters of Codex output returned to the model. */
  maxOutputChars: number;
  /** Permit `danger-full-access`, which disables Codex's sandbox entirely. */
  allowDangerFullAccess: boolean;
  /** Extra arguments appended to every `codex exec` invocation. */
  extraArgs: string[];
  /** Extra environment variables for the Codex process. */
  env: Record<string, string>;
}

const FIFTEEN_MINUTES = 15 * 60_000;
const ONE_HOUR = 60 * 60_000;

export const DEFAULT_CONFIG: WorkerConfig = {
  binary: "codex",
  defaultSandbox: "workspace-write",
  timeoutMs: FIFTEEN_MINUTES,
  maxTimeoutMs: ONE_HOUR,
  maxConcurrent: 4,
  maxJobs: 50,
  maxOutputChars: 24_000,
  allowDangerFullAccess: false,
  extraArgs: [],
  env: {},
};

export function isSandboxMode(value: unknown): value is SandboxMode {
  return typeof value === "string" && (SANDBOX_MODES as readonly string[]).includes(value);
}

export function isEffort(value: unknown): value is Effort {
  return typeof value === "string" && (EFFORTS as readonly string[]).includes(value);
}

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return entries.length === value.length ? entries : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

/**
 * Merges plugin options over the defaults. Unknown or malformed values are ignored rather than
 * failing plugin startup, so a typo never takes the whole server down.
 */
export function resolveConfig(options: Record<string, unknown> = {}): WorkerConfig {
  const config: WorkerConfig = { ...DEFAULT_CONFIG };

  const binary = stringOption(options.binary) ?? stringOption(process.env.CODEX_BIN);
  if (binary) config.binary = binary;

  const defaultModel = stringOption(options.defaultModel) ?? stringOption(options.model);
  if (defaultModel) config.defaultModel = defaultModel;

  if (isSandboxMode(options.defaultSandbox)) config.defaultSandbox = options.defaultSandbox;
  if (isEffort(options.defaultEffort)) config.defaultEffort = options.defaultEffort;

  const timeoutMs = positiveNumber(options.timeoutMs);
  if (timeoutMs) config.timeoutMs = timeoutMs;

  const maxTimeoutMs = positiveNumber(options.maxTimeoutMs);
  if (maxTimeoutMs) config.maxTimeoutMs = Math.max(maxTimeoutMs, config.timeoutMs);

  const maxConcurrent = positiveNumber(options.maxConcurrent);
  if (maxConcurrent) config.maxConcurrent = maxConcurrent;

  const maxJobs = positiveNumber(options.maxJobs);
  if (maxJobs) config.maxJobs = maxJobs;

  const maxOutputChars = positiveNumber(options.maxOutputChars);
  if (maxOutputChars) config.maxOutputChars = maxOutputChars;

  if (typeof options.allowDangerFullAccess === "boolean") {
    config.allowDangerFullAccess = options.allowDangerFullAccess;
  }

  const extraArgs = stringArray(options.extraArgs);
  if (extraArgs) config.extraArgs = extraArgs;

  const env = stringRecord(options.env);
  if (env) config.env = env;

  // Never allow a call-level timeout to exceed the configured ceiling.
  config.maxTimeoutMs = Math.max(config.maxTimeoutMs, config.timeoutMs);
  return config;
}

export class ResolveError extends Error {}

/** Resolves a tool-provided `cwd` against the session directory and validates it exists. */
export function resolveWorkingDirectory(input: unknown, baseDirectory: string): string {
  const candidate = typeof input === "string" && input.trim().length > 0 ? input.trim() : undefined;
  const resolved = candidate ? path.resolve(baseDirectory, candidate) : path.resolve(baseDirectory);

  let stats;
  try {
    stats = statSync(resolved);
  } catch {
    throw new ResolveError(`Working directory does not exist: ${resolved}`);
  }
  if (!stats.isDirectory()) throw new ResolveError(`Working directory is not a directory: ${resolved}`);
  return resolved;
}

export function clampTimeout(requested: unknown, config: WorkerConfig): number {
  const value = positiveNumber(requested);
  if (!value) return config.timeoutMs;
  return Math.min(value, config.maxTimeoutMs);
}
