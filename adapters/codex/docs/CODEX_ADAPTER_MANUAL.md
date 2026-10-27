# Codex Adapter Manual

## Scope

`@openlines/nmnm-codex` provides local deterministic Nanomneme memory to Codex without MCP. It is a macOS and Linux prototype for Node.js 22.13+ with FTS5 in built-in `node:sqlite` (22.19.0 is tested) that bundles its exact `@openlines/nmnm-core` runtime. The package contains one lazy-loaded skill, a constrained JSON runner, and one SessionStart hook.

## First-time local marketplace installation

1. Check out the repository and enter its root. Use Node 22.19+ with built-in SQLite/FTS5, npm, and a Codex CLI supporting local marketplaces and plugins.
2. Install the locked repository dependencies and validate the checkout:

```sh
npm ci
npm run validate
```

3. Prepare the plugin before registering or installing it:

```sh
npm run codex:prepare
```

Preparation checks and refreshes stale generated runtimes, then copies packaged core files and the installed matching JSONC parser into the adapter's ignored `node_modules`. It preserves tracked manifests/locks, requires no existing marketplace/plugin, and never calls Codex. It does not install repository dependencies, run validation, or refresh an installed cache. Repeated preparation reports `up-to-date` when contents match. Missing or mismatched parser dependencies require rerunning `npm ci`; build/preparation failures exit nonzero and may retain completed changes for review.

4. Register this checkout and install the prepared plugin:

```sh
codex plugin marketplace add /absolute/path/to/nanomneme
codex plugin add nmnm-codex@nanomneme-local
codex plugin list --marketplace nanomneme-local
```

Replace the path with the actual checkout. The repo-local `.agents/plugins/marketplace.json` points to `adapters/codex`; `.codex-plugin/plugin.json` owns metadata and hook registration, and its version must match the adapter package. Codex copies the plugin into its cache, where root workspace symlinks and a globally installed CLI cannot satisfy package-relative imports. Start a new session and review/trust the hook. Installation checks do not establish automatic SessionStart invocation or live memory behavior. Publication is deferred; do not use a public npm install command for this prototype.

## Install from a packed local artifact

After the dependency installation, validation, and preparation steps above, run `npm pack --workspace @openlines/nmnm-codex` to produce a local artifact. Repeat preparation after core, logger, or adapter dependency changes before packing. A tarball check does not register a marketplace or establish native plugin loading.

## Refresh after checkout updates

After updating the checkout, run these separate commands from its root:

```sh
npm ci
npm run validate
npm run codex:update
```

- Requires Node 22.19+, npm, installed repository dependencies, and a Codex CLI supporting JSON marketplace/plugin listing and installation.
- Requires `nanomneme-local` to point to this checkout and `nmnm-codex` to be installed and enabled. For first-time setup, use `codex:prepare` and the installation steps above. Missing setup prints the applicable registration/install command. Wrong marketplace/source, disabled plugins, and unsupported CLI output stop before generation or preparation; disabled plugins remain untouched.
- Refreshes stale logger bundles, then prepares physical core/parser dependencies without running the full package suite. Uses packaged core files and the installed parser matching core's exact dependency; it does not fetch upstream Logslines or install new dependencies. Reinstall repository dependencies if the parser is unavailable or mismatched.
- Compares complete file contents, including core/parser and adapter files; unchanged versions do not hide changes. Replaces stale managed dependency trees and removes obsolete files within them; unrelated adapter dependencies remain intact.
- Reinstalls through the existing marketplace only when the cache differs, then verifies version, enablement, and cached contents.
- Respects `CODEX_HOME`, defaulting to `~/.codex`. Cached content is checked under `plugins/cache/nanomneme-local/nmnm-codex/<installed-version>/`.
- Reports dependency freshness and `up-to-date` or `updated`. After reinstalling, `reload-required` means start a new Codex session and review any renewed hook trust prompt. Failures exit nonzero; preparation or installation changes already made remain in place.
- Freshness verification does not establish live hook registration, trust, provider behavior, or end-to-end memory operations. The command does not run the full suite or reload Codex.

`npm run validate codex:update` is invalid: npm forwards `codex:update` as an argument to validation rather than running a second script. If the npm wrapper fails, `node scripts/maintenance.js codex:prepare` and `node scripts/maintenance.js codex:update` are equivalent direct entrypoints; report the full error and npm version rather than treating direct invocation as a permanent fix.

The existing manual preparation path remains available:

```sh
node scripts/check-logging-packages.js --prepare-codex
codex plugin add nmnm-codex@nanomneme-local --json
```

`--prepare-codex` runs standalone package validation first, then uses the same preparation helper with validated dependencies. It may need npm registry access. The plain package check only validates temporary packages and does not update the adapter or installed cache. For generation and upstream maintenance, see the [Logger manual](../../../docs/LOGGER.md).

## Hook trust and bounded context

The hook is not trusted automatically. After reviewing `hooks/hooks.json` and `hooks/session-start.js`, trust it in Codex to enable it. On session start it opens only existing stores read-only, emits no output for empty or unreadable stores, and never blocks startup. The injected index has a fixed 1,200-character cap, uses project records before global records, and labels each record with its store and recorded source. The hook has no context settings, pins, reinjection cadence, or automatic retention.

## Shell-backed 4Rs

The `memory` skill resolves and invokes `skills/memory/runner.js`, which accepts one JSON request on stdin. The only operations are `retain`, `recall`, `retrieve`, and soft `remove`. Requests select `project` or `global`; they cannot select an arbitrary database path, purge, import, export, repair, or verify. New records receive `metadata.source: "codex"`; ID patches retain their existing metadata provenance. Reads and no-op removals leave missing stores absent.

## Store behavior

Project memory is `./.nanomneme/memory.db`. Global memory is `~/.local/share/nanomneme/memory.db`. The runner defaults to project memory and gives new global records global scope. These stores are shared with the CLI and other adapters. Use the CLI for transfer, maintenance, backups, verification, and repair; model-free inspection and existing-record cleanup, including purge, are also available through `nmnm ui`.

## Token and failure boundaries

The index is an intentionally compact aid, not a full database export. Use `retrieve` and `recall` for complete records. Runner failures are structured JSON errors. Hook failures produce no context. Neither failure mode starts a daemon, uses a network service, or falls back to MCP.

## Non-goals

This prototype does not add Windows support, MCP, automatic retention, context configuration, pins, prompt cadence, a Codex-specific management command, direct SQLite access, or npm publication.

## Shared opt-in diagnostics

Diagnostics default off. Enable shared `logging.enabled` in `~/.local/share/nanomneme/config.jsonc`. User-level adapter settings can override it. Raw error messages are not redacted. See the [Logger manual](../../../docs/LOGGER.md#configuration-and-record-contract) for configuration, record fields, permissions, and privacy boundaries.

Codex uses `$CODEX_HOME/nmnm.jsonc`, defaulting to `~/.codex/nmnm.jsonc`, for logging only. Explicit runner 4Rs are observed; SessionStart indexes remain unlogged. Correlation uses nonempty host-provided `CODEX_THREAD_ID`, falling back to `CODEX_SESSION_ID`, otherwise null. Request-supplied session fields are ignored. Each runner process resolves settings and correlation anew. Hosts without these environment values retain null correlation; no session mapping or transcript inspection is required.

`src/logslines.js` supplies the adapter-specific logging binding. The [Logger manual](../../../docs/LOGGER.md#source-and-artifact-map) owns the shared source, generated-artifact, and package-check reference.
