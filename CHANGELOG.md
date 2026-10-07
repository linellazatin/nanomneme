# Changelog

## 0.8.0 - Experimental workbench UI, logging organization, and dependency fixes

Experimental memory review UI, consistent Logslines bindings and build/package organization, automated maintenance and validation, core/adapter patch releases, and dependency audit fixes. Core memory functions and the public logging import remain compatible.

### Updated components

| Component | Version |
| --- | --- |
| Repository | 0.8.0 |
| `@openlines/nmnm-core` | 0.3.1 |
| `@openlines/nmnm-ui` | 0.1.0 (new), experimental, prepared for publication |
| `@openlines/nmnm-cli` | 0.4.0 |
| `@openlines/nmnm-pi` | 0.4.2 |
| `@openlines/nmnm-opencode`, `@openlines/nmnm-claude`, `@openlines/nmnm-codex` | 0.2.2 |

### New

- Experimental `nmnm-ui` foreground workbench with loopback HTTP, a per-launch credential, locally served assets, and Openlines light/dark styling. No daemon, framework, frontend build step, or additional runtime dependency.
- Header shows the installed UI version; website-matched sun/moon icons, fixed header/footer, and one Add store button for authenticated local database selection.
- Store trash icons unregister stores and close their workbench connections without deleting databases; re-added stores open read-only. The memory list scrolls independently after five preview rows, with existing 50-record pagination retained.
- Stores can collapse or expand with a keyboard-accessible title control; its added-store count remains visible in both states and updates on addition/removal.
- UI README includes five screenshots of initial launch, store selection, combined filters, editing, and lifecycle cleanup using disposable sample memories.
- Explicit project/global/custom stores and source-harness filtering; Active, Expired, and Removed views; literal content search, structured filters, and 50-record pagination with store-qualified identities.
- Read-only defaults and per-store editing authorization; changed-field edits, expiry changes, confirmed soft removal, restoration, and separately confirmed purge. Scope and provenance remain read-only.
- Unsaved-draft protection, serialized browser operations, stale-record checks, disposable-store tests, and a rendered Playwright suite. Removal/purge clears selection and resets the detail pane.
- CLI bundles core/UI as regular dependencies and loads UI dynamically through `nmnm ui`. `--port`/`-p` selects a port; `--no-auto`/`-na` suppresses default browser opening; `--help`/`-h` and `--version`/`-v` report UI help/version. Opener failures preserve the running server and printed URL. CLI/UI require Node 22.19+.
- `nmnm --version`/`-v` prints installed CLI, core, and UI versions without starting UI or opening storage.
- Opt-in UI Logslines diagnostics: edit/expiry/restore use the shared `retain` observer, remove/purge use `remove`, and general request/launcher/captured-browser errors emit `ui.error`. Successful reads/navigation, empty patches, and canceled actions stay quiet; mutation errors emit once.
- UI settings are reread per mutation/error attempt. Browser error reports are authenticated, bounded, and best effort; raw error messages remain unredacted.
- UI's build-only `src/ui-logger.js` sits beside `src/ui-logging-runtime.generated.js`; explicit runtime package contents exclude the build source. Installed-tarball checks cover UI emission and source exclusion. Release tooling publishes core, UI, then CLI.
- Registration/editing authorization verifies existing Nanomneme schema and SQLite integrity read-only. Unrelated SQLite files and incomplete lookalikes fail without creation or migration.
- Lists/details use full canonical exports; timestamp conflict checks are separate from mutation. Expired memories cannot be soft-removed. Creation, bulk operations, transfer, repair, adapter settings/pins, and shared general-error emission remain future features documented in UI's README.

### Refactored

