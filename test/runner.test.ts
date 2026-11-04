import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolveConfig } from "../src/config.js";
import { runReview, runTask } from "../src/runner.js";
import { makeFakeCodex, makeTempDir } from "./helpers.js";

const run = promisify(execFile);

test("runTask returns the final message, session id and changes", async () => {
  const binary = await makeFakeCodex();
  const repo = await makeTempDir("codex-repo-");
  await run("git", ["init", "-q", repo]);

  const touched = path.join(repo, "touched.txt");
  const config = resolveConfig({ binary, env: { FAKE_CODEX_TOUCH: touched } });

  const outcome = await runTask(config, {
    prompt: "touch a file",
    cwd: repo,
    sandbox: "workspace-write",
  });

  assert.equal(outcome.state, "completed");
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.message, "FAKE_CODEX_OK");
  assert.equal(outcome.sessionID, "01a1a6d1-4be6-7e82-a0f6-3a47776698ee");
  assert.deepEqual(outcome.changes, ["touched.txt"]);
  assert.equal(outcome.timedOut, false);
});

test("runTask reports a non-zero exit as failed with stderr", async () => {
  const binary = await makeFakeCodex();
  const directory = await makeTempDir("codex-dir-");
  const config = resolveConfig({ binary, env: { FAKE_CODEX_MODE: "fail" } });

  const outcome = await runTask(config, { prompt: "fail", cwd: directory, sandbox: "read-only" });

  assert.equal(outcome.state, "failed");
  assert.equal(outcome.exitCode, 3);
  assert.match(outcome.stderrTail, /fake failure/);
});

test("runTask classifies a timeout", async () => {
  const binary = await makeFakeCodex();
  const directory = await makeTempDir("codex-dir-");
  const config = resolveConfig({ binary, env: { FAKE_CODEX_MODE: "slow" } });

  const outcome = await runTask(config, {
    prompt: "slow",
    cwd: directory,
    sandbox: "read-only",
    timeoutMs: 400,
  });

  assert.equal(outcome.state, "timed_out");
  assert.equal(outcome.timedOut, true);
});

test("runTask classifies an abort as cancelled", async () => {
  const binary = await makeFakeCodex();
  const directory = await makeTempDir("codex-dir-");
  const config = resolveConfig({ binary, env: { FAKE_CODEX_MODE: "slow" } });

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 200);

  const outcome = await runTask(
    config,
    { prompt: "slow", cwd: directory, sandbox: "read-only" },
    { signal: controller.signal },
  );

  assert.equal(outcome.state, "cancelled");
  assert.equal(outcome.aborted, true);
});

test("runTask explains a missing Codex binary", async () => {
  const directory = await makeTempDir("codex-dir-");
  const config = resolveConfig({ binary: path.join(directory, "missing-codex") });

  await assert.rejects(
    runTask(config, { prompt: "x", cwd: directory, sandbox: "read-only" }),
    /Codex CLI not found/,
  );
});

test("runReview passes review flags and returns the review", async () => {
  const binary = await makeFakeCodex();
  const repo = await makeTempDir("codex-review-");
  await run("git", ["init", "-q", repo]);
  await writeFile(path.join(repo, "app.ts"), "export const x = 1;\n");

  const config = resolveConfig({ binary, env: { FAKE_CODEX_MESSAGE: "LGTM" } });
  const outcome = await runReview(config, {
    cwd: repo,
    sandbox: "read-only",
    mode: "uncommitted",
    prompt: "check naming",
  });

  assert.equal(outcome.state, "completed");
  assert.equal(outcome.message, "LGTM");
});
