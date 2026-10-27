# nanomneme Repository Guide

## What this is

nanomneme (`nmnm`) is a small, deterministic SQLite core for coding-agent memory. It is intended to preserve useful context across sessions without requiring an opaque service.

The repository includes memory core, CLI, and local review UI packages; Pi, OpenCode, Claude, and Codex adapters; shared utilities; tests; documentation; and external-source tooling. CLI bundles core and UI as regular dependencies; UI starts only when requested.

Use Node.js 22.19.0 or newer with built-in `node:sqlite` and FTS5 for repository development. Run commands below from the repository root. The root runtime floor is stricter than some individual packages.

## Documentation version policy

Keep active documentation prose and installation examples version-neutral: do not repeat current repository/component versions, dependency ranges, publication snapshots, or installation pins. Preserve existing Shields.io badges, including version and release badges; this policy does not authorize deleting or replacing them with plain links. Manifests, lockfiles, and the changelog own release versions; use package/version commands when users need installed details. Prose version labels belong only in feature-introduction, significant-change, or breaking-change notes. Preserve necessary runtime/host compatibility requirements, version-qualified test evidence, canonical changelog history, and clearly historical research. Use unversioned package installation examples; rollback guidance should select a verified compatible release rather than prescribe a stale pin. Apply this policy across READMEs, manuals, skills, and repository guidance.

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

This first checks all four generated runtimes without rewriting them, then runs Node’s built-in test runner across scripts, shared logger, packages, adapters, and top-level tests. Run the narrowest relevant tests while developing, then the complete suite for cross-package changes.

Validate logging and runtime imports in packed packages installed outside the workspace:

```sh
node scripts/check-logging-packages.js
```

This uses npm registry access for ordinary dependencies, checks all components, and verifies that UI excludes its build-only logger source. It does not refresh installed harnesses or plugin caches by default.

It also installs a disposable Claude plugin from `adapters/claude/package-lock.json` with frozen resolution and lifecycle scripts disabled, audits that external-only dependency tree, checks copied runtime hashes, runs the full core contract against Claude's generated bundle and the Claude adapter suite, and exercises stdio MCP 4Rs and the management CLI. Claude bundles generated core and logging; registry core is rejected, so validation and copied installs do not require core publication. Refresh external dependencies in a standalone temporary copy of Claude's manifest/lock outside the monorepo, review the lock, then synchronize root metadata and validate. Keep plugin package/manifest versions aligned for distribution. These checks do not establish native cache installation or provider behavior.

Pi development-host checks accept stable `~1.2.0` while the dependency floor remains `>=0.87.0`. Main CI/release validation use the lockfile; a separate blocking CI matrix runs adapter tests against `0.87.0`, `~0.87.0`, `~0.99.0`, and `~1.2.0`. Reproduce only in a disposable checkout after `npm ci` with `node scripts/check-pi-compatibility.js '~0.87.0'` (or another matrix selector): it changes `node_modules` without changing manifests/locks and excludes only the development-host version assertion. Host-loader and schema checks do not establish live-provider or rendered-TUI behavior.

Run rendered UI checks when browser behavior or UI logging changes:

```sh
python3 packages/nmnm-ui/test/browser.py
python3 packages/nmnm-ui/test/browser_regressions.py
```

These checks require Python Playwright, installed browser engines, and root development dependencies (including axe-core). They default to Chromium; set `NMNM_UI_BROWSER=firefox` or `NMNM_UI_BROWSER=webkit` for other engines. Tests create disposable stores/server state and save screenshots and axe reports under the platform temporary directory. Run both suites in all engines with `bash scripts/run-ui-browser-checks.sh`; it collects later engines' results even if an earlier suite fails and exits nonzero for any failure. CI/release use one pinned `mcr.microsoft.com/playwright/python:v1.62.0-noble` container with Node 22 and Python 3.14, a matching Playwright package, no runtime APT, a 15-minute job limit, bounded setup steps, and a six-minute suite step. `install --only-shell chromium` ensures the cached headless shell; Firefox/WebKit have no reduced shell equivalent. Engine-qualified evidence is retained for 7 days. They are separate from `npm run validate`; test tools are not UI runtime dependencies. See [Workbench web standards](packages/nmnm-ui/docs/WEB_STANDARDS.md) for the WCAG 2.2 AA maintenance target, coverage, WebKit keyboard assumptions, and required manual checks. Automated passes are not accessibility certification.

