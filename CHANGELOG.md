# Changelog

## 0.0.3 - 2026-08-27

### Added

- Transactional schema-version lifecycle checks and an explicit `verify` diagnostic.
- `nmnm verify` with readable and JSON reports; detected defects exit with status `1`.
- Canonical JSONL `export`/`import` with atomic validation and ID conflict checks.
- Explicit `repair --rebuild-fts` for rebuilding derived full-text rows.
- Add `nmnm --version` and `nmnm -v` CLI flags.

## 0.0.2 - 2026-08-25

### Changed

- Rename permanent removal mode from `hard` to `purge`, matching `--purge`.
- Expand readable retain and recall output; readable remove output now includes mode and timestamp.

## 0.0.1 - 2026-08-25

### Added

- SQLite-backed `nmnm-core` with retain, recall, retrieve, and soft remove.
- FTS5/BM25 retrieval, structured filters, normalized tags, and JSON metadata.
- `nmnm` CLI with readable output and `--json`.
- Local database defaults, explicit `--db`, tests, and operator documentation.
- Separate global persistence via `--global` at `~/.local/share/nanomneme/memory.db`.
- Restore soft-removed memories with `retain --id`; permanently delete with `remove --purge`.
- Enforced field conventions: UUID v4 IDs, canonical UTC timestamps, `project`/`global` scopes, and lowercase kebab-case namespaces and tags.