- Claude copied marketplace installs now include a registry-only npm lockfile resolving published core `0.3.0` under `^0.3.0`, independently of checkout core `0.3.1`. Core publication does not refresh this lock automatically; a later reviewed lock update and plugin version increase are required.
- Added read-only `npm run validate` for generated-output checks/full tests, shipped-dependency audit, and standalone package validation. CI/release use the same command, retain the informational full audit, and preserve release tag checks and publication order. Validation never repairs tracked artifacts or refreshes plugins.
- Added `npm run codex:update` for existing enabled local installations: refresh stale bundles, prepare only physical core/parser dependencies, compare same-version content changes, conditionally reinstall, and verify the cache. Respects `CODEX_HOME` and reports reload requirements. Extracted preparation preserves unrelated dependencies and removes obsolete managed files; `--prepare-codex` remains compatible. Disabled plugins remain untouched.
- Added `npm run logslines:update -- <exact-tag>` to coordinate validated upstream snapshot/provenance and shared release-pin updates, logger generation, repository tests, and standalone package checks. The reviewed pin now lives in `shared/fixtures/logslines-release.json`; offline checks detect source/provenance/fixture drift and package checks exclude the fixture from distributions. Focused external commands remain available.
- Added `npm run logslines:build`: check both runtimes, regenerate only stale outputs, recheck, and validate standalone logging packages. `--fast` explicitly skips package validation; outcomes distinguish current, updated, validated, and failed. The import-safe generator builds both targets before writing, resolves a stable build root, and gives read-only checks distinct stale/failure exit codes.
- Core, adapter, CLI, and UI bindings consistently use `src/logslines.js`. Core preserves `@openlines/nmnm-core/logging` and `createMemoryLogger`; its generated runtime and memory implementation are unchanged.
- CLI binding construction is extracted from its executable and included in its package; command observation still includes output completion.
- One `scripts/build-logger.js` command builds/checks both logging targets. Shared implementation and generated suffixes are retained.
- Core `0.3.1` and adapter patch releases cover binding refactors, metadata, and documentation. All consumers pin core `0.3.1`; private Claude/Codex adapters retain local/plugin distribution.
- OpenCode declares its tested host dependency floor as `@opencode-ai/plugin >=1.18.15`; the lock retains 1.18.15 while fresh installs may resolve newer versions.
- Installed-tarball checks verify enabled success/failure logging across core, CLI, and every adapter. Documentation and the repository guide align file roles, build commands, diagnostics, packaging, and limitations.

### Fixed

- Agent-facing tool/management guidance identifies explicit CLI or UI workbench purge controls. Claude's memory skill distinguishes deterministic subprocess output from the model-mediated slash-command relay.
- Pi, Claude, and OpenCode render enabled autoretention guidance before memory indexes, preserving total budgets and omitting empty indexes.
- Claude disabled reinjection reads settings only and leaves session state untouched. Enabled hooks build memory context only on cadence, advance through context failures, and recover unusable prompt counters; settings failures remain silent without state changes.
- CLI and Pi/Claude/OpenCode retain paths trim and validate scope before store selection; invalid scopes no longer create stores, and padded values cannot bypass CLI route checks or misroute adapter writes.
- Pi metadata and retrieval score filters use explicit tool schemas instead of empty schemas, preserving JSON-object/null metadata and exact/range/null score filters. Regression tests cover provider conversion, routing, and trust checks.
- Store removal restores keyboard focus to Add store after the workbench leaves its pending/inert state.
- Updated MCP SDK from `1.30.0` to the patched `1.31.0` and raised Claude's dependency floor to `^1.31.0`, resolving audit advisory `GHSA-6qxp-vccf-f47h`. Claude uses the SDK's stdio server, outside the advisory's HTTP OAuth-client path; the shipped audit still enforces the patched dependency.
- Resolved `proxy-addr` to `2.0.8` and `brace-expansion` to `5.0.12`. Pi `1.0.4` no longer ships the blocking shrinkwrap; full and production-only audits report zero vulnerabilities.
- Corrected stale repository guidance about the Pi shrinkwrap blocker and logging build/artifact boundaries.
- Corrected Claude/OpenCode management help to describe unqualified pinning as unambiguous store resolution, and separated OpenCode's historical provider probes from current checkout validation.

### Validation

- Standalone validation now checks Claude manifest/lock consistency and registry-only exact resolutions, performs a frozen installation with an isolated cache and disabled lifecycle scripts, audits that tree, runs the full Claude adapter suite against locked core `0.3.0`, and exercises stdio MCP 4Rs and management CLI behavior. Native Claude automatic cache installation remains a separate check.
- CI and tagged releases run the same rendered desktop/mobile Chromium job with pinned Playwright, a 15-minute timeout, and screenshot artifacts retained for 7 days. Publishing requires both repository validation and rendered UI success on the tagged checkout. Release validation extracts required changelog notes before publishing and forwards them to GitHub Release creation.
- Refreshed the repo-local Pi host/TUI baseline to `1.0.4`; tested minimum host compatibility remains `>=0.87.0`.
- Full suite, installed-package checks, disposable-store adapter/CLI simulations, and desktop/mobile Chromium checks passed after the refactors. Native Pi RPC initialization and Claude MCP transport were exercised; OpenCode ran under Bun and Codex through its installed-cache runner. Provider calls, interactive harness TUIs, and native Claude/OpenCode/Codex hook registration remain unverified.

