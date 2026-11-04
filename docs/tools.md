# Tool reference

All tools are registered under the `codex` namespace. Tool names below are the effective names the
model sees.

Common parameters accepted by `codex_task`, `codex_job` and (where noted) `codex_review`:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `prompt` | string | required | Task instructions. Be specific about the goal and how to verify it. |
| `cwd` | string | session directory | Working directory, absolute or relative to the session. Must exist. |
| `sandbox` | enum | `workspace-write` | `read-only`, `workspace-write`, `danger-full-access`. |
| `model` | string | config default | Passed as `-m`, for example `gpt-6.1-sol`. |
| `effort` | enum | config default | `minimal`, `low`, `medium`, `high`. |
| `timeoutMs` | number | `900000` | Clamped to `maxTimeoutMs`. |
| `ephemeral` | boolean | `false` | Do not persist the session; disables `resume`. |
| `includeChanges` | boolean | `true` | Report files touched via Git snapshots. |
| `resume` | string | — | Session id from an earlier run. |
| `extraArgs` | string[] | — | Escaped directly into the `codex exec` invocation. |

## `codex_task`

Runs a task and waits for it to finish. Use it when the answer is needed to continue the
conversation, and `codex_job` when it is not.

```jsonc
{
  "prompt": "Add cursor pagination to src/api/orders.ts, keep the response shape stable, and run the order tests.",
  "sandbox": "workspace-write",
  "effort": "medium",
  "timeoutMs": 1200000
}
```

Result metadata: `state`, `exitCode`, `durationMs`, `sandbox`, `cwd`, `sessionID`, `changes`.

Failure is returned as content, not thrown. A run that exits non-zero still tells you what Codex
said, plus the tail of stderr.

Resuming:

```jsonc
{ "prompt": "The tests still fail, look at the fixture.", "resume": "01a1a6d1-4be6-7e82-a0f6-3a47776698ee" }
```

## `codex_job`

Same inputs as `codex_task`, plus `label`. Returns a job id immediately.

```jsonc
{ "prompt": "Migrate the auth module to the new client", "label": "auth-migration" }
```

The job is independent of the calling session's cancel signal: pressing escape does not kill it.
Use `codex_cancel`.

Jobs are limited by `maxConcurrent` (default 4). Exceeding it raises a tool error that names the
current count and the limit.

## `codex_status`

| Parameter | Type | Description |
| --- | --- | --- |
| `jobID` | string, optional | Omit to list every job from this session. |

With an id, returns state, elapsed time, session id, files touched and the last 2 000 characters of
live output. Without an id, returns a compact list.

## `codex_result`

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `jobID` | string | required | Job to wait for. |
| `waitMs` | number | `30000` | Clamped to 120 000. |

Blocks until the job finishes or the wait elapses. If it is still running, the result says so and
includes the current preview; call again to keep waiting. Cancellation of the calling tool does not
cancel the job.

## `codex_cancel`

| Parameter | Type | Description |
| --- | --- | --- |
| `jobID` | string, required | Job to stop. |

Aborts the job's signal, which terminates the process group. The state becomes `cancelled` once the
process exits. Cancelling an already-finished job reports its state and does nothing.

## `codex_review`

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | enum | `uncommitted` | `uncommitted`, `base`, `commit`. |
| `base` | string | — | Required when `mode` is `base`. |
| `commit` | string | — | Required when `mode` is `commit`. |
| `prompt` | string | — | Extra review instructions. |
| `sandbox` | enum | `read-only` | Reviewer sandbox. |
| `cwd` | string | session directory | Must be inside a Git repository. |
| `model`, `effort`, `timeoutMs`, `extraArgs` | | | Same as tasks. |

```jsonc
{ "mode": "base", "base": "main", "prompt": "Focus on concurrency and error handling." }
```

The tool fails fast when `cwd` is not a Git repository, before spawning Codex.

## Behaviour worth knowing

- **Final message only.** The transcript (tool calls, diffs) stays out of your context window; you
  get Codex's summary, the files it touched, and stderr on failure.
- **Output budgeting.** Messages are truncated head+tail to `maxOutputChars` rather than clipped,
  so both the setup and the conclusion survive.
- **Relative paths** are resolved against the session directory, not the process working directory.
- **No shell.** Arguments are passed as an argv array; prompts are never interpolated into a shell
  command, so quotes and metacharacters are safe.
