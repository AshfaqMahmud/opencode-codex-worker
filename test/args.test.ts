import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReviewArgs, buildTaskArgs, describeArgs } from "../src/args.js";
import { resolveConfig } from "../src/config.js";

const config = resolveConfig();

test("task args put sandbox and prompt in the right places", () => {
  const args = buildTaskArgs({ prompt: "fix the bug", sandbox: "read-only", outputFile: "/tmp/out.txt" }, config);

  assert.deepEqual(args.slice(0, 2), ["exec", "-s"]);
  assert.equal(args[2], "read-only");
  assert.ok(args.includes("--skip-git-repo-check"));
  assert.equal(args.at(-1), "fix the bug");
});

test("resume uses the subcommand and a sandbox config override", () => {
  const args = buildTaskArgs(
    { prompt: "continue", sandbox: "workspace-write", outputFile: "/tmp/out.txt", resume: "abc-123" },
    config,
  );

  assert.deepEqual(args.slice(0, 3), ["exec", "resume", "abc-123"]);
  assert.ok(args.includes("sandbox_mode=\"workspace-write\""));
  assert.ok(!args.includes("-s"));
  assert.equal(args.at(-1), "continue");
});

test("model, effort, ephemeral and extra args are forwarded", () => {
  const args = buildTaskArgs(
    {
      prompt: "go",
      sandbox: "read-only",
      outputFile: "/tmp/out.txt",
      model: "gpt-6.1-sol",
      effort: "high",
      ephemeral: true,
      extraArgs: ["--json"],
    },
    config,
  );

  assert.ok(args.includes("-m"));
  assert.ok(args.includes("gpt-6.1-sol"));
  assert.ok(args.includes('model_reasoning_effort="high"'));
  assert.ok(args.includes("--ephemeral"));
  assert.ok(args.includes("--json"));
});

test("review builds each mode correctly", () => {
  const uncommitted = buildReviewArgs(
    { outputFile: "/tmp/out.txt", sandbox: "read-only", mode: "uncommitted" },
    config,
  );
  assert.deepEqual(uncommitted.slice(0, 3), ["exec", "review", "-c"]);
  assert.ok(uncommitted.includes("--uncommitted"));

  const base = buildReviewArgs(
    { outputFile: "/tmp/out.txt", sandbox: "read-only", mode: "base", base: "main" },
    config,
  );
  assert.deepEqual(base.slice(-2), ["--base", "main"]);

  const commit = buildReviewArgs(
    { outputFile: "/tmp/out.txt", sandbox: "read-only", mode: "commit", commit: "deadbeef" },
    config,
  );
  assert.deepEqual(commit.slice(-2), ["--commit", "deadbeef"]);
});

test("review requires the matching selector", () => {
  assert.throws(
    () => buildReviewArgs({ outputFile: "/tmp/out.txt", sandbox: "read-only", mode: "base" }, config),
    /requires a base branch/,
  );
  assert.throws(
    () => buildReviewArgs({ outputFile: "/tmp/out.txt", sandbox: "read-only", mode: "commit" }, config),
    /requires a commit SHA/,
  );
});

test("describeArgs quotes values with spaces", () => {
  assert.equal(describeArgs(["exec", "hello world"]), 'codex exec "hello world"');
});
