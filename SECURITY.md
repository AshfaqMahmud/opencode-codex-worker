# Security policy

## Supported versions

Only the latest published minor version receives security fixes.

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |
| < 0.1 | No |

## Reporting a vulnerability

Do **not** open a public issue for an exploitable problem.

Use GitHub's private reporting flow: **Security → Report a vulnerability** on
[the repository](https://github.com/AshfaqMahmud/opencode-codex-worker/security/advisories/new).
If that is unavailable, contact the maintainer through the email on their GitHub profile.

Please include:

- the plugin version and `opencode --version`
- the configuration and permission rules involved
- a description of the impact: what an attacker gains, under which sandbox
- reproduction steps, with secrets and personal paths removed

## What to expect

- Acknowledgement within 72 hours.
- An assessment and a remediation plan within 7 days.
- A patched release and a coordinated advisory once a fix is available.
- Credit in the advisory unless you prefer otherwise.

## Scope

In scope:

- Sandbox or permission bypass: a run that should be denied, prompts, or is limited to a directory
  but is not.
- Command injection through prompts, paths, options, labels or `extraArgs`.
- Escaping truncation or context boundaries to inject instructions into the model.
- Leaking credentials or environment data beyond the documented behaviour.

Out of scope:

- Codex or OpenCode vulnerabilities themselves; report those upstream.
- The consequences of enabling `danger-full-access` or setting `allowDangerFullAccess: true` — that is
  documented as unrestricted by design.
- A model choosing to run a destructive command inside a sandbox it was granted.
- Denial of service through your own `maxConcurrent` or timeout settings.

## Hardening guidance

See [docs/security.md](./docs/security.md) for the trust model, sandbox boundaries, environment
inheritance and operating recommendations.
