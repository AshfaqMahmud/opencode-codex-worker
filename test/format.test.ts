import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskOutcome } from "../src/format.js";
import { formatDuration, formatJobList, formatJobView, formatOutcome, truncateMiddle } from "../src/format.js";

const outcome: TaskOutcome = {
  state: "completed",
  exitCode: 0,
  durationMs: 1_500,
  sandbox: "workspace-write",
  message: "Implemented the parser and added tests.",
  stderrTail: "",
  logTail: "",
  sessionID: "01a1a6d1",
  changes: ["src/parser.ts", "test/parser.test.ts"],
  timedOut: false,
  aborted: false,
};

test("formatDuration handles milliseconds, seconds and minutes", () => {
  assert.equal(formatDuration(420), "420ms");
  assert.equal(formatDuration(1_500), "1.5s");
  assert.equal(formatDuration(95_000), "1m 35s");
});

test("truncateMiddle keeps both ends and reports the drop", () => {
  const text = "a".repeat(100) + "b".repeat(100);
  const truncated = truncateMiddle(text, 60);
  assert.ok(truncated.length < text.length + 60);
  assert.match(truncated, /characters truncated/);
  assert.ok(truncated.startsWith("aaa"));
  assert.ok(truncated.endsWith("bbb"));
  assert.equal(truncateMiddle("short", 100), "short");
});

test("formatOutcome includes status, session, changes and message", () => {
  const text = formatOutcome(outcome, 10_000);
  assert.match(text, /Codex finished · 1\.5s · exit 0 · sandbox workspace-write/);
  assert.match(text, /Session: 01a1a6d1/);
  assert.match(text, /src\/parser\.ts/);
  assert.match(text, /Implemented the parser/);
});

test("formatOutcome surfaces stderr and timeout notices on failures", () => {
  const text = formatOutcome(
    { ...outcome, state: "timed_out", exitCode: null, message: "", stderrTail: "boom", timedOut: true },
    5_000,
  );
  assert.match(text, /Codex timed out/);
  assert.match(text, /stderr \(tail\)/);
  assert.match(text, /exceeded its timeout/);
});

test("formatJobView and formatJobList render job state", () => {
  const view = {
    id: "cx_123",
    label: "refactor auth",
    state: "running",
    cwd: "/repo",
    sandbox: "workspace-write" as const,
    createdAt: Date.now() - 2_000,
    prompt: "refactor auth",
    preview: "thinking...",
  };

  const single = formatJobView(view);
  assert.match(single, /Job cx_123 · running/);
  assert.match(single, /thinking\.\.\./);
  assert.match(formatJobList([]), /No Codex jobs/);
  assert.match(formatJobList([view, { ...view, id: "cx_456" }]), /2 Codex jobs/);
});
