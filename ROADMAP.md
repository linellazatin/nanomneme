# Roadmap

nanomneme remains an embedded, deterministic memory primitive: inspectable SQLite
records, lexical retrieval, and thin interfaces. Features are optional additions only
when they preserve that model.

## v0.0.3

- Core 4Rs, SQLite/FTS5 retrieval, project-local storage, and global persistence.
- Human CLI with structured JSON output.
- Transactional schema-version lifecycle checks and report-only integrity verification.
- Canonical JSONL export/import and explicit FTS rebuild repair.

## v0.0.4

- Deterministic importance tie-breaking for equal FTS5/BM25 scores.
- Retrieval provenance for project, global, and custom databases.
- Project-first `retrieve --both` with combined pagination and duplicate-ID preservation.
- Consistent selector validation without creating missing databases.

## Possible next steps

- [x] Release hardening for v0.0.4.
  - [x] Phase 1: prevent export destinations from overwriting the source database,
    including symlink and hardlink aliases.
  - [x] Phase 2: enforce canonical timestamps, kebab-case slugs, and JSON metadata.
  - [x] Phase 3: reject unsupported command options and validate commands before opening
    or creating databases.
  - [x] Phase 4: correct npm package metadata and published file contents.
  - [x] Phase 5: run the final release audit and verification checkpoint.
- [ ] User manual for developers and agents.
  - [ ] Phase 0: define audiences, common tasks, and document structure.
  - [ ] Phase 1: document installation, the core API, CLI commands, schema, and
    developer examples.
  - [ ] Phase 2: document deterministic agent commands, JSON output, store selection,
    and error handling.
  - [ ] Phase 3: document backup, import/export, verification, repair, and recovery.
  - [ ] Phase 4: validate examples and link the manual from the root README and package
    documentation.
- [ ] Source-specific converters for `opl-memory-md`, `openpi-memory`, and `openclaude-memory`,
  kept outside the core and added only when a real migration is needed.
- [ ] Connectivity: thin harness adapters and optional MCP/stdio transport.
- [x] Retrieval: measured deterministic ranking improvements; optional semantic retrieval
  only as a separate extension.
  - [x] Phase 0: add a fixed core retrieval corpus that records current FTS5 query,
    filtering, expiry, ordering, recency, and tie behavior.
  - [x] Phase 1: reproduce tied lexical scores falling back to ID and ignoring importance.
  - [x] Phase 2: prefer higher importance when lexical scores tie, then use ID.
  - [x] Phase 3: document the resulting ranking contract and measurement evidence.
- [x] Multi-store use: explicit project-plus-global retrieval in the CLI. The core stays
  single-store; `retrieve --both` composes project results before global results without
  comparing BM25 scores across databases. Retrieval items identify `store` as `project`,
  `global`, or `custom`; `(store, id)` is the effective identity.

  | Invocation | Databases read | Result `store` |
  |---|---|---|
  | `retrieve` | Default project | `project` |
  | `retrieve --global` | Standard global | `global` |
  | `retrieve --db <path>` | Explicit path | `custom` |
  | `retrieve --both` | Default project, then standard global | Per source row |

  `--both` is retrieval-only and cannot be combined with `--global` or `--db`. Missing
  databases are empty and are not created. Duplicate IDs remain separate source rows.
  - [x] Phase 0: record the approved behavior matrix and lock the existing single-store
    retrieval baseline without changing production behavior.
  - [x] Phase 1: add `store` provenance to project, global, and custom CLI retrieval
    results and readable output; keep `retain` and `recall` unchanged.
  - [x] Phase 2: add `retrieve --both`, reject combinations with `--global` or `--db`,
    and treat missing stores as empty without creating them.
  - [x] Phase 3: apply project-first pagination across both stores, sum their totals,
    and return duplicate IDs separately with store provenance.
  - [x] Phase 4: validate selectors even when both databases are missing; audit CLI
    help, README, changelog, and roadmap; run full tests, package dry-runs, and diff
    checks before closing the category.
- [ ] Portability: richer backup/export/import workflows when ordinary SQLite copies and
  canonical JSONL no longer suffice.
  - [ ] Before schema version 2, add an explicit read-only open mode so `verify` and
    `export` cannot apply migrations.

## Not on the required path

- LLM calls, embeddings, vector databases, and automatic consolidation.
- Background workers, mandatory network services, server mode, sync, or multi-user
  hosting.

Every proposed capability must keep the core local, open, configurable, and usable
without inference or extra infrastructure.
