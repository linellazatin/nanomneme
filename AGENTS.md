# Nanomneme Repository Guide

## What this is

Nanomneme is a local, deterministic memory system for coding agents. It stores canonical memory records in SQLite and exposes the same lifecycle through a reusable core, a CLI, and thin harness adapters. It requires no LLM, embeddings, server, or network service. Node.js 22.13+ is required because the project uses ESM and built-in `node:sqlite` with SQLite FTS5.

## Commands

```sh
npm install
npm test
node packages/nmnm-cli/bin/nmnm.js --help
node packages/nmnm-cli/bin/nmnm.js export --out memory.jsonl
npm pack --dry-run --workspace nmnm-core --workspace nmnm-cli
pi -e ./adapters/pi/extensions/index.js
```

`npm test` runs Node's built-in test runner across all package and Pi-adapter tests. There are no configured build, lint, or typecheck scripts.

## Architecture

- `packages/nmnm-core/src/index.js` owns the SQLite schema, validation, retain/recall/retrieve/remove lifecycle, JSONL portability, verification, and FTS repair.
- `packages/nmnm-cli/bin/nmnm.js` is the `nmnm` command-line interface.
- `adapters/pi/` is a private Pi extension package. Its source handles adapter configuration, pins, session context, and tool registration; `extensions/index.js` is the Pi entry point.
- Tests live beside each component in `packages/*/test/` and `adapters/pi/test/`.

Keep the core independent of CLI parsing, Pi-specific behavior, HTTP, MCP, embeddings, and LLM providers. Adapters must use the core API, never write SQLite directly or parse CLI output.

## Configuration and installation

The root workspace contains `packages/*` and `adapters/*`. The core and CLI are publishable packages; the Pi adapter is private and depends on the matching `nmnm-core` version. Publish core before CLI.

The CLI defaults to `./.nanomneme/memory.db`; `--global` selects the user global database. Pi configuration and pins are adapter-owned files outside SQLite. Pi must not create missing databases for reads or removal: only the retain path creates a missing store.

## Testing and operational quirks

Use `node:test` and `node:assert/strict`, with temporary databases and isolated home directories for global-store tests. `memories` rows are canonical; tags and FTS rows are derived. Prefer CLI mutations because direct SQLite changes can desynchronize derived data.

Removal is soft and reversible by default; `purge` is irreversible. Validate canonical imports before opening a new destination. JSONL is the transfer/restore format, while exact backups require a closed SQLite copy. Exports must not alias their source and must use same-directory atomic replacement. Do not commit `.nanomneme/`, personal global databases, or local Pi settings/pin files.

## Key files

- `README.md`: project overview and quick start.
- `docs/CORE_CLI_MANUAL.md`: core, CLI, data contract, and recovery details.
- `docs/PI_ADAPTER_MANUAL.md`: Pi installation, configuration, pins, and automatic context behavior.
- `ROADMAP.md` and `CHANGELOG.md`: planned and released behavior.
<!-- opl-init:fp e8efaef66e75dcb0 -->