# Architecture

This document describes how `opencode-codex-worker` is put together, why each moving part exists,
and where to look when changing it.

## High-level shape

```
OpenCode server
└── plugin: opencode-codex-worker (src/index.ts)
    ├── WorkerConfig          resolved once from plugin options        (src/config.ts)
    ├── JobManager            in-memory registry of background jobs    (src/jobs.ts)
    └── tools                 registered under the `codex` namespace
        ├── codex_task   ─┐
        ├── codex_job    ─┼─► runner.ts ─► exec.ts ─► codex exec
        ├── codex_review ─┘        │
        ├── codex_status           └─► git.ts   (before/after working-tree snapshots)
        ├── codex_result
        └── codex_cancel
```

There is no build step. OpenCode loads TypeScript directly, so `package.json` points `exports` at
`./src/index.ts` and the published tarball contains `src/`.

## Lifecycle

`src/index.ts` default-exports `Plugin.define({ id, setup })`. OpenCode calls `setup` once per
location, per server process.

`setup` does four things:

1. Resolves plugin options into an immutable `WorkerConfig`.
2. Creates a `JobManager` whose executor is `runTask`.
3. Registers tools inside a single `ctx.tool.transform` callback.
4. Returns a cleanup function that aborts running jobs and disposes the tool registration.

Tool registration is wrapped in one transform for atomicity: either the whole `codex` namespace is
available, or none of it is.

### Why `options: { namespace: "codex" }` is required

`editor.namespace({ name: "codex", ... })` only declares the namespace **description**. The prefix
is applied from each tool's own `options.namespace`. Without it, tools register as bare `task`,
`job`, `status`… and `task` silently shadows OpenCode's built-in subagent tool. This was a real bug
caught during integration testing; see [design decisions](./design-decisions.md#adr-004-namespace-must-be-set-per-tool).

## Execution pipeline

Every task and review funnels through `execute()` in `src/runner.ts`:

1. **Resolve the binary.** `resolveBinary` checks the configured path, then walks `PATH`
   (honouring `PATHEXT` on Windows) and verifies the candidate is an executable *file*.
2. **Create a private output file.** `--output-last-message` writes Codex's final message to a
   random file under the OS temp directory. This is the only reliable way to separate the answer
   from the transcript that Codex also prints.
3. **Snapshot Git state** (tasks only, when `includeChanges` is true). Failure to find a repository
   yields `undefined`, never an error.
4. **Spawn.** `stdio` is `["ignore", "pipe", "pipe"]`. Stdin *must* be ignored: when Codex sees a
   pipe on stdin it prints "Reading additional input from stdin..." and waits.
5. **Supervise.** A timer enforces the timeout; an `AbortSignal` covers cancellation. Both route
   through `terminate()`, which signals the whole process group (`detached: true` on POSIX) so child
   processes Codex spawned die too, escalating to `SIGKILL` after two seconds.
6. **Collect.** stdout and stderr are captured by `TailBuffer`, which keeps the first 25% and the
   last 75% of a character budget with an explicit omission marker.
7. **Parse.** The session id is read from stderr (`session id: <uuid>`), the final message from the
   output file, and changes by diffing the Git snapshots.
8. **Clean up.** The output file is removed in a `finally` block.

The pipeline never rejects on a non-zero exit code. It returns a `TaskOutcome` with
`state: "failed"` so the model can read Codex's stderr and decide what to do next. It rejects only
for infrastructure problems: missing binary, unreadable working directory, or an aborted spawn.

## Outcome classification

| Condition | `state` |
| --- | --- |
| aborted signal | `cancelled` |
| timeout fired | `timed_out` |
| exit code `0` | `completed` |
| any other exit code | `failed` |

Cancellation is checked first, so a job stopped at the same moment it exits still reports
`cancelled`.

## Jobs

`JobManager` (src/jobs.ts) is deliberately small and in-memory:

- `start()` enforces `maxConcurrent` and returns immediately with a `Job`.
- The job owns an `AbortController`; `cancel()` aborts it and the runner classifies the result as
  `cancelled`.
- `done` resolves only after the executor settles and `finishedAt` is stamped.
- Finished jobs are pruned to `maxJobs`, oldest first. Running jobs are never pruned.
- `dispose()` aborts everything and clears the registry (plugin unload).

Jobs are **not** durable. They do not survive a server restart, because the child processes do not
either. Durability would require persisting process handles, which is not meaningful across
restarts; the design instead favours predictable cleanup.

`waitForJob` is the bridge used by `codex_result`: it races `job.done` against a timer and the
caller's abort signal, resolving `false` when the job is still running.

## Sandbox semantics

| Requested sandbox | Flag passed | Permission prompt |
| --- | --- | --- |
| `read-only` | `-s read-only` | none |
| `workspace-write` | `-s workspace-write` | `codex.task` / `codex.job` / `codex.review` |
| `danger-full-access` | `-s danger-full-access` | required, plus `allowDangerFullAccess: true` |

`codex exec review` and `codex exec resume` do **not** accept `-s`, so those paths pass
`-c sandbox_mode="<mode>"` instead. `src/args.ts` is the single place that knows this asymmetry.

## Change detection

`readGitChanges` runs `git status --porcelain=v1 -z --untracked-files=all` and parses NUL-separated
entries. Before/after sets are diffed by path, so the reported files are exactly those that appeared
or changed during the run. Files that were already modified before the run are not misattributed.

This is intentionally weaker than a full diff: it costs two cheap subprocesses instead of parsing
patches, and Codex's own final message usually explains the changes.

## What is intentionally out of scope

- **Streaming partial output into the conversation.** Tool results are atomic in OpenCode; live
  progress is exposed through `codex_status`.
- **Durable job state.** See above.
- **A provider/model adapter.** Codex is a CLI, not an OpenAI-compatible HTTP endpoint, so it cannot
  be plugged in as an OpenCode provider.
- **MCP transport.** The plugin is OpenCode-native; an MCP adapter would duplicate the job model for
  a different client contract.
