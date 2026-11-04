# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-04

### Added

- `codex_task` for synchronous delegation to `codex exec`, with sandbox, model, reasoning effort,
  timeout, session resume and changed-file reporting.
- `codex_job`, `codex_status`, `codex_result` and `codex_cancel` for background work with a
  concurrency limit and job pruning.
- `codex_review` for uncommitted changes, base-branch diffs and individual commits.
- Permission integration: write-capable sandboxes go through `ctx.permission.assert`.
- `danger-full-access` support behind an explicit `allowDangerFullAccess` option.
- Plugin options for binary path, sandbox, model, effort, timeouts, concurrency and environment.
- Test suite covering argument building, process supervision, timeouts, cancellation, job
  bookkeeping, permission gating and output formatting.
- Documentation set: architecture, tool reference, configuration, security, development,
  troubleshooting, release process and design decisions.
- `test/docs.test.ts`, which fails when a tool, option, internal link or changelog entry drifts out
  of sync with the code.
- Contributor guide, security policy, code of conduct, and issue/pull-request templates.

### Changed

- `@opencode/plugin` is declared as an optional peer dependency rather than a dependency. The host
  provides it at runtime, and depending on it would pull non-optional `vite` and `electron` peers
  into every install.
