---
name: memory-guide
description: Use when the user states a durable fact, decision, preference, or instruction worth remembering across sessions, when they ask what is remembered, or when a remembered fact should be corrected or removed. Stores shared memory through the nanomneme MCP tools so it is reusable across Claude, Pi, and other adapters.
allowed-tools: mcp__plugin_nanomneme_memory__retain_memory mcp__plugin_nanomneme_memory__recall_memory mcp__plugin_nanomneme_memory__retrieve_memory mcp__plugin_nanomneme_memory__remove_memory
---

# Nanomneme memory

Nanomneme is a shared, deterministic SQLite memory store. Memories persist beyond a session and are reused across harness adapters. Use the four native MCP tools below; never write the SQLite database or the `nmnm` CLI output directly.

## The 4Rs

- **retain** (`retain_memory`): save a durable fact, or patch an existing one by `id`.
- **recall** (`recall_memory`): read one memory by `id`.
- **retrieve** (`retrieve_memory`): search or list memories (FTS text `query`, filters).
- **remove** (`remove_memory`): soft-remove by `id` (reversible; purge requires an explicit CLI or UI workbench action).

## Project vs global scope

For `retain_memory`, omit `scope` for this repository or use `scope: global` for cross-project user information. **Prefer project** unless the fact clearly applies to every project the user works on (e.g. a personal preference or a cross-repo convention). Other tools use optional `store` (`project` or `global`) to choose a physical database.

## When to retain

Retain durable, reusable facts: decisions and their rationale, project conventions, user preferences, standing instructions. Do not retain secrets, credentials, routine logs, or transient state. Prefer patching an existing memory (retain with its `id`) over creating a near-duplicate; retrieve first to check.

If the project configures `autoretention` in `nmnm.jsonc`, its rules are injected as guidance at session start; `never_persist` rules always win. You remain the only decision maker; nothing is retained without your explicit `retain_memory` call.

## Kinds

`kind` is one of `note`, `decision`, `preference`, `fact`, `instruction`. Choose the one that best matches the memory; default to `note` when unsure.

## Inspecting memory without model reasoning

The `/nanomneme:memory` command (`status`, `list`, `search`, `show`, `pin`, `unpin`, `remove`) runs a deterministic script, then relays its output through the model. For output without a model turn, the user can invoke `! node ${CLAUDE_PLUGIN_ROOT}/bin/memory.js <args>` directly. Use these MCP tools when *you* need to read or write memory.
