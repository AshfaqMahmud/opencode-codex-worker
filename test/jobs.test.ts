import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { resolveConfig } from "../src/config.js";
import { JobLimitError, JobManager, waitForJob } from "../src/jobs.js";
import { runTask } from "../src/runner.js";
import { makeFakeCodex, makeTempDir } from "./helpers.js";

async function setup(overrides: Record<string, unknown> = {}) {
  const binary = await makeFakeCodex();
  const directory = await makeTempDir("codex-job-");
  const config = resolveConfig({ binary, ...overrides });
  const manager = new JobManager(config, (input, hooks) => runTask(config, input, hooks));
  return { config, manager, directory, binary };
}

test("a job starts running and finishes with an outcome", async () => {
  const { manager, directory } = await setup();

  const job = manager.start({ prompt: "say hi", cwd: directory, sandbox: "read-only" });
  assert.equal(job.state, "running");
  assert.match(job.id, /^cx_/);

  assert.equal(await waitForJob(job, 10_000), true);
  assert.equal(job.state, "completed");
  assert.equal(job.outcome?.message, "FAKE_CODEX_OK");
  assert.ok(job.finishedAt);

  manager.dispose();
});

test("a failing job records the failure instead of rejecting", async () => {
  const { manager, directory } = await setup({ env: { FAKE_CODEX_MODE: "fail" } });

  const job = manager.start({ prompt: "fail", cwd: directory, sandbox: "read-only" });
  await waitForJob(job, 10_000);

  assert.equal(job.state, "failed");
  assert.equal(job.outcome?.exitCode, 3);

  manager.dispose();
});

test("concurrency limit rejects extra jobs", async () => {
  const { manager, directory } = await setup({ maxConcurrent: 1, env: { FAKE_CODEX_MODE: "slow" } });

  const job = manager.start({ prompt: "slow", cwd: directory, sandbox: "read-only" });
  assert.throws(
    () => manager.start({ prompt: "another", cwd: directory, sandbox: "read-only" }),
    (error: unknown) => error instanceof JobLimitError,
  );

  manager.cancel(job.id);
  await waitForJob(job, 10_000);
  assert.equal(job.state, "cancelled");

  manager.dispose();
});

test("cancel stops a running job", async () => {
  const { manager, directory } = await setup({ env: { FAKE_CODEX_MODE: "slow" } });

  const job = manager.start({ prompt: "slow", cwd: directory, sandbox: "read-only" });
  assert.equal(manager.cancel(job.id), true);
  await waitForJob(job, 10_000);

  assert.equal(job.state, "cancelled");
  assert.equal(manager.cancel(job.id), false);

  manager.dispose();
});

test("waitForJob returns false while the job is still running", async () => {
  const { manager, directory } = await setup({ env: { FAKE_CODEX_MODE: "slow" } });

  const job = manager.start({ prompt: "slow", cwd: directory, sandbox: "read-only" });
  assert.equal(await waitForJob(job, 50), false);

  manager.cancel(job.id);
  await waitForJob(job, 10_000);
  manager.dispose();
});

test("finished jobs are pruned to maxJobs", async () => {
  const { manager, directory } = await setup({ maxJobs: 2 });

  for (let index = 0; index < 4; index += 1) {
    const job = manager.start({ prompt: `job ${index}`, cwd: directory, sandbox: "read-only" });
    await waitForJob(job, 10_000);
  }

  assert.ok(manager.list().length <= 2);
  manager.dispose();
});

test("labels default to the prompt and can be overridden", async () => {
  const { manager, directory } = await setup();

  const auto = manager.start({ prompt: "  refactor   the auth module  ", cwd: directory, sandbox: "read-only" });
  assert.equal(auto.label, "refactor the auth module");

  const labelled = manager.start(
    { prompt: "something long enough to be truncated", cwd: directory, sandbox: "read-only" },
    "custom label",
  );
  assert.equal(labelled.label, "custom label");

  await Promise.all([waitForJob(auto, 10_000), waitForJob(labelled, 10_000)]);
  manager.dispose();
});

test("unknown job ids throw", async () => {
  const { manager } = await setup();
  assert.throws(() => manager.get("cx_missing"), /No Codex job/);
  manager.dispose();
});
