# Releasing

Publishing is a manual, reviewed step. Nothing pushes to npm on a normal commit.

## Prerequisites

- npm account with publish rights to `opencode-codex-worker`
- `npm login` completed on the machine doing the release
- `gh` authenticated for the repository
- Clean working tree on `main`

```sh
npm whoami
git status --short
```

## 1. Prepare

```sh
npm ci
npm run typecheck
npm test
```

All 47+ tests must pass. CI runs the same matrix on Ubuntu and macOS for Node 20, 22 and 24.

## 2. Choose the version

Semantic versioning:

| Change | Bump |
| --- | --- |
| New tool or option | minor |
| Behaviour change, removed option, renamed tool | major (or minor while `0.x`) |
| Fix with no API change | patch |

```sh
npm version patch --no-git-tag-version
```

Update `CHANGELOG.md` with the same version and a dated section. Move anything under `[Unreleased]`
into it.

## 3. Verify the artifact

```sh
npm pack --dry-run
```

Expect `src/`, `docs/`, `README.md`, `LICENSE`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md` and
`package.json`. No `test/`, no `node_modules`, no tarballs.

Then install the pack into an isolated directory and confirm it loads (see
[development](./development.md#install-a-packed-tarball)).

## 4. Publish

Either locally:

```sh
git add -A
git commit -m "chore(release): v0.1.0"
git tag v0.1.0
git push origin main --tags
npm publish --access public
```

Or via the workflow. Create a GitHub release for the tag; `.github/workflows/publish.yml` runs
`npm publish --provenance --access public`. That path needs an `NPM_TOKEN` repository secret with
publish rights, and produces a provenance attestation linking the tarball to the commit and workflow.

Prefer the workflow: provenance is verifiable and the machine that publishes is not your laptop.

## 5. Confirm

```sh
npm view opencode-codex-worker version
npm view opencode-codex-worker dist.integrity
```

Then, from a clean directory:

```sh
opencode plugin add opencode-codex-worker
opencode run --standalone --auto "Call codex_status and print the output."
```

## Rollback

- **Broken but installable:** `npm deprecate opencode-codex-worker@0.1.0 "reason"` and publish a fix.
  Deprecation is the right tool; it warns without breaking existing lockfiles.
- **Unpublishable:** `npm unpublish opencode-codex-worker@0.1.0` is only allowed within 72 hours and
  breaks anyone who already installed it. Use it only for a leaked secret or a malicious tarball.
- **Yanked GitHub release:** delete the release, keep the tag history intact.

## Checklist

- [ ] `npm ci && npm run typecheck && npm test` pass
- [ ] `CHANGELOG.md` has a dated section for the version
- [ ] `npm pack --dry-run` shows the expected files and size
- [ ] Tarball installs and loads in OpenCode
- [ ] Version bumped in `package.json`
- [ ] Tag pushed, release created
- [ ] `npm view` reports the new version
- [ ] README badges resolve
