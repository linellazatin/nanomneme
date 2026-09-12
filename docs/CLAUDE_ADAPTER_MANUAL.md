# Claude Code Adapter Manual

`nmnm-claude` is the Claude Code harness adapter for nanomneme. It is a plugin that
gives Claude native memory tools over a local stdio MCP server calling `nmnm-core`
directly, plus bounded memory injection at session start. SQLite stays the storage
authority; the adapter never parses the `nmnm` CLI. Memory is shared with Pi and other
adapters; only pins and the harness surface are Claude-specific.

## Install

The plugin lives at `adapters/claude` inside the nanomneme monorepo. Claude Code installs
plugins through a **marketplace** (`.claude-plugin/marketplace.json`), which this repo ships
at its root; the plugin manifest (`adapters/claude/.claude-plugin/plugin.json`) alone only
supports local dev loading. On enable, Claude reads the bundled `.mcp.json`,
`hooks/hooks.json`, `skills/memory-guide/SKILL.md`, and `commands/memory.md`.

**Prerequisite:** Node.js 22.13+ (built-in `node:sqlite` with FTS5). The plugin runs Node
subprocesses with full local-system access (an MCP server and two command hooks); review the
source before installing.

### Option A: Install from the marketplace (recommended)

1. Add the nanomneme marketplace. Use the GitHub shorthand (or a local checkout path for
   testing):

   ```
   /plugin marketplace add linellazatin/nanomneme
   ```
   ```
   /plugin marketplace add ./path/to/nanomneme      # local checkout
   ```

2. Install the plugin. The address is `<plugin>@<marketplace>` — the plugin is `nanomneme`,
   the marketplace is `openlines`:

   ```
   /plugin install nanomneme@openlines
   ```

   Or run `/plugin`, pick the `openlines` marketplace, and install from the menu.

3. Install the plugin's Node dependencies once. Claude Code does not run `npm install` for
   plugins, so the MCP server needs `@modelcontextprotocol/sdk`, `zod`, and `nmnm-core`
   resolvable. `nmnm-core` is an unpublished workspace package, so run `npm install` at the
   **monorepo root** (the parent of `adapters/claude` in the cloned marketplace repo, one
   level up from the plugin path `/plugin` shows), which links `nmnm-core` through npm
   workspaces:

   ```sh
   npm install
   ```

   Node resolves the plugin's imports by walking up to the monorepo `node_modules`, so a
   root install covers `adapters/claude`.

