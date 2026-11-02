# Codex Adapter Manual

## Scope

The Codex adapter provides four local stdio MCP tools on macOS/Linux using Node 22.19+ with built-in SQLite/FTS5. Direct registration uses a stable absolute launcher path and Codex's session directory. User-level context hooks deliver startup memory context, autoretention guidance and optional prompt reinjection. All model-facing persistence remains MCP; context hooks only read existing stores and maintain disposable cadence state. No core, CLI, UI or database migration is required.

## Install

For an existing marketplace installation, remove the old plugin and obsolete hooks as described under [Migration](#migration-rollback-and-uninstall) before registering the direct server and hooks below.

- Keep the checkout at a stable absolute path without spaces so current repository validation tests run correctly. This restriction concerns existing test URL handling; direct MCP and context-hook installation paths support spaces.
- From the checkout root, run these separate commands:

  ```sh
  npm ci
  npm run validate
  npm run codex:prepare
  ```

Preparation refreshes stale generated runtimes and copies packaged checkout core and the complete locked production dependency tree into the adapter's ignored node_modules. It verifies physical files and package identity/version, preserves unrelated dependencies and removes obsolete managed dependencies. It does not invoke Codex, install repository dependencies, run validation or change personal settings. Missing/mismatched dependencies require npm ci; failures exit nonzero and may retain completed preparation changes.

- Add the following to `$CODEX_HOME/config.toml`, defaulting to `~/.codex/config.toml`. Replace the example installation path with your stable checkout location:

  ```toml
  [mcp_servers.nanomneme]
  command = "node"
  args = ["/absolute/path/to/nanomneme/adapters/codex/mcp/launch.js"]
  env_vars = ["CODEX_HOME", "CODEX_THREAD_ID", "CODEX_SESSION_ID"]
  ```

Leave cwd unset and do not set NMNM_PROJECT_DIR in this registration. Codex launches the server in its session directory; launch.js binds to actual process.cwd even if PWD or NMNM_PROJECT_DIR is stale. The internal mcp/server.js requires explicit binding and is not the installation entrypoint. If node is unavailable on Codex's PATH, replace command with the absolute executable path reported by command -v node. Paths in args are separate arguments and support spaces.

- Add or merge the following into `$CODEX_HOME/hooks.json`, defaulting to `~/.codex/hooks.json`. Preserve unrelated hooks, replace all three installation paths and keep each script path quoted. Use an absolute Node executable here too if needed.

  ```json
  {
    "hooks": {
      "SessionStart": [{
        "hooks": [{
          "type": "command",
          "command": "node \"/absolute/path/to/nanomneme/adapters/codex/hooks/context.js\"",
          "timeout": 10,
          "additionalContextLimit": 0
        }]
      }],
      "UserPromptSubmit": [{
        "hooks": [{
          "type": "command",
          "command": "node \"/absolute/path/to/nanomneme/adapters/codex/hooks/context.js\"",
          "timeout": 10,
          "additionalContextLimit": 0
        }]
      }],
      "SessionEnd": [{
        "hooks": [{
          "type": "command",
          "command": "node \"/absolute/path/to/nanomneme/adapters/codex/hooks/context.js\"",
          "timeout": 3
        }]
      }]
    }
  }
  ```

Use one hook representation per config layer. Inline hooks in config.toml are also supported by Codex; do not duplicate the same hooks there and in hooks.json. SessionStart and UserPromptSubmit use additionalContextLimit: 0 because the adapter enforces injection_budget itself, preserving complete configured guidance instead of Codex spilling it to a file. Choose a reasonable budget. SessionEnd only removes disposable cadence state and emits no context.

- Start Codex from your project, or run `codex --cd /absolute/project`.
- Inspect `/mcp` for `retain_memory`, `recall_memory`, `retrieve_memory` and `remove_memory`.
- Review and trust the three hook definitions through `/hooks`.
- Start a new session so startup context runs.

Codex skips untrusted hooks; a config file alone does not activate context. Hooks must be enabled and allowed by managed host policy. See [official hook configuration and trust](https://learn.chatgpt.com/docs/hooks). No hook-trust bypass is part of normal installation.

Direct MCP registration does not install the optional memory skill. Essential tool usage is in the MCP descriptions/instructions; configured policy and startup context require the hooks above. The adapter is private and installed from a checkout or prepared local artifact, not public npm.

## Native configuration

The complete supported native shape in $CODEX_HOME/nmnm.jsonc, defaulting to ~/.codex/nmnm.jsonc, is:

```jsonc
{
  // Context size per lifecycle event in JavaScript UTF-16 code units.
  "injection_budget": 10000,
  "reinjection": {
    "enabled": true,
    "every_n_prompts": 5
  },
  "logging": {
    "enabled": false
  },
  "autoretention": {
    "enabled": true,
    "always_persist": ["Durable project decisions and conventions"],
    "never_persist": ["Secrets, credentials and transient execution logs"],
    "always_ask": ["Personal information or uncertain long-term preferences"]
  }
}
```

These are synthetic example rules. Existing native configuration files need no format conversion. JSONC comments and trailing commas are accepted. Missing files use defaults. Context configuration files must be regular files no larger than 262144 bytes; malformed JSONC or invalid applicable context settings suppress that event's context. Unknown fields are ignored. Logging is validated separately by the shared logger; an invalid logging field disables logging without invalidating otherwise valid context settings.

| Setting | Default | Validation and effect |
| --- | --- | --- |
| injection_budget | 2000 | Nonnegative safe integer; bounds each event's emitted context, including rules, separators and index. Zero suppresses context without opening stores. |
| reinjection.enabled | false | Boolean; enables counting UserPromptSubmit events and periodic context refresh. |
| reinjection.every_n_prompts | 5 | Positive safe integer; inject on every Nth eligible prompt per session/workspace. MCP calls do not advance it. |
| autoretention.enabled | false | Boolean; renders configured guidance when enabled and rules exist. |
| autoretention.always_persist | [] | Array of nonempty strings; guides retention when applicable. |
| autoretention.never_persist | [] | Array of nonempty strings; prohibits automatic retention for matching cases. |
| autoretention.always_ask | [] | Array of nonempty strings; asks before retention for matching cases. |
| logging.enabled | false shared default | Boolean; user adapter setting overrides the shared logging default. |

Project settings live at `<session-cwd>/.nanomneme/nmnm.jsonc`. Project scalar fields override user fields individually; an omitted field inherits the user value, then the default. Rule arrays merge user-first then project with exact-string deduplication, preserving each complete rule. Project autoretention.enabled can disable inherited guidance. Never rules take precedence over ask rules; ask rules take precedence over automatic retention. Project configuration cannot enable diagnostics; the shared ~/.local/share/nanomneme/config.jsonc supplies logging defaults and only user adapter configuration can override them.

Context settings reload on each lifecycle event. Logging settings resolve at the first observed MCP operation and remain fixed until that server connection restarts. Editing reinjection settings preserves the current count: disabled events and invalid settings do not advance it; enabled events with zero budget still count. A due event advances before building context, so a store/context failure does not stall cadence. SessionStart emits context independently of the cadence and does not reset it.

Enabled autoretention guidance is placed before memory previews and shares their budget. If complete guidance cannot fit a positive budget, the event emits no context rather than partial rules. The remaining budget holds up to twenty recent project records followed by up to twenty global records, with complete rows and bounded previews. Missing stores stay absent; stores open read-only and are never migrated by context generation. Memory index text is marked as data, not instructions. Guidance asks the model to use MCP; it is not an automatic writer or a deterministic content-policy enforcement engine.

Cadence state lives in a private `nmnm-codex-<uid>` directory under the platform temporary directory. Its filename hashes home, adapter config path, canonical workspace and session ID; it stores only a count and an optional host turn ID, never prompts, rules or memory content. SessionEnd removes that session/workspace state. Temporary cleanup or session end resets cadence; old state for a previous workspace can be discarded by temporary-directory cleanup. Concurrent duplicate deliveries with a host turn ID are deduplicated; lock contention fails open rather than waiting. An interrupted writer can leave a lock; with Codex stopped, remove the disposable `nmnm-codex-<uid>` directory to reset all cadence. Do not use this state as canonical memory.

## Host approval policy

remove_memory is marked destructive and follows Codex approval policy. Interactive Codex can request approval; a noninteractive policy can reject the call before the adapter runs, producing no memory outcome log. Do not assume a host rejection is a storage failure. For an explicitly authorized unattended workflow, the direct-server per-tool policy is:

```toml
[mcp_servers.nanomneme.tools.remove_memory]
approval_mode = "approve"
```

This approves removal for that configured server; auto retains the host's inferred behavior. Configure it only when intended. See [official MCP configuration](https://learn.chatgpt.com/docs/extend/mcp).

## Refresh after checkout updates

These steps apply to an existing direct MCP installation. Marketplace-plugin installations require [migration](#migration-rollback-and-uninstall) first.

- Update the checkout.
- From its root, run these separate commands:

  ```sh
  npm ci
  npm run validate
  npm run codex:update
  ```
- Restart Codex to load the updated server and hooks.
- Review any changed hook definitions through `/hooks`.

codex:update refreshes stale generated runtimes, prepares physical locked dependencies and reports restart-required. It does not inspect marketplaces, install plugins, modify registrations, change hook trust or reload running servers. The absolute entrypoint stays stable while the checkout stays in place. Repeated preparation reports dependency freshness even when versions are unchanged. Validation remains separate; npm run validate codex:update is invalid.

The equivalent direct tooling entrypoint is node scripts/maintenance.js codex:update. The compatible node scripts/check-logging-packages.js --prepare-codex path validates standalone packages first, then prepares physical dependencies. See the [Logger manual](../../../docs/LOGGER.md) for generation and upstream maintenance.

## Install from a packed local artifact

- Prepare the checkout using the commands under [Install](#install).
- Choose a new, empty installation directory.
- From the checkout root, pack and extract the adapter. Replace `ADAPTER_TARBALL.tgz` with the filename printed by npm pack and substitute your installation directory:

  ```sh
  npm pack --workspace @openlines/nmnm-codex
  mkdir -p "/absolute/path/to/nmnm-codex"
  tar -xzf "ADAPTER_TARBALL.tgz" --strip-components=1 -C "/absolute/path/to/nmnm-codex"
  ```
- Use the MCP registration and hook configuration from [Install](#install), registering `/absolute/path/to/nmnm-codex/mcp/launch.js` and using `/absolute/path/to/nmnm-codex/hooks/context.js` in all three hook commands.

The strip option removes npm's `package/` prefix, placing `mcp/launch.js` and `hooks/context.js` directly under the installation directory. The prepared artifact bundles its production dependency closure; no global CLI or workspace link supplies runtime imports. Do not move or overwrite it while a server is running. Registration and hook trust are separate from tarball validation.

## Migration, rollback and uninstall

### Migrate from the marketplace plugin

- Run `codex plugin list` to identify the installed registration.
- Remove the old plugin before adding the direct server and hooks. For the former repository-local registration, run `codex plugin remove nmnm-codex@nanomneme-local`; substitute the actual marketplace if different.
- Remove old Nanomneme hook definitions and duplicate direct server entries, preserving unrelated configuration.
- Follow [Install](#install) to configure the direct MCP server and context hooks.
- Start a new session and check `/mcp` for exactly one Nanomneme server.

This checkout no longer supplies a marketplace, plugin manifest or .mcp.json. The old runner protocol has no compatibility shim; existing project/global databases remain usable.

### Roll back

- Stop Codex.
- Select a verified compatible release checkout with its matching lockfile.
- Prepare that checkout and follow that release's installation procedure.

Keep store backups independent of installation directories.

### Uninstall

- Remove the `nanomneme` server table from your active user MCP configuration.
- Remove this adapter's `SessionStart`, `UserPromptSubmit` and `SessionEnd` handlers from your hook configuration, preserving unrelated handlers.
- Remove the optional memory skill separately if you installed it.
- Restart Codex.

Preserve unrelated registrations/hooks, `nmnm.jsonc` and both memory stores.

## MCP operations and boundaries

retain_memory creates Codex-provenanced records or patches an explicit ID with mutable fields. Patches preserve metadata/provenance and reject replacement metadata. recall_memory reads an active record; retrieve_memory searches/lists previews; remove_memory soft-removes only. All select store: project or global, defaulting to project; explicit retain scope must match the store. Arbitrary database paths, purge and management operations are unavailable. Reads and missing-target removal do not create stores. Preserve the original store when patching, recalling or removing.

Project memory is `<session-cwd>/.nanomneme/memory.db`; global memory is ~/.local/share/nanomneme/memory.db. Stores remain shared with other adapters, CLI and UI. Use the separate CLI/workbench for transfer, backup, verification, repair and explicit purge. Pins are separate adapter state and are not introduced by native nmnm.jsonc support.

Retrieval defaults to five previews and caps at twenty, with 160-code-point previews. Follow next_offset or narrow selectors at pagination_limited. Recall returns small canonical records directly; large records use lossless record_json pages of up to 4096 Unicode code points. Concatenate pages with matching updated_at and parse JSON; restart if it changes. Cross-call snapshots are not atomic. New retained content is limited to 16384 code points and metadata including provenance to 8192 UTF-8 bytes; existing records are not truncated.

Serialized responses cap at 65536 UTF-8 bytes and arguments at 131072 bytes. Handler errors return bounded JSON with isError; MCP setup/protocol diagnostics use bounded stderr and stdout stays protocol-only. Do not blindly retry mutations after a lost response. Context hooks accept at most 1048576 input bytes, validate the payload's absolute existing cwd and nonempty session ID, and fail open with no context on errors. They never use stale project environment variables as a workspace fallback.

## Shared opt-in diagnostics

Diagnostics default off and use the Logslines nmnm-codex component. Only handler-executed MCP 4Rs are observed once; discovery, schema rejection and context hooks are outside this operation log. Correlation uses nonempty launch-provided CODEX_THREAD_ID, then CODEX_SESSION_ID, otherwise null. A process-wide value does not establish per-turn identity. Logging failures cannot change operation results; existing raw error messages remain unredacted. See the [Logger manual](../../../docs/LOGGER.md#configuration-and-record-contract) for settings, permissions, privacy and source/artifact roles.

## Troubleshooting and validation

If /mcp shows zero tools, check the absolute launch.js path, Node executable, dependency preparation and server stderr. Leave cwd unset; a plugin-cache cwd or manually fixed project environment is not the direct delivery contract. Auth: Unsupported is normal for local stdio. If tools work but context is absent, inspect /hooks trust/enablement, user hook paths, nmnm.jsonc validity and budget; MCP registration alone does not install hooks.

From the repository root:

- Run `node --test adapters/codex/test/*.test.js` for the focused adapter tests.
- Run `npm run validate` for generated checks, the full suite, production audit and independent package validation.

Validation executes MCP operations and context hooks from independently installed/copied artifacts. Native CLI 0.166.0 on macOS loaded the packed artifact from a spaced installation path after normal /hooks trust review. A local deterministic provider fixture verified startup context, actual prompt cadence, configuration reload/budget boundaries, session cleanup and 14 project/global MCP calls. Concurrent native sessions verified store isolation; default removal rejection preceded adapter logging. This establishes bounded host delivery and adapter semantics, not real-model compliance, desktop/IDE, Windows or other-provider behavior.

## Developer notes

These are current limitations and proposed future updates, not installed features or an approved implementation plan. Keep follow-up work within the Codex adapter and supporting tests/documentation unless a wider change is separately reviewed.

### Session correlation

The live MCP connection logged operations correctly but received no launch-provided session ID, leaving `context.session_id: null`. Forwarding environment variables does not make Codex populate them. Pi obtains identity from its session manager; OpenCode's server tools receive the host tool-context session ID. Codex's stdio process currently lacks an equivalent verified per-call binding. Existing hooks receive a host session ID, but that does not automatically associate it with an MCP request.

- Prototype a trusted per-invocation bridge from a Nanomneme `PreToolUse` hook to the MCP handler. [Codex hooks](https://learn.chatgpt.com/docs/hooks#pretooluse) document replacement MCP arguments through `updatedInput`; using that transport for correlation remains unproven.
- Authenticate and bind any internal envelope to the exact invocation, validate it before accepting identity, and remove it before normal argument validation. Never trust a model-supplied session ID or use a shared latest-session value keyed only by workspace.
- Verify concurrent identical calls, multiple sessions in one workspace, stale/replayed envelopes, hook absence and failure handling. Preserve one canonical operation log and `null` when trusted identity is unavailable; do not derive identity from cwd, PID or a generated UUID.

Estimated complexity: moderate, subject to a native-host feasibility gate. Recheck current host metadata support before introducing a bridge; do not promise this mechanism until transport, validation order and concurrency are demonstrated.

### Autoretention enforcement

`always_persist`, `never_persist` and `always_ask` are prose guidance delivered to the active model, with never/ask/automatic precedence. The MCP write handler does not classify content or verify consent. Pi likewise documents model-guided retention; its native controls do not establish deterministic enforcement of these prose rules. Hard enforcement is a proposed capability, not an existing parity guarantee.

- Keep existing prose rules as guidance. Consider a separate optional structured write policy for explicit predicates such as namespaces, fields or defined patterns; enforce it inside the MCP handler for creates and patches, including the effective updated record.
- Require verifiable user approval for writes covered by an approval rule. A model-supplied approval flag is insufficient. [Codex MCP approval controls](https://learn.chatgpt.com/docs/extend/mcp) can prompt for non-read-only tools, but blanket write approval is different from selective content-based approval.
- Prove the approval route before implementation. Current hook documentation does not support `PreToolUse`'s `permissionDecision: "ask"`; do not rely on it. Test denial, missing/expired approval, changed content and policy precedence without exposing memory payloads in logs.

Estimated complexity: moderate for deterministic restrictions, moderate to high for selective verified approval. Pattern checks cannot perfectly classify broad concepts such as personal data or secrets, and `always_persist` cannot guarantee that the model notices every eligible fact. These controls would govern Nanomneme MCP writes, not native Codex memory generation, other adapters or separate CLI/UI writes.
