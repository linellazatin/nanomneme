# Nanomneme for Codex

`@openlines/nmnm-codex` is an MCP-free Codex plugin prototype for macOS and Linux. It bundles `@openlines/nmnm-core@0.3.1`, gives Codex one lazy-loaded `memory` skill backed by a package-relative Node runner, and adds a trusted read-only SessionStart memory index.

The adapter stores canonical records in Nanomneme's standard project database, `./.nanomneme/memory.db`, and standard global database, `~/.local/share/nanomneme/memory.db`. It has no context settings, pins, automatic retention, management CLI, MCP server, or Windows support claim.

Before a local marketplace install or reinstall, run `node scripts/check-logging-packages.js --prepare-codex` at the repository root after `npm install`. This checks standalone packages and places physical core/parser dependencies under the adapter so Codex's cached copy can resolve them. Root workspace links alone are insufficient. The local development plugin uses `.codex-plugin/plugin.json` for its metadata and hook registration, and its version must match `package.json`. See [the Codex adapter manual](docs/CODEX_ADAPTER_MANUAL.md).

## Shared opt-in diagnostics

Diagnostics default off. Enable shared `logging.enabled` in `~/.local/share/nanomneme/config.jsonc`. User-level adapter settings can override it. Raw error messages are not redacted. See the [Logger manual](../../docs/LOGGER.md#configuration-and-record-contract) for configuration, record fields, permissions, and privacy boundaries.

Codex uses `$CODEX_HOME/nmnm.jsonc`, defaulting to `~/.codex/nmnm.jsonc`, for logging only. Explicit runner 4Rs are observed; SessionStart indexes remain unlogged. Correlation uses nonempty host-provided `CODEX_THREAD_ID`, falling back to `CODEX_SESSION_ID`, otherwise null. Request-supplied session fields are ignored. Each runner process resolves settings and correlation anew.

For an existing enabled local marketplace installation, run `npm run codex:update` after checkout changes. It refreshes stale logger bundles, prepares physical core/parser dependencies, compares adapter/dependency/cache contents, and reinstalls only when needed. It respects `CODEX_HOME`, leaves disabled plugins untouched, and reports when a new session is required. It does not perform first-time setup, run the full suite, or validate live hooks. See [refresh instructions](docs/CODEX_ADAPTER_MANUAL.md#refresh-after-checkout-updates).

`src/logslines.js` binds this adapter to core’s shared logging runtime; it does not contain a separate observer or generated bundle. See the [Logger manual](../../docs/LOGGER.md#source-and-artifact-map) for file roles and build rules.
