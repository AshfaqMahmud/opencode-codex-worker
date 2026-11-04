# Security

This plugin gives another autonomous agent the ability to read and modify your working tree. This
document states the trust boundaries plainly so you can decide where it is appropriate.

## Threat model

What this plugin trusts:

- **The user's Codex installation and account.** Same trust as running `codex` yourself.
- **The model driving OpenCode.** It chooses prompts and sandboxes. Permission rules are the
  control that matters, not the model's judgement.
- **The repository.** Codex reads project instructions and files. A malicious repository can
  influence what Codex does inside its sandbox.

What this plugin does not protect against:

- A prompt that persuades Codex to exfiltrate data it can read within `read-only`.
- Malicious code executed by Codex inside `workspace-write` (build scripts, test hooks). The sandbox
  limits *filesystem* scope, not what already-running code can do.
- Secrets visible in the environment. Codex inherits the server's environment by default.

## Sandbox boundaries

| Sandbox | Filesystem | Network | Approval needed |
| --- | --- | --- | --- |
| `read-only` | read | Codex default | none |
| `workspace-write` | read + write in the workspace | Codex default | `codex.*` permission |
| `danger-full-access` | unrestricted | unrestricted | permission **and** `allowDangerFullAccess` |

`danger-full-access` is disabled twice on purpose: the plugin refuses it unless explicitly enabled,
and a permission rule can still deny it. Enable it only in an environment that is already isolated
(container, disposable VM, CI runner).

## Permission gate

Write-capable calls go through `ctx.permission.assert` before any process is spawned, so a denied
call costs nothing and leaves no artifacts. The asserted resources are the resolved working
directory and the requested sandbox, which means both are addressable by rules:

```jsonc
{
  "permissions": [
    { "action": "codex.task", "resource": "danger-full-access", "effect": "deny" },
    { "action": "codex.job", "resource": "/srv/prod/*", "effect": "deny" }
  ]
}
```

A `deny` cannot be overridden by `allowDangerFullAccess`, by a saved approval, or by the model
choosing a different parameter shape.

## Credentials and environment

- The child process receives the server's environment plus the `env` option. Anything exported in
  the shell that launched OpenCode — cloud tokens, registry credentials, API keys — is visible to
  Codex and to any command it runs.
- Prefer least privilege: launch OpenCode with a scoped environment, or set `env` to a minimal
  explicit set where possible.
- Codex's own credentials live in `$CODEX_HOME` (usually `~/.codex`). Overriding `env.CODEX_HOME`
  isolates a worker from your interactive Codex login.
- Codex writes session transcripts under `$CODEX_HOME/sessions`. Use `ephemeral: true` to avoid
  persisting a run.

## Secrets in output

- stderr is returned to the model when a run fails, truncated to the last 25 lines. A failing command
  that printed a token will put it in your conversation.
- The final message is returned in full (bounded by `maxOutputChars`).
- Codex's transcript itself is not forwarded, but anything it chooses to summarise may be.

## Process handling

- Arguments are passed as an argv array with no shell, so prompt text cannot inject commands.
- On POSIX the child runs in its own process group; timeout, cancellation and plugin unload signal
  the whole group, then escalate to `SIGKILL` after two seconds. Orphaned build processes are the
  exception we defend against.
- Background jobs outlive the tool call by design. They do not outlive the server process. `dispose()`
  aborts everything on unload.
- The temporary `--output-last-message` file is created by Codex in the OS temp directory and
  removed in a `finally` block, including on failure.

## Operating recommendations

1. Default to `read-only` for exploration and review; it needs no permission and cannot mutate.
2. Scope `workspace-write` with `deny` rules for directories that must never be touched.
3. Leave `allowDangerFullAccess` off unless the whole environment is disposable.
4. Run untrusted repositories in a container, not on your workstation.
5. Review `extraArgs`: it can re-enable capabilities the plugin otherwise constrains.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md). Please do not open a public issue for an exploitable problem.
