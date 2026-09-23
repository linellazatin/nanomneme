---
name: memory
description: Use when a user states a durable fact, decision, preference, or instruction worth remembering across Codex sessions; when they ask what is remembered; or when a memory should be corrected or removed.
compatibility: macOS and Linux with Node.js 22.13+; this skill uses its bundled direct-core runner and no MCP server.
---

# Nanomneme memory

Nanomneme is a shared deterministic SQLite memory store. The `runner.js` beside this SKILL.md is the only model-facing adapter surface. Resolve that package-relative file and execute it with Node.js; do not write SQLite directly, parse `nmnm` output, use an MCP fallback, or supply a database path.

Send one JSON object on stdin. The runner responds with `{ "ok": true, "result": ... }` on success and a nonzero exit with `{ "ok": false, "error": ... }` on failure.

## The 4Rs

- `retain`: Save a durable record. New records are marked `metadata.source: "codex"`. Include `id` only to patch an existing record; patches preserve its metadata and provenance.
- `recall`: Read one active record by `id`.
- `retrieve`: Search or list active records. Use `query` for lexical search and core selectors such as `kind`, `tags`, `namespace`, or `limit`.
- `remove`: Soft-remove by `id`. Purge is unavailable here and remains an explicit `nmnm` operator action.

Use `store: "project"` by default. Use `store: "global"` only for information that applies across projects; it uses the standard Linux/macOS global store. Reads and missing-target removals do not create a database.

Example request, after resolving the runner path relative to this skill:

```sh
printf '%s\n' '{"operation":"retain","store":"project","input":{"content":"Use SQLite for canonical memory.","kind":"decision","tags":["architecture"]}}' | node /resolved/path/to/skills/memory/runner.js
```

Retain only durable, reusable information. Do not retain credentials, secrets, routine logs, or transient execution state. Retrieve before retaining where a similar record may already exist.
