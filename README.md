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
[![nmnm-opencode version](https://img.shields.io/npm/v/%40openlines%2Fnmnm-opencode?label=opencode&logo=opencode&color=ffffff)](https://www.npmjs.com/package/@openlines/nmnm-opencode)
[![nmnm-claude version](https://img.shields.io/badge/claude-v0.3.0-orange?logo=claudecode)](https://github.com/linellazatin/nanomneme/tree/main/adapters/claude)
[![nmnm-codex version](https://img.shields.io/badge/codex-v0.4.0-black?logo=gnometerminal)](https://github.com/linellazatin/nanomneme/tree/main/adapters/codex)

<img src="docs/img/nanomneme-logo-dark-accent.svg" width="25%" alt="nmnm logo">

</div>

See [CHANGELOG](CHANGELOG.md) for release history, feature introductions, and breaking changes.
>
> ### v0.11.0: Project work summaries and startup briefs
> - opt into compaction autosummaries: `nmnm-claude` & `nmnm-opencode` save structured checkpoints; `nmnm-pi` saves bounded native text using pi's existing compaction call; `nmnm-codex` autosummaries are still 'to be discussed' due to post compaction metadata lacking summary text output (since I opted-out of using transcript ingestion)
> - `nmnm-pi` capture opt-in authorizes unattended saving, including headless sessions, independently of ordinary autoretention rules and without further approval prompts
> - save structured/native summaries through the CLI; correct or soft-remove sources by ID and preview historical context with `nmnm brief`
> - independently enable project-only briefs across all four adapters within existing context budgets; Codex supports briefs but not automatic capture
> - **no transcript ingestion, separate model or extra inference call**; see the [summary contract and JSON examples](docs/CORE_CLI_MANUAL.md#project-work-summaries-and-briefs)
> ### v0.10.0: Core SQLite operations enhancements
> - skip unchanged tag/FTS writes and batch tag loading for retrieval and export
> - accelerate recent, namespace and source retrieval with a backward-compatible optional index; preserve exact totals, ordering, and existing adapter behavior
> - see [measured improvements and limits](docs/CORE_CLI_MANUAL.md#enhancement-quantification-and-evidence); no new ranking or retrieval policy
> ### v0.9.2 - Adapter fixes and shared CI
> - bounded `nmnm-opencode` browser-read retries; mutations never retry
> - fixed `nmnm-pi` browser pagination at the core offset limit
> - shared validation and host compatibility gates for CI and releases
>

>
> ### Note to users that still use 'older' coding agents ver: 
> - pi < v1.x.x
> - opencode < v2.x.x
>
> I will be bumping devDependency and compatibility floors to pi's 1.x.x and opencode's 2.x.x (including CI host validations for each). This will be initiated on the next 'minor' patch release of the project repo.
>
> This is for the purpose of tool improvement, by implementing adapter-specific enhancements introduced by *newer* harness releases.
>
> **Thank you for your support, as always. Let's keep our philosophies intact.**
>

nanomneme is a small, deterministic SQLite core for coding-agent memory: useful context survives a session without becoming an opaque service. Inspired by [`openpi-memory`](https://github.com/linellazatin/openpi-memory) and [`openclaude-memory`](https://github.com/linellazatin/openclaude-memory), and their demonstration that memory can persist in inspectable files, it replaces (or complements*) per-harness memory formats with one shared system for `Pi`, `Claude Code*`, `OpenCode`, `Codex*`, and future adapters.

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

### Project summaries and startup briefs

Inspired by Codex-style continuity, this feature started with manual project checkpoints and deterministic briefs. Autosummaries add eligible output from existing compaction calls. Manual capture uses the separately installed CLI; **neither path requires transcript ingestion, a separate model or extra inference**.

A **summary** is a durable UUID-backed record: `kind: note`, `scope: project`, `namespace: project-summary`, readable content and validated `metadata.summary`. Structured `nanomneme/project-summary` payloads contain title/`as_of`, objective, state/outcome/verification, decisions, questions, next steps, historical authorization and optional references. Native `nanomneme/native-compaction-summary` payloads preserve title/`as_of`/text. Both have an 8192-byte normalized UTF-8 limit, source attribution and optional retry-deduplication receipts.

A **brief** is a read-only historical view of eligible project summaries, with no stored record or model call. Adapters preserve ordinary context and use spare budget for full brief content or UUID pointers. It supplies neither global memory nor current authorization or verification.

>
> Manual CLI input and adapter captures share core validation, SQLite persistence and brief rendering. `nmnm-pi` imports core directly; `nmnm-opencode` uses its Node bridge; `nmnm-claude` uses generated core. Adapters deliver briefs through existing context hooks. Updates preserve identity/provenance and format; removal changes later briefs, leaving already-injected context intact.
>
> Adapters expose ordinary memory tools, with no dedicated summary create/update tools. Explicit summary creation/correction uses the separately installed CLI or a custom integration with core’s public summary APIs. Supported automatic capture and brief delivery (of adapters) call core without the CLI.
>

| Component | Manual summary workflow | Compaction autosummary | Brief capability |
| --- | --- | --- | --- |
| Core | Validate/store/update/remove through public APIs | Persistence and replay protection; no generation | Read-only deterministic renderer |
| CLI | `summary add/update --file`; `summary remove <id>` | Inspect/manage adapter captures; no background capture | `nmnm brief` preview |
| Pi | Shared CLI in the project | Native completed text; opt-in authorizes unattended saving, including headless use | Startup and existing refresh/cadence delivery |
| Claude Code | Shared CLI in the project | Structured checkpoint through PreCompact/PostCompact; model applies retention guidance | Existing context-hook delivery |
| OpenCode V1/V2 | Shared CLI in the project | Structured checkpoint through native compaction hooks/live completion; Node bridge saves | Primary-request context delivery |
| Codex | Shared CLI in the project | **Deferred:** hooks expose lifecycle metadata without completed summary text | Existing context-hook delivery, including other adapters’ captures |
| Workbench UI | Inspect ordinary summary notes (namespace: project-summary); canonical corrections use CLI | No capture/generation | No dedicated brief renderer |

Capture (`summary.autocapture.enabled`) and delivery (`brief.enabled`) default off independently. Pi opt-in authorizes unattended capture regardless of ordinary autoretention guidance. Claude/OpenCode models must omit disallowed checkpoints; validation cannot certify compliance. Codex capture is deferred, with no transcript or later model/tool-turn fallback.

See the [summary contract, JSON examples and lifecycle](docs/CORE_CLI_MANUAL.md#project-work-summaries-and-briefs), [automatic capture contract](docs/CORE_CLI_MANUAL.md#automatic-capture-contract) and [architecture](docs/ARCHITECTURE.md#project-work-summary-boundary).

### Local Workbench UI

- **On-demand workbench:** experimental `@openlines/nmnm-ui`; node foreground launcher, loopback browser access, no persistent daemon, and local Openlines light/dark assets.
- **Explicit review:** collapsible Stores with an added-store count, a local database picker, and trash controls that preserve files; recorded source filters, Active/Expired/Removed views, literal search, and five visible preview rows within 50-record pages.
- **Deliberate cleanup:** read-only by default; enable editing per store for changed-field updates, expiry changes, soft removal, restoration, and separately confirmed permanent purge. Scope and provenance are read-only.
- **Current limits:** full-store snapshots, a non-atomic stale-edit check, no soft removal of expired records, and session-only registrations. Creation, transfer, repair, bulk operations, and adapter settings are future features. See the [UI README](packages/nmnm-ui/README.md).

### Diagnostics

Diagnostics default off. CLI, UI mutations, and adapters use the shared Logslines observer; UI general errors use a separate emitter. Enable shared `logging.enabled` or an applicable user-level adapter override. Raw error messages are not redacted. See the [Logger manual](docs/LOGGER.md).

### Adapters

#### Pi coding agent

- **Native memory tools:** model-invoked retain, recall, retrieve, and remove operations over `nmnm-core`; retain schemas explain canonical inputs and create-versus-patch routing so ordinary creation needs only content and one successful call. Project operations require Pi project trust, while global operations remain available in untrusted projects. Model-visible JSON is bounded to 50 KiB, with explicit summaries for oversized results.
- **Project and global memory:** explicit store selection with canonical records and no custom database-path parsing.
- **Bounded automatic context:** transient autoretention guidance and the first-prompt memory index share one configurable character budget; pinned entries come first, with recent active fallback, store and recorded-source labels, unresolved-pin reporting, and refresh after successful compaction or memory mutations.
- **Opt-in autoretention:** project/global JSONC rules guide the active model's `retain_memory` calls without a nested model, worker, or direct adapter write.
- **Opt-in compaction autosummary:** automatically save eligible completed native compaction text into trusted project memory when opted in, independently of ordinary autoretention rules and without further UI approval, using the existing model call. Independently enable project briefs for bounded historical context at startup and refresh.
- **Adapter-owned configuration:** optional JSONC settings and separate JSON pin files, with project and global locations.
- **Direct user controls:** `/memory refresh`, `status`, `list`, `remove`, `pin`, and `unpin` without model involvement; `status` reports injection state, autoretention, the effective index budget, current full-payload character count, and lifecycle metadata without exposing memory content.
- **Native memory browser:** `/memory` and `/memory browse` open a Pi TUI menu with `Status`, `All`, `Project`, and `Global` tabs. Record details use a native action dialog; returning preserves selection. Standard selection keys honor configured `tui.select.*` bindings; arrows and `h/j/k/l` support navigation. Non-TUI UI modes use native dialogs.
- **Readable list UX:** project-first combined listing, pagination, `[project]` and `[global]` labels, exact-store `*` pin markers, and 60-character previews. Store-tab selection scrolls with navigation and resizing and remains valid after concurrent removals; native dialogs number rows to distinguish identical previews. Browser rows omit IDs, which remain in details.
- **Safety boundaries:** terminal-safe display without rewriting stored text, validated pin targets, ambiguity-safe removal, soft-only slash removal, non-creating native reads, and durable unresolved pins.

#### OpenCode

- **Shared and adapter-owned config:** project `nmnm.jsonc` settings shared with Pi and Claude, adapter-owned `nmnm-opencode.json` pins, and global settings under `${XDG_CONFIG_HOME:-~/.config}/opencode`.
- **Model-free management CLI:** `nmnm-opencode` (`status`, `list`, `search`, `show`, `pin`, `unpin`, `remove`) with project-first combined pagination and `--source all|opencode`; purge is available through `nmnm remove --purge` or the UI workbench, outside adapter management.
- **Model-free terminal browser:** **ctrl+alt+m** opens Status/All/Project/Global, filtering, pagination, pin/unpin, and confirmed soft removal. V1 registers via `tui.jsonc` and uses its local bridge; V2 loads `./tui` automatically or through global `cli.json`, routing operations over authenticated OpenCode RPC to server-owned stores. Reads briefly retry typed location-readiness failures; mutations never retry, and changed locations reject stale selections. See the [adapter guide](adapters/opencode/README.md) for setup and verification limits.
- **Opt-in compaction autosummary:** native V1/V2 compaction hooks request and save eligible structured checkpoints through the Node bridge using the existing model call. Independently enabled project briefs deliver saved history in primary-request context.
- **Native V1/V2 memory tools:** V2 support, introduced in adapter `0.3.0`, exposes retain, recall, retrieve, and soft remove through the server's short-lived Node bridge. Native evidence covers V1 1.19.0 and V2 2.3.0; among these tools, only retain creates missing stores and new records carry `"opencode"` source provenance. Eligible opt-in compaction capture can also create the project store.
- **Bounded transient injection:** V1 uses its experimental system transform; V2 rebuilds context for each primary request using the session's location. Guidance precedes pins and recent memories. V2 omits the ordinary index from auxiliary generation and compaction requests; opt-in capture adds separate checkpoint instructions to the existing compaction call. The next primary request receives a fresh index.

#### Claude Code

- **Native MCP memory tools:** model-invoked retain, recall, retrieve, and remove over a local stdio MCP server using bundled core; no daemon, network, or CLI parsing. `retain_memory` records Claude Code source provenance on new entries; `remove_memory` is soft-only.
- **Bounded session-start context:** a `SessionStart` command hook injects the project/global index and optional autoretention guidance as transient context; disabled-by-default `UserPromptSubmit` reinjection uses a configurable cadence.
- **Shared and adapter-owned config:** project `nmnm.jsonc` settings shared with Pi, adapter-owned `nmnm-claude.json` pins, and global settings under `${CLAUDE_PLUGIN_DATA}` (fallback `~/.claude`). Memory databases remain in the standard Nanomneme locations.
- **Model guidance:** a `memory-guide` Skill (`/nanomneme:memory-guide`) teaches the 4Rs, project-versus-global scope, and safe capture.
- **Model-free management command:** `bin/memory.js` (`status`, `list`, `search`, `show`, `pin`, `unpin`, `remove`) reuses the shared store/context helpers; `list` and `search` accept `--source all|claude-code`. A `/nanomneme:memory` slash command embeds it and relays output verbatim, or invoke the CLI with `!` for a fully model-free path.
- **Opt-in compaction autosummary:** PreCompact requests a structured checkpoint in the existing model call; PostCompact validates and saves eligible output. Independently enabled project briefs deliver saved history through context hooks.

#### Codex adapter

- **Native stdio MCP:** `@openlines/nmnm-codex` bundles checkout core and the locked production MCP runtime for retain, recall, retrieve and soft remove. Creation sets Codex provenance; patches preserve it, and absent-store reads/removal do not create databases.
- **Direct registration:** a stable absolute MCP launcher binds to Codex's actual session directory without manual project-path exports. Bounded previews and lossless record paging keep model responses small.
- **Native configuration:** user context hooks provide startup indexes, optional prompt reinjection and complete autoretention guidance from `nmnm.jsonc`. All persistence remains MCP; there is no autonomous writer, shell runner, pin management or adapter CLI. Removal follows host approval policy. Windows support is not claimed.
- **Opt-in project briefs:** deliver saved project summaries, including compaction autosummaries from other adapters, through existing context hooks. Codex compaction autosummary capture remains unavailable.


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
| `adapters/codex` | Direct stdio MCP adapter with session workspace binding, native context configuration and bundled production runtimes. |
| `adapters/opencode` | Publishable `@openlines/nmnm-opencode` OpenCode server plugin: native memory tools plus bounded transient index injection. |

Use Node.js 22.19+ with built-in `node:sqlite` and FTS5. The Pi adapter is published as `@openlines/nmnm-pi` and the OpenCode adapter as `@openlines/nmnm-opencode`; Claude Code is a separately installed Git-first plugin.

## Quick start

Explicit [project work summaries and brief preview](docs/CORE_CLI_MANUAL.md#project-work-summaries-and-briefs) are available through core/CLI without a separate model or transcript access. Adapter brief delivery is opt-in through existing `brief.enabled` context settings.

```sh
npm install --global @openlines/nmnm-cli
nmnm --version
nmnm retain "Use SQLite for storage" --kind decision --tags architecture,storage
nmnm retrieve "SQLite"
nmnm ui
```

The npm command installs core and UI as regular CLI dependencies; the workbench starts only through `nmnm ui`. Install core directly when writing a Node.js integration. Install Pi with:

```sh
pi install npm:@openlines/nmnm-pi
```

Claude Code remains a separately installed adapter.

The Claude adapter ships generated core and logging runtimes. Its registry-only lock covers external dependencies, so PR checks and copied plugin installs no longer depend on publishing core first. See the [Claude installation and dependency refresh guide](adapters/claude/docs/CLAUDE_ADAPTER_MANUAL.md#install).

The private Codex adapter uses direct MCP registration from a stable checkout or prepared local artifact. Create an artifact with:

```sh
npm ci
npm run validate
npm run codex:prepare
npm pack --workspace @openlines/nmnm-codex
```

Register the absolute `mcp/launch.js` path with no configured cwd. Add and trust the user-level context hooks for full native configuration behavior, then restart Codex. See the [Codex adapter manual](adapters/codex/docs/CODEX_ADAPTER_MANUAL.md#install) for installation, configuration and migration from the retired marketplace delivery.

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
- Published `nmnm-cli` includes `nmnm-core` and `nmnm-ui`, including the browser fixes. See [launch and workflow details](packages/nmnm-ui/README.md).

## Updating existing installations

For any core efficiency changes, update each installation you use and restart its host. No manual database migration, export/import, FTS rebuild, settings change, or pin reset is required. Registry installations receive published releases; pulling a checkout alone does not refresh dependencies or separately installed copies.

- **Pi:** update the installed adapter package, then restart Pi.
- **OpenCode:** update the installed plugin, then restart the server and terminal. Keep separately registered server/TUI entries aligned; updating a checkout does not replace a cached registry plugin.
- **Claude Code:** refresh the marketplace, update the installed plugin itself, then restart Claude Code. Refreshing only the marketplace does not replace the plugin. See the [Claude update guidance](adapters/claude/docs/CLAUDE_ADAPTER_MANUAL.md#install).
- **CLI/core/UI:** update any separately installed copies or application dependencies and their lockfiles. Updating an adapter does not replace an unrelated global CLI. Updating the CLI brings its core and UI dependencies; restart any running workbench.
- **Codex:** for an existing direct checkout installation, update the checkout and run these separate commands from its root, then restart Codex:

```sh
npm ci
npm run validate
npm run codex:update
```

Codex preparation refreshes physical dependencies without changing registrations or hook trust; keep the checkout at its registered path. If using a prepared artifact, replace the complete prepared artifact at its stable installation path, not just its source files. Former marketplace installations require the separate [migration procedure](adapters/codex/docs/CODEX_ADAPTER_MANUAL.md#migration-rollback-and-uninstall); see also [refresh instructions](adapters/codex/docs/CODEX_ADAPTER_MANUAL.md#refresh-after-checkout-updates).

Existing memories remain intact. The optional performance index installs or upgrades automatically on the next writable open of each store, which can take extra time and disk space on a large database. Only the recognized legacy index is retired; memories are not rewritten. Read-only access remains compatible without it, but index-specific speedups begin only after installation. There is no need to create a dummy memory or run repair to activate the update. See [core upgrade behavior](docs/CORE_CLI_MANUAL.md#optional-index-upgrades) for writable-open side effects and verification guidance.

## Documentation

| Document | Owns |
|---|---|
| [Logger manual](docs/LOGGER.md) | Logging file roles, bindings, generated runtimes, build/distribution checks, and deferred shared-error API. |
| [Architecture](docs/ARCHITECTURE.md) | Component boundaries, shared diagnostics build/runtime path, SQLite persistence lifecycle, and ER model. |
| [Core and CLI Manual](docs/CORE_CLI_MANUAL.md) | Core API, CLI, data contract, agent use, portability, and recovery. |
| [Core README](packages/nmnm-core/README.md) | Core package installation and API discovery. |
| [CLI README](packages/nmnm-cli/README.md) | CLI package installation and command discovery. |
| [UI README](packages/nmnm-ui/README.md) | Foreground launcher, review/cleanup workflows, store/source selection, field controls, limitations, and future features. |
| [Pi quick start](adapters/pi/README.md) | Package-local Pi entry point. |
| [Pi Adapter Manual](adapters/pi/docs/PI_ADAPTER_MANUAL.md) | Pi installation, tools, pins, configuration, and automatic index behavior. |
| [Claude quick start](adapters/claude/README.md) | Package-local Claude Code plugin entry point. |
| [Claude Adapter Manual](adapters/claude/docs/CLAUDE_ADAPTER_MANUAL.md) | Claude Code plugin install, MCP tools, hooks, the `/nanomneme:memory` management command, pins, and configuration. |
| [Codex quick start](adapters/codex/README.md) | Codex MCP adapter entry point. |
| [Codex Adapter Manual](adapters/codex/docs/CODEX_ADAPTER_MANUAL.md) | Local installation, workspace binding, MCP 4Rs and output boundaries. |
| [OpenCode quick start](adapters/opencode/README.md) | Package-local OpenCode server plugin entry point. |
| [OpenCode Adapter Manual](adapters/opencode/docs/OPENCODE_ADAPTER_MANUAL.md) | OpenCode plugin install, native tools, transient injection, the `nmnm-opencode` CLI, the TUI memory browser, pins, configuration, and compatibility probes. |
| [Changelog](CHANGELOG.md) | Release history and pending changes. |

`nmnm --help` is authoritative for CLI flags. Runtime code and tests are authoritative when documentation disagrees with behavior.

## Development

- `npm run validate`: read-only generated-output check and full suite via `npm test`, shipped-dependency audit, then standalone package validation. Used by CI/release; stops at the first failure. Requires npm registry access and never repairs tracked artifacts or refreshes Codex.
- `.github/workflows/validate.yml` owns all automated gates: repository validation, Pi/OpenCode compatibility, and rendered UI. It runs on PRs/main and is called by `release.yml` on the tagged commit. Release-only tag/changelog checks supply the release notes; publishing waits for every shared job. Repository required-check rules may need updating when workflow/check names change.
- Root-only OpenCode overrides select patched Zod and Effect TOML dependencies pending upstream fixes; exact selections live in the root manifest and lockfile. They protect checkout/CI installs, not independently installed adapters; remove them after a compatible upstream release resolves both advisories and passes validation. Recheck shipped and full dependency audits against the registry rather than relying on historical results.
- CI and tagged releases run the same separate blocking rendered UI job: Python 3.14, matching pinned Playwright image/package, headless Chromium/Firefox/WebKit, disposable stores, and a 15-minute timeout. Branch CI runs on pull requests and pushes to `main`; release checks run on the tagged checkout. Screenshots remain available as Actions artifacts for 7 days. Run `python3 packages/nmnm-ui/test/browser.py` locally; see [UI validation](packages/nmnm-ui/README.md#validation) for dependencies and coverage.
- CI and tagged releases also require the separate OpenCode native/terminal matrix, including connected-server routing and V2 live TUI reload. Hosts install outside checkout dependencies; no model credentials are needed. See the [OpenCode manual](adapters/opencode/docs/OPENCODE_ADAPTER_MANUAL.md#dual-host-compatibility) for reproduction and coverage limits.
- Tagged releases require matching root versions, nonempty changelog notes, repository validation, rendered UI, and Pi/OpenCode compatibility success before publishing. Validated notes supply the GitHub Release body; publication order is core, UI, CLI, Pi, then OpenCode. Claude/Codex remain private.
- `npm run logslines:build`: check all four generated runtimes, regenerate stale outputs, recheck, and validate standalone packages. Reports `up-to-date` or `updated`, followed by `validated`; errors report `failed` and exit nonzero.
- `npm run logslines:build -- --fast`: skip standalone package validation explicitly for the edit loop.
- Logger build commands require Node 22.19+, npm, and installed repository dependencies. Package validation may need npm registry access; build commands do not fetch upstream Logslines or refresh Codex. See the [logger guide](docs/LOGGER.md).
- `npm run codex:prepare`: refresh stale generated runtimes and copy the complete locked production runtime tree before direct registration or packing. Requires repository dependencies; never calls Codex or runs validation. See the [Codex quick start](adapters/codex/README.md#quick-start).
- `npm run codex:update`: refresh generated runtimes and prepare physical locked dependencies, then report restart requirements. It never invokes Codex or changes registrations/hook trust. See the [Codex manual](adapters/codex/docs/CODEX_ADAPTER_MANUAL.md#refresh-after-checkout-updates).
- `node scripts/build-logger.js --check`: read-only check; exits `0` when current, `2` when stale/missing, or `1` on failure. `npm test` remains read-only.

```sh
# full node tests
npm test
# npm package dry run for validation
npm pack --dry-run --workspace @openlines/nmnm-core --workspace @openlines/nmnm-ui --workspace @openlines/nmnm-cli --workspace @openlines/nmnm-pi --workspace @openlines/nmnm-opencode
```

Logslines source is checked in under `external/logslines/`, selected by upstream Git tag rather than an npm dependency. Use `npm run logslines:update -- <reviewed-release-tag>` with the intended exact release tag to validate and update the snapshot, provenance, and reviewed pin in `shared/fixtures/logslines-release.json`, refresh stale core/UI/Claude runtimes, run the full suite, and validate standalone packages. GitHub/npm network access may be required. Later failures retain updated files for review and report affected paths. `external:check` still verifies a selected upstream release; focused `external:update` only replaces snapshot/provenance and leaves the fixture, bundles, and validation to the maintainer. Offline pin checks run through `npm test`; CI, installation, and package runtime do not fetch Logslines. See the [logger guide](docs/LOGGER.md).

Run `npm test` before submitting changes. Do not commit `.nanomneme/`, personal global databases, or Pi settings and pin files containing local data. Use canonical JSONL for transfer and closed SQLite copies for exact backups. See the manuals for validation, recovery, and adapter-specific safety boundaries.

### Noted for future work

#### Codex adapter

- Patch `scope` mutates the record (`adapters/codex/src/operations.js` patch validation; core treats `scope` as a mutable column, not a selector).
- see the adapter's [Developer notes](adapters/codex/docs/CODEX_ADAPTER_MANUAL.md#developer-notes) for specifics.

#### Pi adapter

- Evaluate explicit tool annotations and custom call rendering for memory tools; host defaults and enabled built-ins are not adapter guarantees. See the [Pi manual](adapters/pi/docs/PI_ADAPTER_MANUAL.md#boundaries) for compatibility and validation limits.
