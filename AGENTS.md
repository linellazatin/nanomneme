# Repository Guidelines

## Project Structure & Module Organization

This is a Node.js ESM workspace with two packages:

- `packages/nmnm-core/src/index.js` contains the SQLite schema, 4Rs, portability APIs, and FTS repair.
- `packages/nmnm-cli/bin/nmnm.js` implements the `nmnm` command-line interface.
- Package tests live in `packages/*/test/*.test.js`.
- Root documentation is `README.md`, `CHANGELOG.md`, and `ROADMAP.md`.

Keep core independent of CLI parsing, harnesses, MCP, HTTP, embeddings, and LLM providers. The CLI validates arguments, calls core, and formats output.

The core contract is `open(path)` plus the 4Rs, `export`, `import`, `rebuildFts`,
`verify`, and `close`. `memories` rows are canonical; tags and FTS rows are derived.

## Build, Test, and Development Commands

- `npm install`: install and link the workspace packages.
- `npm test`: run all tests with Node's built-in test runner.
- `node packages/nmnm-cli/bin/nmnm.js --help`: run the CLI from the checkout.
- `node packages/nmnm-cli/bin/nmnm.js export --out memory.jsonl`: export JSONL.
- `node packages/nmnm-cli/bin/nmnm.js repair --rebuild-fts`: rebuild FTS rows.
- `npm pack --dry-run --workspace nmnm-core --workspace nmnm-cli`: inspect publishable package contents.

Use Node.js 22.13 or later. SQLite comes from `node:sqlite`; do not add an ORM or database dependency without a demonstrated need.

## Coding Style & Naming Conventions

Use ESM, two-space indentation, single quotes, and semicolons. Use camelCase for JavaScript variables and functions. Preserve public wire names such as `order_by`, `removed_at`, and CLI flags such as `--order-by`.

No formatter or linter is configured. Keep diffs focused and prefer small functions.

Preserve public snake-case names (`created_at`, `--order-by`). Use `soft` for reversible
removal and `purge` for irreversible removal.

## Testing Guidelines

Use `node:test` with `node:assert/strict`. Name tests after observable behavior, for example: `test('retain restores a soft-removed memory', ...)`. Add core tests for storage behavior and CLI tests for command parsing and output. Use temporary databases and isolated home directories for global-memory tests. Run `npm test` before submitting changes.

## Commit & Pull Request Guidelines

No Git history is currently available to establish a house style. Use concise Conventional Commit-style messages, such as `feat: add purge command` or `docs: clarify global storage`. Keep each commit focused.

Pull requests should explain user-visible behavior, list verification, link issues when available, and update docs/changelog for public changes.

## Data and Safety

Do not commit `.nanomneme/` or personal global databases. Prefer the CLI for mutations;
direct SQLite writes can desynchronize FTS and tags. Close databases before backup.
Test imports with temporary databases.