## 0.7.0 - Core and CLI hardening

### Updated components

| Component | Version |
| --- | --- |
| Repository | 0.7.0 |
| `@openlines/nmnm-core`, `@openlines/nmnm-cli` | 0.3.0 |
| `@openlines/nmnm-pi` | 0.4.1 |
| `@openlines/nmnm-opencode`, `@openlines/nmnm-claude`, `@openlines/nmnm-codex` | 0.2.1 |

### Fixed

- Punctuation-only search returns no matches with explicit relevance ordering; invalid selectors still reject.
- Claude/OpenCode unpin resolves targets from pin files, allowing cleanup of removed, expired, and missing memories without database access; unqualified pins in both stores remain ambiguous. OpenCode browser unpin also handles inactive targets.
- Claude/OpenCode pin mutations lock the complete read-modify-write and atomically replace private files. Competing writers fail with a retry message; crash-left locks require explicit recovery after all writers stop.
- Short temporary names preserve valid long database/export filenames. Text validation rejects unpaired Unicode surrogates before SQLite replacement; valid pairs remain intact.
- Export rejects source journal/WAL/shared-memory paths and existing aliases before opening storage or replacing output.
- Concurrent first-use writers atomically publish complete private stores without overwriting another creator; failed initialization publishes no partial store. Requires same-filesystem hardlinks.
- Import and verification reject null metadata; numeric ranges reject inherited operator names.
- New POSIX databases/directories request `0600`/`0700`; private exports preserve stricter owner permissions. Verification reports unsafe database/sidecar mode bits without changing permissions; excludes ACLs and Windows.
- Transactional target reads preserve unrelated concurrent patches and each patch's committed result. Rows, tags, and FTS commit atomically; reads use per-database snapshots. Lock timeout: five seconds, no automatic retries.
- Search supports Unicode, Boolean expressions, phrases, prefixes, bounded groups, and FTS5 NEAR. Malformed syntax falls back to literals, retaining operator words; punctuation-only queries return no matches. Storage errors remain unmasked.
- Patches/restores/soft removals preserve creation time and strictly advance per-record update time under frozen/backward clocks. Imports preserve timestamps; expiry/purge use wall-clock time. Timestamp exhaustion fails atomically.
- Writes enable SQLite `secure_delete` and transactional FTS5 `secure-delete`. Purge atomically removes rows, tags, and live FTS, including expired/removed records. Protection covers subsequent deletion remnants, not historical data, WAL/journals, reader snapshots, backups/exports, or device copies; no automatic cleanup or forensic-erasure guarantee.

### Changed

- CLI/adapters pin core `0.3.0`; Claude/Codex manifests match package versions. Adapter APIs and engine floors are unchanged.
- Pi against core/CLI hardening: added tool-boundary coverage for Unicode search/validation, unsupported numeric-range operators, private first-use storage, and monotonic patch/restore timestamps. No tool-handler runtime change was needed.
- OpenCode against core/CLI hardening: added Node-bridge coverage for Unicode search/validation, invalid metadata and numeric-range operators, private project/global first-use storage, and handler coverage for monotonic patch/restore timestamps. No tool-handler runtime change was needed.
- Claude against core/CLI hardening: added tool-handler coverage for Unicode search/validation, malformed text, invalid metadata and numeric-range operators, null-metadata patch normalization, private project/global first-use storage, and monotonic patch/restore timestamps, plus management-CLI coverage for Unicode/structured search and malformed-query errors. No tool-handler runtime change was needed.
- Aligned manuals/READMEs with runtime contracts, adapter behavior, and manual import validation/guarantees. Diagnostic errors remain unredacted; review logs before sharing.
- Documented FTS5 requirements: official macOS arm64 Node.js 22.13.0 lacks FTS5; 22.19.0 is tested. Prepare Codex's physical core bundle before marketplace reinstall/reload.

## 0.6.0 - Shared Logslines diagnostics

### Updated components

| Component | Version |
| --- | --- |
| `@openlines/nmnm-core` | 0.2.0 |
| `@openlines/nmnm-cli` | 0.2.0 |
| `@openlines/nmnm-pi` | 0.4.0 |
| `@openlines/nmnm-opencode` | 0.2.0 |
| `@openlines/nmnm-claude` | 0.2.0 |
| `@openlines/nmnm-codex` | 0.2.0 |

### New

