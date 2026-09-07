# nanomneme

nanomneme is a small, deterministic SQLite memory store for people and coding agents.
It uses lexical FTS5/BM25 retrieval and structured filters. It has no required LLM,
embedding, vector database, server, or background worker.

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
| `adapters/pi` | Private Git-first Pi package for v0.1.0. |

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
`nmnm-pi.json` appears only after a pin change. See the Pi manual for the full lifecycle.
Its direct user controls include project-first global `/memory list`, with pin markers and
compact previews, ambiguity-safe reversible `/memory remove`, and store-validated `/memory pin`.
Only Pi `retain_memory` creates a missing database; native reads and removal leave missing
stores absent.

## Documentation

| Document | Owns |
|---|---|
| [Core and CLI Manual](docs/CORE_CLI_MANUAL.md) | Core API, CLI, data contract, agent use, portability, and recovery. |
| [Pi Adapter Manual](docs/PI_ADAPTER_MANUAL.md) | Pi installation, tools, pins, configuration, and automatic index behavior. |
| [Pi quick start](adapters/pi/README.md) | Package-local Pi entry point. |
| [Core README](packages/nmnm-core/README.md) | Core package installation and API discovery. |
| [CLI README](packages/nmnm-cli/README.md) | CLI package installation and command discovery. |
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