Launch the foreground workbench without automatically opening the browser:

```sh
node packages/nmnm-cli/bin/nmnm.js ui --no-auto
```

The installed equivalent is `nmnm ui`; `--port`/`-p` selects a port, and `--no-auto`/`-na` suppresses default browser opening. Ctrl-C stops the server. Select existing stores and enable editing explicitly inside the workbench.

Check that the checked-in Logslines snapshot and provenance exactly match the selected upstream release tag:

```sh
npm run external:check -- <reviewed-release-tag>
```

Replace `<reviewed-release-tag>` with the exact reviewed tag recorded in `shared/fixtures/logslines-release.json`. This command fetches the tagged upstream files and compares their contents and hashes with the local snapshot. The offline pinned-hash test runs under `npm test` and CI; CI does not fetch external Logslines sources.

Update Logslines to an explicitly selected release tag:

```sh
npm run logslines:update -- <reviewed-release-tag>
```

This validates the upstream snapshot, updates provenance and the reviewed pin at `shared/fixtures/logslines-release.json`, refreshes stale bundles, runs the full suite, and validates standalone packages. Later failures retain updates for review and identify affected paths. Focused `external:update` remains available but updates only snapshot/provenance; it does not update the fixture/bundles or run validation. The fixture is excluded from published runtime packages.

Prepare Codex before first-time marketplace installation or packing:

```sh
npm run codex:prepare
```

