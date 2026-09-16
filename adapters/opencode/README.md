# @openlines/nmnm-opencode

OpenCode adapter for [nanomneme](../../README.md): a server plugin that gives OpenCode
native, observable memory tools backed by the shared nanomneme SQLite store, bounded
transient memory-index injection during the session, and a model-free TUI memory browser.
Memory is reusable across OpenCode, Pi, Claude Code, and other adapters; only the
harness-facing surface differs.

## What it provides

- A native OpenCode **server plugin** (`index.js`) registering `retain_memory`,
  `recall_memory`, `retrieve_memory`, and `remove_memory` via the `@opencode-ai/plugin`
  tool API. OpenCode loads plugins under Bun, which has no `node:sqlite`, so each core call
  runs in a short-lived spawned `node` bridge (`src/bridge.js`) rather than in the Bun host.
  No MCP server, daemon, or network. New retains record `metadata.source` as `"opencode"`;
  ID-based patches preserve an existing source. Only `retain_memory` creates a missing store;
  reads and soft removal never create one. Removal is always soft; purge stays `nmnm`-CLI-only.
- **Bounded transient injection** through `experimental.chat.system.transform`: the project and
  global pin set and recent active memories (and optional autoretention guidance) are appended
  to the system prompt on every model request whose context is non-empty. OpenCode rebuilds the
  system prompt per request, so no cadence/compaction/mutation gating is needed and the
  `reinjection` setting stays inert. No context is ever written to disk.
- A deterministic, model-free **management CLI** — `nmnm-opencode` (`status`, `list`,
  `search`, `show`, `pin`, `unpin`, `remove`).
- An optional model-free **TUI memory browser** (`tui.js`, registered via `tui.jsonc`) opened on
  **ctrl+alt+m**: Status / All / Project / Global tabs, source cycling, pin/unpin, and confirmed
  soft removal, all routed through the same Node bridge.

## Install

Requires Node.js 22.13+ with `node:sqlite` on `PATH` (or set `NMNM_NODE`) for the bridge, and an
OpenCode version exposing the `@opencode-ai/plugin` server API. Add the npm plugin to your
OpenCode config:

```jsonc
// opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@openlines/nmnm-opencode"]
}
```

OpenCode installs npm plugins (and their dependencies) via Bun at startup and caches them.
To also enable the TUI memory browser, register the same package in the TUI config
(`~/.config/opencode/tui.jsonc`), which resolves its `./tui` export:

```jsonc
{ "plugin": ["@openlines/nmnm-opencode"] }
```

For local development from this checkout, point the entry at the source instead:

```jsonc
{ "plugin": ["file:///absolute/path/to/nanomneme/adapters/opencode/index.js"] }
```

The four memory tools then appear natively to the agent. See the
[OpenCode Adapter Manual](../../docs/OPENCODE_ADAPTER_MANUAL.md) for the full guide,
including the compatibility probes and the manual smoke check.

## Configuration

- Project settings (shared with Pi and Claude): `<repo>/.nanomneme/nmnm.jsonc`.
- Global settings: `${XDG_CONFIG_HOME:-~/.config}/opencode/nmnm.jsonc`.
- Pins (adapter-owned): `<repo>/.nanomneme/nmnm-opencode.json` and
  `~/.local/share/nanomneme/nmnm-opencode.json`.

See the [OpenCode Adapter Manual](../../docs/OPENCODE_ADAPTER_MANUAL.md) for the config
schema, tool reference, and injection lifecycle.

## Develop

```sh
node --test adapters/opencode/test/*.test.js
```