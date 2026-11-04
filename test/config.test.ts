import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_CONFIG,
  clampTimeout,
  isEffort,
  isSandboxMode,
  resolveConfig,
  resolveWorkingDirectory,
} from "../src/config.js";
import { makeTempDir } from "./helpers.js";

test("defaults are applied when no options are given", () => {
  const config = resolveConfig();
  assert.equal(config.binary, "codex");
  assert.equal(config.defaultSandbox, "workspace-write");
  assert.equal(config.timeoutMs, DEFAULT_CONFIG.timeoutMs);
  assert.equal(config.allowDangerFullAccess, false);
});

test("options override defaults", () => {
  const config = resolveConfig({
    binary: "/opt/bin/codex",
    defaultSandbox: "read-only",
    defaultModel: "gpt-6.1-sol",
    defaultEffort: "high",
    timeoutMs: 1_000,
    maxOutputChars: 500,
    allowDangerFullAccess: true,
    extraArgs: ["--json"],
    env: { CODEX_HOME: "/tmp/codex-home" },
  });

  assert.equal(config.binary, "/opt/bin/codex");
  assert.equal(config.defaultSandbox, "read-only");
  assert.equal(config.defaultModel, "gpt-6.1-sol");
  assert.equal(config.defaultEffort, "high");
  assert.equal(config.timeoutMs, 1_000);
  assert.equal(config.maxOutputChars, 500);
  assert.equal(config.allowDangerFullAccess, true);
  assert.deepEqual(config.extraArgs, ["--json"]);
  assert.deepEqual(config.env, { CODEX_HOME: "/tmp/codex-home" });
});

test("malformed options are ignored instead of throwing", () => {
  const config = resolveConfig({
    binary: 42,
    defaultSandbox: "unsafe",
    timeoutMs: -5,
    maxConcurrent: "many",
    extraArgs: ["--ok", 7],
    env: { GOOD: "yes", BAD: 1 },
  });

  assert.equal(config.binary, "codex");
  assert.equal(config.defaultSandbox, "workspace-write");
  assert.equal(config.timeoutMs, DEFAULT_CONFIG.timeoutMs);
  assert.equal(config.maxConcurrent, DEFAULT_CONFIG.maxConcurrent);
  assert.deepEqual(config.extraArgs, []);
  assert.deepEqual(config.env, { GOOD: "yes" });
});

test("maxTimeoutMs never drops below the default timeout", () => {
  const config = resolveConfig({ timeoutMs: 5_000, maxTimeoutMs: 100 });
  assert.equal(config.maxTimeoutMs, 5_000);
});

test("clampTimeout uses the default and respects the ceiling", () => {
  const config = resolveConfig({ timeoutMs: 2_000, maxTimeoutMs: 10_000 });
  assert.equal(clampTimeout(undefined, config), 2_000);
  assert.equal(clampTimeout(50_000, config), 10_000);
  assert.equal(clampTimeout(0, config), 2_000);
  assert.equal(clampTimeout("soon", config), 2_000);
});

test("sandbox and effort guards", () => {
  assert.equal(isSandboxMode("read-only"), true);
  assert.equal(isSandboxMode("yolo"), false);
  assert.equal(isEffort("medium"), true);
  assert.equal(isEffort("extreme"), false);
});

test("resolveWorkingDirectory resolves relative paths and rejects missing directories", async () => {
  const base = await makeTempDir();
  await mkdir(path.join(base, "nested"));
  await writeFile(path.join(base, "file.txt"), "x");

  assert.equal(resolveWorkingDirectory("nested", base), path.join(base, "nested"));
  assert.equal(resolveWorkingDirectory(undefined, base), base);
  assert.throws(() => resolveWorkingDirectory("missing", base), /does not exist/);
  assert.throws(() => resolveWorkingDirectory("file.txt", base), /not a directory/);
});
