# Development

## Prerequisites

- Node.js 20+ (CI covers 20, 22 and 24)
- Git, for the change-detection tests
- OpenCode v2, for integration checks
- Optional: a real Codex CLI login, only needed when you want a live run

## Setup

```sh
git clone https://github.com/AshfaqMahmud/opencode-codex-worker.git
cd opencode-codex-worker
npm install
npm run typecheck
npm test
```

The suite runs offline. Tests spawn a fake `codex` executable written to a temp directory, so no
account, network or real Codex install is required.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | Plugin definition, namespace registration, cleanup |
| `src/config.ts` | Option parsing, defaults, working-directory resolution |
| `src/args.ts` | Argv construction for `exec`, `exec resume`, `exec review` |
| `src/exec.ts` | Binary discovery, spawning, process groups, timeout, `TailBuffer` |
| `src/runner.ts` | The execution pipeline and outcome classification |
| `src/git.ts` | Working-tree snapshots and change diffing |
| `src/jobs.ts` | Background job registry, concurrency, pruning, `waitForJob` |
| `src/tools.ts` | Tool schemas, validation, permission gate, formatting |
| `src/format.ts` | Human-readable output and truncation |
| `test/` | Node test-runner suites plus the fake Codex helper |
| `docs/` | This documentation |

The dependency direction is one-way: `tools → runner → exec/git/format`, with `jobs` depending only
on types. `index.ts` wires everything together. Keep it that way; it is why most logic is testable
without OpenCode.

## Testing strategy

| Suite | Covers |
| --- | --- |
| `config.test.ts` | Defaults, overrides, ignored junk, clamping, cwd resolution |
| `args.test.ts` | Flag placement, the `-s` vs `-c sandbox_mode` split, review modes |
| `exec.test.ts` | Capture, streaming, timeout kill, abort, binary discovery, `TailBuffer` |
| `runner.test.ts` | End-to-end runs, session id parsing, change detection, failure states |
| `jobs.test.ts` | Lifecycle, concurrency limit, cancellation, pruning, labels |
| `format.test.ts` | Status lines, truncation, job rendering |
| `tools.test.ts` | Input validation, permission gating, job tools, review guard |
| `docs.test.ts` | Documentation stays in sync with the code |

The fake Codex (`test/helpers.ts`) honours `-o <file>`, prints a session id to stderr, and switches
behaviour through `FAKE_CODEX_MODE` (`ok`, `fail`, `slow`) and `FAKE_CODEX_TOUCH`.

### Writing a test

Prefer testing the module directly over the plugin entry point. Only `index.ts` knows about
`@opencode/plugin`; everything else takes plain arguments.

```ts
const binary = await makeFakeCodex();
const config = resolveConfig({ binary, env: { FAKE_CODEX_MESSAGE: "LGTM" } });
const outcome = await runTask(config, { prompt: "x", cwd: directory, sandbox: "read-only" });
assert.equal(outcome.message, "LGTM");
```

If you add a tool, add an assertion to `docs.test.ts`'s implicit contract by documenting it in
`docs/tools.md`; the test fails otherwise.

## Running against a local checkout

Published packages load through OpenCode's plugin installer. A local checkout does not, in some
builds, when the entry point is only reachable through `package.json` exports. Two reliable
workflows:

### Copy the sources into the project

```sh
mkdir -p .opencode/plugins/codex-worker
cp src/*.ts .opencode/plugins/codex-worker/
```

OpenCode loads `.opencode/plugins/*/index.ts` automatically. Because the directory now has
`index.ts` at its root, sibling imports such as `./config.js` resolve to the `.ts` files.

### Install a packed tarball

```sh
npm pack
mkdir -p ~/.cache/opencode/npm/opencode-codex-worker@latest
cd ~/.cache/opencode/npm/opencode-codex-worker@latest
npm install /path/to/opencode-codex-worker-0.1.0.tgz
```

Then add `"plugins": ["opencode-codex-worker"]` to `~/.config/opencode/opencode.json` and restart
the service. This mirrors the registry install path most closely.

> The cache path is an OpenCode implementation detail, verified against v2.0.32. If it moves, use
> `opencode plugin add opencode-codex-worker` after publishing.

### Verify registration

```sh
opencode run --standalone --auto "Call codex_status with an empty object and print the output."
```

A registered plugin answers `No Codex jobs have been started in this session.`

## Debugging

```sh
opencode run --standalone --print-logs --log-level debug "Say OK"
```

Useful signals:

- `location services booted` means config and plugins for that directory were loaded.
- Plugin `setup` errors appear in the server log; the plugin API does not fail the session loudly.
- `--standalone` runs a private server, which isolates plugin problems from the shared service.

To inspect what actually registered, register a temporary probe plugin whose `setup` awaits
`ctx.tool.list()` and writes the ids to a file. That is how the namespace regression was found.

## Adding a tool

1. Add an entry in `createTools()` in `src/tools.ts` with a JSON Schema and a handler.
2. Reuse `parseTaskInput`, `assertPermission` and `notify` rather than duplicating validation.
3. Return `{ content, metadata }`. Put machine-readable state in `metadata`.
4. Document it in [`docs/tools.md`](./tools.md) — `test/docs.test.ts` enforces this.
5. Add a case to `test/tools.test.ts`.

Names are registered under the `codex` namespace through `options: { namespace: "codex" }` in
`src/index.ts`. A bare name can shadow built-in tools; never drop the option.

## Adding an option

1. Add the field to `WorkerConfig` and `DEFAULT_CONFIG` in `src/config.ts`.
2. Parse it in `resolveConfig` using the tolerant helpers; invalid input must not throw.
3. Document it in [`docs/configuration.md`](./configuration.md) and the README table.
4. Extend `test/config.test.ts`, and the option check in `test/docs.test.ts` covers the docs.

## Conventions

- TypeScript strict, `verbatimModuleSyntax`, ESM with explicit `.js` import extensions.
- No shell interpolation anywhere; pass argv arrays.
- Never reject a tool call because Codex exited non-zero — that is a result, not an exception.
- Truncate user-visible output through `truncateMiddle`/`maxOutputChars`, never by slicing.
- Keep `src/` free of `@opencode/plugin` imports except `index.ts`.
