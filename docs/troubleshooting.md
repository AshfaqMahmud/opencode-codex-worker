# Troubleshooting

## The plugin does not load

**Symptom:** `codex_status` is not in the tool list, or the model says the tool does not exist.

Check, in order:

1. `opencode debug config` — is the plugin listed under `plugins`?
2. `opencode plugin list` — does an installed package appear?
3. Logs: `opencode run --standalone --print-logs --log-level debug "Say OK"` and look for plugin
   setup failures. The plugin API logs and continues; a broken plugin does not fail the session.

If you are developing against a checkout, the entry point must be reachable. See
[local development](./development.md#running-against-a-local-checkout). Directories that expose
`src/index.ts` only through `package.json` exports do not always auto-load.

After editing configuration, restart: `opencode service restart`.

## `codex_task` is missing but `task` behaves oddly

You are running a build where the namespace was not applied, so the tool shadowed OpenCode's
built-in `task`. Upgrade the plugin. The fix registers every tool with `options: { namespace: "codex" }`,
producing `codex_task`, `codex_job`, and so on.

## `Codex CLI not found`

The binary is not on `PATH`.

```sh
which codex
codex --version
```

Install Codex, or point the plugin at it:

```jsonc
{ "plugins": [{ "package": "opencode-codex-worker", "options": { "binary": "/Users/you/.local/bin/codex" } }] }
```

`CODEX_BIN` is used when the option is unset. Note that a GUI-launched OpenCode may have a shorter
`PATH` than your terminal.

## A task hangs with no output

The plugin always ignores stdin. If you forked the code and gave the child a pipe, Codex prints
`Reading additional input from stdin...` and waits forever. Use
`stdio: ["ignore", "pipe", "pipe"]`.

For long migrations, prefer `codex_job`: a synchronous `codex_task` blocks the conversation until it
finishes.

## `Codex review needs a Git repository`

`codex_review` requires a repository; it fails before spawning anything. Pass `cwd` pointing inside a
repo, or run `git init`.

Reviewing a specific commit outside the current history is not supported by Codex's review
subcommand; check the commit out or review the base branch instead.

## Permission prompt never appears

- `read-only` calls never prompt by design.
- A `deny` rule may be winning. Rules are evaluated last-match-wins, and any `deny` blocks the call.
- `danger-full-access` needs both `allowDangerFullAccess: true` and a non-denying rule.
- Non-interactive runs need `--auto` or pre-approved rules; otherwise the request has nowhere to go.

Inspect the asserted action and resources in [`docs/configuration.md`](./configuration.md#permissions).

## `danger-full-access` is disabled`

That is intentional. Set `allowDangerFullAccess: true` in plugin options, or keep the sandbox at
`workspace-write`. Prefer a disposable environment before enabling it.

## Tasks time out

Default is 15 minutes, ceiling one hour.

```jsonc
{ "options": { "timeoutMs": 1800000, "maxTimeoutMs": 3600000 } }
```

Timeouts terminate the whole process group, so no orphaned build processes remain.

## `Too many Codex jobs running`

`maxConcurrent` defaults to 4. Wait for a job, `codex_cancel` one, or raise the limit. Codex itself
may also limit concurrent sessions on your plan.

## Stderr shows a Postman MCP auth error

Codex loads MCP servers from `~/.codex/config.toml`. Something like:

```
ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(...)
```

is harmless for the run. Remove or disable that MCP server in your Codex config to silence it. The
plugin only surfaces stderr when a run fails, so successful runs stay quiet.

## Windows

- Process-group termination is POSIX-only; on Windows the plugin falls back to killing the direct
  child. Deep process trees may survive a timeout.
- Binary discovery honours `PATHEXT`, so a `codex.cmd` shim resolves correctly.
- Path patterns in permission rules are matched case-insensitively and with forward slashes.

## Output is cut off

That is `maxOutputChars` (default 24 000). It truncates head and tail, keeping both the setup and the
conclusion, and labels the omission. Raise it if you genuinely need the full text; the model's
context window is the real constraint.

## A job disappeared from `codex_status`

Finished jobs are pruned to `maxJobs` (default 50), oldest first. Running jobs are never pruned.
Results are not persisted across server restarts.

## Still stuck

Open an issue with:

- `opencode --version`, `codex --version`, OS and Node version
- the plugin version (`npm view opencode-codex-worker version` or the installed commit)
- the relevant log lines with secrets redacted
- the tool call that failed, with any sensitive prompt text removed
