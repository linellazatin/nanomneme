# nanomneme Repository Guide

## What this is

nanomneme (`nmnm`) is a small, deterministic SQLite memory core for coding agents. The repository contains core, CLI and local review UI packages; Pi, OpenCode, Claude and Codex adapters; shared utilities; tests; documentation; and external-source tooling. CLI depends on core and UI; UI starts only when requested.

- Use Node.js 22.19.0+ with built-in `node:sqlite` and FTS5 for repository development. The root floor is stricter than some packages.
- Run repository commands from the root unless stated otherwise.
- Use a checkout path without spaces for full validation: existing Claude/maintenance subprocess tests still pass encoded URL paths to Node. Codex's direct MCP and hook entrypoints support spaced installation paths.

## Documentation version policy

- Keep active READMEs, manuals, skills and guidance version-neutral; omit current component versions, dependency ranges, publication snapshots and installation pins.
- Preserve existing Shields.io badges, including version/release badges; do not replace them with plain links.
- Keep versions in manifests, locks and changelog. Use package/version commands for installed details and unversioned installation examples.
- Retain runtime/host requirements, version-qualified test evidence, canonical changelog history and historical research. Use prose version labels only for feature introductions or significant/breaking changes.
- For rollback, select a verified compatible release rather than prescribing a stale pin.

## Commands

- **Before shipping:** run `npm run validate`: `npm test`, shipped audit, then standalone packages; failure stops the sequence. It requires registry access but never regenerates tracked artifacts, fetches upstream, prepares checkout dependencies or refreshes harnesses. CI/release block on it.
- **Development:** run focused tests first, then `npm test` for cross-package changes. It checks all four generated runtimes read-only and runs Node tests across scripts, shared logger, packages, adapters and top-level tests.
- **Generate runtimes:** run `npm run logslines:build` to check, regenerate stale outputs, recheck and validate packages. It reports `up-to-date`/`updated`, then `validated`. `-- --fast` explicitly skips package validation. Build/read failures prevent generation; errors exit nonzero.
- **Installed packages:** run `node scripts/check-logging-packages.js` for packed imports/logging and UI build-source exclusion. Dependencies may need registry access; personal harnesses/caches remain untouched.
- **Rendered UI:** run `python3 packages/nmnm-ui/test/browser.py` and `python3 packages/nmnm-ui/test/browser_regressions.py` for browser/UI logging changes. `bash scripts/run-ui-browser-checks.sh` runs both in Chromium/Firefox/WebKit, continuing after failures and failing if any check fails.
- **Workbench:** run `node packages/nmnm-cli/bin/nmnm.js ui --no-auto` or installed `nmnm ui`. `--port`/`-p` selects a port; `--no-auto`/`-na` suppresses browser opening; Ctrl-C stops it. Select existing stores and enable editing explicitly.
- **Upstream check:** run `npm run external:check -- <reviewed-release-tag>` with the tag in `shared/fixtures/logslines-release.json`. It fetches tagged sources and compares bytes/hashes; `npm test`/CI check the offline fixture without upstream access.
- **Logslines update:** run `npm run logslines:update -- <reviewed-release-tag>` for an explicitly selected tag. It updates snapshot/provenance/fixture, refreshes bundles and runs full tests/package validation. Failures retain changes and identify paths. Focused `external:update` updates only snapshot/provenance; the fixture never ships.
- **Codex preparation:** run `npm ci`, `npm run validate`, then `npm run codex:prepare` separately before direct registration/packing. It refreshes stale runtimes and copies the complete physical locked production tree, without invoking Codex, registering servers/hooks or running validation.
- **Codex update:** after checkout updates, run `npm ci`, `npm run validate`, then `npm run codex:update`. It prepares same-version content changes and reports `restart-required`; no marketplace, cache reinstall, registration/trust change or live reload occurs. `npm run validate codex:update` is invalid.

Standalone Claude checks use its frozen independent lock with lifecycle scripts disabled: external-only audit, runtime hashes, full bundled-core contract, adapter suite, MCP 4Rs and management CLI. Registry core is rejected, avoiding a core-publication prerequisite. Codex checks pack the locked closure, independently install/copy it and exercise MCP, context hooks, JSONC merging, cadence and cleanup. The verifier client never ships. Neither establishes native registration/provider behavior.

- Refresh Claude external dependencies in a temporary standalone copy of its manifest/lock outside the monorepo; review the lock, synchronize root metadata and validate. Keep plugin package/manifest versions aligned.

Pi's development host accepts stable `~1.5.0`, with dependency floor `>=0.87.0`. Main CI/release use the lockfile; a separate blocking matrix tests `0.87.0`, `~0.87.0`, `~0.99.0`, `~1.2.0` and `~1.5.0`. Schema checks cover equivalent provider constraints and the actual host validator, not only TypeBox checks.

