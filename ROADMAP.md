# Roadmap

nanomneme remains an embedded, deterministic memory primitive: inspectable SQLite
records, lexical retrieval, and thin interfaces. Features are optional additions only
when they preserve that model.

## Package versions

- `nanomneme`: 0.2.1
- `nmnm-core`: 0.0.5 (only bump version if modified/updated)
- `nmnm-cli`: 0.0.5 (only bump version if modified/updated)
- `nmnm-pi`: 0.1.4 (pi coding agent adapter; only bump version if modified/updated; started 0.1.0)
- `nmnm-claude`: 0.1.1 (claude code adapter; only bump version if modified/updated; started 0.1.0)
- `nmnm-opencode*`: 0.1.0 (opencode adapter; only bump version if modified/updated; started 0.1.0)
- `nmnm-codex*`: 0.1.0 (Git-first Codex plugin; only bump version if modified/updated; started 0.1.0)

> `* upcoming feature developments`

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

## v0.0.5

- Strict canonical import validation before destination creation.
- Atomic file export with source-alias protection and failure cleanup.
- Read-only core opening for CLI verification and export.
- Documented transfer, restore, merge, and exact-backup workflows.

## Possible next steps

- [x] Release hardening for v0.0.4.
  - [x] Phase 1: prevent export destinations from overwriting the source database,
    including symlink and hardlink aliases.
  - [x] Phase 2: enforce canonical timestamps, kebab-case slugs, and JSON metadata.
  - [x] Phase 3: reject unsupported command options and validate commands before opening
    or creating databases.
  - [x] Phase 4: correct npm package metadata and published file contents.
  - [x] Phase 5: run the final release audit and verification checkpoint.
- [x] User manual for developers and agents.
  - [x] Phase 0: define audiences, common tasks, and document structure.
  - [x] Phase 1: document installation, the core API, CLI commands, schema, and
    developer examples.
  - [x] Phase 2: document deterministic agent commands, JSON output, store selection,
    and error handling.
  - [x] Phase 3: document backup, import/export, verification, repair, and recovery.
  - [x] Phase 4: validate examples and link the manual from the root README and package
    documentation.
- [x] Final v0.0.5 sweep fixes.
  - [x] Phase 1: make verification exact and safe for schema and timestamp-order drift.
  - [x] Phase 2: project canonical fields explicitly from public reads and exports.
  - [x] Phase 3: correct JSON-output and FTS-index documentation.
  - [x] Phase 4: support `--` before positional content or queries.
  - [x] Phase 5: run the final release audit and shipping checkpoint.
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
- [x] Portability: safer canonical import/export and richer workflows when ordinary
  SQLite copies and canonical JSONL no longer suffice.
  - [x] Phase 0: validate complete import input before opening or creating the destination.
  - [x] Phase 1: define and enforce strict canonical record fields, timestamp ordering,
    and unknown-field handling.
  - [x] Phase 2: write export files atomically without weakening source-alias protection.
  - [x] Phase 3: add explicit read-only core opening for `verify`, `export`, and future
    migrations.
  - [x] Phase 4: document the existing backup, restore, transfer, and merge workflows;
    defer new commands until online backup or an explicit conflict policy is required.
  - [x] Phase 5: complete user documentation, changelog, roadmap, and release verification.

## v0.1.0

- [x] Connectivity: Git-first Pi adapter. Keep `nmnm-core` and `nmnm-cli` behavior
  unchanged; Pi is a thin interface over the core. OpenCode remains deferred until its
  own compatibility probe and plan.
  - [x] Phase 0: confirm Pi local-path and Git-package installation, establish the
    Git-first release route, and record that current OpenCode supports local and npm
    plugins but is not in this release.
  - [x] Phase 1: add `adapters/pi` with the minimal Pi manifest and extension entrypoint;
    import `nmnm-core` directly rather than shelling out to the CLI; prove local loading
    and Git-package layout with a Pi smoke check.
  - [x] Phase 2: add native `retain_memory`, `recall_memory`, `retrieve_memory`, and
    `remove_memory` tools that preserve core validation and project/global selection;
    test them against isolated SQLite stores.
  - [x] Phase 3: add Pi-only global and project configuration, adapter-owned pins,
    bounded compact memory-index injection on the first prompt, recent-memory fallback,
    and `/memory refresh`, `pin`, `unpin`, and `status`. Exclude Markdown storage,
    consolidation, compaction handoffs, and a browser.
  - [x] Phase 4: add `docs/PI_ADAPTER_MANUAL.md` and an adapter quick-start README;
    rework the root README as a concise project reference and documentation index rather
    than a duplicate manual; update changelog and roadmap; validate documentation and
    clean local/Git installation.
  - [x] Phase 5: run the v0.1.0 release checkpoint: full tests, Pi smoke tests,
    package/layout and documentation checks, dependency audit, and diff checks. npm
    publication remains deferred until Pi and OpenCode adapters are ready.
  - [x] Follow-up: split adapter settings from pins. JSONC `nmnm.jsonc` lives in the
    project `.nanomneme` directory or Pi agent directory; JSON `nmnm-pi.json` lives in
    the project `.nanomneme` directory or nanomneme global data directory. Maintain the
    complete current JSONC template in the Pi user manual. Do not automatically migrate
    the unreleased combined configuration layout.
  - [x] Follow-up: add direct, model-free user controls for bounded project/global memory
    listing and soft removal. Default listing is project-first then global with combined
    pagination, store labels, pin markers, and compact previews; unqualified removal
    resolves one match or refuses ambiguity. Retain core store boundaries and do not expose
    irreversible purge through the slash command.
  - [x] Follow-up: validate `/memory pin` against its selected store before writing. The
    unscoped project default rejects global-only IDs with an explicit global command hint;
    unpin may still remove unresolved references.
  - [x] Follow-up: make user-facing command and flag references table-first, and rename
    the core and CLI guide to `CORE_CLI_MANUAL.md`.
  - [x] Follow-up: replace timing-dependent recency test setup with explicit timestamps.
  - [x] Follow-up: keep missing stores absent for Pi native recall, retrieve, and remove.
  - [ ] Deferred: decide whether a Pi pin may override an expired memory's core lifecycle.
    Current pins are durable adapter references until explicit unpin; unreadable targets
    are skipped and reported as unresolved.

