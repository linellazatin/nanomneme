# nanomneme Repository Guide

## What this is

nanomneme (`nmnm`) is a small, deterministic SQLite core for coding-agent memory. It is intended to preserve useful context across sessions without requiring an opaque service.

The repository includes memory core, CLI, and local review UI packages; Pi, OpenCode, Claude, and Codex adapters; shared utilities; tests; documentation; and external-source tooling. CLI bundles core and UI as regular dependencies; UI starts only when requested.

Use Node.js 22.19.0 or newer with built-in `node:sqlite` and FTS5 for repository development. Run commands below from the repository root. The root runtime floor is stricter than some individual packages.

## Commands

Run complete read-only validation before shipping:

```sh
npm run validate
```

This runs `npm test` (generated-output check plus the full suite), the shipped-dependency audit, then standalone package validation. It stops on failure, requires npm registry access, and never regenerates tracked artifacts, fetches upstream Logslines, or refreshes Codex. CI/release use this blocking command and retain the informational full-tree audit.

Refresh stale logger bundles and validate standalone packages:

```sh
npm run logslines:build
```

Reports `up-to-date` or `updated`, then `validated`. Use `npm run logslines:build -- --fast` to explicitly skip package validation for the edit loop. Build/read failures do not trigger regeneration; errors exit nonzero.

Run the complete test suite:

```sh
npm test
```

This first checks both generated logging runtimes without rewriting them, then runs Node’s built-in test runner across scripts, shared logger, packages, adapters, and top-level tests. Run the narrowest relevant tests while developing, then the complete suite for cross-package changes.

Validate logging and runtime imports in packed packages installed outside the workspace:

```sh
node scripts/check-logging-packages.js
```

This uses npm registry access for ordinary dependencies, checks all components, and verifies that UI excludes its build-only logger source. It does not refresh installed harnesses or plugin caches by default.

It also installs a disposable Claude plugin from `adapters/claude/package-lock.json` with frozen resolution and lifecycle scripts disabled, audits that dependency tree, runs the Claude adapter suite, and exercises stdio MCP 4Rs and the management CLI. Claude's `^0.3.0` manifest deliberately locks registry core `0.3.0`; root workspace development uses checkout `0.3.1`. Publishing core does not refresh the plugin lock. Review a later lock update, update its test assertion, and increase the plugin package/manifest versions together before distributing it. These checks do not establish native cache installation or provider behavior.

Run rendered UI checks when browser behavior or UI logging changes:

```sh
python3 packages/nmnm-ui/test/browser.py
python3 packages/nmnm-ui/test/browser_regressions.py
```

These checks require Python Playwright, installed browser engines, and root development dependencies (including axe-core). They default to Chromium; set `NMNM_UI_BROWSER=firefox` or `NMNM_UI_BROWSER=webkit` for other engines. Tests create disposable stores/server state and save screenshots and axe reports under the platform temporary directory. CI/release run blocking Ubuntu lanes for all three engines, using Python 3.14, Playwright 1.62.0, a 15-minute timeout per lane, and retained evidence for 7 days. They are separate from `npm run validate`; test tools are not UI runtime dependencies. See [Workbench web standards](packages/nmnm-ui/docs/WEB_STANDARDS.md) for the WCAG 2.2 AA maintenance target, coverage, WebKit keyboard assumptions, and required manual checks. Automated passes are not accessibility certification.

Launch the foreground workbench without automatically opening the browser:

```sh
node packages/nmnm-cli/bin/nmnm.js ui --no-auto
```

The installed equivalent is `nmnm ui`; `--port`/`-p` selects a port, and `--no-auto`/`-na` suppresses default browser opening. Ctrl-C stops the server. Select existing stores and enable editing explicitly inside the workbench.

Check that the checked-in Logslines snapshot and provenance exactly match the selected upstream release tag:

```sh
npm run external:check -- v0.1.0
```

This command fetches the tagged upstream files and compares their contents and hashes with the local snapshot. The offline pinned-hash test runs under `npm test` and CI; CI does not fetch external Logslines sources.

Update Logslines to an explicitly selected release tag:

```sh
npm run logslines:update -- v0.1.0
```

This validates the upstream snapshot, updates provenance and the reviewed pin at `shared/fixtures/logslines-release.json`, refreshes stale bundles, runs the full suite, and validates standalone packages. Later failures retain updates for review and identify affected paths. Focused `external:update` remains available but updates only snapshot/provenance; it does not update the fixture/bundles or run validation. The fixture is excluded from published runtime packages.

Refresh an existing enabled local Codex installation:

```sh
npm run codex:update
```

Requires an existing matching `nanomneme-local` marketplace and installed plugin. Refreshes stale bundles, prepares physical core/parser dependencies, detects same-version content changes, reinstalls only stale cache contents, and verifies the result. Respects `CODEX_HOME` and reports reload requirements; missing setup, wrong registrations, disabled plugins, or unsupported CLI metadata stop before generation/preparation. It does not perform first-time setup, run the full suite, or establish live hook behavior.

## Architecture

