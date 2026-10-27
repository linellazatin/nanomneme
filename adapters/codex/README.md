# Nanomneme for Codex

`@openlines/nmnm-codex` is an MCP-free Codex plugin prototype for macOS and Linux. It bundles the prepared checkout core, gives Codex one lazy-loaded `memory` skill backed by a package-relative Node runner, and adds a trusted read-only SessionStart memory index.

The adapter stores canonical records in Nanomneme's standard project database, `./.nanomneme/memory.db`, and standard global database, `~/.local/share/nanomneme/memory.db`. It has no context settings, pins, automatic retention, management CLI, MCP server, or Windows support claim.

## Quick start

### First-time installation

Check out the repository and run these commands from its root with Node 22.19+ and Codex available:

```sh
npm ci
npm run validate
npm run codex:prepare
codex plugin marketplace add /absolute/path/to/nanomneme
codex plugin add nmnm-codex@nanomneme-local
```

Replace the absolute path with this checkout. Start a new Codex session and review/trust the SessionStart hook. Preparation refreshes stale generated runtimes and copies physical core/parser dependencies into the adapter; root workspace links and a global `nmnm` CLI cannot supply dependencies to Codex's cached copy. It does not register or install a plugin, run validation, or require existing Codex setup. See [detailed installation steps](docs/CODEX_ADAPTER_MANUAL.md#first-time-local-marketplace-installation).

### Update an existing installation

After updating the checkout, run these separate commands from its root:

```sh
npm ci
npm run validate
npm run codex:update
```

The updater requires the matching local marketplace and an installed, enabled plugin. It prepares physical dependencies and refreshes stale cached contents, including same-version changes. Start a new session if it reports `reload-required`, and review renewed hook trust prompts. It respects `CODEX_HOME` and leaves disabled plugins untouched. Do not combine commands as `npm run validate codex:update`. See [refresh details](docs/CODEX_ADAPTER_MANUAL.md#refresh-after-checkout-updates).

## Shared opt-in diagnostics

Diagnostics default off. Enable shared `logging.enabled` in `~/.local/share/nanomneme/config.jsonc`. User-level adapter settings can override it. Raw error messages are not redacted. See the [Logger manual](../../docs/LOGGER.md#configuration-and-record-contract) for configuration, record fields, permissions, and privacy boundaries.

Codex uses `$CODEX_HOME/nmnm.jsonc`, defaulting to `~/.codex/nmnm.jsonc`, for logging only. Explicit runner 4Rs are observed; SessionStart indexes remain unlogged. Correlation uses nonempty host-provided `CODEX_THREAD_ID`, falling back to `CODEX_SESSION_ID`, otherwise null. Request-supplied session fields are ignored. Each runner process resolves settings and correlation anew.

`src/logslines.js` binds this adapter to core’s shared logging runtime; it does not contain a separate observer or generated bundle. See the [Logger manual](../../docs/LOGGER.md#source-and-artifact-map) for file roles and build rules.
