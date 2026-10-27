# Claude Code Adapter Manual

`nmnm-claude` is the Claude Code harness adapter for nanomneme. It is a plugin that gives Claude native memory tools over a local stdio MCP server calling the generated core runtime bundled with the plugin, plus bounded memory injection at session start. SQLite stays the storage authority; the adapter never parses the `nmnm` CLI. Memory is shared with Pi and other adapters; only pins and the harness surface are Claude-specific.

## Install

The plugin lives at `adapters/claude` inside the nanomneme monorepo. Claude Code installs plugins through a **marketplace** (`.claude-plugin/marketplace.json`), which this repo ships at its root; the plugin manifest (`adapters/claude/.claude-plugin/plugin.json`) alone only supports local dev loading. On enable, Claude reads the bundled `.mcp.json`, `hooks/hooks.json`, `skills/memory-guide/SKILL.md`, and `commands/memory.md`.

**Prerequisite:** Node.js 22.13+ (built-in `node:sqlite` with FTS5). The plugin runs Node subprocesses with full local-system access (an MCP server and two command hooks); review the source before installing.

### Option A: Install from the marketplace (recommended)

1. Add the nanomneme marketplace. Use the GitHub shorthand (or a local checkout path for testing):

   ```
   /plugin marketplace add linellazatin/nanomneme
   ```
   ```
   /plugin marketplace add ./path/to/nanomneme      # local checkout
   ```

2. Install the plugin. The address is `<plugin>@<marketplace>` — the plugin is `nanomneme`, the marketplace is `openlines`:

   ```
   /plugin install nanomneme@openlines
   ```

   Or run `/plugin`, pick the `openlines` marketplace, and install from the menu.

