# Roadmap

nanomneme remains an embedded, deterministic memory primitive: inspectable SQLite
records, lexical retrieval, and thin interfaces. Features are optional additions only
when they preserve that model.

## v0.0.3

- Core 4Rs, SQLite/FTS5 retrieval, project-local storage, and global persistence.
- Human CLI with structured JSON output.
- Transactional schema-version lifecycle checks and report-only integrity verification.
- Canonical JSONL export/import and explicit FTS rebuild repair.

## Possible next steps

- Source-specific converters for `opl-memory-md`, `openpi-memory`, and `openclaude-memory`,
  kept outside the core and added only when a real migration is needed.
- Connectivity: thin harness adapters and optional MCP/stdio transport.
- Retrieval: measured deterministic ranking improvements; optional semantic retrieval
  only as a separate extension.
- Multi-store use: explicit project-plus-global retrieval after precedence rules are
  proven necessary.
- Portability: richer backup/export/import workflows when ordinary SQLite copies and
  canonical JSONL no longer suffice.

## Not on the required path

- LLM calls, embeddings, vector databases, and automatic consolidation.
- Background workers, mandatory network services, server mode, sync, or multi-user
  hosting.

Every proposed capability must keep the core local, open, configurable, and usable
without inference or extra infrastructure.
