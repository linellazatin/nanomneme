# nmnm-claude

Claude Code adapter for [nanomneme](../../README.md): a plugin that gives Claude native,
observable memory tools backed by the shared nanomneme SQLite store, plus bounded
memory injection at session start. Memory is reusable across Claude, Pi, and other
adapters; only the harness-facing surface differs.

## What it provides

- A local stdio **MCP server** (`mcp/server.js`) exposing `retain_memory`,
  `recall_memory`, `retrieve_memory`, and `remove_memory`, importing `nmnm-core` directly.
  New retains record `metadata.source` as `"claude-code"`; ID-based patches preserve an
  existing source.
- A **`SessionStart` hook** that injects the bounded project/global index (and optional
  autoretention guidance) as transient context, and a disabled-by-default
  **`UserPromptSubmit`** reinjection hook.
- A **`memory-guide` Skill** (`/nanomneme:memory-guide`) teaching when to use memory and how
  to choose project vs global.
- A deterministic **`memory` command** — `bin/memory.js` (`status`, `list`, `search`,
  `show`, `pin`, `unpin`, `remove`) plus a `/nanomneme:memory` slash command that embeds it.
  Model-free output; run `bin/memory.js` directly with `!` for a fully model-free path.

## Install

Requires Node.js 22.13+ (built-in `node:sqlite`). Claude Code installs this plugin through
the nanomneme marketplace (`.claude-plugin/marketplace.json` at the repo root):

```
/plugin marketplace add linellazatin/nanomneme
/plugin install nanomneme@openlines
```

Then install the plugin's Node dependencies so the MCP server resolves
`@modelcontextprotocol/sdk`, `zod`, and `nmnm-core` (Claude Code does not run this for you).
`nmnm-core` is an unpublished workspace package, so run `npm install` at the **monorepo
root** of the cloned marketplace repo, not inside `adapters/claude`:

```sh
npm install
```

The MCP server auto-enables; its tools appear as `mcp__plugin_nanomneme_memory__<tool>`. See
the [Claude Adapter Manual](../../docs/CLAUDE_ADAPTER_MANUAL.md) for the full step-by-step
guide, including local development loading.

## Configuration

- Project settings (shared with Pi): `<repo>/.nanomneme/nmnm.jsonc`.
- Global settings: `${CLAUDE_PLUGIN_DATA}/nmnm.jsonc`. Under a real install that is the
  per-plugin data dir (`~/.claude/plugins/data/<plugin>-<marketplace>/nmnm.jsonc`, currently
  `nanomneme-openlines`); `~/.claude/nmnm.jsonc` applies only when `CLAUDE_PLUGIN_DATA` is
  unset. This location is per-plugin (not shared, moves on rename) — prefer project settings
  for anything shared with Pi.
- Pins (adapter-owned): `<repo>/.nanomneme/nmnm-claude.json` and
  `~/.local/share/nanomneme/nmnm-claude.json`.

See the [Claude Adapter Manual](../../docs/CLAUDE_ADAPTER_MANUAL.md) for the full config
schema, tool reference, and behavior.

## Develop

```sh
node --test adapters/claude/test/*.test.js
```
