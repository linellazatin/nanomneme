# Nanomneme for Codex

`@openlines/nmnm-codex` supplies local memory through four native stdio MCP tools on macOS and Linux. It bundles the prepared checkout core and MCP runtime dependencies. Direct registration launches an absolute entrypoint from a stable installation and binds memory to the actual Codex session working directory.

The adapter uses the standard project database, `<project>/.nanomneme/memory.db`, and global database, `~/.local/share/nanomneme/memory.db`. Existing records need no migration. Native context hooks support startup context and configured prompt reinjection; all memory writes use MCP. No Windows support is claimed.

## Quick start

Existing marketplace-plugin users must follow the [migration procedure](docs/CODEX_ADAPTER_MANUAL.md#migration-rollback-and-uninstall) before adding the direct server or hooks.

### First-time installation

Check out the repository at a stable path without spaces and run these commands from its root with Node 22.19+ and Codex available. The checkout restriction avoids existing repository-test URL handling failures; the direct adapter entrypoints themselves support spaced installation paths.

```sh
npm ci
npm run validate
npm run codex:prepare
```

Add this server to `$CODEX_HOME/config.toml`, defaulting to `~/.codex/config.toml`, replacing the absolute path with the stable checkout location:

```toml
[mcp_servers.nanomneme]
command = "node"
args = ["/absolute/path/to/nanomneme/adapters/codex/mcp/launch.js"]
env_vars = ["CODEX_HOME", "CODEX_THREAD_ID", "CODEX_SESSION_ID"]
```

Leave `cwd` unset so Codex supplies the session directory. Start Codex normally from your project, or use `codex --cd /absolute/project`; no `NMNM_PROJECT_DIR` export is required. The launcher uses the actual process directory even if inherited `PWD` or `NMNM_PROJECT_DIR` is stale. Check `/mcp` for the four tools. Direct MCP registration does not install the optional memory skill. Preparation copies the complete production runtime dependency tree without registering a server or changing personal configuration.

For full native configuration behavior, merge the three context hook handlers from the [installation guide](docs/CODEX_ADAPTER_MANUAL.md#install) into `$CODEX_HOME/hooks.json`, defaulting to `~/.codex/hooks.json`. They run the stable `adapters/codex/hooks/context.js` entrypoint for `SessionStart`, `UserPromptSubmit` and `SessionEnd`. Review/trust them through `/hooks`, then start a new session. MCP registration alone supplies the tools; the hooks deliver startup context, configured autoretention guidance and actual prompt cadence.

### Native configuration

Create or keep `$CODEX_HOME/nmnm.jsonc`, defaulting to `~/.codex/nmnm.jsonc`. The complete supported shape is:

```jsonc
{
  "injection_budget": 10000,
  "reinjection": { "enabled": true, "every_n_prompts": 5 },
  "logging": { "enabled": false },
  "autoretention": {
    "enabled": true,
    "always_persist": ["Durable project decisions"],
    "never_persist": ["Secrets and transient logs"],
    "always_ask": ["Personal information"]
  }
}
```

Comments/trailing commas are supported. Project settings at `.nanomneme/nmnm.jsonc` override individual scalar fields and merge/deduplicate rule arrays. Context defaults are a 2000-character budget with reinjection and autoretention disabled; logging defaults off. Context reloads per event; logging changes require server restart. Never rules take precedence over ask rules, then automatic retention. Rules guide the model to use MCP; they do not create an autonomous writer. See [all defaults, validation, budgets and lifecycle behavior](docs/CODEX_ADAPTER_MANUAL.md#native-configuration).

### Update an existing installation

For an existing direct MCP installation, update the checkout and run these separate commands from its root. These commands do not migrate a marketplace-plugin installation.

```sh
npm ci
npm run validate
npm run codex:update
```

The updater prepares physical locked dependencies and reports `restart-required`. It never invokes Codex or changes registration/hook trust; the stable paths keep working while the checkout stays in place. Restart Codex and review changed hook definitions. Do not combine commands as `npm run validate codex:update`. See [refresh details](docs/CODEX_ADAPTER_MANUAL.md#refresh-after-checkout-updates).

## MCP tools

Direct registration launches `mcp/launch.js` by absolute path with no configured cwd. The launcher selects its actual process directory; `mcp/server.js` is the strict internal entrypoint. Remove the old marketplace plugin and duplicate hook/server registrations before migrating; see [migration and uninstall](docs/CODEX_ADAPTER_MANUAL.md#migration-rollback-and-uninstall).

The tools are `retain_memory`, `recall_memory`, `retrieve_memory` and `remove_memory`. All select `store: "project"` by default; global stores are supported on macOS/Linux. Retain creates Codex-provenanced records or patches an explicit ID while preserving metadata; patches reject replacement metadata. Explicit scope must match the selected store. Remove is soft-only. Reads and missing-target removal do not create stores. Retrieval defaults to five previews, caps at twenty, and reports `next_offset` or `pagination_limited`; narrow selectors when the core paging ceiling is reached.

Recall returns small canonical records directly. Large records return `record_json` pages of at most 4,096 Unicode code points, including metadata; concatenate pages with the same `updated_at` and parse JSON to recover the record. Restart paging if it changes. No atomic snapshot across calls is promised. New retained content is limited to 16,384 code points and metadata to 8,192 UTF-8 bytes; these write limits do not truncate existing stored records.

MCP diagnostics reuse the same opt-in configuration and Logslines component below. Logging settings resolve on the first observed operation and remain fixed until server restart; correlation uses launch-supplied host values, otherwise null. Invalid tool schemas are rejected before operation observation; handler-level failures are observed once. Protocol/setup errors use bounded stderr, and MCP stdout carries only protocol messages. Context hooks emit separate bounded lifecycle output and do not log memory operations.

## Shared opt-in diagnostics

Diagnostics default off. Enable shared `logging.enabled` in `~/.local/share/nanomneme/config.jsonc`. User-level adapter settings can override it. Raw error messages are not redacted. See the [Logger manual](../../docs/LOGGER.md#configuration-and-record-contract) for configuration, record fields, permissions, and privacy boundaries.

Codex reads `logging.enabled` from the same native `$CODEX_HOME/nmnm.jsonc`; project settings cannot enable logging. Handler-executed 4Rs are observed once. Correlation uses nonempty launch-provided `CODEX_THREAD_ID`, falling back to `CODEX_SESSION_ID`, otherwise null; request-supplied correlation is rejected. Each connection fixes logging settings at its first observed operation; restart to adopt configuration changes. Discovery, schema rejection and context hooks remain outside memory logging.

`src/logslines.js` binds this adapter to core’s shared logging runtime; it does not contain a separate observer or generated bundle. See the [Logger manual](../../docs/LOGGER.md#source-and-artifact-map) for file roles and build rules.

## Validation

Run `node --test adapters/codex/test/*.test.js` from the repository root, then `npm run validate` for generated checks, the full suite, production audit and independent package validation. Installed and copied artifacts exercise both MCP and context hooks. Native Codex CLI 0.166.0 on macOS loaded an independently packed artifact from a spaced path, accepted normal hook trust review, delivered bounded context and actual prompt cadence, and completed 14 project/global MCP calls through a local deterministic provider fixture. These checks establish host delivery and adapter semantics; real-model compliance, other providers and desktop/IDE behavior require separate evidence.

Removal is marked destructive and follows host approval policy. Noninteractive `codex exec` with approvals disabled may reject it before adapter execution; such rejection produces no memory log. Deliberate per-tool approval configuration is described in the [manual](docs/CODEX_ADAPTER_MANUAL.md#host-approval-policy).
