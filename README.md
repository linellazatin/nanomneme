<div align="center">

# nanomneme (nmnm)

[![gh stars](https://img.shields.io/github/stars/linellazatin/nanomneme?logo=github&color=ffffe0)](https://github.com/linellazatin/nanomneme)
[![gh release](https://img.shields.io/github/v/release/linellazatin/nanomneme?label=release&logo=github&color=ffffe0)](https://github.com/linellazatin/nanomneme)
[![license](https://img.shields.io/npm/l/@openlines/opl-pi-sht)](./LICENSE)

### memory core
[![nmnm-cli version](https://img.shields.io/npm/v/%40openlines%2Fnmnm-cli?label=cli&logo=npm&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-cli)
[![nmnm-cli downloads](https://img.shields.io/npm/dm/@openlines/nmnm-cli?label=cli&logo=npm&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-cli)

[![nmnm-core version](https://img.shields.io/npm/v/%40openlines%2Fnmnm-core?label=core&logo=npm&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-core)
[![nmnm-core downloads](https://img.shields.io/npm/dm/@openlines/nmnm-core?label=core&logo=npm&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-core)

### adapters
[![nmnm-pi version](https://img.shields.io/npm/v/%40openlines%2Fnmnm-pi?label=pi&logo=pi&color=ffffe0)](https://www.npmjs.com/package/@openlines/nmnm-pi)
[![nmnm-claude version](https://img.shields.io/badge/claude-v0.1.2-orange?logo=claude)](https://github.com/linellazatin/nanomneme/tree/main/adapters/claude)
[![nmnm-opencode version](https://img.shields.io/npm/v/%40openlines%2Fnmnm-opencode?label=opencode&logo=opencode)](https://www.npmjs.com/package/@openlines/nmnm-opencode)

</div>

nanomneme is a small, deterministic SQLite core for coding-agent memory: useful context survives a session without becoming an opaque service. Inspired by [`openpi-memory`](https://github.com/linellazatin/openpi-memory) and [`openclaude-memory`](https://github.com/linellazatin/openclaude-memory), and their demonstration that memory can persist in inspectable files, it replaces per-harness memory formats with one shared system for `Pi`, `Claude Code`, and future adapters.

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
- **Harness-agnostic foundation:** one shared memory contract supports Pi, Claude Code, OpenCode, and future thin adapters.
- **4Rs lifecycle:** retain, recall, retrieve, and remove; retrieval can filter recorded harness sources; soft removal is reversible and purge is explicit.
- **Local SQLite storage:** transactional canonical records with derived tags and FTS5 indexes.
- **Canonical validation:** UUID v4 IDs, UTC timestamps, supported kinds and scopes, kebab-case namespaces and tags, and JSON metadata.
- **Deterministic retrieval:** lexical FTS5/BM25 search with literal punctuation terms, structured filters, expiry handling, pagination, and stable relevance, importance, recency, and ID ordering.
- **Multi-store selection:** project, global, or custom databases; `retrieve --both` returns project-first results with store provenance and preserves duplicate IDs.
- **Portable data:** canonical JSONL export/import with validation, conflict safety, atomic file replacement, and exact closed SQLite backups.
- **Integrity tools:** report-only verification, schema lifecycle checks, read-only access, and explicit FTS rebuild repair.

### CLI

- **Complete operator surface:** `retain`, `recall`, `retrieve`, `remove`, `verify`, `export`, `import`, and `repair`.
- **Human and agent output:** readable terminal messages or structured JSON, with JSONL reserved for exports.
- **Safe targeting:** project defaults, standard global storage, explicit `--db` paths, `--both` retrieval, and validated command-specific options.

### Adapters

#### Pi coding agent

- **Native memory tools:** model-invoked retain, recall, retrieve, and remove operations over `nmnm-core`; project operations require Pi project trust, while global operations remain available in untrusted projects. Model-visible JSON is bounded to 50 KiB, with explicit summaries for oversized results.
- **Project and global memory:** explicit store selection with canonical records and no custom database-path parsing.
- **Bounded automatic context:** transient autoretention guidance and the first-prompt memory index share one configurable character budget; pinned entries come first, with recent active fallback, store and recorded-source labels, unresolved-pin reporting, and refresh after successful compaction or memory mutations.
- **Opt-in autoretention:** project/global JSONC rules guide the active model's `retain_memory` calls without a nested model, worker, or direct adapter write.
- **Adapter-owned configuration:** optional JSONC settings and separate JSON pin files, with project and global locations.
- **Direct user controls:** `/memory refresh`, `status`, `list`, `remove`, `pin`, and `unpin` without model involvement; `status` reports injection state, autoretention, the effective index budget, current full-payload character count, and lifecycle metadata without exposing memory content.
- **Native memory browser:** `/memory` and `/memory browse` show the shared status card before opening; record details stay inside a native action dialog, so the card remains visible on return. Search and store controls stay above each record page. Standard selection keys honor Pi's configured `tui.select.*` bindings; `h/j/k/l` remain available.
- **Readable list UX:** project-first combined listing, pagination, `[project]` and `[global]` labels, exact-store `*` pin markers, and 60-character previews; browser rows omit IDs, which remain in details.
- **Safety boundaries:** validated pin targets, ambiguity-safe removal, soft-only slash removal, non-creating native reads, and durable unresolved pins.

#### Claude Code

- **Native MCP memory tools:** model-invoked retain, recall, retrieve, and remove over a local stdio MCP server that imports `nmnm-core` directly; no daemon, network, or CLI parsing. `retain_memory` records Claude Code source provenance on new entries; `remove_memory` is soft-only.
- **Bounded session-start context:** a `SessionStart` command hook injects the project/global index and optional autoretention guidance as transient context; disabled-by-default `UserPromptSubmit` reinjection uses a configurable cadence.
- **Shared and adapter-owned config:** project `nmnm.jsonc` settings shared with Pi, adapter-owned `nmnm-claude.json` pins, and global settings under `${CLAUDE_PLUGIN_DATA}`.
- **Model guidance:** a `memory-guide` Skill (`/nanomneme:memory-guide`) teaches the 4Rs, project-versus-global scope, and safe capture.
- **Model-free management command:** `bin/memory.js` (`status`, `list`, `search`, `show`, `pin`, `unpin`, `remove`) reuses the shared store/context helpers; `list` and `search` accept `--source all|claude-code`. A `/nanomneme:memory` slash command embeds it and relays output verbatim, or invoke the CLI with `!` for a fully model-free path.

#### OpenCode

- **Native plugin memory tools:** an OpenCode server plugin on `@opencode-ai/plugin` registers retain, recall, retrieve, and remove backed by `nmnm-core` with no MCP server, daemon, network, or CLI parsing. Because OpenCode loads plugins under Bun (no `node:sqlite`), each core call runs in a short-lived spawned `node` bridge. `retain_memory` records `"opencode"` source provenance on new entries and is the only operation that creates a missing store; `remove_memory` is soft-only.
- **Bounded transient injection:** `experimental.chat.system.transform` appends the project/global index and optional autoretention guidance to the merged system prompt on every request with non-empty context (OpenCode rebuilds the prompt per request, so no cadence gating is needed). No context is written to disk.
- **Shared and adapter-owned config:** project `nmnm.jsonc` settings shared with Pi and Claude, adapter-owned `nmnm-opencode.json` pins, and global settings under `${XDG_CONFIG_HOME:-~/.config}/opencode`.
- **Model-free management CLI:** `nmnm-opencode` (`status`, `list`, `search`, `show`, `pin`, `unpin`, `remove`) with project-first combined pagination and `--source all|opencode`; purge stays CLI-only.
- **Model-free TUI memory browser:** an optional `tui.js` plugin (registered via `tui.jsonc`) opened on **ctrl+alt+m** with Status/All/Project/Global tabs, source cycling, and pin/unpin/soft-remove, routed through the same Node bridge.

## Architecture

```text
chosen adapter or nmnm CLI
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
| `packages/nmnm-core` | Publishable `@openlines/nmnm-core` Node.js ESM storage API. |
| `packages/nmnm-cli` | Publishable `@openlines/nmnm-cli` package providing the `nmnm` CLI. |
| `adapters/pi` | Publishable `@openlines/nmnm-pi` Pi package, including a model-free memory browser. |
| `adapters/claude` | Private Git-first Claude Code plugin: native MCP memory tools plus session-start index injection. |
| `adapters/opencode` | Publishable `@openlines/nmnm-opencode` OpenCode server plugin: native memory tools plus bounded transient index injection. |

Use Node.js 22.19+ with built-in `node:sqlite` and FTS5. The Pi adapter is published as
`@openlines/nmnm-pi` and the OpenCode adapter as `@openlines/nmnm-opencode`; Claude Code is a
separately installed Git-first plugin.

## Quick start

```sh
npm install --global @openlines/nmnm-cli
nmnm retain "Use SQLite for storage" --kind decision --tags architecture,storage
nmnm retrieve "SQLite"
```

This one command installs the CLI and its exact `@openlines/nmnm-core` dependency. Install
`@openlines/nmnm-core` directly only when writing a Node.js integration. Install Pi with:

```sh
pi install npm:@openlines/nmnm-pi
```

Claude Code remains a separately installed adapter.

The CLI defaults to `./.nanomneme/memory.db`. `--global` uses
`~/.local/share/nanomneme/memory.db` on Linux and macOS. Standard `retain` routes derive the
matching scope; custom `--db` retains require `--scope project|global`. `retrieve --both`
composes project results before global results; `(store, id)` identifies a retrieval item.

Try the Pi adapter directly from a checkout:

```sh
pi -e ./adapters/pi/extensions/index.js
```

Pi settings and pins are adapter-owned files outside SQLite. First load creates neither:
`nmnm.jsonc` is optional and user-authored, and `nmnm-pi.json` appears only after a pin change.
The first prompt receives a bounded transient index, rebuilt after successful compaction or memory
mutations. In an untrusted Pi project, automatic context is global-only and project files are not read;
project model tools are refused, while explicit user `/memory` commands remain available. Optional
`autoretention` only guides the active model's `retain_memory`; disabled-by-default
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
| [Pi Adapter Manual](adapters/pi/docs/PI_ADAPTER_MANUAL.md) | Pi installation, tools, pins, configuration, and automatic index behavior. |
| [Claude quick start](adapters/claude/README.md) | Package-local Claude Code plugin entry point. |
| [Claude Adapter Manual](adapters/claude/docs/CLAUDE_ADAPTER_MANUAL.md) | Claude Code plugin install, MCP tools, hooks, the `/nanomneme:memory` management command, pins, and configuration. |
| [OpenCode quick start](adapters/opencode/README.md) | Package-local OpenCode server plugin entry point. |
| [OpenCode Adapter Manual](adapters/opencode/docs/OPENCODE_ADAPTER_MANUAL.md) | OpenCode plugin install, native tools, transient injection, the `nmnm-opencode` CLI, the TUI memory browser, pins, configuration, and compatibility probes. |
| [Roadmap](ROADMAP.md) | Phased delivery and deferred work. |
| [Changelog](CHANGELOG.md) | Released and unreleased changes. |

`nmnm --help` is authoritative for CLI flags. Runtime code and tests are authoritative
when documentation disagrees with behavior.

## Development

```sh
npm test
pi -e ./adapters/pi/extensions/index.js --help
npm pack --dry-run --workspace @openlines/nmnm-core --workspace @openlines/nmnm-cli
```

Run `npm test` before submitting changes. Do not commit `.nanomneme/`, personal global
databases, or Pi settings and pin files containing local data. Use canonical JSONL for transfer and
closed SQLite copies for exact backups. See the manuals for validation, recovery, and
adapter-specific safety boundaries.
