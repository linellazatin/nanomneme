# OpenCode Adapter Manual

The OpenCode adapter (`@openlines/nmnm-opencode`) is a native OpenCode **server plugin**
built on `@opencode-ai/plugin`. It gives the OpenCode agent the same four memory tools as the
Pi and Claude Code adapters, injects a bounded transient memory index into every model request,
keeps adapter-owned pins, and ships a model-free management CLI. It adds no MCP server,
daemon, custom TUI, direct SQLite write, or core/CLI behavior change.

Runtime code and tests are authoritative if this manual disagrees with behavior.

## Requirements and architecture

- Node.js 22.13+ with built-in `node:sqlite`, available on `PATH` (or set `NMNM_NODE` to its
  absolute path).
- An OpenCode version exposing the `@opencode-ai/plugin` server API, native `tool` registration,
  and `experimental.chat.system.transform`. Developed and verified against
  `@opencode-ai/plugin` 1.18.15 / OpenCode 1.18.31. The system-transform hook is marked
  experimental upstream.

OpenCode loads server plugins under **Bun**, and its Bun build provides no `node:sqlite` (only
the incompatible `bun:sqlite`). Because `@openlines/nmnm-core` requires `node:sqlite`, the
plugin does **not** import the core in the Bun host. Instead:

```text
OpenCode (Bun) plugin  ->  spawns  node  src/bridge.js  (per core call)  ->  @openlines/nmnm-core
```

`index.js` (Bun-safe: only `@opencode-ai/plugin`, `node:child_process/os/url`) registers the
tools and the system transform; every core operation (a 4R tool call or the bounded index) runs
in a short-lived `node` bridge process (`src/bridge.js` via `src/bridge-client.js`). The bridge
reads a JSON request on stdin and writes a JSON response on stdout; the core's SQLite
experimental warning goes to stderr and never pollutes the result. This is a stateless
process-per-call, not a daemon or network service, so the "thin core client, no direct SQLite"
rule holds: only `src/*` under Node ever touches `nmnm-core`.

## Install

### Option A: npm plugin

Add the package to OpenCode config. OpenCode installs npm plugins and their dependencies via
Bun at startup and caches them under `~/.cache/opencode/node_modules`.

```jsonc
// opencode.json (project) or ~/.config/opencode/opencode.json (global)
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@openlines/nmnm-opencode"]
}
```

Pin a version for reproducibility: `"@openlines/nmnm-opencode@0.1.0"`.

### Option B: local development loading

From this checkout, point the entry at the source. Plugins in a project `opencode.json`, or
files under `.opencode/plugins/`, are discovered automatically.

```jsonc
{ "plugin": ["file:///absolute/path/to/nanomneme/adapters/opencode/index.js"] }
```

Run `npm install` at the monorepo root first so `@openlines/nmnm-core` resolves for the Node
bridge. Then verify discovery without a model round-trip:

```sh
opencode debug config   # the plugin path appears under "plugin" and "plugin_origins"
```

## Native memory tools

The plugin registers exactly four tools; each forwards through the Node bridge to
`@openlines/nmnm-core`, resolving the project store from the tool-context directory (not
`process.cwd()`).

| Tool | Purpose | Notable args |
| --- | --- | --- |
| `retain_memory` | Create or explicitly patch a memory. | `content`, `id`, `kind`, `scope`, `namespace`, `tags`, `importance`, `confidence`, `expires_at`, `metadata` |
| `recall_memory` | Read one active memory by id. | `id`, `store` |
| `retrieve_memory` | Search (FTS/BM25) or list active memories. | `query`, `store`, `kind`, `scope`, `namespace`, `tags`, `expires`, `importance`, `confidence`, `order_by`, `limit`, `offset` |
| `remove_memory` | Soft-remove a memory by id. | `id`, `store` |

Behavior:

- New retains add `metadata.source: "opencode"`; ID-based patches preserve an existing source.
- `retain_memory` routes to the global store when `scope: "global"`, otherwise the project
  store, and it is the **only** operation that creates a missing database.
- `store: "project" | "global"` selects the physical store for recall/retrieve/remove; a
  missing selected store returns `null` (or `{ total: 0, items: [] }`) without creating it.
- `remove_memory` is always soft and reversible; purge is not exposed to the model.

## System-prompt injection

On `experimental.chat.system.transform` the plugin appends a transient `# Nanomneme memory`
block containing the bounded index and optional autoretention guidance. It is **never** written
to disk and is **not** a persistent session-message snapshot.

OpenCode rebuilds the system prompt for every model request rather than carrying an injected
message across the session, so the block is appended to **each request whose context is
non-empty**. This makes the memory index continuously available and means a Pi/Claude-style
periodic reinjection cadence is unnecessary: the `reinjection` setting is parsed for schema
compatibility but is **inert on OpenCode**. Because OpenCode forwards a single merged system
string, the block is appended to the last system entry (pushed only when none exists), matching
how other working OpenCode plugins inject context.

Settings, store, or bridge failures are caught and the block is omitted, so injection can never
block a chat. An empty index plus no guidance injects nothing.

## Memory management CLI

A deterministic, model-free command backs human management. After an npm install it is on the
`nmnm-memory` bin; from a checkout run the script directly. `NMNM_PROJECT_DIR` selects the
project store (otherwise the current directory). It runs under Node and uses `nmnm-core`
directly (no bridge).

