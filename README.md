# opencode-codex-worker

Delegate coding work from [OpenCode](https://opencode.ai) to the [Codex CLI](https://github.com/openai/codex) running as a separate worker.

OpenCode plans, reviews and talks to you. Codex does the bulk implementation in parallel, with its own tools, its own context window and its own quota.

[![npm version](https://img.shields.io/npm/v/opencode-codex-worker.svg)](https://www.npmjs.com/package/opencode-codex-worker)
[![license](https://img.shields.io/npm/l/opencode-codex-worker.svg)](./LICENSE)
[![CI](https://github.com/AshfaqMahmud/opencode-codex-worker/actions/workflows/ci.yml/badge.svg)](https://github.com/AshfaqMahmud/opencode-codex-worker/actions/workflows/ci.yml)

## Why

A single agent is a bottleneck. This plugin turns `codex exec` into a first-class tool:

- **Parallel work** — start several background jobs, keep working in the main session.
- **Second opinion** — ask Codex to review a diff without leaving OpenCode.
- **Context isolation** — a big refactor burns Codex's context window, not yours.
- **Real file edits** — Codex writes to the working tree, constrained by its sandbox.

## Requirements

- OpenCode v2
- The Codex CLI installed and authenticated (`codex login`), `codex --version` ≥ 0.160
- Node.js 20+ (only for local development)

## Install

```sh
opencode plugin add opencode-codex-worker
```

Or add it to `opencode.json(c)` yourself:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-codex-worker"]
}
```

With options:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-codex-worker",
      "options": {
        "defaultSandbox": "workspace-write",
        "maxConcurrent": 4
      }
    }
  ]
}
```

Restart the OpenCode service after changing config: `opencode service restart`.

## Tools

| Tool | What it does |
| --- | --- |
| `codex_task` | Run a task and wait for the result |
| `codex_job` | Start a task in the background, return a job id |
| `codex_status` | List jobs, or inspect one job's state and live output |
| `codex_result` | Wait for a job and return its final message |
| `codex_cancel` | Terminate a running job |
| `codex_review` | Review uncommitted changes, a base branch, or a commit |

### `codex_task`

```jsonc
{
  "prompt": "Add pagination to src/api/orders.ts and update the tests",
  "sandbox": "workspace-write",
  "effort": "medium",
  "timeoutMs": 900000
}
```

Returns Codex's final message, the session id (for `resume`), and the files it touched.

### `codex_job` → `codex_result`

```jsonc
{ "prompt": "Migrate the auth module to the new client", "label": "auth-migration" }
```

Then poll with `codex_status`, or block with `codex_result` (waits up to 120s per call). Jobs keep running after the tool call returns and are independent of your session's cancel signal.

### `codex_review`

```jsonc
{ "mode": "uncommitted", "prompt": "Focus on error handling and missing tests" }
```

`mode` is `uncommitted` (default), `base` (with `base: "main"`), or `commit` (with `commit: "<sha>"`).

## Configuration

All options are optional.

| Option | Default | Description |
| --- | --- | --- |
| `binary` | `codex` | Codex executable or absolute path. Also reads `CODEX_BIN`. |
| `defaultSandbox` | `workspace-write` | Sandbox when a call does not specify one. |
| `defaultModel` | Codex default | Passed as `-m`. |
| `defaultEffort` | Codex default | `minimal`, `low`, `medium`, `high`. |
| `timeoutMs` | `900000` | Default task timeout (15 min). |
| `maxTimeoutMs` | `3600000` | Ceiling for per-call timeouts. |
| `maxConcurrent` | `4` | Maximum simultaneously running jobs. |
| `maxJobs` | `50` | Finished jobs kept in memory. |
| `maxOutputChars` | `24000` | Output budget returned to the model. |
| `allowDangerFullAccess` | `false` | Permit `danger-full-access`. |
| `extraArgs` | `[]` | Extra arguments appended to `codex exec`. |
| `env` | `{}` | Extra environment variables for the Codex process. |

## Sandboxes and permissions

| Sandbox | Codex can | OpenCode permission |
| --- | --- | --- |
| `read-only` | read and inspect | not requested |
| `workspace-write` | edit the working directory | `codex.task` / `codex.job` / `codex.review` |
| `danger-full-access` | run anything | requested, and blocked unless `allowDangerFullAccess` |

Write-capable calls go through `ctx.permission.assert`, so your existing OpenCode allow/deny rules apply:

```jsonc
{
  "permissions": [
    { "action": "codex.task", "resource": "/srv/prod/**", "effect": "deny" }
  ]
}
```

## How it works

Each call spawns `codex exec` with a private `--output-last-message` file and no stdin, so the worker never blocks waiting for input. The plugin:

1. resolves `codex` on `PATH` (or uses `binary`),
2. maps the sandbox to `-s` (task) or `-c sandbox_mode` (review/resume, which do not accept `-s`),
3. captures stdout/stderr with head+tail truncation,
4. snapshots `git status` before and after to report files touched,
5. parses the Codex session id from stderr so runs can be resumed,
6. kills the whole process group on timeout, cancellation, or session interrupt.

## Troubleshooting

**`Codex CLI not found`** — the binary is not on `PATH`. Install Codex, or set `binary` to its absolute path (`which codex`).

**`Codex review needs a Git repository`** — `codex_review` requires a repo; initialize one or point `cwd` at one.

**Stderr noise about Postman MCP auth** — Codex loads MCP servers from `~/.codex/config.toml`. The error is harmless; disable the server there to silence it.

**Tasks hit the timeout** — raise `timeoutMs`, or use `codex_job` for long migrations so the main session is not blocked.

**Plugin does not load locally** — when developing against a local checkout, put `index.ts` at the root of `.opencode/plugins/<name>/`. Local directories that only expose `src/index.ts` through `package.json` exports do not auto-load in some OpenCode builds; installed npm packages are unaffected.

## Development

```sh
npm install
npm run typecheck
npm test        # 47 tests, no network and no real Codex needed
```

Tests use a fake `codex` executable, so they exercise argument building, process supervision, timeouts, cancellation, job bookkeeping, permission gating and output formatting without touching your Codex account.

To try a local checkout, link it as a plugin:

```sh
mkdir -p .opencode/plugins/codex-worker
cp -R src/*.ts .opencode/plugins/codex-worker/
```

Then ask OpenCode: *"Call codex_status."*

## License

MIT © Ashfaq Mahmud