- `@openlines/nmnm-core` added the `nmnm-core/logging` export, one shared catalog/observer/runtime, and JSONC configuration.
  - Logging defaults off; `~/.local/share/nanomneme/config.jsonc` sets the default and user-level adapter `nmnm.jsonc` overrides it.
  - Project settings cannot enable it; invalid applicable logging configuration disables that caller.
  - Preserved the closed `logslines/v1` envelope, empty attributes, closed error schema, per-component private JSONL files, and original operation results/errors. No database, pin, or historical log migration is needed.
  - Context hooks, internal reads, navigation, and canceled actions remain unlogged.
- `@openlines/nmnm-cli`, `@openlines/nmnm-claude`, `@openlines/nmnm-opencode`, and `@openlines/nmnm-codex` added explicit operation diagnostics.
  - Added CLI coverage for maintenance and transfer completion.
  - `@openlines/nmnm-opencode` bridge spawn failures emit one host-side `failed` record from the Bun plugin (the bridge provably never ran), carrying the spawn error verbatim; ambiguous post-spawn transport/parse failures remain outside coverage to avoid contradicting a bridge-logged outcome.
  - Added Codex session correlation using `CODEX_THREAD_ID`, falling back to `CODEX_SESSION_ID` or null for `session_id`; model request fields cannot select the session ID.
    - Added `--prepare-codex` to the package checker for local marketplace installs. It copies verified physical core/parser dependencies into the adapter before Codex caches it. Root workspace links alone do not provide dependencies to the cached plugin.
    - Added host-correlation regression coverage for thread/session precedence, fallback, blank or invalid values, host lookup failures, and ignored request-supplied session fields.
- Added offline conformance checks against the pinned Logslines schema and isolated tarball checks for shipped imports and Codex's bundled parser. No runtime Logslines fetches or telemetry.

### Changed

- Refreshed the Pi development host to `@earendil-works/pi-coding-agent` **v1.0.0** in the lockfile
  - Published compatibility range stays `>=0.87.0` and `MIN_PI_TUI` now floors at v1.0.0.
  - Re-assessed the v0.99.2 and v1.0.0 changelogs and host types: all Pi adapter tests pass on the v1.0.0 host; Pi 1.0.0 still pins dev-only `brace-expansion` 5.0.9 in its shrinkwrap.
- Migrated `@openlines/nmnm-pi` to the shared logger and retired its private runtime.
- Extracted Bun-safe `@openlines/nmnm-opencode` path helpers into `src/paths.js` so the Bun plugin host can load the sqlite-free `@openlines/nmnm-core/logging` subpath; the bridge client records spawn failures for logged operations (4R tools with host session correlation, `browser_*` mutations).
- Failed diagnostics now record the thrown error: `error.message` carries the underlying error message verbatim (previously the fixed catalog string), with derived `error.kind` (`validation`/`filesystem`/`timeout`, else `unknown`) and optional `cause_kind` (error class name).
- Extended Pi host-registry test coverage to execute a loaded tool definition, lifecycle injection, and the real Logslines sink.

### Fixed

- Fixed `@openlines/nmnm-claude` management CLI reporting "ID is ambiguous" for a missing memory ID targeted without a store; it now reports not found (logged as `not_found`), while an ID present in both stores still reports ambiguity and logs `blocked`.
- Claude adapter MCP server now reports the package version instead of a stale hardcoded `0.1.0`.
- Documented Claude session correlation as a host limitation: Claude Code exposes `session_id` only to hook stdin, not to MCP servers or the management CLI, so Claude diagnostic records keep `context.session_id` null; regression coverage pins this.
- Hardened Pi pin mutation serialization with same-directory locks and atomic replacement.
  - Locks are never reclaimed automatically, preventing stale-lock recovery from deleting a newly acquired lock and losing an update.
  - Crash-left locks require explicit operator removal after all writers stop; failed ownership and temporary-file cleanup still release the lock. A completed pin update that cannot finish cleanup reports a safe manual-recovery error and records a failed diagnostic carrying that error's message.
- Fixed CLI executable detection through npm symlinks and documented checkout linking; root workspace installation alone does not replace an older global CLI.

## 0.5.1 - Pi v0.99 host baseline refresh

### Changed
- Refreshed Pi development host to `@earendil-works/pi-coding-agent` **v0.99.1** in the lockfile. The compatibility range stays `>=0.87.0` (no v0.99-only API); `MIN_PI_TUI` now floors at v0.99.1 so the lockfile cannot fall back silently.
- `@openlines/nmnm-pi` **v0.3.1**: documentation and test baseline only, no runtime or memory-contract change.

