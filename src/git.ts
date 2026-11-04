import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface GitChange {
  /** Porcelain status code, such as `M` or `??`. */
  status: string;
  path: string;
}

function parsePorcelain(output: string): GitChange[] {
  const entries = output.split("\0").filter((entry) => entry.length > 3);
  return entries.map((entry) => ({
    status: entry.slice(0, 2).trim() || entry.slice(0, 2),
    path: entry.slice(3),
  }));
}

/**
 * Reads working-tree changes. Returns `undefined` when `cwd` is not inside a Git repository so
 * callers can skip change reporting instead of failing the task.
 */
export async function readGitChanges(cwd: string): Promise<GitChange[] | undefined> {
  try {
    const { stdout } = await run(
      "git",
      ["-C", cwd, "status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    return parsePorcelain(stdout);
  } catch {
    return undefined;
  }
}

/** Returns files touched during the run, comparing the after-state against the before-state. */
export function diffChanges(
  before: readonly GitChange[] | undefined,
  after: readonly GitChange[] | undefined,
): string[] | undefined {
  if (!before || !after) return undefined;
  const seen = new Set(before.map((change) => change.path));
  const touched: string[] = [];
  for (const change of after) {
    if (!seen.has(change.path)) touched.push(change.path);
  }
  return [...new Set(touched)].sort();
}
