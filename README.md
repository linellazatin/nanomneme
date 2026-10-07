<div align="center">

# nanomneme (nmnm)

[![gh stars](https://img.shields.io/github/stars/linellazatin/nanomneme?logo=github&color=ffffe0)](https://github.com/linellazatin/nanomneme)
[![gh release](https://img.shields.io/github/v/release/linellazatin/nanomneme?label=release&logo=github&color=ffffe0)](https://github.com/linellazatin/nanomneme)
[![license](https://img.shields.io/github/license/linellazatin/nanomneme)](./LICENSE)

### memory core
[![nmnm-cli version](https://img.shields.io/npm/v/%40openlines%2Fnmnm-cli?label=cli&logo=npm&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-cli)
[![nmnm-cli downloads](https://img.shields.io/npm/dt/@openlines/nmnm-cli?label=cli&logo=npm&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-cli)

[![nmnm-core version](https://img.shields.io/npm/v/%40openlines%2Fnmnm-core?label=core&logo=npm&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-core)
[![nmnm-core downloads](https://img.shields.io/npm/dt/@openlines/nmnm-core?label=core&logo=npm&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-core)

[![nmnm-ui version](https://img.shields.io/npm/v/%40openlines%2Fnmnm-ui?label=workbench-ui&logo=npm&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-ui)

### adapters
[![nmnm-pi version](https://img.shields.io/npm/v/%40openlines%2Fnmnm-pi?label=pi&logo=pi&color=ffffe0)](https://www.npmjs.com/package/@openlines/nmnm-pi)
[![nmnm-opencode version](https://img.shields.io/npm/v/%40openlines%2Fnmnm-opencode?label=opencode&logo=opencode&color=gray)](https://www.npmjs.com/package/@openlines/nmnm-opencode)
[![nmnm-claude version](https://img.shields.io/badge/claude-v0.2.2-orange?logo=claude)](https://github.com/linellazatin/nanomneme/tree/main/adapters/claude)
[![nmnm-codex version](https://img.shields.io/badge/codex-v0.2.2-black?logo=codex)](https://github.com/linellazatin/nanomneme/tree/main/adapters/codex)

>

<img src="docs/img/nanomneme-logo-dark-accent.svg" width="25%" alt="nmnm logo">

</div>

>
> ### v0.8.1 - workbench correctness and web standards
> - Patched UI `0.1.1` preserves credentials after skip-link reloads, repairs shrinking pagination, stages filter changes, and restores keyboard/mobile focus.
> - Semantic HTML, stronger input contrast, a WCAG 2.2 AA maintenance target, and blocking Chromium/Firefox/WebKit correctness/accessibility gates. CLI `0.4.1` pins the patched UI; publication remains separate.
> ### v0.8.0 - experimental workbench ui, logging organization, and dependency fixes
> - `nmnm ui` with CLI-bundled UI: on-demand browser workbench with explicit store/source selection, read-only defaults, editing, expiry management, removal, restoration, and purge. See the [UI README](packages/nmnm-ui/README.md).
> - Consistent `src/logslines.js` bindings, unified logger generation, explicit UI packaging, adapter/core patch releases, and resolved dependency audit findings.
> - Maintenance commands for logger builds, reviewed upstream updates, Codex cache refresh, and read-only validation shared with CI/release.
> ### v0.7.0 - core and CLI hardening
> - Private new storage, transactional patches, Unicode and Boolean search, ordered record timestamps, and explicit deletion guarantees. Adapters pinned core `0.3.0` in that release; Claude/OpenCode pin updates are locked and atomic.
> ### v0.6.0 - logslines shared logger integration
> - Initial implementation of shared logger for ALL adapters, including nmnm-cli.
>
> see [CHANGELOG](CHANGELOG.md) for more details.
>

nanomneme is a small, deterministic SQLite core for coding-agent memory: useful context survives a session without becoming an opaque service. Inspired by [`openpi-memory`](https://github.com/linellazatin/openpi-memory) and [`openclaude-memory`](https://github.com/linellazatin/openclaude-memory), and their demonstration that memory can persist in inspectable files, it replaces per-harness memory formats with one shared system for `Pi`, `Claude Code`, `OpenCode`, `Codex`, and future adapters.

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
- **Harness-agnostic foundation:** one shared memory contract supports Pi, Claude Code, Codex, OpenCode, and future thin adapters.
- **4Rs lifecycle:** retain, recall, retrieve, and remove; retrieval can filter recorded harness sources; soft removal is reversible and purge is explicit.
- **Local SQLite storage:** atomic canonical, tag, and FTS5 mutations, snapshot reads, latest-record patching, and strictly increasing per-record update timestamps.
- **Canonical validation:** UUID v4 IDs, UTC timestamps, supported kinds and scopes, kebab-case namespaces and tags, and JSON metadata.
- **Deterministic retrieval:** Unicode FTS5/BM25 search with Boolean expressions, phrases, prefixes, NEAR groups, literal fallback for malformed expressions, structured filters, expiry handling, pagination, and stable relevance, importance, recency, and ID ordering.
- **Multi-store selection:** project, global, or custom databases; `retrieve --both` returns project-first results with store provenance and preserves duplicate IDs.
- **Portable data:** canonical JSONL export/import with validation, conflict safety, atomic file replacement, and exact closed SQLite backups.
- **Integrity tools:** report-only verification, schema lifecycle checks, read-only access, and explicit FTS rebuild repair.

### CLI

- **Complete operator surface:** `retain`, `recall`, `retrieve`, `remove`, `verify`, `export`, `import`, and `repair`.
- **Human and agent output:** readable terminal messages or structured JSON, with JSONL reserved for exports.
- **Safe targeting:** project defaults, standard global storage, explicit `--db` paths, `--both` retrieval, and validated command-specific options.

### Local review UI

- **On-demand workbench:** experimental `@openlines/nmnm-ui`, with patched UI `0.1.1` bundled by checkout CLI `0.4.1` for the next publication; Node foreground launcher, loopback browser access, no persistent daemon, and local Openlines light/dark assets.
- **Explicit review:** collapsible Stores with an added-store count, a local database picker, and trash controls that preserve files; recorded source filters, Active/Expired/Removed views, literal search, and five visible preview rows within 50-record pages.
- **Deliberate cleanup:** read-only by default; enable editing per store for changed-field updates, expiry changes, soft removal, restoration, and separately confirmed permanent purge. Scope and provenance are read-only.
- **Current limits:** full-store snapshots, a non-atomic stale-edit check, no soft removal of expired records, and session-only registrations. Creation, transfer, repair, bulk operations, and adapter settings are future features. See the [UI README](packages/nmnm-ui/README.md).

### Diagnostics

Diagnostics default off. CLI, UI mutations, and adapters use the shared Logslines observer; UI general errors use a separate emitter. Enable shared `logging.enabled` or an applicable user-level adapter override. Raw error messages are not redacted. See the [Logger manual](docs/LOGGER.md).

### Adapters

#### Pi coding agent

- **Native memory tools:** model-invoked retain, recall, retrieve, and remove operations over `nmnm-core`; project operations require Pi project trust, while global operations remain available in untrusted projects. Model-visible JSON is bounded to 50 KiB, with explicit summaries for oversized results.
- **Project and global memory:** explicit store selection with canonical records and no custom database-path parsing.
- **Bounded automatic context:** transient autoretention guidance and the first-prompt memory index share one configurable character budget; pinned entries come first, with recent active fallback, store and recorded-source labels, unresolved-pin reporting, and refresh after successful compaction or memory mutations.
- **Opt-in autoretention:** project/global JSONC rules guide the active model's `retain_memory` calls without a nested model, worker, or direct adapter write.
- **Adapter-owned configuration:** optional JSONC settings and separate JSON pin files, with project and global locations.
- **Direct user controls:** `/memory refresh`, `status`, `list`, `remove`, `pin`, and `unpin` without model involvement; `status` reports injection state, autoretention, the effective index budget, current full-payload character count, and lifecycle metadata without exposing memory content.
- **Native memory browser:** `/memory` and `/memory browse` open a Pi TUI menu with `Status`, `All`, `Project`, and `Global` tabs. Record details use a native action dialog; returning preserves selection. Standard selection keys honor configured `tui.select.*` bindings; arrows and `h/j/k/l` support navigation. Non-TUI UI modes use native dialogs.
- **Readable list UX:** project-first combined listing, pagination, `[project]` and `[global]` labels, exact-store `*` pin markers, and 60-character previews; browser rows omit IDs, which remain in details.
- **Safety boundaries:** validated pin targets, ambiguity-safe removal, soft-only slash removal, non-creating native reads, and durable unresolved pins.

#### OpenCode

- **Native plugin memory tools:** an OpenCode server plugin on `@opencode-ai/plugin` registers retain, recall, retrieve, and remove backed by `nmnm-core` with no MCP server, daemon, network, or CLI parsing. Because OpenCode loads plugins under Bun (no `node:sqlite`), each core call runs in a short-lived spawned `node` bridge. `retain_memory` records `"opencode"` source provenance on new entries and is the only operation that creates a missing store; `remove_memory` is soft-only.
- **Bounded transient injection:** `experimental.chat.system.transform` appends the project/global index and optional autoretention guidance to the merged system prompt on every request with non-empty context (OpenCode rebuilds the prompt per request, so no cadence gating is needed). No context is written to disk.
- **Shared and adapter-owned config:** project `nmnm.jsonc` settings shared with Pi and Claude, adapter-owned `nmnm-opencode.json` pins, and global settings under `${XDG_CONFIG_HOME:-~/.config}/opencode`.
- **Model-free management CLI:** `nmnm-opencode` (`status`, `list`, `search`, `show`, `pin`, `unpin`, `remove`) with project-first combined pagination and `--source all|opencode`; purge is available through `nmnm remove --purge` or the UI workbench, outside adapter management.
- **Model-free TUI memory browser:** an optional `tui.js` plugin (registered via `tui.jsonc`) opened on **ctrl+alt+m** with Status/All/Project/Global tabs, source cycling, and pin/unpin/soft-remove, routed through the same Node bridge.

#### Claude Code

- **Native MCP memory tools:** model-invoked retain, recall, retrieve, and remove over a local stdio MCP server that imports `nmnm-core` directly; no daemon, network, or CLI parsing. `retain_memory` records Claude Code source provenance on new entries; `remove_memory` is soft-only.
- **Bounded session-start context:** a `SessionStart` command hook injects the project/global index and optional autoretention guidance as transient context; disabled-by-default `UserPromptSubmit` reinjection uses a configurable cadence.
- **Shared and adapter-owned config:** project `nmnm.jsonc` settings shared with Pi, adapter-owned `nmnm-claude.json` pins, and global settings under `${CLAUDE_PLUGIN_DATA}` (fallback `~/.claude`). Memory databases remain in the standard Nanomneme locations.
- **Model guidance:** a `memory-guide` Skill (`/nanomneme:memory-guide`) teaches the 4Rs, project-versus-global scope, and safe capture.
- **Model-free management command:** `bin/memory.js` (`status`, `list`, `search`, `show`, `pin`, `unpin`, `remove`) reuses the shared store/context helpers; `list` and `search` accept `--source all|claude-code`. A `/nanomneme:memory` slash command embeds it and relays output verbatim, or invoke the CLI with `!` for a fully model-free path.

#### Codex prototype

- **MCP-free package:** `@openlines/nmnm-codex` 0.2.2 bundles the exact core runtime and a constrained, shell-backed JSON runner for retain, recall, retrieve, and soft remove. New records carry `metadata.source: "codex"`; reads and no-op removal do not create a store.
- **Bounded trusted context:** one SessionStart hook reads existing project then global stores without writing them, injects a fixed bounded index, and emits no context on failure. The prototype intentionally has no pins, context settings, prompt cadence, automatic retention, adapter management CLI, or Windows support claim.
- **Lazy guidance:** one `memory` skill resolves the package-relative runner beside its `SKILL.md`; no MCP fallback is supplied.


## Architecture

`Nanomneme` keeps SQLite persistence and memory lifecycle logic in `nmnm-core`; the CLI, UI, and harness adapters are thin core clients that never write SQLite directly or parse CLI output. The detailed component, diagnostics, persistence, and SQLite data-model reference is in [Architecture](docs/ARCHITECTURE.md).

## Memory Operations Sequence

Every individual core call targets one physical store. The CLI, adapters, and UI can compose multi-store reads at their own boundaries; the UI sorts canonical snapshots without comparing FTS scores. Implemented paths are documented in [Memory operations](docs/SEQUENCE_MEMORY_HANDLING.md).

## Packages

| Component | Role |
|---|---|
| `packages/nmnm-core` | Publishable `@openlines/nmnm-core` Node.js ESM storage API. |
| `packages/nmnm-cli` | Publishable `@openlines/nmnm-cli` package providing the `nmnm` CLI. |
| `packages/nmnm-ui` | CLI-bundled experimental `@openlines/nmnm-ui` foreground browser workbench for review and cleanup. |
| `adapters/pi` | Publishable `@openlines/nmnm-pi` Pi package, including a model-free memory browser. |
| `adapters/claude` | Private Git-first Claude Code plugin: native MCP memory tools plus session-start index injection. |
| `adapters/codex` | Local-marketplace-only MCP-free Codex prototype with a bundled direct-core runner and bounded session-start index. |
| `adapters/opencode` | Publishable `@openlines/nmnm-opencode` OpenCode server plugin: native memory tools plus bounded transient index injection. |

Use Node.js 22.19+ with built-in `node:sqlite` and FTS5. The Pi adapter is published as `@openlines/nmnm-pi` and the OpenCode adapter as `@openlines/nmnm-opencode`; Claude Code is a separately installed Git-first plugin.

## Quick start

```sh
npm install --global @openlines/nmnm-cli
nmnm --version
nmnm retain "Use SQLite for storage" --kind decision --tags architecture,storage
nmnm retrieve "SQLite"
nmnm ui
```

The npm command installs the CLI with its exact core and UI dependencies; the workbench starts only through `nmnm ui`. Install core directly when writing a Node.js integration. Install Pi with:

```sh
pi install npm:@openlines/nmnm-pi
```

Claude Code remains a separately installed adapter.

Copied Claude marketplace plugins install from the adapter-local registry lockfile, currently core `0.3.0` under the compatible `^0.3.0` manifest range. Local workspace development uses checkout core `0.3.1`. See the [Claude installation and dependency refresh guide](adapters/claude/docs/CLAUDE_ADAPTER_MANUAL.md#install).

The Codex adapter is a local prototype, not an npm-published install. Create a packed local artifact with:

```sh
node scripts/check-logging-packages.js --prepare-codex
npm pack --workspace @openlines/nmnm-codex
```

The tarball is for isolated artifact validation; use the repo-local `.agents/plugins/marketplace.json` entry for live development, then review and trust its SessionStart hook in Codex. See the [Codex adapter manual](adapters/codex/docs/CODEX_ADAPTER_MANUAL.md).

The CLI defaults to `./.nanomneme/memory.db`. `--global` uses `~/.local/share/nanomneme/memory.db` on Linux and macOS. Standard `retain` routes derive the matching scope; custom `--db` retains require `--scope project|global`. Scope values are trimmed and validated before opening a database; standard selectors reject scope mismatches. `retrieve --both` composes project results before global results; `(store, id)` identifies a retrieval item.

### Local UI quick start

From a repository checkout with workspace dependencies installed:

```sh
node packages/nmnm-ui/bin/nmnm-ui.js
```

- The default browser opens automatically; `--no-auto` or `-na` disables opening. The full printed URL remains available for manual access; Ctrl-C stops the foreground server.
- Click Add store, browse to an existing database, then select stores and a recorded source harness.
- Enable editing explicitly for each store before cleanup.
- The picker starts in the launch directory. Browse another project's folders to select its store.
- CLI `0.4.0` includes core and UI; run `nmnm ui` after publication. These new CLI/UI versions are prepared for manual publication. See [launch and workflow details](packages/nmnm-ui/README.md).

## Documentation

| Document | Owns |
|---|---|
| [Logger manual](docs/LOGGER.md) | Logging file roles, bindings, both generated runtimes, build/distribution checks, and deferred shared-error API. |
| [Architecture](docs/ARCHITECTURE.md) | Component boundaries, shared diagnostics build/runtime path, SQLite persistence lifecycle, and ER model. |
| [Core and CLI Manual](docs/CORE_CLI_MANUAL.md) | Core API, CLI, data contract, agent use, portability, and recovery. |
| [Core README](packages/nmnm-core/README.md) | Core package installation and API discovery. |
| [CLI README](packages/nmnm-cli/README.md) | CLI package installation and command discovery. |
| [UI README](packages/nmnm-ui/README.md) | Foreground launcher, review/cleanup workflows, store/source selection, field controls, limitations, and future features. |
| [Pi quick start](adapters/pi/README.md) | Package-local Pi entry point. |
| [Pi Adapter Manual](adapters/pi/docs/PI_ADAPTER_MANUAL.md) | Pi installation, tools, pins, configuration, and automatic index behavior. |
| [Claude quick start](adapters/claude/README.md) | Package-local Claude Code plugin entry point. |
| [Claude Adapter Manual](adapters/claude/docs/CLAUDE_ADAPTER_MANUAL.md) | Claude Code plugin install, MCP tools, hooks, the `/nanomneme:memory` management command, pins, and configuration. |
| [Codex quick start](adapters/codex/README.md) | Package-local Codex prototype entry point. |
| [Codex Adapter Manual](adapters/codex/docs/CODEX_ADAPTER_MANUAL.md) | Codex local-prototype installation, trusted hook, shell-backed 4Rs, and token boundaries. |
| [OpenCode quick start](adapters/opencode/README.md) | Package-local OpenCode server plugin entry point. |
| [OpenCode Adapter Manual](adapters/opencode/docs/OPENCODE_ADAPTER_MANUAL.md) | OpenCode plugin install, native tools, transient injection, the `nmnm-opencode` CLI, the TUI memory browser, pins, configuration, and compatibility probes. |
| [Changelog](CHANGELOG.md) | Released changes. |

`nmnm --help` is authoritative for CLI flags. Runtime code and tests are authoritative when documentation disagrees with behavior.

## Development

- `npm run validate`: read-only generated-output check and full suite via `npm test`, shipped-dependency audit, then standalone package validation. Used by CI/release; stops at the first failure. Requires npm registry access and never repairs tracked artifacts or refreshes Codex.
- CI and tagged releases run the same separate blocking rendered UI job: Python 3.14, Playwright 1.62.0, headless Chromium, disposable stores, and a 15-minute timeout. Branch CI runs on pull requests and pushes to `main`; release checks run on the tagged checkout. Screenshots remain available as Actions artifacts for 7 days. Run `python3 packages/nmnm-ui/test/browser.py` locally; see [UI validation](packages/nmnm-ui/README.md#validation) for dependencies and coverage.
- Tagged releases require matching root versions, nonempty changelog notes, repository validation, and rendered UI success before publishing. Validated notes supply the GitHub Release body; publication order is core, UI, CLI, Pi, then OpenCode. Claude/Codex remain private.
- `npm run logslines:build`: check both logger bundles, regenerate stale outputs, recheck, and validate standalone packages. Reports `up-to-date` or `updated`, followed by `validated`; errors report `failed` and exit nonzero.
- `npm run logslines:build -- --fast`: skip standalone package validation explicitly for the edit loop.
- Logger build commands require Node 22.19+, npm, and installed repository dependencies. Package validation may need npm registry access; build commands do not fetch upstream Logslines or refresh Codex. See the [logger guide](docs/LOGGER.md).
- `npm run codex:update`: refresh an existing enabled Codex plugin against this checkout, prepare physical core/parser dependencies, and reinstall only stale cached content. Requires a matching local marketplace and installed plugin; respects `CODEX_HOME` and reports when a new session is required. No first-time setup or full-suite run. See the [Codex manual](adapters/codex/docs/CODEX_ADAPTER_MANUAL.md#refresh-after-checkout-updates).
- `node scripts/build-logger.js --check`: read-only check; exits `0` when current, `2` when stale/missing, or `1` on failure. `npm test` remains read-only.

```sh
# full node tests
npm test
# npm package dry run for validation
npm pack --dry-run --workspace @openlines/nmnm-core --workspace @openlines/nmnm-ui --workspace @openlines/nmnm-cli --workspace @openlines/nmnm-pi --workspace @openlines/nmnm-opencode
```

Logslines source is checked in under `external/logslines/`, selected by upstream Git tag rather than an npm dependency. Use `npm run logslines:update -- v0.1.0` with the intended exact release tag to validate and update the snapshot, provenance, and reviewed pin in `shared/fixtures/logslines-release.json`, refresh stale core/UI runtimes, run the full suite, and validate standalone packages. GitHub/npm network access may be required. Later failures retain updated files for review and report affected paths. `external:check` still verifies a selected upstream release; focused `external:update` only replaces snapshot/provenance and leaves the fixture, bundles, and validation to the maintainer. Offline pin checks run through `npm test`; CI, installation, and package runtime do not fetch Logslines. See the [logger guide](docs/LOGGER.md).

Run `npm test` before submitting changes. Do not commit `.nanomneme/`, personal global databases, or Pi settings and pin files containing local data. Use canonical JSONL for transfer and closed SQLite copies for exact backups. See the manuals for validation, recovery, and adapter-specific safety boundaries.

### Noted for future work

#### Pi adapter

- pi v0.99 prints tool arguments for tools without a custom call renderer, defaults undocumented tool annotations to non-read-only and possibly destructive, and enables the `codemode`, `tool_search`, and `mcp` built-in extensions.