### Verification
- Re-assessed against the Pi v0.99.0 and v0.99.1 changelogs and the installed host types: **NO BREAKING CHANGE** reaches `nmnm-pi`. All 97 Pi adapter tests pass on the v0.99.1 host, including the real extension-loader path and a `pi --mode rpc` load.

### Security
- Fixed both reachable `npm audit` findings in the lockfile: `fast-uri` 3.1.7 → 3.1.8 (GHSA-hrr3-gc8f-f4qj) and `ip-address` 10.7.0 → 10.7.2 (GHSA-j6r3-76f7-8jcv, GHSA-h3mg-xc3c-68pw). Each arrives only through the Claude adapter's `@modelcontextprotocol/sdk` tree (`ajv`, `express-rate-limit`); no published npm package ships either module, and Claude plugin users pick the patched copies up from the root lockfile.
- Residual high finding `brace-expansion` 5.0.9 (GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p; patched in 5.0.12) is dev-only and not fixable from this repo: Pi's published `npm-shrinkwrap.json` pins it inside `@earendil-works/pi-coding-agent`, so neither `npm update` nor a root `overrides` entry can move it. It appears in no published tarball. It clears when Pi bumps the pin.
- CI and release gates now block on the shipped tree (`npm audit --audit-level=high --omit=dev`) and report the full tree as an informational step, so the upstream dev-host pin stays visible without holding a release.

## 0.5.0 - Pi Logslines diagnostics

### Added

- `@openlines/nmnm-pi` 0.3.0 adds opt-in `logslines/v1` diagnostics for the model-facing retain, recall, retrieve, and remove tools. The shared logger and Logslines runtime are bundled into Pi; enable logging in global Pi settings. Each terminal 4R outcome carries the Pi host session ID when supplied, operation timing where meaningful, a stable event, and a normalized outcome.
  - Added dedicated Pi logger and tool-boundary regression coverage for successful, empty, not-found, blocked, and failed outcomes.
  - Added a complete Pi Logslines reference: the closed 12-field record shape, fixed service identity, session correlation, duration rules, event catalog, normalized failure shape, privacy boundary, append-only global Nanomneme JSON Lines file, and current scope.
  - Logging is contained so an emitter, sink, validation, serialization, or session-ID lookup failure does not alter model-tool memory behavior.
  - Pi session and tools share a lazy logger; `/reload` re-reads global logging settings without adding session records.
  - Browser Pin, Unpin, and confirmed soft Remove now emit one sanitized outcome (`ok`, `not_found`, or `failed`) per attempted action; navigation and canceled removal emit none. Browser messages name the memory action; the event identifies its origin.
  - Explicit `/memory` pin, unpin, and soft remove emit separate sanitized outcomes. Ambiguous removal is `blocked`, absent pins on unpin are `not_found`, and read-only commands emit none.
  - Logslines now ships as a checked-in `external/logslines/` source snapshot selected by upstream Git tag `v0.1.0`, replacing the sibling `file:` npm build dependency. Maintainers explicitly validate or refresh the snapshot; CI and Pi installation do not fetch it, and the generated Pi runtime includes its MIT attribution.
  - Hardened `logslines` diagnostics storage with an owner-only `logs/` directory and owner-only JSONL files, tightening existing logs on first use. 
    - Added SHA-256 provenance for the checked-in logslines source; maintainer checks compare the snapshot with the selected upstream release, and offline pinned-hash checks run in CI.

## 0.4.0 - Codex adapter prototype

### New
- Added `@openlines/nmnm-codex` 0.1.0, an MCP-free macOS/Linux Codex plugin prototype with a direct `nmnm-core` JSON runner for retain, recall, retrieve, and soft remove.
- Added bounded project-first/global-second SessionStart context, with a trusted read-only hook that fails without injecting context.
- Added `.agents/plugins/marketplace.json` for Codex local deployment; npm publication is deferred for now.

### Changed
- Raised the Pi development baseline to `>=0.87.0` and refreshed the lockfile to Pi 0.87.1.
- Updated nmnm-claude package name to match @openlines tagging.


## 0.3.4 - Literal search-term hardening

- `@openlines/nmnm-core` 0.1.1: `retrieve` search terms are normalized so ordinary text — hyphenated
  names, `key:value` pairs, URLs, `node.js`, `v1.2.3`, `C++`, `C#`, `50%`, and other punctuation — is
  matched literally instead of raising `invalid FTS5 query` or being misread as FTS5 column filters.
  `AND`/`OR`/`NOT`/`NEAR` still work in infix position, quoted phrases and balanced parentheses are
  preserved, a trailing `*` acts as a prefix, and dangling operators, stray quotes, or punctuation-only
  queries degrade to literal text or an empty result rather than erroring.
