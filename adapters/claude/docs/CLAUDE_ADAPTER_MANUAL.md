# Claude Code Adapter Manual

`nmnm-claude` is the Claude Code harness adapter for nanomneme. It is a plugin that gives Claude native memory tools over a local stdio MCP server calling the generated core runtime bundled with the plugin, plus bounded memory injection at session start. SQLite stays the storage authority; the adapter never parses the `nmnm` CLI. Memory is shared with Pi and other adapters; only pins and the harness surface are Claude-specific.

## Install

The plugin lives at `adapters/claude` inside the nanomneme monorepo. Claude Code installs plugins through a **marketplace** (`.claude-plugin/marketplace.json`), which this repo ships at its root; the plugin manifest (`adapters/claude/.claude-plugin/plugin.json`) alone only supports local dev loading. On enable, Claude reads the bundled `.mcp.json`, `hooks/hooks.json`, `skills/memory-guide/SKILL.md`, and `commands/memory.md`.

**Prerequisite:** Node.js 22.13+ (built-in `node:sqlite` with FTS5). The plugin runs Node subprocesses with full local-system access: an MCP server and command handlers for SessionStart, UserPromptSubmit, PreCompact and PostCompact. Review the source before installing; opt-in PostCompact capture can write project summaries.

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

For `retain_memory`, omitted scope means the project store and `scope: "global"` means the global store. Scope is trimmed and validated before selecting or creating a store; invalid values fail without creating a database. The other tools accept `store` (`"project"` or `"global"`) to select a physical database. Project data is `./.nanomneme/memory.db`; global data is `~/.local/share/nanomneme/memory.db` on Linux and macOS. Results are canonical core JSON. Among MCP tools, only `retain_memory` creates a missing store; reads and removal leave missing stores absent. The server resolves the project directory from `NMNM_PROJECT_DIR`, set to `${CLAUDE_PROJECT_DIR}` in `.mcp.json`, falling back to the process working directory.

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
  "brief": { "enabled": false },
  "summary": { "autocapture": { "enabled": false } },

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

`injection_budget` bounds the index, optional project brief and autoretention guidance together; a rule is never partially emitted, and guidance that alone exceeds the budget is an error. Autoretention only guides the active model; the model remains the sole decision maker and calls `retain_memory` itself.

### Pins — `nmnm-claude.json`

JSON array of memory IDs, adapter-owned (per-adapter, not shared). Memory itself is shared; pins are not. Locations:

- **Project**: `<project>/.nanomneme/nmnm-claude.json`.
- **Global**: `~/.local/share/nanomneme/nmnm-claude.json`.

