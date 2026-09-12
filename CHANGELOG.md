# Changelog

## 0.2.0 - Claude Code adapter

### Added

- Add `nmnm-claude`, a Claude Code plugin: native `retain_memory`, `recall_memory`,
  `retrieve_memory`, and `remove_memory` tools over a local stdio MCP server importing
  `nmnm-core` directly. `remove_memory` is soft-only.
- Inject the bounded project/global index and optional autoretention guidance as transient
  `SessionStart` context; add disabled-by-default `UserPromptSubmit` reinjection.
- Reuse existing store/context semantics: project-first index, adapter-owned `nmnm-claude.json`
  pins, shared project `nmnm.jsonc` settings, global settings under `${CLAUDE_PLUGIN_DATA}`.
- Ship a `memory-guide` skill (`/nanomneme:memory-guide`) teaching the 4Rs and scope.
- Add a deterministic, model-free `/nanomneme:memory` command (and `bin/memory.js` CLI):
  `status`, `list`, `search`, `show`, `pin`, `unpin`, `remove`. Reads never create a store.

## 0.1.3 - Pi adapter memory browser + stricter soft-only removal

### Added

- Add a model-free native-dialog `/memory` browser with project/global/both paging, FTS text search, full record details, pin/unpin, and confirmed soft removal. Both browser entry points show the shared status card before opening; record details remain inside their action dialog so the card persists on return. Search and store selection remain above every record page for immediate access.

### Changed

- Make the model-facing Pi `remove_memory` tool soft-only; `purge` is now CLI-only.
- Show the exact current next-injection payload character count in `/memory status`, including enabled autoretention guidance, in an aligned shared status card.

## 0.1.2 - Pi adapter observability + reinjection enhancement

### Added

- Add `/memory status` lifecycle metadata for context: pending state, the current periodic policy, prompt count, aggregate details for the last injection, and the latest error; remains read-only and never exposes injected memory content.

- Add disabled-by-default periodic reinjection for long Pi sessions. 
  - Project/global JSONC settings select a positive prompt interval, defaulting to five when enabled
  - cadence reuses the bounded context and creates no automatic writes, workers, timers, or handoffs

## 0.1.1 - Pi adapter autoretention introduction

### Added

- Add opt-in `autoretention` rules in project and global JSONC settings. Enabled guidance uses the
  active model and `retain_memory`; global and project rules combine, while `never_persist` takes
  precedence.
- Validate settings and pins read-only at Pi session start. Configuration failures do not block Pi
  startup, and corrected files retry automatically on the next prompt.
- Rebuild and transiently inject the current index after successful Pi compaction or successful
  model/slash memory mutations; read and no-op removal paths do not trigger reinjection.

### Changed

- Inject bounded Nanomneme context through Pi's system prompt rather than a persistent custom
  session message. `/memory refresh` continues to request one next-prompt injection.
- Apply `injection_budget` to all transient Nanomneme context. Complete autoretention rules take
  priority over index rows and are never partially injected.

## 0.1.0 - Thin harness adapter for Pi coding agent (pi.dev)

### Added

- Add the Git-first `adapters/pi` package and root manifest; core and CLI behavior remain
  unchanged.
- Add Pi-native retain, recall, retrieve, and remove tools over `nmnm-core`, with
  project/global selection and canonical JSON results.
- Add project/global JSONC settings `nmnm.jsonc` and JSON pins `nmnm-pi.json`, bounded first-prompt index injection,
  recent-memory fallback, and `/memory` refresh, pin, unpin, and status controls. Reads
  never create stores.
  - Make `/memory list` project-first across both stores with store labels; require an explicit store when unqualified `/memory remove <id>` matches both.
  - Mark exact store pins with `*` in `/memory list` and truncate previews to 60 characters.
  - Validate the selected store before `/memory pin` writes; direct global-only IDs to the
  explicit global command.
  - Keep missing Pi stores absent for native recall, retrieve, and remove operations.
  - Keep slash removal soft-only; matching pins remain durable and become unresolved until explicitly unpinned.
- Add model-free paginated listing and reversible soft removal.

### Changed

- Stabilize recency-order regression coverage with explicit timestamps instead of timing.
- Rename the pin diagnostic from `stale` to `unresolved`.
- Pin the matching `nmnm-core` dependency and declare the TypeBox peer dependency; avoid
  the unsupported `workspace:` protocol.

### Documentation

- Add the Pi adapter manual and package quick start; make the root README the v0.1.0
  project index linked to the main and Pi manuals.
- Document Pi first-load behavior, settings/pin/SQLite file ownership, and the complete
  v0.1.0 JSONC template.
- Rename the core and CLI guide to `CORE_CLI_MANUAL.md`; use compact command, flag, and
  behavior tables in both user-facing manuals.

## 0.0.5 - 2026-09-06

### Changed

- Validate complete JSONL import input before opening or creating the destination database.
- Reject import records with unknown fields, non-canonical values, or `updated_at`
  earlier than `created_at`.
- Write file exports through a same-directory temporary file and atomic replacement,
  cleaning up the temporary file on failure.
- Add core `open(path, { readOnly: true })`; CLI `verify` and `export` now prevent
  database writes and migrations while `repair` remains writable.
- List maintenance command options completely in CLI help.
- Make verification detect unexpected columns and invalid timestamp ordering, and report
  unusable table shapes without throwing.
- Project canonical memory fields explicitly so schema additions cannot leak into public
  reads or produce JSONL that nanomneme cannot import.
- Accept `--` as the CLI end-of-options marker for positional content and queries that
  begin with `--`.

### Documentation

- Establish the developer-and-agent user manual structure, audience boundaries, and
  documentation ownership.
- Add installation, complete CLI reference, core lifecycle/API, schema ownership, and
  developer error-handling guidance to the user manual.
- Document deterministic agent commands, machine-readable output contracts,
  store-qualified identity, and exit/error handling.
- Add task-based export, import, exact-backup, verification, repair, and recovery
  procedures to the user manual.
- Complete the user manual with troubleshooting, validated examples, and links from both
  package READMEs.
- Clarify that `export` emits JSONL rather than accepting `--json`, and that FTS repair
  indexes non-removed expired records as well as ordinary active records.
- Complete the final v0.0.5 sweep with full tests, package installation smoke checks,
  dependency audit, documentation validation, and publication dry-runs.
- Define the supported transfer, empty-store restore, conflict-safe merge, and exact
  SQLite backup workflows; defer new backup and overwrite modes until proven necessary.
- Complete the portability documentation and v0.0.5 release verification.

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
