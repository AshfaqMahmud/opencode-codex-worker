# Configuration

Configuration is resolved once at plugin setup from the options object in `opencode.json(c)`.
Malformed values are ignored rather than failing startup, so a typo degrades to the default instead
of taking the server down.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-codex-worker",
      "options": {
        "defaultSandbox": "read-only",
        "defaultEffort": "high",
        "maxConcurrent": 2
      }
    }
  ]
}
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `binary` | string | `codex` | Executable name or absolute path. Falls back to `CODEX_BIN`. |
| `defaultSandbox` | enum | `workspace-write` | Used when a tool call omits `sandbox`. |
| `defaultModel` | string | Codex default | Equivalent to `-m`. `model` is accepted as an alias. |
| `defaultEffort` | enum | Codex default | `minimal`, `low`, `medium`, `high`. |
| `timeoutMs` | number | `900000` | Default per-call timeout. |
| `maxTimeoutMs` | number | `3600000` | Ceiling for call-level `timeoutMs`. |
| `maxConcurrent` | number | `4` | Maximum running background jobs. |
| `maxJobs` | number | `50` | Finished jobs retained in memory. |
| `maxOutputChars` | number | `24000` | Output budget returned to the model. |
| `allowDangerFullAccess` | boolean | `false` | Permit the `danger-full-access` sandbox. |
| `extraArgs` | string[] | `[]` | Appended to every `codex exec` invocation. |
| `env` | object | `{}` | Extra environment variables for the Codex process. |

Notes:

- `maxTimeoutMs` is coerced upward if it is smaller than `timeoutMs`; a ceiling below the default
  would make the default unreachable.
- `env` is merged over the inherited process environment, so `CODEX_HOME`, proxies and tokens can be
  overridden per plugin without touching your shell.
- `extraArgs` is an escape hatch for new Codex flags. It is inserted verbatim after the plugin's own
  flags; conflicting flags have undefined precedence, so prefer first-class options.

### Environment

| Variable | Effect |
| --- | --- |
| `CODEX_BIN` | Default binary when the `binary` option is unset. |
| `CODEX_HOME` | Read by Codex itself for config, auth and sessions. |

## Permissions

Write-capable runs call `ctx.permission.assert` with:

| Field | Value |
| --- | --- |
| `action` | `codex.task`, `codex.job`, or `codex.review` |
| `resources` | `[cwd, sandbox]` |
| `metadata` | `{ sandbox }` |

Because V2 actions are plain strings, these are ordinary permission rules. Any `deny` on either
resource blocks the call; otherwise any `ask` prompts.

Block writes to a sensitive tree while still allowing reads:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "permissions": [
    { "action": "codex.task", "resource": "/srv/prod/*", "effect": "deny" },
    { "action": "codex.job", "resource": "/srv/prod/*", "effect": "deny" }
  ]
}
```

Never allow unsandboxed runs, even if a user enables the option later:

```jsonc
{
  "permissions": [
    { "action": "codex.task", "resource": "danger-full-access", "effect": "deny" }
  ]
}
```

Always ask before Codex edits anything, everywhere:

```jsonc
{
  "permissions": [
    { "action": "codex.task", "resource": "workspace-write", "effect": "ask" },
    { "action": "codex.job", "resource": "workspace-write", "effect": "ask" }
  ]
}
```

Read-only calls never prompt. If you want a gate on all delegation, add rules for
`read-only` as well.

Setting `allowDangerFullAccess: true` only removes the plugin's own guard; it does not bypass your
permission rules, and a `deny` still wins.

## Per-agent configuration

Options are per location, not per agent. To give a reviewer agent read-only defaults, define a
narrower agent permission set:

```jsonc
{
  "agents": {
    "reviewer": {
      "permissions": [
        { "action": "codex.task", "resource": "workspace-write", "effect": "deny" },
        { "action": "codex.job", "resource": "workspace-write", "effect": "deny" }
      ]
    }
  }
}
```

## Applying changes

Restart the service after editing configuration:

```sh
opencode service restart
```

Plugin setup runs at server start, so a running `codex_job` does not survive the restart.