Run `npm ci` and `npm run validate` first as separate commands. Preparation refreshes stale generated runtimes and copies physical core/parser dependencies into the adapter without calling Codex, registering a marketplace, installing a plugin, or running validation. Register the repository and install the plugin only afterward; see the [Codex quick start](adapters/codex/README.md#quick-start).

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

Component `src/logslines.js` files bind identity and caller configuration to `@openlines/nmnm-core/logging`, except Claude, which imports its local generated logging runtime; core persistence methods do not emit records automatically. The shared implementation lives in `shared/logger/` and ships as core’s generated runtime. UI mutations reuse it; UI general errors use a separate generated runtime built from `packages/nmnm-ui/src/ui-logger.js`. That source is excluded from the UI npm package. Claude's generated core and logging runtimes live in `adapters/claude/src/` and carry version/license stamps. See [Logger manual](docs/LOGGER.md) for the complete file-role map.

## Testing and operational quirks

Check all four generated runtimes (core logging, UI logging, Claude core, and Claude logging):

```sh
node scripts/build-logger.js --check
```

The check exits `0` when current, `2` when stale/missing, and `1` on failure. If stale, inspect the source/build inputs, run `npm run logslines:build`, and review affected artifacts. Do not hand-edit generated files. Core source/version, shared production logger source, upstream snapshot/provenance, generator, and UI error-emitter changes can require regeneration; ordinary bindings, tests, and documentation changes do not by themselves. UI and Claude logging bundle JSONC; core keeps it external.

Diagnostics default off. Shared `~/.local/share/nanomneme/config.jsonc` supplies the default; user-level adapter `nmnm.jsonc` can override it. Invalid applicable configuration disables logging; project settings cannot enable it. UI rereads settings per mutation/error attempt. Logs append to `~/.local/share/nanomneme/logs/<component>.jsonl`; raw error messages are not redacted. Keep personal databases, logs, credentials, and local settings out of tracked files. Checked-in generated logging runtimes are intentional package artifacts.

Dependency auditing is scoped to what ships. CI and release block on `npm audit --audit-level=high --omit=dev`; `npm audit --audit-level=high` is informational there. The current production audit is clean; the full audit retains findings from Pi's pinned Undici dependency. Recheck the current lockfile and registry audit before treating this status as current. Host-harness dependencies use a tested minimum compatible version rather than an exact pin.

Root-only overrides temporarily select patched OpenCode Zod and Effect TOML dependencies pending upstream fixes; exact selections live in `package.json` and the root lockfile. They protect npm checkout/CI installs, not independently installed adapters or Bun-managed plugin caches. Keep the tested host floor unchanged; do not use forced audit downgrades. After an upstream fix, remove the overrides and rerun frozen installation, adapter/native-host checks, production audit, and standalone validation. Root and Claude's independent lockfiles must each resolve patched external dependencies.

Codex cached plugins require physical core/parser dependencies. Use `npm run codex:prepare` before first-time installation; `npm run codex:update` prepares them and conditionally refreshes an existing enabled installation. Start a new session after installing/reinstalling and review hook trust. `npm run validate codex:update` is invalid; run scripts separately. Pack-output parsing accepts arrays and package-name-keyed objects and rejects mismatched packages/versions and malformed or unsafe file lists. The compatible `node scripts/check-logging-packages.js --prepare-codex` path runs package validation before preparation; marketplace reinstall/reload remain separate for that manual path. See [Codex manual](adapters/codex/docs/CODEX_ADAPTER_MANUAL.md#refresh-after-checkout-updates). Unit tests and tarball checks do not establish native harness registration, provider behavior, or installed-cache freshness.

UI registration opens existing databases read-only and rejects incompatible schema/SQLite integrity; it does not create or migrate stores. Lists/details use full exports, and timestamp conflict checks are not atomic with mutation. Test writes against disposable stores. Shared general-error emission is a future feature, not part of the current core logging API.

CLI scope values and Pi/Claude/OpenCode retain scopes are trimmed and validated before store selection. CLI selectors still determine the destination; adapter retain scope selects its store, with omitted scope defaulting to project. Pi validates scope before project-trust checks. Invalid scope must not create a store. Pi retain schemas describe supported kinds/scopes, 0–1 scores, UUIDs, slugs, expiry formats, and create-versus-patch semantics alongside explicit metadata and retrieval score filters. Model-facing inputs are canonical and unpadded; direct runtime calls still trim text. Host schema rejection can occur before adapter logging. Provider conversion checks do not establish live provider acceptance; the documented five-case Bedrock/Pi 1.3.0 sample establishes only bounded single-model first-retain success.

Pi/Claude/OpenCode render enabled autoretention guidance before memory indexes within their existing budgets. Pi's minimal-call and patch/store reminder adds 290 characters, including its newline, when enabled rules exist; this reduces index space without raising the default budget. Never redirect untrusted project memories to global as a fallback. Claude prompt-submit resolves settings before state or memory access; disabled reinjection leaves session state untouched. Enabled prompts advance an ephemeral counter and build context only on cadence; failed context builds do not stall the count. Settings errors fail open without state changes. Subprocess hook checks do not establish native harness registration.

Store trash controls unregister stores and close their readers/writers without deleting files; re-added stores start read-only. Stores can collapse with its added-store count still visible. The memory list scrolls after five preview rows and retains 50-record pagination. Release validation requires changelog notes for the root tag before any publishing; documentation under review must be included in the intended release commit by the maintainer.

## Key files

- `README.md`: project overview and package/adapter references.
- `package.json`: workspace scripts, development dependencies, and runtime floor.
- `scripts/maintenance.js`: build, upstream update, Codex refresh, and read-only validation coordinator.
- `shared/fixtures/logslines-release.json`: independent reviewed release metadata/hash pin, excluded from runtime packages.
- `scripts/build-logger.js`: core/UI logging and Claude core/logging generation/check tooling.
- `scripts/check-logging-packages.js`: installed-tarball logging checks and optional Codex preparation.
- `scripts/external-logslines.js`: pinned upstream snapshot check/update tooling.
- `docs/LOGGER.md`: authoritative logging source, binding, artifact, and build reference.
- `docs/ARCHITECTURE.md` and `docs/SEQUENCE_MEMORY_HANDLING.md`: component boundaries and operation flow.
- `packages/nmnm-ui/README.md`: UI features, limitations, diagnostics, packaging, and future features.
- `AGENTS.md`: repository-specific agent instructions.
<!-- opl-init:fp c6e0ec4c308f16e7 -->
