# nanomneme Repository Guide

## What this is

nanomneme (`nmnm`) is a small, deterministic SQLite core for coding-agent memory. It is intended to preserve useful context across sessions without requiring an opaque service.

The repository includes the memory core and CLI packages, adapters for supported coding agents, shared utilities, scripts, tests, documentation, and external-data tooling.

## Commands

Run the complete test suite:

```sh
npm test
```

This first verifies generated logger output, then runs Node’s built-in test runner across scripts, shared logger tests, package tests, adapter tests, and top-level tests.

Check that the checked-in Logslines snapshot and provenance exactly match the selected upstream release tag:

```sh
npm run external:check -- v0.1.0
```

This command fetches the tagged upstream files and compares their contents and hashes with the local snapshot. The offline pinned-hash test runs under `npm test` and CI; CI does not fetch external Logslines sources.

Update the external Logslines source and SHA-256 provenance to a selected release tag:

```sh
npm run external:update -- v0.1.0
```

## Architecture

- `packages/` contains the memory core, CLI, and related package code.
- `adapters/` contains integrations for coding-agent environments, including Pi, OpenCode, Claude, and Codex.
- `shared/` contains shared implementation and tests, including the logger.
- `scripts/` contains repository tooling such as logger generation checks and external data maintenance.
- `test/` contains top-level tests.
- `docs/` and `research/` contain documentation and research material.
- `external/` contains externally sourced material managed by the external check/update scripts.

## Testing and operational quirks

The `test` script requires logger-generated output to be current:

```sh
node scripts/build-logger.js --check
```

If this check fails, inspect the logger build tooling before changing generated files. Run the narrowest relevant test while developing, then run `npm test` for cross-package changes.

The repository includes SQLite database files and log files; inspect surrounding code and configuration before changing their handling. Keep secrets and generated output out of tracked configuration.

Dependency auditing is scoped to what ships. CI and release block on `npm audit --audit-level=high --omit=dev` and run the full-tree audit as an informational step. The remaining high finding, `brace-expansion` inside `@earendil-works/pi-coding-agent`, is pinned by Pi's own published `npm-shrinkwrap.json`; neither `npm update` nor a root `overrides` entry can move it, so do not add one — it waits on a Pi release.

## Key files

- `README.md` — project overview and package/adaptor references.
- `package.json` — repository scripts.
- `scripts/build-logger.js` — logger generation/check tooling.
- `scripts/external-logslines.js` — external data check and update tool.
- `AGENTS.md` — additional repository-specific agent instructions.
<!-- opl-init:fp c6e0ec4c308f16e7 -->
