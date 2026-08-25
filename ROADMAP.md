# Roadmap

nanomneme remains an embedded, deterministic memory primitive: inspectable SQLite
records, lexical retrieval, and thin interfaces. Features are optional additions only
when they preserve that model.

## v0.0.1

- Core 4Rs, SQLite/FTS5 retrieval, project-local storage, and global persistence.
- Human CLI with structured JSON output.

## Possible next steps

- Portability: backup guidance, export, and import.
- Connectivity: thin harness adapters and optional MCP/stdio transport.
- Retrieval: measured deterministic ranking improvements; optional semantic retrieval
  only as a separate extension.
- Multi-store use: explicit project-plus-global retrieval after precedence rules are
  proven necessary.

## Not on the required path

- LLM calls, embeddings, vector databases, and automatic consolidation.
- Background workers, mandatory network services, server mode, sync, or multi-user
  hosting.

Every proposed capability must keep the core local, open, configurable, and usable
without inference or extra infrastructure.
