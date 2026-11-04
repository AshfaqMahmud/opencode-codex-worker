import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { TailBuffer, resolveBinary, startExec } from "../src/exec.js";
import { makeTempDir } from "./helpers.js";

test("TailBuffer keeps the head and the tail of a large stream", () => {
  const buffer = new TailBuffer(100, 0.25);
  for (let index = 0; index < 50; index += 1) buffer.push("0123456789");

  const text = buffer.toString();
  assert.equal(buffer.truncated, true);
  assert.match(text, /characters omitted/);
  assert.ok(text.startsWith("0123456789"));
  assert.ok(text.endsWith("0123456789"));
});

test("TailBuffer concatenates small streams untouched", () => {
  const buffer = new TailBuffer(100);
  buffer.push("hello ");
  buffer.push("world");
  assert.equal(buffer.truncated, false);
  assert.equal(buffer.toString(), "hello world");
});

test("resolveBinary finds an absolute path and rejects a missing one", async () => {
  const directory = await makeTempDir();
  assert.equal(resolveBinary(directory), undefined);
  assert.equal(resolveBinary(path.join(directory, "nope")), undefined);
  assert.ok(resolveBinary(process.execPath));
});

test("startExec captures stdout, stderr and the exit code", async () => {
  const result = await startExec({
    binary: process.execPath,
    args: ["-e", 'process.stdout.write("out");process.stderr.write("err");process.exit(4)'],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 10_000,
  }).promise;

  assert.equal(result.stdout, "out");
  assert.equal(result.stderr, "err");
  assert.equal(result.exitCode, 4);
  assert.equal(result.timedOut, false);
  assert.equal(result.aborted, false);
});

test("startExec kills a process that exceeds its timeout", async () => {
  const result = await startExec({
    binary: process.execPath,
    args: ["-e", "setTimeout(() => {}, 30_000)"],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 300,
  }).promise;

  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
});

test("startExec kills a process when the signal aborts", async () => {
  const controller = new AbortController();
  const running = startExec({
    binary: process.execPath,
    args: ["-e", "setTimeout(() => {}, 30_000)"],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 30_000,
    signal: controller.signal,
  });

  setTimeout(() => controller.abort(), 150);
  const result = await running.promise;

  assert.equal(result.aborted, true);
  assert.equal(result.timedOut, false);
});

test("startExec streams chunks as they arrive", async () => {
  const chunks: string[] = [];
  await startExec({
    binary: process.execPath,
    args: ["-e", 'process.stdout.write("streamed")'],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 10_000,
    onData: (_stream, chunk) => chunks.push(chunk),
  }).promise;

  assert.equal(chunks.join(""), "streamed");
});