- `packages/` contains `nmnm-core`, `nmnm-cli`, and `nmnm-ui`. Core owns SQLite access; CLI, UI, and adapters call its public APIs.
- `adapters/` contains integrations for coding-agent environments, including Pi, OpenCode, Claude, and Codex.
- `shared/` contains shared implementation/tests and the reviewed Logslines release fixture.
- `scripts/` contains repository tooling such as logger generation checks and external data maintenance.
- `test/` contains top-level tests.
- `docs/` and `research/` contain documentation and research material.
- `external/` contains externally sourced material managed by the external check/update scripts.

Component `src/logslines.js` files bind identity and caller configuration to `@openlines/nmnm-core/logging`; core persistence methods do not emit records automatically. The shared implementation lives in `shared/logger/` and ships as core’s generated runtime. UI mutations reuse it; UI general errors use a separate generated runtime built from `packages/nmnm-ui/src/ui-logger.js`. That source is excluded from the UI npm package. See [Logger manual](docs/LOGGER.md) for the complete file-role map.

## Testing and operational quirks

Check both generated logging runtimes:

```sh
node scripts/build-logger.js --check
```

The check exits `0` when current, `2` when stale/missing, and `1` on failure. If stale, inspect the source/build inputs, run `npm run logslines:build`, and review both artifacts. Do not hand-edit generated files. Shared production logger source, upstream snapshot/provenance, generator, and UI error-emitter changes can require regeneration; ordinary bindings, tests, and documentation changes do not by themselves. UI bundles JSONC; core keeps it external.

Diagnostics default off. Shared `~/.local/share/nanomneme/config.jsonc` supplies the default; user-level adapter `nmnm.jsonc` can override it. Invalid applicable configuration disables logging; project settings cannot enable it. UI rereads settings per mutation/error attempt. Logs append to `~/.local/share/nanomneme/logs/<component>.jsonl`; raw error messages are not redacted. Keep personal databases, logs, credentials, and local settings out of tracked files. Checked-in generated logging runtimes are intentional package artifacts.

Dependency auditing is scoped to what ships. CI and release block on `npm audit --audit-level=high --omit=dev`; `npm audit --audit-level=high` is informational there. Both audits currently pass. The former Pi shrinkwrap blocker was resolved with the Pi host update; do not carry historical vulnerability assumptions forward without checking the current lockfile and audit. Host-harness dependencies use a tested minimum compatible version rather than an exact pin.

Codex cached plugins require physical core/parser dependencies. `npm run codex:update` prepares them and conditionally refreshes an existing enabled installation; start a new session after reinstalling. The compatible `node scripts/check-logging-packages.js --prepare-codex` path runs package validation before preparation; marketplace reinstall/reload remain separate for that manual path. See [Codex manual](adapters/codex/docs/CODEX_ADAPTER_MANUAL.md#refresh-after-checkout-updates). Unit tests and tarball checks do not establish native harness registration, provider behavior, or installed-cache freshness.

UI registration opens existing databases read-only and rejects incompatible schema/SQLite integrity; it does not create or migrate stores. Lists/details use full exports, and timestamp conflict checks are not atomic with mutation. Test writes against disposable stores. Shared general-error emission is a future feature, not part of the current core logging API.

CLI scope values and Pi/Claude/OpenCode retain scopes are trimmed and validated before store selection. CLI selectors still determine the destination; adapter retain scope selects its store, with omitted scope defaulting to project. Pi validates scope before project-trust checks. Invalid scope must not create a store. Pi metadata and score-filter schemas are explicit; provider conversion checks do not establish live provider acceptance.

Pi/Claude/OpenCode render enabled autoretention guidance before memory indexes within their existing budgets. Claude prompt-submit resolves settings before state or memory access; disabled reinjection leaves session state untouched. Enabled prompts advance an ephemeral counter and build context only on cadence; failed context builds do not stall the count. Settings errors fail open without state changes. Subprocess hook checks do not establish native harness registration.

Store trash controls unregister stores and close their readers/writers without deleting files; re-added stores start read-only. Stores can collapse with its added-store count still visible. The memory list scrolls after five preview rows and retains 50-record pagination. Release validation requires changelog notes for the root tag before any publishing; documentation under review must be included in the intended release commit by the maintainer.

## Key files

- `README.md`: project overview and package/adapter references.
- `package.json`: workspace scripts, development dependencies, and runtime floor.
- `scripts/maintenance.js`: build, upstream update, Codex refresh, and read-only validation coordinator.
- `shared/fixtures/logslines-release.json`: independent reviewed release metadata/hash pin, excluded from runtime packages.
- `scripts/build-logger.js`: shared/core and UI logger generation/check tooling.
- `scripts/check-logging-packages.js`: installed-tarball logging checks and optional Codex preparation.
- `scripts/external-logslines.js`: pinned upstream snapshot check/update tooling.
- `docs/LOGGER.md`: authoritative logging source, binding, artifact, and build reference.
- `docs/ARCHITECTURE.md` and `docs/SEQUENCE_MEMORY_HANDLING.md`: component boundaries and operation flow.
- `packages/nmnm-ui/README.md`: UI features, limitations, diagnostics, packaging, and future features.
- `AGENTS.md`: repository-specific agent instructions.
<!-- opl-init:fp c6e0ec4c308f16e7 -->
