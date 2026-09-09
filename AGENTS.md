# Nanomneme Repository Guide

## What this is

Nanomneme is a local, deterministic memory system for coding agents. Canonical memory records live in SQLite and are exposed through a reusable core library, a CLI, and thin harness adapters. It has no LLM, embeddings, server, or network dependency. Node.js 22.13+ is required for ESM and built-in `node:sqlite` with FTS5.

## Commands

```sh
npm install
npm test
node packages/nmnm-cli/bin/nmnm.js --help
node packages/nmnm-cli/bin/nmnm.js export --out memory.jsonl
npm pack --dry-run --workspace nmnm-core --workspace nmnm-cli
pi -e ./adapters/pi/extensions/index.js
```

`npm test` runs Node's built-in test runner across package and Pi-adapter tests. There are no configured build, lint, or typecheck scripts.

## Architecture

- `packages/nmnm-core/src/index.js` owns the SQLite schema, validation, memory lifecycle, JSONL portability, verification, and FTS repair.
- `packages/nmnm-cli/bin/nmnm.js` implements the `nmnm` command.
- `adapters/pi/` is a private Pi extension package. Its source handles adapter configuration, pins, session context, and tool registration; `extensions/index.js` is the entry point.
- Tests sit beside their components under `packages/*/test/` and `adapters/pi/test/`.

Keep core independent of CLI parsing, Pi-specific behavior, HTTP, MCP, embeddings, and LLM providers. Adapters must call the core API rather than write SQLite directly or parse CLI output.

## Configuration and installation

The root workspace contains `packages/*` and `adapters/*`. Core and CLI are publishable packages; the Pi adapter is private and depends on a matching `nmnm-core` version. Publish core before CLI.

The CLI default store is `./.nanomneme/memory.db`; `--global` selects the user-global database. Pi configuration and pins are adapter-owned files outside SQLite. Reads and removals in Pi must not create missing databases; only retain may create a missing store.

## Testing and operational quirks

Use `node:test` and `node:assert/strict`, temporary databases, and isolated home directories for global-store tests. `memories` rows are canonical; tags and FTS rows are derived. Prefer CLI mutations because direct SQLite updates can desynchronize derived data.

Removal is soft and reversible by default; purge is irreversible. Validate canonical imports before opening a new destination. Use JSONL for transfer or restore; exact backups require a closed SQLite copy. Exports must not alias their source and must use same-directory atomic replacement. Do not commit `.nanomneme/`, personal global databases, or local Pi settings and pin files.

## Key files

- `README.md`: project overview and quick start.
- `docs/CORE_CLI_MANUAL.md`: core, CLI, data contract, and recovery details.
- `docs/PI_ADAPTER_MANUAL.md`: Pi installation, configuration, pins, and context behavior.
- `ROADMAP.md` and `CHANGELOG.md`: planned and released behavior.
<!-- opl-init:fp a0e80f3ce855b04b -->