3. Current Claude Code automatically installs Node dependencies for copied marketplace plugins from the plugin-local `package.json` and `package-lock.json`, with frozen resolution and lifecycle scripts disabled. The adapter bundles generated core and logging runtimes; its registry-only lock covers external dependencies, not core. It can be validated and distributed before core is published to npm. For a marketplace added from a local path, the plugin loads in place instead: run `npm ci` at the monorepo root yourself. See [Claude's dependency installation rules](https://code.claude.com/docs/en/plugins/loading#node-js-package-dependencies).

4. Restart or start a new session. Confirm the four tools appear as `mcp__plugin_nanomneme_memory__*` (see [Native MCP tools](#native-mcp-tools)) and that a fresh session injects the memory index.

To update later: `/plugin marketplace update openlines`, then update the plugin. Copied plugins with an explicit unchanged manifest version retain their cached files, so a dependency-lock update must accompany a plugin version increase. If dependency installation fails, inspect the note in `/plugin` or `claude plugin list`; the plugin may load while its Node components remain unavailable. A checkout root install does not repair a separate copied cache.

### Option B: Local development loading

From a checkout, install workspace dependencies and load the plugin directory directly without a marketplace:

```sh
npm ci
```

Then add the local marketplace and install, or point Claude Code at the plugin directory per your setup. This is the fastest path while iterating on the adapter itself.

Public npm publication of the adapter is deferred.

### Refresh bundled runtimes and external dependencies

Core and logging implementations are generated into `src/core-runtime.generated.js` and `src/logging-runtime.generated.js`, with core-version stamps and bundled license notices. They come from the checkout's core/shared logger sources; do not edit them directly or add a registry core dependency. After core code/version/license, shared logger, parser, or upstream changes, run:

```sh
npm run logslines:build -- --fast
npm run validate
```

Commit the affected generated files with their source changes. The read-only generator check rejects stale or missing artifacts; standalone validation installs a disposable copied plugin with `npm ci --ignore-scripts`, audits its external dependencies, runs the full core contract against the bundled runtime, runs Claude's tests, and exercises stdio MCP and the management CLI. No registry core package is installed. These checks do not establish native copied-cache installation, hook registration, or provider behavior.

For external dependency updates, copy only Claude's `package.json` and `package-lock.json` into a standalone temporary directory outside the monorepo, run `npm update --package-lock-only --ignore-scripts` there, review registry URLs/integrity and transitive changes, then copy the lock back. Synchronize changed manifest metadata with the root lock and rerun validation. Keep package/plugin versions aligned when preparing a new distribution; core publication is no longer part of this process.

## Native MCP tools

The stdio MCP server (`mcp/server.js`) registers four model-facing tools. Claude namespaces them by plugin name and server key, so they appear as `mcp__plugin_nanomneme_memory__<tool>`:

| Tool | Input | Description | Notes |
|---|---|---|---|
| `retain_memory` | `content`; optional `id`, canonical fields | Create, or patch and restore a known ID. | New records require `content`; scope selects the matching write store. |
| `recall_memory` | `id`; optional `store` | Read one active, unexpired memory. | Canonical core JSON or `null`; missing stores stay absent. |
| `retrieve_memory` | Optional `query`, filters, ordering, pagination, `store` | Search or list active memories. | One store only; missing stores return `{ total: 0, items: [] }`. |
| `remove_memory` | `id`; optional `store` | Soft-remove an active memory. | Reversible via a retain patch; purge requires CLI or UI workbench action; missing stores return `null`. |

For `retain_memory`, omitted scope means the project store and `scope: "global"` means the global store. Scope is trimmed and validated before selecting or creating a store; invalid values fail without creating a database. The other tools accept `store` (`"project"` or `"global"`) to select a physical database. Project data is `./.nanomneme/memory.db`; global data is `~/.local/share/nanomneme/memory.db` on Linux and macOS. Results are canonical core JSON. Only `retain_memory` creates a missing store; reads and removal leave missing stores absent. The server resolves the project directory from `NMNM_PROJECT_DIR`, set to `${CLAUDE_PROJECT_DIR}` in `.mcp.json`, falling back to the process working directory.

Core hardening introduced in `0.3.0` passes through unchanged: Unicode/structured search, malformed-text and numeric-range validation, private first-use storage, and monotonic mutation timestamps. Handler tests cover validation rejections and project/global first-use creation; clock tests use frozen and backward mocks across reopened stores. Validation throws reach Claude Code as MCP tool errors with the core message verbatim and never crash the server. Retain still accepts null metadata (new records add the `claude-code` source; patches normalize it to `{}`); null rejection applies to core import/verification. Export/import/verification remain `nmnm` CLI operations, not adapter tools.

The `memory-guide` Skill (invoked as `/nanomneme:memory-guide`) teaches the model when to use these tools, how to choose project vs global scope, and which facts not to retain. It is named `memory-guide`, not `memory`, so it does not collide with the `/nanomneme:memory` management command below (a plugin skill and a command that share a name resolve to the same slash invocation, and the command would win).

## Session-start injection

A `SessionStart` command hook (`hooks/session-start.js`) appends bounded Nanomneme context to the session as transient `additionalContext`. Enabled autoretention guidance comes first, followed by a compact index listing project pins, then global pins, then recent active records from each store. Rows contain `store`, a `[source]` label when recorded, ID, and a short content preview. The index is not a transfer of complete records; the model uses `recall_memory` or `retrieve_memory` for full content.

New Claude Code retains record `metadata.source` as `"claude-code"`. **Note:** ID-based patches preserve existing source when metadata is omitted; older or externally created records have no source label unless they already carry one.

Injection is a command hook using the plugin's generated core runtime under Node, so it works during the launch window when MCP tools are not yet available. Index reads are read-only and never create or migrate a database. Missing databases are empty. Missing, removed, expired, or unreadable pins are skipped and counted as unresolved; the pin stays configured until explicitly unpinned. The hook is wrapped so a failure never blocks startup.

### Reinjection

A `UserPromptSubmit` command hook (`hooks/prompt-submit.js`) can rebuild the same bounded context on a fixed cadence. It is **disabled by default**. The hook reads project/global settings first; disabled reinjection accesses neither pins/databases nor session-state files. Project settings override global settings. When enabled, it advances an ephemeral per-session prompt counter under the system temp directory and builds memory context only every `every_n_prompts` eligible prompts (default 5). Disabling leaves existing state untouched; re-enabling resumes its count. Unusable saved counters restart at zero. Context-build failures emit nothing but still advance the enabled counter so repaired memory can recover on a later cadence; malformed settings emit nothing and leave state untouched. Reinjection adds no timers, workers, or canonical memory writes.

## Memory management command

A deterministic, model-free management surface complements the model-facing MCP tools. `bin/memory.js` reuses the shared store and context helpers (no model, worker, or network) and prints text:

| Command | Output |
|---|---|
| `status` | Injection budget/current/unresolved, reinjection policy, autoretention counts, pin counts, per-store totals. |
| `list [project\|global] [limit] [offset] [--source all\|claude-code]` | Active memories, project rows before global, `*` marks pins. Defaults to both stores, limit 20; `all` includes legacy records without a source. |
| `search <query> [project\|global] [limit] [offset] [--source all\|claude-code]` | Same listing, filtered by an FTS query and optional source. |
| `show [project\|global] <id>` | Full record detail for one memory. |
| `pin` / `unpin` `[project\|global] <id>` | Edit the adapter `nmnm-claude.json` pin file. |
| `remove [project\|global] <id>` | Reversible soft removal (purge requires CLI or UI workbench action). |

When the store is omitted, `show`/`pin`/`remove` resolve the ID from active memories; `unpin` resolves it from pin files, including unresolved targets. Matches in both stores require an explicit project or global selection. Reads never create a store; `pin`/`unpin`/`remove` are deterministic writes.

Two ways to run it:

- **`/nanomneme:memory <args>`** — a slash command (`commands/memory.md`) that embeds the script via bash execution and relays its output verbatim. This is the closest match to Pi's `/memory list` / `status`. Claude Code slash commands are prompt templates, not native dialogs, so the data is deterministic and model-free but the final relay still passes through the model; there is no interactive navigation like Pi's browser.
- **`! node ${CLAUDE_PLUGIN_ROOT}/bin/memory.js <args>`** — invoking the CLI with the `!` prefix runs it and shows output with no model turn at all: a fully model-free path.

The command resolves the project store from `NMNM_PROJECT_DIR`/`CLAUDE_PROJECT_DIR` (falling back to the working directory) and the global store at `~/.local/share/nanomneme/memory.db`, matching the MCP server and hooks. `CLAUDE_PLUGIN_DATA` selects global adapter settings only; global pins stay at `~/.local/share/nanomneme/nmnm-claude.json`, independently of that variable.

## Configuration

Two file types, mirroring the Pi adapter. Settings are hand-authored and read-only; pins are adapter-owned.

### Settings — `nmnm.jsonc`

JSONC, validated read-only at load. Invalid JSONC or out-of-contract values raise an error that is caught so it never blocks startup; correct the file and it applies on the next load. Locations:

- **Project** (shared across adapters): `<project>/.nanomneme/nmnm.jsonc`. Pi and Claude share this file. Resolved relative to the working directory, so it always applies.
- **Global**: `${CLAUDE_PLUGIN_DATA}/nmnm.jsonc`. Under a real plugin install Claude Code sets `CLAUDE_PLUGIN_DATA` to the per-plugin data directory, so the effective file is `~/.claude/plugins/data/<plugin>-<marketplace>/nmnm.jsonc` — currently `~/.claude/plugins/data/nanomneme-openlines/nmnm.jsonc`. `~/.claude/nmnm.jsonc` is used **only** as a fallback when `CLAUDE_PLUGIN_DATA` is unset (e.g. running a hook by hand in a shell); the running plugin does not read it.

  Note this global location is per-plugin: it is **not** shared with Pi or other adapters, and it moves if the plugin or marketplace is renamed (the directory name is `<plugin>-<marketplace>`). For settings you want shared with Pi, or that should survive a rename, prefer the project `.nanomneme/nmnm.jsonc`.

Project settings override global. Complete settings template:

```jsonc
{
  // Character budget for all transient injected context (index + autoretention).
  // Non-negative integer. Default 2000.
  "injection_budget": 2000,

  // Periodic reinjection on UserPromptSubmit. Disabled by default.
  "reinjection": {
    "enabled": false,
    // Positive integer cadence in eligible prompts. Default 5.
    "every_n_prompts": 5
  },

  // Opt-in guidance for the model's own retain_memory calls. No nested model,
  // worker, or direct SQLite write. Global and project rule arrays combine;
  // never_persist takes precedence over all other rules.
  "autoretention": {
    "enabled": false,
    "always_persist": [],
    "never_persist": [],
    "always_ask": []
  }
}
```

`injection_budget` bounds the index plus any autoretention guidance together; a rule is never partially emitted, and guidance that alone exceeds the budget is an error. Autoretention only guides the active model; the model remains the sole decision maker and calls `retain_memory` itself.

### Pins — `nmnm-claude.json`

JSON array of memory IDs, adapter-owned (per-adapter, not shared). Memory itself is shared; pins are not. Locations:

- **Project**: `<project>/.nanomneme/nmnm-claude.json`.
- **Global**: `~/.local/share/nanomneme/nmnm-claude.json`.

Pinned memories are injected first, in store order (project then global). Edit pins with `/nanomneme:memory pin`/`unpin` (see [Memory management command](#memory-management-command)), or by editing the pin files directly. MCP tools manage memories, not pins.

Pin mutations use a same-directory lock and atomic replacement. Competing writers receive a retry error; locks are never reclaimed automatically. After a crash, stop all adapter writers, remove the affected pin file’s `.lock` manually, then retry.

## Safety boundaries

- Model-facing `remove_memory` is soft-only and reversible; irreversible purge requires an explicit CLI (`nmnm remove --purge`) or UI workbench action.
- Reads and removal never create a missing store; only `retain_memory` does.
- Injection is transient context, never a persistent session-message snapshot or an automatic memory write.
- The adapter never writes SQLite directly or parses CLI output; all operations go through `nmnm-core`.
- Do not commit `.nanomneme/`, personal global databases, or pin files with local data.

## Cross-adapter use

Memory retained through Claude is readable by the Pi adapter and the `nmnm` CLI against the same store. For the global store:

```sh
node packages/nmnm-cli/bin/nmnm.js retrieve "<query>" --global
```

Runtime code and tests are authoritative when this manual disagrees with behavior.

## Shared opt-in diagnostics

Diagnostics default off. Enable shared `logging.enabled` in `~/.local/share/nanomneme/config.jsonc`. User-level adapter settings can override it. Raw error messages are not redacted. See the [Logger manual](../../../docs/LOGGER.md#configuration-and-record-contract) for configuration, record fields, permissions, and privacy boundaries.

Claude uses its existing user settings resolver (`CLAUDE_PLUGIN_DATA` when supplied, otherwise `~/.claude/nmnm.jsonc`). Explicit MCP 4Rs and management mutations are observed; context hooks and read-only management are unlogged. Restart the MCP process to refresh cached settings. Correlation is null.

`src/logslines.js` supplies the adapter-specific logging binding. The [Logger manual](../../../docs/LOGGER.md#source-and-artifact-map) owns the shared source, generated-artifact, and package-check reference.
