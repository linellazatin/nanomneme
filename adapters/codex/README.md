# Nanomneme for Codex

`@openlines/nmnm-codex` is an MCP-free Codex plugin prototype for macOS and Linux. It bundles `@openlines/nmnm-core@0.2.0`, gives Codex one lazy-loaded `memory` skill backed by a package-relative Node runner, and adds a trusted read-only SessionStart memory index.

The adapter stores canonical records in Nanomneme's standard project database, `./.nanomneme/memory.db`, and standard global database, `~/.local/share/nanomneme/memory.db`. It has no adapter settings, pins, automatic retention, management CLI, MCP server, or Windows support claim.

Before a local marketplace install or reinstall, run `node scripts/check-logging-packages.js --prepare-codex` at the repository root after `npm install`. This checks standalone packages and places physical core/parser dependencies under the adapter so Codex's cached copy can resolve them. Root workspace links alone are insufficient. The local development plugin uses `.codex-plugin/plugin.json` for its metadata and hook registration, and its version must match `package.json`. See [the Codex adapter manual](docs/CODEX_ADAPTER_MANUAL.md).

## Shared opt-in diagnostics

Set `"logging": { "enabled": true }` in `~/.local/share/nanomneme/config.jsonc` to enable the shared default. JSONC comments and trailing commas are supported. Adapter user-level `nmnm.jsonc` can explicitly enable or disable logging; absence inherits. Either invalid applicable logging configuration disables that caller. Project settings cannot authorize logging. Records use the shared `logslines/v1` catalog and core-distributed runtime, contain no memory payloads or stack traces, carry thrown-error messages verbatim in failed records, and append to `~/.local/share/nanomneme/logs/<component>.jsonl`. Logging failures preserve operations and output. Existing databases, pin files, and logs require no migration.

Codex uses `$CODEX_HOME/nmnm.jsonc`, defaulting to `~/.codex/nmnm.jsonc`, for logging only. Explicit runner 4Rs are observed; SessionStart indexes remain unlogged. Correlation uses nonempty host-provided `CODEX_THREAD_ID`, falling back to `CODEX_SESSION_ID`, otherwise null. Request-supplied session fields are ignored. Each runner process resolves settings and correlation anew.
