# nmnm-claude

Claude Code adapter for [nanomneme](../../README.md): a plugin that gives Claude native, observable memory tools backed by the shared nanomneme SQLite store, plus bounded memory injection at session start. Memory is reusable across Claude, Pi, and other adapters; only the harness-facing surface differs.

## What it provides

- A local stdio **MCP server** (`mcp/server.js`) exposing `retain_memory`, `recall_memory`, `retrieve_memory`, and `remove_memory`, importing `@openlines/nmnm-core` directly. New retains record `metadata.source` as `"claude-code"`; ID-based patches preserve existing source when metadata is omitted. `list` and `search` accept `--source all|claude-code`.
- A **`SessionStart` hook** that injects optional autoretention guidance before the bounded project/global index as transient context. Disabled **`UserPromptSubmit`** reinjection reads settings only; enabled reinjection persists an ephemeral prompt counter and builds context only on its configured cadence.
- A **`memory-guide` Skill** (`/nanomneme:memory-guide`) teaching when to use memory and how to choose project vs global.
- A deterministic **`memory` command**: `bin/memory.js` (`status`, `list`, `search`, `show`, `pin`, `unpin`, `remove`) plus a `/nanomneme:memory` slash command that embeds it and relays output through the model. Invoke the script directly with `!` for output without a model turn.

## Install

Requires Node.js 22.13+ with FTS5 in built-in `node:sqlite`; Node.js 22.19.0 is tested. Claude Code installs this plugin through the nanomneme marketplace (`.claude-plugin/marketplace.json` at the repo root):

```
/plugin marketplace add linellazatin/nanomneme
/plugin install nanomneme@openlines
```

Current Claude Code installs Node dependencies automatically for copied marketplace plugins using this plugin's `package.json` and registry-only `package-lock.json`. The manifest accepts core `^0.3.0`; the plugin lock deliberately resolves published `0.3.0`, independently of checkout core `0.3.1`. Publishing a newer core does not change this frozen resolution. See [Claude's dependency installation rules](https://code.claude.com/docs/en/plugins/loading#node-js-package-dependencies).

For a marketplace added from a local path, or direct development loading, Claude loads the plugin in place and does not install dependencies. Run `npm ci` at the monorepo root to use checkout core. A root workspace install does not supply dependencies to a copied marketplace cache.

The MCP server auto-enables; its tools appear as `mcp__plugin_nanomneme_memory__<tool>`. See the [Claude Adapter Manual](docs/CLAUDE_ADAPTER_MANUAL.md) for the full step-by-step guide, including local development loading.

## Configuration

- Project settings (shared across adapters): `<repo>/.nanomneme/nmnm.jsonc`.
- Global settings: `${CLAUDE_PLUGIN_DATA}/nmnm.jsonc`. Under a real install that is the per-plugin data dir (`~/.claude/plugins/data/<plugin>-<marketplace>/nmnm.jsonc`, currently `nanomneme-openlines`); `~/.claude/nmnm.jsonc` applies only when `CLAUDE_PLUGIN_DATA` is unset. This location is per-plugin (not shared, moves on rename) — prefer project settings for anything shared with other adapters.
- Pins (adapter-owned): `<repo>/.nanomneme/nmnm-claude.json` and `~/.local/share/nanomneme/nmnm-claude.json`.

See the [Claude Adapter Manual](docs/CLAUDE_ADAPTER_MANUAL.md) for the full config schema, tool reference, and behavior.

## Develop

Core hardening introduced in `0.3.0` and retained in `0.3.1` is covered at the tool handlers for Unicode search/validation, invalid metadata/range operators, private project/global first-use storage, and monotonic patch/restore timestamps under frozen/backward clocks; management CLI tests cover Unicode/structured search and malformed-query errors. Tool-handler APIs are unchanged. Export/import/verification remain core CLI operations, not adapter tools.

```sh
node --test adapters/claude/test/*.test.js
```

`npm run validate` also installs a disposable copied plugin from its own lockfile with lifecycle scripts disabled, audits that dependency tree, runs this suite against registry core `0.3.0`, and exercises the stdio MCP 4Rs and management CLI. It does not establish native Claude registration or provider behavior. See the manual's [dependency refresh procedure](docs/CLAUDE_ADAPTER_MANUAL.md#refresh-the-locked-core).

## Shared opt-in diagnostics

Diagnostics default off. Enable shared `logging.enabled` in `~/.local/share/nanomneme/config.jsonc`. User-level adapter settings can override it. Raw error messages are not redacted. See the [Logger manual](../../docs/LOGGER.md#configuration-and-record-contract) for configuration, record fields, permissions, and privacy boundaries.

Claude uses its existing user settings resolver (`CLAUDE_PLUGIN_DATA` when supplied, otherwise `~/.claude/nmnm.jsonc`). Explicit MCP 4Rs and management mutations are observed; context hooks and read-only management are unlogged. Restart the MCP process to refresh cached settings. Correlation is null.

Pin mutations use a same-directory lock and atomic replacement. Competing writers receive a retry error; locks are never reclaimed automatically. After a crash, stop all adapter writers, remove the affected pin file’s `.lock` manually, then retry.

`src/logslines.js` binds this adapter to core’s shared logging runtime; it does not contain a separate observer or generated bundle. See the [Logger manual](../../docs/LOGGER.md#source-and-artifact-map) for file roles and build rules.