- Reproduce Pi matrix runs only in a disposable checkout after `npm ci`: `node scripts/check-pi-compatibility.js '~0.87.0'` or another selector. It changes `node_modules`, not manifests/locks, and excludes only the development-host version assertion.
- Pi's adapter suite includes captured regular/fullscreen renderer checks in `adapters/pi/test/browser.test.js`. Test control-sequence safety, unique native-dialog targets, and selection visibility during navigation/resizing, and valid pagination focus after concurrent store removals against disposable stores. Keep captured-renderer evidence distinct from live-terminal and live-provider acceptance.

UI checks require Python Playwright, installed engines and root dev dependencies including axe-core. Default Chromium switches via `NMNM_UI_BROWSER=firefox`/`webkit`. Stores and screenshots/axe reports are temporary; tools are not UI runtime dependencies. Checks run separately from `npm run validate` and do not certify accessibility.

- Preserve the matching pinned CI/release Playwright image/package (`mcr.microsoft.com/playwright/python:v1.62.0-noble`), Node 22, Python 3.14, no runtime APT, 15-minute job limit, bounded setup and six-minute suite step. Chromium uses `install --only-shell chromium`; Firefox/WebKit have no reduced-shell equivalent. Retain engine-qualified evidence for seven days.
- Follow [Workbench web standards](packages/nmnm-ui/docs/WEB_STANDARDS.md) for the WCAG 2.2 AA maintenance target, coverage, WebKit keyboard assumptions and required manual checks.

## Architecture

- `packages/` contains `nmnm-core`, `nmnm-cli` and `nmnm-ui`. Core owns SQLite access; CLI, UI and adapters call public core APIs.
- `adapters/` contains Pi, OpenCode, Claude and Codex integrations.
- `shared/` contains shared implementation/tests and the reviewed Logslines fixture.
- `scripts/` contains generation, validation, Codex preparation and external-source maintenance tooling.
- `test/` contains top-level tests; `docs/` and `research/` contain documentation/research; `external/` contains managed upstream sources.

Component `src/logslines.js` bindings supply identity/configuration to `@openlines/nmnm-core/logging`; Claude imports its local generated runtime instead. Core persistence does not log automatically. Shared implementation lives in `shared/logger/` and ships as core's generated runtime; UI mutations reuse it. UI general errors use a separate runtime built from `packages/nmnm-ui/src/ui-logger.js`, excluded from the UI package. Claude's generated core/logging runtimes live in `adapters/claude/src/` with version/license stamps. See [Logger manual](docs/LOGGER.md) for the file-role map.

## Testing and operational quirks

### Generated runtimes and diagnostics

- Check core logging, UI logging, Claude core and Claude logging with `node scripts/build-logger.js --check`: exit `0` means current, `2` stale/missing and `1` failure.
- If stale, inspect inputs, run `npm run logslines:build` and review artifacts. Do not hand-edit generated files. Core source/version, shared production logger, upstream snapshot/provenance, generator and UI error-emitter changes can require regeneration; ordinary bindings/tests/docs do not by themselves.
- Keep personal databases, logs, credentials and settings untracked. Checked-in generated runtimes are intentional package artifacts.

UI and Claude logging bundle JSONC; core keeps it external. Diagnostics default off: shared `~/.local/share/nanomneme/config.jsonc` supplies defaults and user adapter `nmnm.jsonc` can override them. Invalid applicable configuration disables logging; projects cannot enable it. UI rereads settings per mutation/error attempt. Logs append to `~/.local/share/nanomneme/logs/<component>.jsonl`; raw error messages are not redacted. Shared general-error emission remains a future feature outside the current core logging API.

### Dependencies and distribution

- Block CI/release on `npm audit --audit-level=high --omit=dev`; keep `npm audit --audit-level=high` informational. Recheck the lockfile and registry rather than relying on historical clean-audit claims.
- Declare host-harness dependencies with a tested minimum compatible version rather than an exact pin.
- Keep the root OpenCode Zod/Effect TOML overrides until the upstream fixes are verified. Exact selections belong in the manifest/lock; root overrides protect checkout/CI npm installs, not independently installed adapters or Bun caches.
- After an upstream fix, remove applicable overrides and rerun frozen install, adapter/native-host checks, production audit and standalone validation. Keep the tested host floor; do not force audit downgrades. Root and Claude's independent lockfiles must each resolve patched external dependencies.

Pack-output parsing accepts arrays and package-name-keyed objects, rejecting mismatched packages/versions and malformed or unsafe file lists.

### Codex delivery and context

