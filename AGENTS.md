# Repository Guidelines

## Project Structure & Module Organization

This is a Node.js ESM workspace with two packages:

- `packages/nmnm-core/src/index.js` contains the SQLite schema and the retain, recall, retrieve, and remove operations.
- `packages/nmnm-cli/bin/nmnm.js` implements the `nmnm` command-line interface.
- Package tests live in `packages/*/test/*.test.js`.
- Root documentation is `README.md`, `CHANGELOG.md`, and `ROADMAP.md`. There are no static assets or build output directories.

Keep the core independent of CLI parsing, harnesses, MCP, HTTP services, embeddings, and LLM providers. The CLI should validate arguments, call the core, and format output only.

## Build, Test, and Development Commands

- `npm install`: install and link the workspace packages.
- `npm test`: run all tests with Node's built-in test runner.
- `node packages/nmnm-cli/bin/nmnm.js --help`: run the CLI from the checkout.
- `npm pack --dry-run --workspace nmnm-core --workspace nmnm-cli`: inspect publishable package contents.

Use Node.js 22.13 or later. SQLite comes from `node:sqlite`; do not add an ORM or database dependency without a demonstrated need.

## Coding Style & Naming Conventions

Use ESM, two-space indentation, single quotes, and semicolons. Use camelCase for JavaScript variables and functions. Preserve public wire names such as `order_by`, `removed_at`, and CLI flags such as `--order-by`.

No formatter or linter is configured. Keep diffs focused and match surrounding style. Prefer small, direct functions over new abstractions.

## Testing Guidelines

Use `node:test` with `node:assert/strict`. Name tests after observable behavior, for example: `test('retain restores a soft-removed memory', ...)`. Add core tests for storage behavior and CLI tests for command parsing and output. Use temporary databases and isolated home directories for global-memory tests. Run `npm test` before submitting changes.

## Commit & Pull Request Guidelines

No Git history is currently available to establish a house style. Use concise Conventional Commit-style messages, such as `feat: add purge command` or `docs: clarify global storage`. Keep each commit focused.

Pull requests should explain user-visible behavior, list verification performed, link related issues when available, and update documentation or the changelog for public changes. Screenshots are not normally relevant for this CLI project.