Pinned memories are injected first, in store order (project then global). Edit pins with `/nanomneme:memory pin`/`unpin` (see [Memory management command](#memory-management-command)), or by editing the pin files directly. MCP tools manage memories, not pins.

Pin mutations use a same-directory lock and atomic replacement. Competing writers receive a retry error; locks are never reclaimed automatically. After a crash, stop all adapter writers, remove the affected pin file’s `.lock` manually, then retry.

## Safety boundaries

- Model-facing `remove_memory` is soft-only and reversible; irreversible purge requires an explicit CLI (`nmnm remove --purge`) or UI workbench action.
- Reads and removal never create a missing store. Among MCP tools, only `retain_memory` creates one; eligible opt-in PostCompact capture can also create the project store.
- Ordinary index/brief injection is transient context and does not write memories. Separately enabled compaction capture validates and saves a project summary after successful compaction.
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

## Project startup briefs

A summary is a persisted project work account supplied explicitly or captured by a supported adapter during compaction. A brief is an on-demand deterministic historical view of eligible summaries; it is not another memory record and uses no separate model or transcript access. Save the [JSON example](../../../docs/examples/project-summary.json) using `nmnm summary add --file summary.json --json`, then inspect `nmnm brief`. Configure the existing user or project `nmnm.jsonc`:

```json
{
  "brief": { "enabled": true }
}
```

Brief delivery defaults off. Project `brief.enabled` overrides the user value, including explicit false. A malformed brief-only object disables the brief without discarding otherwise valid ordinary context. Invalid broader settings retain their existing behavior. User settings may enable delivery across projects, but each brief reads only the receiving project's store. Existing ordinary global previews remain available; no global brief is constructed.

Claude delivers briefs through SessionStart and the existing enabled UserPromptSubmit cadence. Optional automatic capture uses the separate PreCompact/PostCompact handlers below; no new MCP tool is added.

The adapter budgets ordinary guidance and memory previews first, including pins where supported. The brief uses up to 1000 UTF-16 code units of spare space after separators. It can repeat a summary already shown as an ordinary preview. The core emits full primary content or a complete UUID, date, status and title pointer with recall guidance. If neither fits, or the brief read fails, ordinary context remains available.

Use the existing `recall_memory` tool with the returned project UUID for full detail; existing tool output limits still apply. `nmnm summary update <id> --file summary.json` corrects an active supported summary. Existing removal, explicit restoration, expiry and transfer operations apply. Brief reads are read-only and unlogged and never create a missing store. See the [core/CLI contract](../../../docs/CORE_CLI_MANUAL.md#project-work-summaries-and-briefs) for fields, limits, historical scope and concurrent-update behavior.

Credential-free native delivery check: set `NMNM_CLAUDE_NATIVE` to the installed Claude executable and run `node --test adapters/claude/test/native-brief.test.js` from the repository root. It uses temporary settings/stores, explicit startup-hook configuration and a local synthetic SSE provider; it verifies enabled/disabled prompt delivery without personal plugin registration or real-model acceptance.

To remove a brief source, use `nmnm summary remove <id> --json` with its project summary UUID. Briefs have no separate stored ID; the next configured refresh/reinjection or new session renders the remaining eligible summaries, or no brief when none remain. Already-injected context is unchanged.

## Automatic compaction checkpoints

Automatic capture is opt-in and independent of brief delivery. Configure the existing user/project `nmnm.jsonc`:

```json
{
  "summary": { "autocapture": { "enabled": true } },
  "brief": { "enabled": true }
}
```

Project `summary.autocapture.enabled` overrides the user value, including false. Invalid capture-only settings disable capture without discarding otherwise valid ordinary context; malformed broader settings retain their existing failure behavior. Enabling briefs never enables writes. OpenCode also supports same-call capture; Pi offers automatic native-text capture; Codex reports capture unavailable. All adapters can read eligible project summaries through existing brief delivery. Management status reports configuration and required native callbacks, not proof of installed/trusted hooks.

The shipped PreCompact command adds a bounded marked JSON checkpoint request to the host's existing summarization call, preserving its normal summary. PostCompact extracts the matching checkpoint, validates the existing project-summary contract and writes through bundled core with `metadata.source: claude-code` and an opaque `metadata.summary_capture.id` receipt. No CLI subprocess, new model request, worker, transcript read or host identity bridge is introduced. Instructions and output can cost additional tokens within the existing compaction request. The model may omit the checkpoint; no repair or follow-up inference is started.

Native events must supply an absolute project directory, session/prompt identifiers and a manual/auto trigger. Event identifiers only scope a hashed temporary filename; they are not stored in memories or logs. A private temporary directory holds only a random marker, timestamp, policy hash and consumed flag. Markers are eligible for one hour; changed policy, stale markers, unsafe state paths and overlapping callbacks skip capture. Each new PreCompact attempt replaces the marker; old completion blocks cannot consume the current attempt. A completed attempt is consumed before writing and never retried automatically, including after a storage failure. Temporary bookkeeping is disposable; expiry limits eligibility rather than scheduling a cleanup worker. Cancelled/failed compaction saves nothing. Native hook input and completed summary extraction are bounded to 1 MiB; the checkpoint retains the 8192-byte JSON contract limit. Oversized hook instructions skip capture rather than accepting the host's truncated instructions.

Configured never/ask retention guidance is included even when ordinary autoretention injection is disabled. The model must omit the entire checkpoint if required content needs approval, policy is unclear or no useful permitted checkpoint is available. Capture opt-in is not blanket retention approval or permission to implement historical proposals. Validation enforces schema/markers/limits, not semantic classification: correct omission of sensitive content and faithful summaries still depend on the host's compaction model. Unknown verification must remain explicit. No claim of general model compliance is made.

Core serializes capture receipt checks and creation in one write transaction. Matching retries return the original record without updating it or restoring a removed/expired record; conflicting content/provenance rejects the retry. Explicit summary updates preserve source and receipts. General metadata replacement or purge can remove the receipt; core deduplication requires that receipt to remain present. New captures append dated records rather than overwriting manual summaries; existing summary update/remove, export/import and brief fallback behavior applies. Successful capture is observed once as `retain` when diagnostics are enabled; skipped/read-only/replayed events are unlogged, correlation remains null, and payload/event identifiers are omitted.

Upgrade/reload the plugin to load its shipped hook definitions through your normal native host process; personal hook registration/trust changes are separate. This implementation was observed on native Claude Code 2.1.330. Older or other hosts that do not expose the required events, identifiers or completed summary cannot capture automatically; manual summaries and briefs remain available.

Run `NMNM_CLAUDE_NATIVE=/absolute/claude node --test adapters/claude/test/native-compaction.test.js` from the repository. It uses production hooks, disposable homes and a local synthetic provider. Manual baseline/valid/missing/invalid/malformed/oversized cases each used one compaction request; automatic disabled/enabled cases each used two requests, including the ordinary continuation. Native cancellation and provider failure saved nothing. Valid checkpoints retained Claude provenance and reached a fresh native session with their UUID and historical warning. Automatic triggering uses synthetic provider usage accounting and host-generated history. This proves native delivery/persistence and unchanged request count, not real-model generation or policy compliance.


Additional disposable native simulation completed 15 provider-scripted memory operations through the real MCP executor: project/global creation, recall/search, patch, removal and restoration. Tool results returned to the local synthetic provider and canonical state/provenance/timestamps matched; 16 requests included the final continuation. This establishes execution and routing, not model judgment.

Enabled project briefs can also include Pi native compaction checkpoints. The shared core labels that text historical/unverified and uses a complete recall pointer when full text exceeds the brief budget. Recall the project UUID for full detail; summary updates must preserve their original format.
