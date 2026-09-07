# Repository Guidelines

## Project Structure & Module Organization

This Node.js ESM workspace has two packages:

- `packages/nmnm-core/src/index.js` contains the SQLite schema, 4Rs, portability APIs, and FTS repair.
- `packages/nmnm-cli/bin/nmnm.js` implements the `nmnm` command-line interface.
- Package tests live in `packages/*/test/*.test.js`.
- Each package keeps its own `README.md` and `LICENSE`; publish only runtime files.
- Root documentation is `README.md`, `CHANGELOG.md`, `ROADMAP.md`, and
  `docs/CORE_CLI_MANUAL.md`.

Keep core independent of CLI parsing, MCP, HTTP, embeddings, and LLM providers. Its
contract is `open(path, { create, readOnly })`, the 4Rs, portability, verification, FTS
repair, and `close`. `memories` rows are canonical; tags and FTS rows are derived.

## Build, Test, and Development Commands

- `npm install`: install and link workspaces.
- `npm test`: run all tests with Node's built-in test runner.
- `node packages/nmnm-cli/bin/nmnm.js --help`: run the CLI from the checkout.
- `node packages/nmnm-cli/bin/nmnm.js export --out memory.jsonl`: export JSONL.
- `npm pack --dry-run --workspace nmnm-core --workspace nmnm-cli`: inspect publishable package contents.
- `npm publish --dry-run --workspace nmnm-core --workspace nmnm-cli`: validate publication metadata without publishing.

Use Node.js 22.13+ and built-in `node:sqlite`. Publish `nmnm-core` before `nmnm-cli`;
the CLI pins the matching core version.

## Coding Style & Naming Conventions

Use ESM, two-space indentation, single quotes, semicolons, and camelCase JavaScript names.
Preserve public snake-case wire names such as `created_at` and flags such as `--order-by`.
No formatter or linter is configured. Keep diffs focused and functions small. Use `soft`
for reversible removal and `purge` for irreversible removal.

## Testing Guidelines

Use `node:test` with `node:assert/strict`. Name tests after observable behavior. Put
storage tests in core and parsing/output tests in CLI. Use temporary databases and
isolated home directories for global tests. Run `npm test` before submission.

## Commit & Pull Request Guidelines

Use concise Conventional Commit-style subjects and focused commits. Pull requests should
explain user-visible behavior, list verification, link issues when available, and update
documentation and the changelog for public changes.

## Data and Safety

Do not commit `.nanomneme/` or personal global databases. Prefer CLI mutations because
direct SQLite writes can desynchronize tags and FTS. Validate canonical imports before
opening new destinations. Export files must not alias their source and must use
same-directory atomic replacement. Use JSONL for transfer/restore and closed SQLite
copies for exact backups. Require a concrete workflow and conflict policy before adding
overwrite, backup, compression, or converter behavior.
