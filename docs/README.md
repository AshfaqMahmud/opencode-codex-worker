# Documentation

Start with the [README](../README.md) for installation and a quick tour. These documents go deeper.

| Document | Read it when |
| --- | --- |
| [Tools](./tools.md) | You want the full parameter reference and behaviour of each `codex_*` tool |
| [Configuration](./configuration.md) | You are tuning options or writing permission rules |
| [Security](./security.md) | You need to know what Codex can reach, and what the sandbox does not cover |
| [Architecture](./architecture.md) | You are changing the plugin and need the execution pipeline and job model |
| [Development](./development.md) | You are building, testing, or loading a local checkout |
| [Troubleshooting](./troubleshooting.md) | Something does not load, hangs, or gets denied |
| [Design decisions](./design-decisions.md) | You are about to change a decision that looks arbitrary |
| [Releasing](./releasing.md) | You are publishing a version |

## Reading order for new contributors

1. [Architecture](./architecture.md) — the mental model.
2. [Development](./development.md) — how to run it and where tests live.
3. [Design decisions](./design-decisions.md) — why the code looks the way it does.
4. [CONTRIBUTING](../CONTRIBUTING.md) — the rules for a pull request.

## Keeping docs honest

`test/docs.test.ts` fails when a registered tool, or a configuration option, is missing from this
documentation. If you add either, add the docs in the same commit and CI stays green.
