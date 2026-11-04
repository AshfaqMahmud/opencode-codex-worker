# Design decisions

Short records of choices that are easy to reverse by accident. Each entry states the decision, the
reason, and what would have to change for it to be revisited.

## ADR-001: Wrap the Codex CLI instead of building an HTTP provider

**Decision.** Spawn `codex exec` as a subprocess; do not translate Codex into an OpenAI-compatible
provider or an MCP server.

**Why.** Codex is an agent, not a chat endpoint. Its value is the loop: reading files, editing,
running tests. Reimplementing that as a provider would either lose the loop or duplicate it. The CLI
also carries the user's existing login, configuration and quota.

**Revisit if.** Codex ships a stable, documented session API that is cheaper to integrate than
process supervision.

## ADR-002: Read the final answer from `--output-last-message`

**Decision.** Write Codex's final message to a temp file and read it, falling back to stdout.

**Why.** `codex exec` prints the whole transcript to stderr and the answer to stdout, but the
boundaries are version-dependent and include headers. A dedicated file is the only stable contract.
It also lets the plugin return the answer without leaking tool chatter into the model's context.

**Revisit if.** Codex adds a structured `--json` schema we can rely on across versions. Even then,
the file remains a useful fallback.

## ADR-003: `@opencode/plugin` is an optional peer dependency

**Decision.** Declare it under `peerDependencies` with `optional: true`, and keep a dev dependency
for types.

**Why.** The host already provides the plugin SDK at runtime; a loaded plugin can import
`@opencode/plugin` without its own `node_modules`. Listing it as a dependency would pull `vite` and
`electron` — non-optional peers of the SDK — into every user's install for no benefit. The tarball
is 17.9 kB only because of this.

**Revisit if.** OpenCode stops injecting the SDK, or the SDK's peer graph becomes optional.

## ADR-004: Namespace must be set per tool

**Decision.** Every tool is registered with `options: { namespace: "codex" }`.

**Why.** `editor.namespace()` declares a description; it does not prefix tool names. Without the
per-tool option, tools register as `task`, `job`, `status`, and `task` silently replaces OpenCode's
built-in subagent tool. This was observed in OpenCode 2.0.32 during integration testing.

**Revisit if.** The plugin API starts deriving the namespace from `editor.namespace()`. Until then,
removing the option is a breaking, dangerous regression.

## ADR-005: Jobs are in-memory

**Decision.** `JobManager` keeps jobs in a process-local map and never persists them.

**Why.** A job is a child process. Persisting the record without the process would produce zombies
that report `running` forever after a restart. Cleanup semantics beat fake durability.

**Revisit if.** OpenCode gains durable background execution with process reattachment.

## ADR-006: Ship TypeScript source, publish without a build

**Decision.** `exports` points at `./src/index.ts`; the tarball contains `src/` and no `dist/`.

**Why.** OpenCode executes plugins in a Bun runtime that handles TypeScript natively. A build step
adds a failure mode (stale artifacts) and a source map problem for no runtime benefit.

**Revisit if.** A consumer needs plain JavaScript, for example a Node-based plugin host. Then add a
`dist/` build and keep both entry points.

## ADR-007: Permission prompts only for write-capable sandboxes

**Decision.** `read-only` runs skip `ctx.permission.assert` entirely.

**Why.** Read-only delegation is the common case — exploration, explanation, review. Prompting on
every call would train users to approve reflexively, which is worse than not prompting. Writes and
unsandboxed runs still gate.

**Revisit if.** Users report needing a quota or cost gate rather than a safety gate. That would be a
different action name, not a change to this rule.

## ADR-008: Change detection via before/after `git status`

**Decision.** Diff `git status --porcelain` snapshots instead of producing a patch.

**Why.** Two cheap subprocesses give the practically useful answer ("what did Codex touch?") without
parsing diffs or attributing pre-existing modifications. Codex's own summary covers intent.

**Revisit if.** Users need per-run diffs. That should be an explicit tool, not a side effect of every
task.

## ADR-009: Argv only, never a shell

**Decision.** All invocations pass an argv array to `spawn` with `shell: false`.

**Why.** Prompts are user and model controlled. Shell interpolation would turn a prompt into command
injection. `describeArgs` exists only for human-readable previews.

**Revisit if.** Never. If a shell feature is needed, add a flag rather than a command string.