## v0.1.1

- [x] Pi adapter memory lifecycle follow-up. Keep `nmnm-core` deterministic and SQLite-backed;
  configuration, transient injection, post-compaction reinjection, and model guidance stay
  adapter-only.
  - [x] Phase 0-A: research Pi session context, compaction, persistence, and extension hooks;
    use the findings to avoid duplicating Pi session retention or relying on unsupported events.
  - [x] Phase 0-B: define the JSONC contract and regression matrix: `injection_budget` remains
    bounded, while optional `autoretention` contains explicit opt-in `enabled` plus
    `always_persist`, `never_persist`, and `always_ask` string arrays. Combine global and project
    rules; `never_persist` wins conflicts. Automatic retention is inactive unless enabled;
    injection must be transient context, never a persistent session-message snapshot.
  - [x] Phase 1: change first-prompt index injection to a transient system-prompt addition.
    Preserve the existing bounded read-only behavior and do not add recurring injection cadence or
    an `inject_every_n_prompts` setting. Phase 2 adds enabled autoretention rule guidance.
  - [x] Phase 2: add opt-in rules-guided automatic retention. Render user-authored rules for the
    active model; it remains the only decision maker and calls canonical `retain_memory` itself.
    Do not add a nested extraction model, background worker, or direct SQLite write path.
  - [x] Phase 3: after every successful Pi compaction or memory-index mutation (`retain`,
    `remove`, `pin`, or `unpin`), re-inject the current bounded memory index and rules on the next
    prompt. Use Pi's retained compaction summary for session continuity; do not add a separate
    handoff, automatic consolidation, auto-resume, or canonical memory for transient session state.
  - [x] Phase 4: update the Pi manual, README, changelog, and complete JSONC template; run adapter
    tests, full tests, and Pi smoke checks before declaring the 0.1.1 feature update complete.
  - [x] Phase 5: validate settings and pins read-only at session start, retry a failed next-prompt
    injection after configuration repair, and apply one character budget to complete autoretention
    guidance plus the memory index without partially emitting a rule.

## v0.1.2

- [x] Pi adapter reinjection hardening. Keep `nmnm-core` deterministic and SQLite-backed; lifecycle
  observability and optional cadence stay adapter-only.
  - [x] Phase 6: expose in-memory transient-context lifecycle metadata through `/memory status`:
    pending state, periodic policy, prompt count, last successful injection aggregate, and latest
    error. Do not write session telemetry, configuration, or SQLite data.
  - [x] Phase 7: add disabled-by-default JSONC periodic reinjection. When explicitly enabled,
    rebuild current bounded context every five eligible prompts in addition to existing first-prompt
    and dirty triggers; do not add timers, workers, handoffs, consolidation, auto-resume, or direct
    automatic writes.
  - [x] Phase 8: update root/private adapter metadata to 0.1.2; document the periodic policy and
    status output in README and manuals; replace planned changelog notes with user-facing release
    entries; then repeat adapter, full-suite, package, Pi smoke, and diff checks.

## v0.1.3

