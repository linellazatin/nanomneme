# Codex Adapter Manual

## Scope

`@openlines/nmnm-codex` provides local deterministic Nanomneme memory to Codex without MCP. It is a macOS and Linux prototype for Node.js 22.13+ with FTS5 in built-in `node:sqlite` (22.19.0 is tested) that bundles its exact `@openlines/nmnm-core` runtime. The package contains one lazy-loaded skill, a constrained JSON runner, and one SessionStart hook.

## Install from a packed local artifact

From the repository root, run `npm install`, then `node scripts/check-logging-packages.js --prepare-codex`. The preparation command checks isolated packages and copies physical core/parser dependencies into the adapter's ignored `node_modules`; it preserves tracked package manifests and the root lockfile. Repeat preparation after core or adapter dependency changes, before packing or refreshing the marketplace installation. Codex copies the plugin into its cache, where root workspace links cannot provide dependencies. The local development plugin uses `.codex-plugin/plugin.json` for its metadata and hook registration, and its version must match `package.json`.

For live Codex development, use the repo-local `.agents/plugins/marketplace.json` entry, which points at `adapters/codex`. Register the repository with `codex plugin marketplace add /absolute/path/to/nanomneme`, then install or refresh it with `codex plugin add nmnm-codex@nanomneme-local`. Start a new session and review any renewed hook trust prompt. Use `codex plugin list --marketplace nanomneme-local` to inspect the installed version. Publication is deliberately deferred; do not use a public npm install command for this prototype. For a packed artifact, run `npm pack --workspace @openlines/nmnm-codex` after preparation.

## Refresh after checkout updates

For an existing local marketplace installation, use this command after core, logger, adapter, or dependency changes:

```sh
npm run codex:update
```

- Requires Node 22.19+, npm, installed repository dependencies, and a Codex CLI supporting JSON marketplace/plugin listing and installation.
- Requires `nanomneme-local` to point to this checkout and `nmnm-codex` to be installed and enabled. Missing setup prints the applicable registration/install command. Wrong marketplace/source, disabled plugins, and unsupported CLI output stop before generation or preparation; disabled plugins remain untouched.
- Refreshes stale logger bundles, then prepares physical core/parser dependencies without running the full package suite. Uses packaged core files and the installed parser matching core's exact dependency; it does not fetch upstream Logslines or install new dependencies. Reinstall repository dependencies if the parser is unavailable or mismatched.
- Compares complete file contents, including core/parser and adapter files; unchanged versions do not hide changes. Replaces stale managed dependency trees and removes obsolete files within them; unrelated adapter dependencies remain intact.
- Reinstalls through the existing marketplace only when the cache differs, then verifies version, enablement, and cached contents.
- Respects `CODEX_HOME`, defaulting to `~/.codex`. Cached content is checked under `plugins/cache/nanomneme-local/nmnm-codex/<installed-version>/`.
- Reports dependency freshness and `up-to-date` or `updated`. After reinstalling, `reload-required` means start a new Codex session and review any renewed hook trust prompt. Failures exit nonzero; preparation or installation changes already made remain in place.
- Freshness verification does not establish live hook registration, trust, provider behavior, or end-to-end memory operations. The command does not run the full suite or reload Codex.

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
