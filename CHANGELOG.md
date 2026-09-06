# Changelog

## 0.0.4 - 2026-09-06

### Added

- Label every CLI retrieval result as `project`, `global`, or `custom`; readable rows show the store first.
- Add `retrieve --both` for project-first, then global retrieval; missing databases are treated as empty without being created.

### Changed

- Prefer higher-importance memories when FTS5/BM25 relevance scores tie; ID remains the final deterministic tie-breaker.
- Reject `--both` outside retrieval and when combined with `--global` or `--db`.
- Apply pagination once across the project-first `--both` sequence, sum store totals, and preserve duplicate IDs as separate source results.
- Validate `retrieve --both` selectors consistently when neither database exists.
- Reject export destinations that reference the source database directly or through a filesystem alias.
- Reject impossible calendar timestamps, malformed kebab-case slugs, and metadata values JSON would silently omit or coerce.
- Reject command-specific unsupported options and invalid command structures before opening or creating a database.
- Add publish-ready package metadata and restrict npm tarballs to runtime code, package documentation, and the MIT license.
- Reject non-JSON metadata instances and blank numeric CLI arguments instead of silently coercing them.

### Documentation

- Clarify FTS5 query semantics, relevance tie-breakers, and retrieval regression coverage.
- Record the approved phased contract for project-plus-global CLI retrieval.
- Audit CLI help and repository guidance for the completed multi-store behavior.
- Complete the v0.0.4 release-hardening audit, package installation smoke checks, and shipping guidance.

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
