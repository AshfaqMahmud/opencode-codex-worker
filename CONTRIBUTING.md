# Contributing

Thanks for considering a contribution. This project is small and opinionated; the best contributions
are focused, tested and documented.

## Before you start

- For a bug, open an issue with a reproduction: plugin version, `opencode --version`,
  `codex --version`, the tool call, and relevant logs with secrets redacted.
- For a behaviour change or a new tool, open an issue first. Tools are a public API surface and this
  plugin deliberately stays narrow.
- For a security problem, follow [SECURITY.md](./SECURITY.md) instead of opening an issue.

## Setup

```sh
git clone https://github.com/AshfaqMahmud/opencode-codex-worker.git
cd opencode-codex-worker
npm install
npm run typecheck
npm test
```

Node 20+ and Git are required. A real Codex installation is not needed for the test suite.

## The bar for a pull request

1. `npm run typecheck` is clean.
2. `npm test` passes, including the documentation checks.
3. New behaviour has a test that fails without your change.
4. User-visible behaviour is documented in `docs/` and, if it is an option, in the README table.
5. The diff is scoped. Unrelated refactors belong in a separate pull request.

## Code conventions

- TypeScript strict mode, ESM, explicit `.js` extensions on relative imports.
- `src/` must not import `@opencode/plugin` outside `index.ts`; that separation is what makes the
  logic testable without a server.
- Pass argv arrays, never a shell string.
- A non-zero Codex exit is a result, not an exception. Reserve rejections for infrastructure
  failures.
- Truncate output through `truncateMiddle` or `maxOutputChars`; never `slice` user-visible text.
- Keep comments for *why*. The code already says *what*.

## Adding a tool

1. Add a definition in `createTools()` in `src/tools.ts`, reusing the existing validation helpers.
2. Return `{ content, metadata }`; put structured state in `metadata`.
3. Register it with `options: { namespace: "codex" }` — this happens centrally in `src/index.ts`, so
   just add the definition to the array.
4. Document it in `docs/tools.md`. `test/docs.test.ts` enforces this.
5. Test it in `test/tools.test.ts`, including the permission path if it can write.

## Adding an option

1. Extend `WorkerConfig` and `DEFAULT_CONFIG` in `src/config.ts`.
2. Parse it in `resolveConfig` with the tolerant helpers. Invalid values are ignored, never thrown.
3. Document it in `docs/configuration.md` and the README table.
4. Cover it in `test/config.test.ts`.

## Commit messages

Conventional Commits, imperative mood:

```
feat: add codex_cancel tool
fix: apply namespace to registered tools
docs: document permission gate
test: cover timeout classification
chore: bump dev dependencies
```

The changelog is grouped by these prefixes.

## Review process

Expect comments about scope and tests more than style. A maintainer will run the full CI matrix and
an integration check against a real OpenCode and Codex before merging anything that changes process
handling or the tool surface.

## License

By contributing you agree that your contribution is licensed under the [MIT License](./LICENSE).