4. Restart or start a new session. Confirm the four tools appear as
   `mcp__plugin_nanomneme_memory__*` (see [Native MCP tools](#native-mcp-tools)) and that a
   fresh session injects the memory index.

To update later: `/plugin marketplace update openlines`, then reinstall if a new version is
published.

### Option B: Local development loading

From a checkout, install workspace dependencies and load the plugin directory directly
without a marketplace:

```sh
npm install
```

Then add the local marketplace and install, or point Claude Code at the plugin directory per
your setup. This is the fastest path while iterating on the adapter itself.

Public npm publication of the adapter is deferred.

## Native MCP tools

The stdio MCP server (`mcp/server.js`) registers four model-facing tools. Claude
namespaces them by plugin name and server key, so they appear as
`mcp__plugin_nanomneme_memory__<tool>`:

| Tool | Input | Description | Notes |
|---|---|---|---|
| `retain_memory` | `content`; optional `id`, canonical fields, `store` | Create, or patch and restore a known ID. | New records require `content`. |
| `recall_memory` | `id`; optional `store` | Read one active, unexpired memory. | Canonical core JSON or `null`; missing stores stay absent. |
| `retrieve_memory` | Optional `query`, filters, ordering, pagination, `store` | Search or list active memories. | One store only; missing stores return `{ total: 0, items: [] }`. |
| `remove_memory` | `id`; optional `store` | Soft-remove an active memory. | Reversible via a retain patch; purge is CLI-only; missing stores return `null`. |

`store` accepts `"project"` or `"global"`; omitted means project. Project data is
`./.nanomneme/memory.db`; global data is `~/.local/share/nanomneme/memory.db` on Linux and
macOS. Results are canonical core JSON. Only `retain_memory` creates a missing store; reads
and removal leave missing stores absent. The server resolves the project directory from
`NMNM_PROJECT_DIR`, set to `${CLAUDE_PROJECT_DIR}` in `.mcp.json`, falling back to the
process working directory.

The `memory-guide` Skill (invoked as `/nanomneme:memory-guide`) teaches the model when to
use these tools, how to choose project vs global scope, and which facts not to retain. It is
named `memory-guide`, not `memory`, so it does not collide with the `/nanomneme:memory`
management command below (a plugin skill and a command that share a name resolve to the same
slash invocation, and the command would win).

## Session-start injection

A `SessionStart` command hook (`hooks/session-start.js`) appends bounded Nanomneme context
to the session as transient `additionalContext`. Enabled autoretention guidance comes
first, followed by a compact index listing project pins, then global pins, then recent
active records from each store. Rows contain `store`, ID, and a short content preview. The
index is not a transfer of complete records; the model uses `recall_memory` or
`retrieve_memory` for full content.

Injection is a command hook (Node importing `nmnm-core`), not an `mcp_tool` hook, so it
works during the launch window when MCP tools are not yet available. Index reads are
read-only and never create or migrate a database. Missing databases are empty. Missing,
removed, expired, or unreadable pins are skipped and counted as unresolved; the pin stays
configured until explicitly unpinned. The hook is wrapped so a failure never blocks
startup.

### Reinjection

A `UserPromptSubmit` command hook (`hooks/prompt-submit.js`) can rebuild the same bounded
context on a fixed cadence. It is **disabled by default**. When `reinjection.enabled` is
true, it fires every `every_n_prompts` prompts (default 5). Prompt-count state is ephemeral
(per session, under the system temp directory); it adds no timers, workers, or automatic
writes.

## Memory management command

A deterministic, model-free management surface complements the model-facing MCP tools.
`bin/memory.js` reuses the shared store and context helpers (no model, worker, or network)
and prints text:

| Command | Output |
|---|---|
| `status` | Injection budget/current/unresolved, reinjection policy, autoretention counts, pin counts, per-store totals. |
| `list [project\|global] [limit] [offset]` | Active memories, project rows before global, `*` marks pins. Defaults to both stores, limit 20. |
| `search <query> [project\|global] [limit] [offset]` | Same listing, filtered by an FTS query. |
| `show [project\|global] <id>` | Full record detail for one memory. |
| `pin` / `unpin` `[project\|global] <id>` | Edit the adapter `nmnm-claude.json` pin file. |
| `remove [project\|global] <id>` | Reversible soft removal (purge stays CLI-only). |

When the store is omitted for `show`/`pin`/`unpin`/`remove`, the command resolves it by
looking the ID up in both stores; an ambiguous ID (present in both) asks you to qualify it.
Reads never create a store; `pin`/`unpin`/`remove` are deterministic writes.

Two ways to run it:

- **`/nanomneme:memory <args>`** — a slash command (`commands/memory.md`) that embeds the
  script via bash execution and relays its output verbatim. This is the closest match to
  Pi's `/memory list` / `status`. Claude Code slash commands are prompt templates, not
  native dialogs, so the data is deterministic and model-free but the final relay still
  passes through the model; there is no interactive navigation like Pi's browser.
- **`! node ${CLAUDE_PLUGIN_ROOT}/bin/memory.js <args>`** — invoking the CLI with the `!`
  prefix runs it and shows output with no model turn at all: a fully model-free path.

The command resolves the project store from `NMNM_PROJECT_DIR`/`CLAUDE_PROJECT_DIR` (falling
back to the working directory) and the global store via `CLAUDE_PLUGIN_DATA`, matching the
MCP server and hooks.

## Configuration

Two file types, mirroring the Pi adapter. Settings are hand-authored and read-only; pins
are adapter-owned.

### Settings — `nmnm.jsonc`

JSONC, validated read-only at load. Invalid JSONC or out-of-contract values raise an error
that is caught so it never blocks startup; correct the file and it applies on the next
load. Locations:

- **Project** (shared across adapters): `<project>/.nanomneme/nmnm.jsonc`. Pi and Claude
  share this file. Resolved relative to the working directory, so it always applies.
- **Global**: `${CLAUDE_PLUGIN_DATA}/nmnm.jsonc`. Under a real plugin install Claude Code
  sets `CLAUDE_PLUGIN_DATA` to the per-plugin data directory, so the effective file is
  `~/.claude/plugins/data/<plugin>-<marketplace>/nmnm.jsonc` — currently
  `~/.claude/plugins/data/nanomneme-openlines/nmnm.jsonc`. `~/.claude/nmnm.jsonc` is used
  **only** as a fallback when `CLAUDE_PLUGIN_DATA` is unset (e.g. running a hook by hand in a
  shell); the running plugin does not read it.

  Note this global location is per-plugin: it is **not** shared with Pi or other adapters,
  and it moves if the plugin or marketplace is renamed (the directory name is
  `<plugin>-<marketplace>`). For settings you want shared with Pi, or that should survive a
  rename, prefer the project `.nanomneme/nmnm.jsonc`.

Project settings override global. Complete v0.2.0 template:

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

`injection_budget` bounds the index plus any autoretention guidance together; a rule is
never partially emitted, and guidance that alone exceeds the budget is an error.
Autoretention only guides the active model; the model remains the sole decision maker and
calls `retain_memory` itself.

### Pins — `nmnm-claude.json`

JSON array of memory IDs, adapter-owned (per-adapter, not shared). Memory itself is shared;
pins are not. Locations:

- **Project**: `<project>/.nanomneme/nmnm-claude.json`.
- **Global**: `~/.local/share/nanomneme/nmnm-claude.json`.

Pinned memories are injected first, in store order (project then global). Edit pins with
`/nanomneme:memory pin`/`unpin` (see [Memory management command](#memory-management-command)),
by editing the pin files directly, or through the MCP tools.

## Safety boundaries

- Model-facing `remove_memory` is soft-only and reversible; irreversible purge stays a
  deliberate CLI-operator path (`nmnm remove --purge`).
- Reads and removal never create a missing store; only `retain_memory` does.
- Injection is transient context, never a persistent session-message snapshot or an
  automatic write.
- The adapter never writes SQLite directly or parses CLI output; all operations go through
  `nmnm-core`.
- Do not commit `.nanomneme/`, personal global databases, or pin files with local data.

## Cross-adapter use

Memory retained through Claude is readable by the Pi adapter and the `nmnm` CLI against the
same store. For the global store:

```sh
node packages/nmnm-cli/bin/nmnm.js retrieve "<query>" --global
```

Runtime code and tests are authoritative when this manual disagrees with behavior.