- Register a stable absolute `adapters/codex/mcp/launch.js` path with no configured `cwd`; it uses the actual Codex session directory, ignoring stale `PWD`/`NMNM_PROJECT_DIR` values. Do not use plugin-cache cwd as a project directory. The internal `mcp/server.js` still requires explicit binding.
- Forward `CODEX_HOME` and supported correlation variables as documented. Native settings use `$CODEX_HOME/nmnm.jsonc`, defaulting to `~/.codex/nmnm.jsonc`; project settings use `<session-cwd>/.nanomneme/nmnm.jsonc`.
- Register and trust the separate `hooks/context.js` handlers for `SessionStart`, `UserPromptSubmit` and `SessionEnd`. They read existing stores and manage disposable cadence state; memory writes remain MCP. Direct registration does not install the optional memory skill.
- Preserve native context budgets, scalar overrides, deduplicated rule merging and never/ask/automatic precedence. Count real user-prompt events, not MCP calls. Context settings reload per event; disabled/invalid reinjection leaves state untouched, and failed due builds still advance enabled cadence. Logging keeps its first-operation snapshot until server restart.
- Use preparation for the full physical production closure, not only core/parser. The compatible `node scripts/check-logging-packages.js --prepare-codex` route validates packages before preparing dependencies; restart remains separate.
- Migrate former marketplace installations before direct setup. For local tarballs, strip npm's `package/` prefix when extracting; keep installation paths stable and avoid duplicate server/hook registrations.

Codex has no marketplace/cache delivery, pin management or adapter CLI. Reads and missing-target removal do not create stores; removal is soft-only. See the [Codex quick start](adapters/codex/README.md#quick-start) and [manual](adapters/codex/docs/CODEX_ADAPTER_MANUAL.md) for setup, migration, configuration and output limits. SDK/tarball checks do not establish native registration, live-model compliance or desktop/IDE behavior.

### Store and adapter contracts

- Trim/validate CLI scope and Pi/Claude/OpenCode retain scope before selecting stores; invalid scope must not create one. CLI selectors determine destination; these adapters use retain scope, defaulting to project. Pi validates scope before project-trust checks.
- Preserve Pi's terminal presentation boundary: escape stored C0/C1 controls except layout newlines/tabs without rewriting canonical records. Keep store-tab selection visible with a height-bounded window and the floor-compatible cursor marker; native dialogs use unique page-local row numbers, not preview text alone, to distinguish targets.
- Preserve Pi's canonical model schema guidance: kinds/scopes, scores from 0–1, UUIDs, slugs, expiry formats, create-versus-patch intent, metadata and retrieval score filters. Model inputs are unpadded; direct runtime calls still trim text. Host schema rejection may precede adapter logging.
- Render enabled autoretention rules before indexes within existing budgets. Pi's minimal-call/original-store reminder consumes 290 characters including its newline without raising the default budget. Never redirect untrusted project memories to global as a fallback.
- Preserve Claude's config-first prompt hook: disabled reinjection touches no session state or memory; enabled prompts advance an ephemeral counter and build context only on cadence. Context-build failures do not stall cadence; settings errors fail open without state changes.

Provider conversion is not live-provider acceptance. The documented five-case Bedrock/Pi 1.3.0 sample proves only bounded single-model first-retain success; subprocess hooks do not establish native registration.

### Workbench and release boundaries

- Open registered UI stores read-only; reject incompatible schema/SQLite integrity without creating or migrating databases. Enable writes explicitly per store/session and test them only against disposable stores.
- Preserve trash controls as unregister/close-reader-and-writer actions, never file deletion; re-added stores start read-only. Keep store collapse/count controls, five-row preview scrolling and 50-record pagination.
- Require changelog notes for the root release tag before publishing. The maintainer must include reviewed documentation in the intended release commit.

UI lists/details use full exports; timestamp conflict checks are not atomic with mutations. UI owns no adapter settings or pins.

## Key files

- `README.md`: project overview and component references.
- `package.json`: workspace scripts, development dependencies and runtime floor.
- `scripts/maintenance.js`: validation, generation, upstream updates and Codex preparation coordinator.
- `shared/fixtures/logslines-release.json`: reviewed release metadata/hash pin, excluded from runtime packages.
- `scripts/build-logger.js`: core/UI logging and Claude core/logging generation/check tooling.
- `scripts/check-logging-packages.js`: installed-artifact logging/runtime checks and optional Codex preparation.
- `scripts/external-logslines.js`: pinned upstream snapshot maintenance.
- `docs/LOGGER.md`: authoritative logging source, binding, artifact and build reference.
- `docs/ARCHITECTURE.md` and `docs/SEQUENCE_MEMORY_HANDLING.md`: component boundaries and operation flows.
- `packages/nmnm-ui/README.md`: UI features, limitations, diagnostics, packaging and future features.
- `AGENTS.md`: repository-specific agent instructions.
<!-- opl-init:fp c6e0ec4c308f16e7 -->
