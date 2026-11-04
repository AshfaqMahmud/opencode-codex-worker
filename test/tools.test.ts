import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { resolveConfig } from "../src/config.js";
import { JobManager } from "../src/jobs.js";
import { runTask } from "../src/runner.js";
import { createTools, type PermissionRequest, type ToolCallContext, type ToolDefinition } from "../src/tools.js";
import { makeFakeCodex, makeTempDir } from "./helpers.js";

interface Harness {
  tools: Map<string, ToolDefinition>;
  permissions: PermissionRequest[];
  manager: JobManager;
  directory: string;
  config: ReturnType<typeof resolveConfig>;
}

async function harness(overrides: Record<string, unknown> = {}): Promise<Harness> {
  const binary = await makeFakeCodex();
  const directory = await makeTempDir("codex-tools-");
  const config = resolveConfig({ binary, ...overrides });
  const manager = new JobManager(config, (input, hooks) => runTask(config, input, hooks));
  const permissions: PermissionRequest[] = [];

  const tools = createTools({
    config,
    jobs: manager,
    directory,
    permission: {
      assert: async (request) => {
        permissions.push(request);
      },
    },
  });

  return {
    tools: new Map(tools.map((tool) => [tool.name, tool])),
    permissions,
    manager,
    directory,
    config,
  };
}

function context(signal = new AbortController().signal): ToolCallContext {
  return { sessionID: "ses_test", agent: "build", messageID: "msg_1", id: "call_1", signal };
}

function tool(harness: Harness, name: string): ToolDefinition {
  const found = harness.tools.get(name);
  assert.ok(found, `missing tool ${name}`);
  return found;
}

test("codex_task runs a read-only task without a permission prompt", async () => {
  const h = await harness();
  const result = await tool(h, "task").execute(
    { prompt: "look around", sandbox: "read-only", cwd: h.directory },
    context(),
  );

  assert.match(result.content, /Codex finished/);
  assert.match(result.content, /FAKE_CODEX_OK/);
  assert.equal(result.metadata?.state, "completed");
  assert.equal(h.permissions.length, 0);
});

test("codex_task asks for permission before writing", async () => {
  const h = await harness();
  await tool(h, "task").execute({ prompt: "edit files", cwd: h.directory }, context());

  assert.equal(h.permissions.length, 1);
  assert.equal(h.permissions[0]?.action, "codex.task");
  assert.deepEqual(h.permissions[0]?.resources, [h.directory, "workspace-write"]);
});

test("danger-full-access is blocked unless enabled in options", async () => {
  const h = await harness();
  await assert.rejects(
    tool(h, "task").execute({ prompt: "yolo", sandbox: "danger-full-access" }, context()),
    /danger-full-access" is disabled/,
  );

  const allowed = await harness({ allowDangerFullAccess: true });
  await tool(allowed, "task").execute({ prompt: "yolo", sandbox: "danger-full-access" }, context());
  assert.equal(allowed.permissions.length, 1);
});

test("invalid inputs are rejected before running anything", async () => {
  const h = await harness();

  await assert.rejects(tool(h, "task").execute({}, context()), /"prompt" is required/);
  await assert.rejects(
    tool(h, "task").execute({ prompt: "x", sandbox: "unsafe" }, context()),
    /Invalid sandbox/,
  );
  await assert.rejects(
    tool(h, "task").execute({ prompt: "x", cwd: path.join(h.directory, "missing") }, context()),
    /does not exist/,
  );
});

test("codex_job returns an id and codex_result returns the message", async () => {
  const h = await harness();
  const started = await tool(h, "job").execute(
    { prompt: "background work", sandbox: "read-only", label: "bg" },
    context(),
  );

  const jobID = String(started.metadata?.jobID);
  assert.match(jobID, /^cx_/);
  assert.match(started.content, /Started Codex job/);

  const result = await tool(h, "result").execute({ jobID, waitMs: 5_000 }, context());
  assert.match(result.content, /FAKE_CODEX_OK/);
  assert.equal(result.metadata?.state, "completed");

  const status = await tool(h, "status").execute({ jobID }, context());
  assert.match(status.content, /completed/);
  assert.equal(status.metadata?.state, "completed");
});

test("codex_status lists jobs and codex_cancel stops a running one", async () => {
  const h = await harness({ env: { FAKE_CODEX_MODE: "slow" } });
  const started = await tool(h, "job").execute({ prompt: "slow job", sandbox: "read-only" }, context());
  const jobID = String(started.metadata?.jobID);

  const list = await tool(h, "status").execute({}, context());
  assert.match(list.content, /1 Codex job/);
  assert.equal(list.metadata?.running, 1);

  const cancelled = await tool(h, "cancel").execute({ jobID }, context());
  assert.match(cancelled.content, /Cancelling/);

  const result = await tool(h, "result").execute({ jobID, waitMs: 10_000 }, context());
  assert.match(result.content, /cancelled/);
});

test("codex_review refuses directories outside a git repository", async () => {
  const h = await harness();
  const plain = await makeTempDir("not-a-repo-");
  await mkdir(path.join(plain, "sub"));

  await assert.rejects(
    tool(h, "review").execute({ cwd: plain }, context()),
    /needs a Git repository/,
  );
});

test("codex_review runs against a git repository", async () => {
  const h = await harness();
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  await run("git", ["init", "-q", h.directory]);

  const result = await tool(h, "review").execute({ cwd: h.directory, prompt: "check style" }, context());
  assert.match(result.content, /Codex finished/);
  assert.equal(h.permissions.length, 0);
});
