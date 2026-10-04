# nmnm-claude

Claude Code adapter for [nanomneme](../../README.md): a plugin that gives Claude native, observable memory tools backed by the shared nanomneme SQLite store, plus bounded memory injection at session start. Memory is reusable across Claude, Pi, and other adapters; only the harness-facing surface differs.

## What it provides

- A local stdio **MCP server** (`mcp/server.js`) exposing `retain_memory`, `recall_memory`, `retrieve_memory`, and `remove_memory`, importing `@openlines/nmnm-core` directly. New retains record `metadata.source` as `"claude-code"`; ID-based patches preserve an existing source. `list` and `search` accept `--source all|claude-code`.
- A **`SessionStart` hook** that injects the bounded project/global index (and optional autoretention guidance) as transient context, and a disabled-by-default **`UserPromptSubmit`** reinjection hook.
- A **`memory-guide` Skill** (`/nanomneme:memory-guide`) teaching when to use memory and how to choose project vs global.
- A deterministic **`memory` command** — `bin/memory.js` (`status`, `list`, `search`, `show`, `pin`, `unpin`, `remove`) plus a `/nanomneme:memory` slash command that embeds it. Model-free output; run `bin/memory.js` directly with `!` for a fully model-free path.

## Install

Requires Node.js 22.13+ with FTS5 in built-in `node:sqlite`; Node.js 22.19.0 is tested. Claude Code installs this plugin through the nanomneme marketplace (`.claude-plugin/marketplace.json` at the repo root):

```
/plugin marketplace add linellazatin/nanomneme
/plugin install nanomneme@openlines
```

Then install the plugin's Node dependencies so the MCP server resolves `@modelcontextprotocol/sdk`, `zod`, and `@openlines/nmnm-core` (Claude Code does not run this for you). From a cloned marketplace repository, run `npm install` at the **monorepo root**, not inside `adapters/claude`:

```sh
npm install
```

The MCP server auto-enables; its tools appear as `mcp__plugin_nanomneme_memory__<tool>`. See the [Claude Adapter Manual](docs/CLAUDE_ADAPTER_MANUAL.md) for the full step-by-step guide, including local development loading.

## Configuration

- Project settings (shared across adapters): `<repo>/.nanomneme/nmnm.jsonc`.
- Global settings: `${CLAUDE_PLUGIN_DATA}/nmnm.jsonc`. Under a real install that is the per-plugin data dir (`~/.claude/plugins/data/<plugin>-<marketplace>/nmnm.jsonc`, currently `nanomneme-openlines`); `~/.claude/nmnm.jsonc` applies only when `CLAUDE_PLUGIN_DATA` is unset. This location is per-plugin (not shared, moves on rename) — prefer project settings for anything shared with other adapters.
- Pins (adapter-owned): `<repo>/.nanomneme/nmnm-claude.json` and `~/.local/share/nanomneme/nmnm-claude.json`.

See the [Claude Adapter Manual](docs/CLAUDE_ADAPTER_MANUAL.md) for the full config schema, tool reference, and behavior.

## Develop

```sh
node --test adapters/claude/test/*.test.js
```

## Shared opt-in diagnostics

Set `"logging": { "enabled": true }` in `~/.local/share/nanomneme/config.jsonc` to enable the shared default. JSONC comments and trailing commas are supported. Adapter user-level `nmnm.jsonc` can explicitly enable or disable logging; absence inherits. Either invalid applicable logging configuration disables that caller. Project settings cannot authorize logging. Records use the shared `logslines/v1` catalog and core-distributed runtime, omit structured memory payloads and stack traces, preserve thrown-error messages verbatim without redaction, and append to `~/.local/share/nanomneme/logs/<component>.jsonl`. Correlation is null: Claude Code exposes `session_id` only to hook stdin, never to MCP servers or the management CLI, and hook session fields are not forwarded. Error messages may expose sensitive input or paths; review logs before sharing. Logging failures preserve operations and output. Existing databases, pin files, and logs require no migration.

Claude uses its existing user settings resolver (`CLAUDE_PLUGIN_DATA` when supplied, otherwise `~/.claude/nmnm.jsonc`). Explicit MCP 4Rs and management mutations are observed; context hooks and read-only management are unlogged. Restart the MCP process to refresh cached settings. Correlation is null.
