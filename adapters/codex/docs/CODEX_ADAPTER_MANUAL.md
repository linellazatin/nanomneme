# Codex Adapter Manual

## Scope

`@openlines/nmnm-codex` provides local deterministic Nanomneme memory to Codex without MCP. It is a macOS and Linux prototype for Node.js 22.13+ that bundles its exact `@openlines/nmnm-core` runtime. The package contains one lazy-loaded skill, a constrained JSON runner, and one SessionStart hook.

## Install from a packed local artifact

From the repository root, run `npm install`, then `node scripts/check-logging-packages.js --prepare-codex`. The preparation command checks isolated packages and copies physical core/parser dependencies into the adapter's ignored `node_modules`; it preserves tracked package manifests and the root lockfile. Repeat preparation after core or adapter dependency changes, before packing or refreshing the marketplace installation. Codex copies the plugin into its cache, where root workspace links cannot provide dependencies. The local development plugin uses `.codex-plugin/plugin.json` for its metadata and hook registration, and its version must match `package.json`.

For live Codex development, use the repo-local `.agents/plugins/marketplace.json` entry, which points at `adapters/codex`. Register the repository with `codex plugin marketplace add /absolute/path/to/nanomneme`, then install or refresh it with `codex plugin add nmnm-codex@nanomneme-local`. Start a new session and review any renewed hook trust prompt. Use `codex plugin list --marketplace nanomneme-local` to inspect the installed version. Publication is deliberately deferred; do not use a public npm install command for this prototype. For a packed artifact, run `npm pack --workspace @openlines/nmnm-codex` after preparation.

## Refresh after checkout updates

For an existing local marketplace installation, repeat this procedure after core changes, shared logger changes, or Codex adapter/dependency changes. Codex runs a cached plugin with physical bundled dependencies; updating the checkout or reinstalling the plugin alone does not refresh an already prepared core copy. The displayed version can remain unchanged while the bundled code is stale.

1. From the repository root, confirm the generated logger is current:

```sh
node scripts/build-logger.js --check
```

If this reports a stale bundle after a shared logger change, run `node scripts/build-logger.js`, review the generated diff, then repeat the check.

2. Refresh the adapter's physical core/parser dependencies, then refresh the installed plugin:

```sh
node scripts/check-logging-packages.js --prepare-codex
codex plugin add nmnm-codex@nanomneme-local --json
```

Preparation requires npm registry access for ordinary dependencies and must complete successfully before reinstalling. The plain package check without `--prepare-codex` validates temporary packages but does not update `adapters/codex/node_modules`. Marketplace reinstall refreshes the cached plugin even when its version remains `0.2.0`.

3. Reload Codex or start a new session so it uses the refreshed plugin.
4. Compare the checkout logger with both bundled copies:

```sh
cmp packages/nmnm-core/src/logging-runtime.generated.js \
  adapters/codex/node_modules/@openlines/nmnm-core/src/logging-runtime.generated.js

cmp packages/nmnm-core/src/logging-runtime.generated.js \
  "${CODEX_HOME:-$HOME/.codex}/plugins/cache/nanomneme-local/nmnm-codex/0.2.0/node_modules/@openlines/nmnm-core/src/logging-runtime.generated.js"
```

Each comparison succeeds with no output and exit code `0`. Replace `0.2.0` with the installed plugin version when it changes. If the adapter copy differs, repeat preparation; if only the cached copy differs, repeat marketplace reinstall and reload. For generation and Logslines maintenance, see the [Logger manual](../../../docs/LOGGER.md).

## Hook trust and bounded context

The hook is not trusted automatically. After reviewing `hooks/hooks.json` and `hooks/session-start.js`, trust it in Codex to enable it. On session start it opens only existing stores read-only, emits no output for empty or unreadable stores, and never blocks startup. The injected index has a fixed 1,200-character cap, uses project records before global records, and labels each record with its store and recorded source. The hook has no context settings, pins, reinjection cadence, or automatic retention.

## Shell-backed 4Rs

The `memory` skill resolves and invokes `skills/memory/runner.js`, which accepts one JSON request on stdin. The only operations are `retain`, `recall`, `retrieve`, and soft `remove`. Requests select `project` or `global`; they cannot select an arbitrary database path, purge, import, export, repair, or verify. New records receive `metadata.source: "codex"`; ID patches retain their existing metadata provenance. Reads and no-op removals leave missing stores absent.

## Store behavior

Project memory is `./.nanomneme/memory.db`. Global memory is `~/.local/share/nanomneme/memory.db`. The runner defaults to project memory and gives new global records global scope. These stores are shared with the Nanomneme CLI and other adapters, so use the `nmnm` CLI for model-free inspection, transfer, maintenance, backups, verification, repair, and irreversible purge.

## Token and failure boundaries

The index is an intentionally compact aid, not a full database export. Use `retrieve` and `recall` for complete records. Runner failures are structured JSON errors. Hook failures produce no context. Neither failure mode starts a daemon, uses a network service, or falls back to MCP.

## Non-goals

This prototype does not add Windows support, MCP, automatic retention, context configuration, pins, prompt cadence, a Codex-specific management command, direct SQLite access, or npm publication.

## Shared opt-in diagnostics

Set `"logging": { "enabled": true }` in `~/.local/share/nanomneme/config.jsonc` to enable the shared default. JSONC comments and trailing commas are supported. Adapter user-level `nmnm.jsonc` can explicitly enable or disable logging; absence inherits. Either invalid applicable logging configuration disables that caller. Project settings cannot authorize logging. Records use the shared `logslines/v1` catalog and core-distributed runtime, contain no memory payloads or stack traces, carry thrown-error messages verbatim in failed records, and append to `~/.local/share/nanomneme/logs/<component>.jsonl`. Logging failures preserve operations and output. Existing databases, pin files, and logs require no migration.

Codex uses `$CODEX_HOME/nmnm.jsonc`, defaulting to `~/.codex/nmnm.jsonc`, for logging only. Explicit runner 4Rs are observed; SessionStart indexes remain unlogged. Correlation uses nonempty host-provided `CODEX_THREAD_ID`, falling back to `CODEX_SESSION_ID`, otherwise null. Request-supplied session fields are ignored. Each runner process resolves settings and correlation anew. Hosts without these environment values retain null correlation; no session mapping or transcript inspection is required.