```sh
nmnm-memory status
nmnm-memory list [project|global] [limit] [offset] [--source all|opencode]
nmnm-memory search <query> [project|global] [limit] [offset] [--source all|opencode]
nmnm-memory show [project|global] <id>
nmnm-memory pin [project|global] <id>      # defaults to project
nmnm-memory unpin [project|global] <id>
nmnm-memory remove [project|global] <id>   # reversible soft removal
```

`list`/`search` with no store compose a project-then-global page (combined pagination, store
labels, `*` pin markers, compact previews) without comparing BM25 scores across databases.
Unqualified `remove`/`show`/`pin` resolve a single match or refuse on ambiguity. Purge is not
exposed; it stays `nmnm remove --purge`.

There is no model-free OpenCode slash command in this release; the CLI is the management
surface.

## Configuration

Settings are hand-authored and read-only; pins are adapter-owned (per-adapter, not shared).
Memory itself is shared across adapters.

### Settings — `nmnm.jsonc`

JSONC, validated at load in the Node bridge. Invalid JSONC or out-of-contract values raise an
error that is caught so it never blocks a chat.

- **Project** (shared with Pi and Claude): `<project>/.nanomneme/nmnm.jsonc`.
- **Global**: `${XDG_CONFIG_HOME:-~/.config}/opencode/nmnm.jsonc`.

Project settings override global. Template:

```jsonc
{
  // Character budget for all transient injected context (index + autoretention).
  // Non-negative integer. Default 2000.
  "injection_budget": 2000,

  // Parsed for schema compatibility but inert on OpenCode (the index is appended to every
  // request instead). Retained so one settings file works across Pi and Claude.
  "reinjection": {
    "enabled": false,
    "every_n_prompts": 5
  },

  // Opt-in guidance for the model's own retain_memory calls. Global and project rule
  // arrays combine; never_persist takes precedence over all other rules.
  "autoretention": {
    "enabled": false,
    "always_persist": [],
    "never_persist": [],
    "always_ask": []
  }
}
```

`injection_budget` bounds the index plus any autoretention guidance together; a rule is never
partially emitted, and guidance that alone exceeds the budget is an error (context omitted).

### Pins — `nmnm-opencode.json`

JSON array of memory IDs, adapter-owned.

- **Project**: `<project>/.nanomneme/nmnm-opencode.json`.
- **Global**: `~/.local/share/nanomneme/nmnm-opencode.json`.

Pinned memories are injected first, in store order (project then global). Missing, expired, or
soft-removed pin targets remain configured and are counted as unresolved; they are not silently
rewritten. Manage pins with `nmnm-memory pin`/`unpin` or by editing the files.

## Safety boundaries

- Model-facing `remove_memory` and CLI `remove` are soft-only and reversible; purge stays a
  deliberate CLI-operator path.
- Reads, removal, injection, and the index never create a missing store; only `retain_memory`
  does.
- Injection is transient context, never a persistent snapshot or an automatic write. The Bun
  plugin holds no state; each core call is a fresh short-lived Node process.
- The adapter never writes SQLite directly or parses CLI output; all operations go through
  `@openlines/nmnm-core` inside the Node bridge.
- Do not commit `.nanomneme/`, personal global databases, or pin files with local data.

## Compatibility probes

The runtime shape below was established by probing the installed OpenCode 1.18.31 before
finalizing the design:

| Probe | Result |
| --- | --- |
| Local `file://` / npm server plugin is discovered by `opencode.json` | Verified — `opencode debug config` lists the plugin under `plugin`/`plugin_origins` |
| Plugin host runtime | OpenCode runs server plugins under **Bun 1.3.14** (reports a Node 24 shim) |
| `node:sqlite` in the plugin host | **Not available** under Bun (`bun:sqlite` only) — this is why core access runs in a spawned Node bridge |
| Relative `./src/*.js` imports under the Bun host | Work in general; the original failure was the transitive `node:sqlite` import, not path resolution |
| Zod tool schemas load offline | Verified — plugin tests exercise the real `tool()`/`tool.schema` API |
| `experimental.chat.system.transform` reaches the model | **Verified live** — appended to the last merged system entry; a seeded project memory was echoed by the model, and `--pure` correctly reported it missing |
| Native tool write path | **Verified live** — the model called `retain_memory`; the record was written through the Node bridge with `metadata.source: "opencode"` |
| System prompt persistence across requests | OpenCode rebuilds per request, so injection is per-request; no cadence/mutation/compaction gating is required and `reinjection` stays inert |

## Manual smoke check

Confirmed against OpenCode 1.18.31 with a configured provider:

1. With the plugin enabled and a seeded project memory, a turn that must read the injected
   index answered with the seeded codeword; the `--pure` control (no plugins) could not.
2. A turn instructed to call `retain_memory` did so, and reading the project store confirmed a
   new record with `metadata.source: "opencode"` in the project store.
3. Reads and soft removal left a missing store absent.

```sh
npm test
npm pack --dry-run --workspace @openlines/nmnm-opencode
```

## Cross-adapter use

Memory retained through OpenCode is readable by the Pi and Claude Code adapters and the `nmnm`
CLI against the same store. For the global store:

```sh
node packages/nmnm-cli/bin/nmnm.js retrieve "<query>" --global
```