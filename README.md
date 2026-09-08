# nanomneme (nmnm)

nanomneme began with a simple question: how can coding agents remember useful things across sessions without turning memory into another opaque service?

The inspiration came from systems such as [`openpi-memory`](https://github.com/linellazatin/openpi-memory) and [`openclaude-memory`](https://github.com/linellazatin/openclaude-memory), which demonstrated that persistent agent memory could be built from ordinary, inspectable Markdown files. Their central insight was practical: agents become more useful when important context survives the current conversation and can be reintroduced when needed.

nanomneme carries that idea forward into a small, deterministic SQLite core. Instead of making each harness own its memory format, nanomneme provides one shared memory system that `Pi`, `OpenCode` (soon), and future adapters can use consistently.

## What the name means

`Mneme` comes from the Greek word for `memory or remembrance`. It also evokes `Mnemosyne`, the personification of memory in Greek mythology.

The `nano` prefix describes the project’s character: small, local, focused, and lightweight. `nanomneme` is not trying to become a memory platform, cloud service, or artificial brain. It is a compact memory primitive that can sit underneath developer tools and agents.

## Our philosophy

`nanomneme` is built around a few principles:

- Memory should persist beyond a session, but remain owned and inspectable by the user.
- The core should work locally without an LLM, embeddings, vector databases, servers, or required network services.
- One shared core should support many harnesses through thin adapters.
- Retrieval should be deterministic, explainable, and bounded by the available context budget.
- Automatic injection should provide a compact memory index, not dump every full record into the prompt.
- Project and global memories should remain explicit and distinguishable.
- Pins belong to the adapter that uses them, while memories remain reusable across harnesses.
- Removal should be reversible by default, and data should remain portable through canonical JSONL.
- A memory system should help agents remember without pretending to be human memory.

At its heart, `nanomneme` is a durable, local record of what matters: `small enough to understand, strong enough to persist, and open enough to serve whatever harness comes next`.

## Features

### Core memory handler

- **Lightweight by design:** no required LLM calls, embeddings, vector database, daemon, ORM, or network service; memory operations stay local and deterministic.
- **User-owned and inspectable:** SQLite is the source of truth, with readable JSONL portability and explicit project/global boundaries.
- **Harness-agnostic foundation:** one shared memory contract keeps records reusable across Pi, OpenCode (soon), and future thin adapters.
- **4Rs lifecycle:** retain, recall, retrieve, and remove memories; soft removal is reversible and purge is explicit.
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
- **Direct user controls:** `/memory refresh`, `status`, `list`, `remove`, `pin`, and `unpin` without model involvement.
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
| `adapters/pi` | Private Git-first Pi package for v0.1.1. |

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

Pi settings and pins remain adapter-owned files outside SQLite. The adapter creates no
configuration on first load: `nmnm.jsonc` is optional and user-authored, while
`nmnm-pi.json` appears only after a pin change. The bounded index is appended transiently to
the first prompt and rebuilt after successful compaction or memory mutations; optional
`autoretention` rules only guide the active model's `retain_memory` calls. See the Pi manual
for the full lifecycle.
Its direct user controls include project-first global `/memory list`, with pin markers and
compact previews, ambiguity-safe reversible `/memory remove`, and store-validated `/memory pin`.
Only Pi `retain_memory` creates a missing database; native reads and removal leave missing
stores absent.

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
