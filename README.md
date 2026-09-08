# nanomneme (nmnm)

nanomneme is a small, deterministic SQLite core for coding-agent memory: useful context survives a session without becoming an opaque service. Inspired by [`openpi-memory`](https://github.com/linellazatin/openpi-memory) and [`openclaude-memory`](https://github.com/linellazatin/openclaude-memory), and their demonstration that memory can persist in inspectable files, it replaces per-harness memory formats with one shared system for `Pi`, `OpenCode` (soon), and future adapters.

## What the name means

`Mneme` is Greek for memory or remembrance and evokes Mnemosyne. `nano` reflects the project's small, local focus: nanomneme is a compact memory primitive for developer tools and agents, not a memory platform, cloud service, or artificial brain.

## Our philosophy

`nanomneme` is built around a few principles:

- Memory persists beyond a session but remains user-owned and inspectable.
- The core is local and works without an LLM, embeddings, vector databases, servers, or required network services.
- Thin adapters share one core; retrieval is deterministic, explainable, and context-bounded.
- Injection supplies a compact index rather than complete records; project and global memories remain distinct.
- Pins are adapter-owned, memories are reusable across harnesses, removal is reversible by default, and JSONL keeps data portable.

Nanomneme helps agents remember without pretending to be human memory.

## Features

### Core memory handler

- **Local and user-owned:** no required LLM calls, embeddings, vector database, daemon, ORM, or network service; operations are local and deterministic, SQLite is the source of truth, and JSONL portability preserves explicit project/global boundaries.
- **Harness-agnostic foundation:** one shared memory contract supports Pi, OpenCode (soon), and future thin adapters.
- **4Rs lifecycle:** retain, recall, retrieve, and remove; soft removal is reversible and purge is explicit.
- **Local SQLite storage:** transactional canonical records with derived tags and FTS5 indexes.
- **Canonical validation:** UUID v4 IDs, UTC timestamps, supported kinds and scopes, kebab-case namespaces and tags, and JSON metadata.
- **Deterministic retrieval:** lexical FTS5/BM25 search, structured filters, expiry handling, pagination, and stable relevance, importance, recency, and ID ordering.
- **Multi-store selection:** project, global, or custom databases; `retrieve --both` returns project-first results with store provenance and preserves duplicate IDs.
- **Portable data:** canonical JSONL export/import with validation, conflict safety, atomic file replacement, and exact closed SQLite backups.
- **Integrity tools:** report-only verification, schema lifecycle checks, read-only access, and explicit FTS rebuild repair.

### CLI

- **Complete operator surface:** `retain`, `recall`, `retrieve`, `remove`, `verify`, `export`, `import`, and `repair`.
- **Human and agent output:** readable terminal messages or structured JSON, with JSONL reserved for exports.
- **Safe targeting:** project defaults, standard global storage, explicit `--db` paths, `--both` retrieval, and validated command-specific options.

### Adapters

#### Pi coding agent

- **Native memory tools:** model-invoked retain, recall, retrieve, and remove operations over `nmnm-core`.
- **Project and global memory:** explicit store selection with canonical records and no custom database-path parsing.
- **Bounded automatic context:** transient autoretention guidance and the first-prompt memory index share one configurable character budget; pinned entries come first, with recent active fallback, store labels, unresolved-pin reporting, and refresh after successful compaction or memory mutations.
- **Opt-in autoretention:** project/global JSONC rules guide the active model's `retain_memory` calls without a nested model, worker, or direct adapter write.
- **Adapter-owned configuration:** optional JSONC settings and separate JSON pin files, with project and global locations.
- **Direct user controls:** `/memory refresh`, `status`, `list`, `remove`, `pin`, and `unpin` without model involvement; `status` reports transient injection lifecycle metadata without exposing memory content.
- **Readable list UX:** project-first combined listing, pagination, `[project]` and `[global]` labels, exact-store `*` pin markers, and 60-character previews.
- **Safety boundaries:** validated pin targets, ambiguity-safe removal, soft-only slash removal, non-creating native reads, and durable unresolved pins.

## Architecture

```text
Pi adapter or nmnm CLI
          |
          v
       nmnm-core
          |
          v
node:sqlite + SQLite FTS5
```

`nmnm-core` owns the schema, validation, transactional writes, tags, FTS synchronization,
portability, verification, and repair. The CLI is the operator interface. Harness adapters
are thin core clients: they never write SQLite directly or parse CLI output.

## Packages

| Component | Role |
|---|---|
| `packages/nmnm-core` | Publishable Node.js ESM storage API. |
| `packages/nmnm-cli` | Publishable `nmnm` CLI. |
| `adapters/pi` | Private Git-first Pi package for v0.1.2. |

Use Node.js 22.13+ with built-in `node:sqlite` and FTS5. Public npm publication of the
Pi adapter is deferred; OpenCode is not included in this release.

## Quick start

```sh
npm install
node packages/nmnm-cli/bin/nmnm.js retain "Use SQLite for storage" \
  --kind decision --tags architecture,storage
node packages/nmnm-cli/bin/nmnm.js retrieve "SQLite"
```

The CLI defaults to `./.nanomneme/memory.db`. `--global` uses
`~/.local/share/nanomneme/memory.db` on Linux and macOS. `retrieve --both` composes
project results before global results; `(store, id)` identifies a retrieval item.

Try the Pi adapter directly from a checkout:

```sh
pi -e ./adapters/pi/extensions/index.js
```

Pi settings and pins are adapter-owned files outside SQLite. First load creates neither:
`nmnm.jsonc` is optional and user-authored, and `nmnm-pi.json` appears only after a pin change.
The first prompt receives a bounded transient index, rebuilt after successful compaction or memory
mutations. Optional `autoretention` only guides the active model's `retain_memory`; disabled-by-default
`reinjection` can rebuild the same context every five user prompts. Direct controls provide a project-first
`/memory list`, reversible ambiguity-safe `/memory remove`, and store-validated `/memory pin`. Only
`retain_memory` creates a missing database; native reads and removal leave missing stores absent. See the
Pi manual for the full lifecycle.

## Documentation

| Document | Owns |
|---|---|
| [Core and CLI Manual](docs/CORE_CLI_MANUAL.md) | Core API, CLI, data contract, agent use, portability, and recovery. |
| [Core README](packages/nmnm-core/README.md) | Core package installation and API discovery. |
| [CLI README](packages/nmnm-cli/README.md) | CLI package installation and command discovery. |
| [Pi quick start](adapters/pi/README.md) | Package-local Pi entry point. |
| [Pi Adapter Manual](docs/PI_ADAPTER_MANUAL.md) | Pi installation, tools, pins, configuration, and automatic index behavior. |
| [Roadmap](ROADMAP.md) | Phased delivery and deferred work. |
| [Changelog](CHANGELOG.md) | Released and unreleased changes. |

`nmnm --help` is authoritative for CLI flags. Runtime code and tests are authoritative
when documentation disagrees with behavior.

## Development

```sh
npm test
pi -e ./adapters/pi/extensions/index.js --help
npm pack --dry-run --workspace nmnm-core --workspace nmnm-cli
```

Run `npm test` before submitting changes. Do not commit `.nanomneme/`, personal global
databases, or Pi settings and pin files containing local data. Use canonical JSONL for transfer and
closed SQLite copies for exact backups. See the manuals for validation, recovery, and
adapter-specific safety boundaries.