- [x] Pi adapter safety and memory-management UX. Keep all behavior in `nmnm-pi`; do not change
  `nmnm-core` or `nmnm-cli`.
  - [x] Phase 0: remove irreversible purge from the model-facing `remove_memory` schema and make
    the tool soft-only. Keep CLI purge as the deliberate operator path and preserve missing-store,
    mutation-refresh, and durable-pin behavior.
  - [x] Phase 1: add a model-free native-dialog browser opened by `/memory` or `/memory browse`.
    Show the shared status card before opening and keep record details inside their action dialog so
    it persists on return, while keeping search and store selection above project/global/both pages; support FTS text search, full record details,
    pin/unpin, and confirmed soft removal. Reuse Pi dialog primitives and existing adapter store operations;
    do not add a custom TUI subsystem or dependency.
  - [x] Phase 2: update adapter tests and documentation, recalculate model-tool schema overhead,
    show the exact current full-payload character count in an aligned `/memory status` card, run
    the full suite, and perform a real Pi extension smoke check.

### Ranked Pi adapter backlog after v0.1.3

1. [ ] Add model-facing project-plus-global retrieval with explicit `(store, id)` provenance,
   composed in the adapter without comparing BM25 scores across databases.
2. [ ] Improve adapter capture guidance: retain durable facts, ask before sensitive project detail,
   never retain secrets or routine logs, verify volatile remembered facts before acting, and prefer
   patching an existing memory over creating a duplicate. Keep policy guidance distinct from
   enforceable privacy controls.
3. [ ] Consider an explicit, user-invoked consolidation workflow only after duplicate-memory usage
   demonstrates a need. Candidate records must be shown before replacement, and superseded records
   remain soft-removed rather than purged. Do not add background or automatic consolidation.

### Compaction continuity decision

A separate Pi handoff or auto-resume remains rejected. Pi 0.85.1 compaction already persists a
structured checkpoint containing goals, constraints, progress, decisions, next steps, critical
context, and retained recent messages; repeated compactions incorporate the previous summary.
`nmnm-pi` should continue rebuilding its bounded durable-memory context after `session_compact`
rather than creating a competing session summary. Reconsider only for a harness without equivalent
native continuity or measured evidence that Pi's checkpoint loses required state.

## v0.2.0

- [x] Connectivity: Git-first Claude Code adapter (`nmnm-claude`). Keep `nmnm-core` and
  `nmnm-cli` unchanged; the adapter is a thin core client. Transport is a local stdio MCP
  server (the sanctioned "optional MCP/stdio transport") rather than the Pi native-tool API,
  which Claude Code cannot reproduce without MCP.
  - [x] Phase 1: `adapters/claude` plugin scaffold with `.claude-plugin/plugin.json`,
    `.mcp.json`, and shared `src/store.js` + `src/context.js` ported from Pi (project/global
    routing, bounded index, pins, settings). Import `nmnm-core` directly; no CLI parsing.
  - [x] Phase 2: native `retain_memory`, `recall_memory`, `retrieve_memory`, and
    `remove_memory` MCP tools over a stdio server that imports the core; `remove_memory` is
    soft-only. Tests drive the tools through a real MCP client against isolated stores.
  - [x] Phase 3: `SessionStart` command hook injects the bounded project/global index and
    optional autoretention guidance as transient `additionalContext`; disabled-by-default
    `UserPromptSubmit` reinjection on a configurable cadence with ephemeral prompt-count
    state. Command hooks (not `mcp_tool` hooks) so injection works during the launch window.
  - [x] Phase 4: adapter-owned `nmnm-claude.json` pins (project and global) and shared
    project `nmnm.jsonc` settings; global settings under `${CLAUDE_PLUGIN_DATA}`. A
    model-facing `memory-guide` skill (`/nanomneme:memory-guide`) teaches the 4Rs,
    project/global scope, and autoretention.
  - [x] Phase 5: `docs/CLAUDE_ADAPTER_MANUAL.md`, adapter README, root README/changelog
    updates, full test suite, and a real MCP-client + hook smoke check.
  - [x] Phase 6: a deterministic, model-free memory management surface. A `bin/memory.js`
    CLI (`status`, `list`, `search`, `show`, `pin`, `unpin`, `remove`) reuses the shared
    store/context helpers; a `/nanomneme:memory` slash command embeds it via bash execution
    and relays the output verbatim, and `!`-invoking the CLI is a fully model-free path.
    Claude Code slash commands are prompt templates, not native dialogs, so Pi's interactive
    browser (arrow-key navigation, in-dialog actions) still does not port; this delivers the
    equivalent text list/status/management output instead. The guidance skill is renamed
    `memory-guide` (`/nanomneme:memory-guide`) so the command owns `/nanomneme:memory`
    outright; a plugin skill and command that share a name collide on one slash invocation.

## v0.2.1

- [x] New Pi and Claude Code retains write their harness provenance to `metadata.source`; bounded indexes show recorded source labels, while ID-based patches preserve the existing source.

## Not on the required path

- Nested LLM calls, embeddings, vector databases, and automatic consolidation.
- Background workers, mandatory network services, server mode, sync, or multi-user
  hosting.
- A separate Pi compaction handoff, auto-resume layer, or canonical memory for transient session
  state.

Every proposed capability must keep the core local, open, configurable, and usable
without inference or extra infrastructure.
