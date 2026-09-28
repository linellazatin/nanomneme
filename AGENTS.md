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

Check the external Logslines source selected by release tag:

```sh
npm run external:check -- v0.1.0
```

Update the external Logslines source to a selected release tag:

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

## Key files

- `README.md` — project overview and package/adaptor references.
- `package.json` — repository scripts.
- `scripts/build-logger.js` — logger generation/check tooling.
- `scripts/external-logslines.js` — external data check and update tool.
- `AGENTS.md` — additional repository-specific agent instructions.
<!-- opl-init:fp c6e0ec4c308f16e7 -->
