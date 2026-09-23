# Codex Adapter Manual

## Scope

`@openlines/nmnm-codex` provides local deterministic Nanomneme memory to Codex without MCP. It is a macOS and Linux prototype for Node.js 22.13+ that bundles its exact `@openlines/nmnm-core` runtime. The package contains one lazy-loaded skill, a constrained JSON runner, and one SessionStart hook.

## Install from a packed local artifact

From the repository root, run `npm pack --workspace @openlines/nmnm-codex` and install the tarball into an isolated temporary directory to validate its bundled runtime. For live Codex development, use the repo-local `.agents/plugins/marketplace.json` entry, which points at `adapters/codex`; install it through Codex, then review and trust the hook definition. Publication is deliberately deferred; do not use a public npm install command for this prototype.

## Hook trust and bounded context

The hook is not trusted automatically. After reviewing `hooks/hooks.json` and `hooks/session-start.js`, trust it in Codex to enable it. On session start it opens only existing stores read-only, emits no output for empty or unreadable stores, and never blocks startup. The injected index has a fixed 1,200-character cap, uses project records before global records, and labels each record with its store and recorded source. The hook has no settings, pins, reinjection cadence, or automatic retention.

## Shell-backed 4Rs

The `memory` skill resolves and invokes `skills/memory/runner.js`, which accepts one JSON request on stdin. The only operations are `retain`, `recall`, `retrieve`, and soft `remove`. Requests select `project` or `global`; they cannot select an arbitrary database path, purge, import, export, repair, or verify. New records receive `metadata.source: "codex"`; ID patches retain their existing metadata provenance. Reads and no-op removals leave missing stores absent.

## Store behavior

Project memory is `./.nanomneme/memory.db`. Global memory is `~/.local/share/nanomneme/memory.db`. The runner defaults to project memory and gives new global records global scope. These stores are shared with the Nanomneme CLI and other adapters, so use the `nmnm` CLI for model-free inspection, transfer, maintenance, backups, verification, repair, and irreversible purge.

## Token and failure boundaries

The index is an intentionally compact aid, not a full database export. Use `retrieve` and `recall` for complete records. Runner failures are structured JSON errors. Hook failures produce no context. Neither failure mode starts a daemon, uses a network service, or falls back to MCP.

## Non-goals

This prototype does not add Windows support, MCP, automatic retention, adapter configuration, pins, prompt cadence, a Codex-specific management command, direct SQLite access, or npm publication.