- `@openlines/nmnm-cli` `retrieve` joins unquoted words into a single query, so `nmnm retrieve node js`
  is read as `node js`.
- `@openlines/nmnm-cli` 0.1.1, `@openlines/nmnm-opencode` 0.1.1, and `@openlines/nmnm-pi` 0.2.1 all repin
  `@openlines/nmnm-core` to 0.1.1, carrying the fix through their
  model-visible `retrieve_memory` tools.
- `@openlines/nmnm-opencode` text clutter clean-up in memory browser status view

## 0.3.3 - Pi adapter trust and host hardening

- Release bumped adapter and dependency version `@openlines/nmnm-pi 0.2.0` for `Pi 0.87.0` and `Node.js 22.19+`.
- **Limit automatic context to global memory in untrusted projects** without reading project settings,
- Load the adapter through Pi's real extension loader in an isolated regression test.
  pins, or SQLite data; reject model-facing project operations while keeping global tools and explicit
  user `/memory` project commands available.
- Bound model-visible Pi tool JSON to `50 KiB`; oversized successful results return valid summaries
  without truncating canonical stored memories.
- Honor configured `tui.select.*` browser keybindings while retaining `h/j/k/l` navigation aliases.
- Keep structured prompt-section migration deferred pending a separate behavior and cache probe.

## 0.3.2 - Pi adapter agent release 0.87.0 compatibility hardening

- Re-verified `@openlines/nmnm-pi` (0.1.9) against Pi 0.87.0; the 0.87 lifecycle, session, context,
  and `shouldStopAfterTurn` changes did not intersect the adapter surface.
- Aligned the Pi adapter dev/test baseline to `@earendil-works/pi-tui` 0.87.0 and added a host-surface
  smoke test that floors the loader-provided `pi-tui`/`typebox` surface at 0.87.0.

## 0.3.1 - Pi adapter browser UX updates

- `Status` separates effective `autoretention` from last-injection metadata.
- Omit IDs from Pi browser list rows; selected-record details retain the canonical ID.

## 0.3.0 - OpenCode adapter

- Add `@openlines/nmnm-opencode` (`0.1.0`) with the four memory tools, adapter-owned pins, and
  the model-free `nmnm-opencode` CLI. New records carry `metadata.source: "opencode"`; reads do
  not create stores and removal is soft-only.
- Support Bun-hosted plugins through a short-lived Node bridge; inject the bounded memory index
  per request via `experimental.chat.system.transform`, failing safe on errors.
- Add the optional model-free TUI browser (`tui.js`, `tui.jsonc`, **ctrl+alt+m**) with
  Status/All/Project/Global tabs, source filtering, pin/unpin, confirmed soft removal, and
  project/global browsing. Detail rows show Tags, Namespace, Kind, Importance, and Updated;
  Back stays in-browser and restores the prior list selection.
- Document and test the adapter, bridge, CLI, tools, TUI, and OpenCode 1.18.31 provider smoke.

## 0.2.3 - Pi adapter memory browser enhancements

- Replaced interactive Pi adapter memory browser with custom TUI menu: `Status`, `All`, `Project`, and `Global` tabs switch with left/right arrows.
- Publish the Pi adapter as `@openlines/nmnm-pi`.
- Keep project memory indexing and default listing available on Windows, where global storage is unsupported.
- Keep native and TUI memory browsers open after an invalid FTS search, reporting the validation error instead.

## 0.2.2 - Source filtering

- Add core `retrieve({ source })` filtering.
- Add Pi `all`/`pi` source controls to browse and list.
- Add Claude Code `--source all|claude-code` to list and search.
- Align standard retain routes for matching project/global store; require explicit scope for CLI custom-database retains.
- Prepare public `@openlines/nmnm-core` and `@openlines/nmnm-cli` releases with audited,
  provenance-enabled GitHub Actions publishing, versioned GitHub Release notes.

## 0.2.1 - Harness provenance

### Added

- New Pi and Claude Code retains record their originating harness in `metadata.source`
  (`"pi"` or `"claude-code"`), and both bounded indexes display recorded source labels.

### Changed

- ID-based adapter patches preserve an existing source; records created before provenance
  tracking remain unlabeled.

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
