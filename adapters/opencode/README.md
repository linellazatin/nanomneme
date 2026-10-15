# @openlines/nmnm-opencode

V2 port in progress: this checkout includes a server-routed browser RPC contract and client transport, with native-host regression checks against V1 1.19.0 and V2 2.0.29. The V2 memory tools, context injection, and terminal browser UI are not yet ported. The feature and installation instructions below describe the existing V1 integration, not V2 readiness.

<div align="center">

[![nmnm-opencode version](https://img.shields.io/npm/v/%40openlines%2Fnmnm-opencode?label=opencode&logo=opencode&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-opencode) [![nmnm-opencode downloads](https://img.shields.io/npm/dt/@openlines/nmnm-opencode?label=downloads&logo=npm&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-opencode)

</div>

OpenCode adapter for [nanomneme](https://github.com/linellazatin/nanomneme): a server plugin that gives OpenCode native, observable memory tools backed by the shared nanomneme SQLite store, bounded transient memory-index injection during the session, and a model-free TUI memory browser. Memory is reusable across OpenCode, Pi, Claude Code, and other adapters; only the harness-facing surface differs.

## What it provides

- A native OpenCode **server plugin** (`index.js`, with V1 hooks in `src/server-v1.js`) registering `retain_memory`, `recall_memory`, `retrieve_memory`, and `remove_memory` via the `@opencode-ai/plugin` tool API. OpenCode loads plugins under Bun, which has no `node:sqlite`, so each core call runs in a short-lived spawned `node` bridge (`src/bridge.js`) rather than in the Bun host. No MCP server, daemon, or network. New retains record `metadata.source` as `"opencode"`; ID-based patches preserve existing source when metadata is omitted. Only `retain_memory` creates a missing store; reads and soft removal never create one. Removal is always soft; purge requires `nmnm remove --purge` or the UI workbench.
- **Bounded transient injection** through `experimental.chat.system.transform`: optional autoretention guidance precedes the project/global pin set and recent active memories in a block appended to every model request whose context is non-empty. OpenCode rebuilds the system prompt per request, so no cadence/compaction/mutation gating is needed and the `reinjection` setting stays inert. No context is ever written to disk.
- A deterministic, model-free **management CLI** — `nmnm-opencode` (`status`, `list`, `search`, `show`, `pin`, `unpin`, `remove`).
- An optional model-free **TUI memory browser** (`tui.js`, forwarding to `src/tui-v1.js` and registered via `tui.jsonc`) opened on **ctrl+alt+m**: a compact label-aligned Status summary plus All / Project / Global tabs, source cycling, pin/unpin, and confirmed soft removal, all routed through the same Node bridge.

![ss-memory-status](docs/img/ss-memory-status.png)

![ss-memory-list-all](docs/img/ss-memory-list-all.png)

![ss-memory-detail](docs/img/ss-memory-detail.png)

## Install

Requires Node.js 22.13+ with FTS5 in `node:sqlite` on `PATH` (or set `NMNM_NODE`) for the bridge. This checkout's dual server entry is tested against OpenCode V1 1.19.0; do not infer older host compatibility from the legacy API dependency range. V2 feature parity is still pending. Add the npm plugin to your OpenCode config:

```jsonc
// opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@openlines/nmnm-opencode"]
}
```

OpenCode installs npm plugins (and their dependencies) via Bun at startup and caches them.

### Enable the TUI browser

The TUI browser is a separate plugin entry from the server plugin. Register the same package in `~/.config/opencode/tui.jsonc`; OpenCode resolves the package's `./tui` export:

```jsonc
{ "plugin": ["@openlines/nmnm-opencode"] }
```

Restart OpenCode, then press **ctrl+alt+m** to open the model-free browser. It provides Status, All, Project, and Global tabs plus source filtering, pin/unpin, and confirmed soft removal.

For local development from this checkout, point the entry at the source instead:

```jsonc
{ "plugin": ["file:///absolute/path/to/nanomneme/adapters/opencode/index.js"] }
```

Register the TUI source separately in `~/.config/opencode/tui.jsonc`:

```jsonc
{ "plugin": ["file:///absolute/path/to/nanomneme/adapters/opencode/tui.js"] }
```

The four memory tools then appear natively to the agent. See the [OpenCode Adapter Manual](docs/OPENCODE_ADAPTER_MANUAL.md) for the full guide, including the compatibility probes and the manual smoke check.

## Configuration

- Project settings (shared across adapters): `<repo>/.nanomneme/nmnm.jsonc`.
- Global settings: `${XDG_CONFIG_HOME:-~/.config}/opencode/nmnm.jsonc`.
- Pins (adapter-owned): `<repo>/.nanomneme/nmnm-opencode.json` and `~/.local/share/nanomneme/nmnm-opencode.json`.

See the [OpenCode Adapter Manual](docs/OPENCODE_ADAPTER_MANUAL.md) for the config schema, tool reference, and injection lifecycle.

## Develop

The browser RPC transport exposes only status, browse, detail, and pin/unpin/soft-removal operations through the connected OpenCode server. The server owns store routing and the Node bridge; the V2 client transport never falls back to local persistence. Transport failures are not retried automatically, and cancellation does not roll back a mutation already dispatched to the synchronous bridge. Native transport checks are opt-in: set `NMNM_OPENCODE_V1` or `NMNM_OPENCODE_V2` to the corresponding executable and run `node --test adapters/opencode/test/browser-rpc-v1-host.test.js` or `node --test adapters/opencode/test/browser-rpc-host.test.js`. Each creates isolated host state and disposable stores without using the personal background service; without the environment variable, that host check is explicitly skipped.

Core hardening introduced in `0.3.0` and retained in `0.3.1` is covered through the real Node bridge for Unicode search/validation, invalid metadata/range operators, and private project/global first-use storage; direct handlers cover monotonic patch/restore timestamps under frozen/backward clocks. Tool-handler APIs are unchanged. Export/import/verification remain core CLI operations, not adapter tools.

```sh
node --test adapters/opencode/test/*.test.js
```

## Shared opt-in diagnostics

Diagnostics default off. Enable shared `logging.enabled` in `~/.local/share/nanomneme/config.jsonc`. User-level adapter settings can override it. Raw error messages are not redacted. See the [Logger manual](../../docs/LOGGER.md#configuration-and-record-contract) for configuration, record fields, permissions, and privacy boundaries.

OpenCode uses its existing user settings resolver under the OpenCode config directory. Node tool operations, CLI mutations, and confirmed TUI mutations are observed; index/navigation reads are unlogged. Each bridge process resolves settings anew. Spawn failures emit one host-side failed record because the bridge never ran; ambiguous post-spawn transport/parse failures remain unlogged to avoid contradicting a bridge outcome. Server tools forward the host tool-context `sessionID`; TUI and CLI management use null correlation.

Pin mutations use a same-directory lock and atomic replacement. Competing writers receive a retry error; locks are never reclaimed automatically. After a crash, stop all adapter writers, remove the affected pin file’s `.lock` manually, then retry.

`src/logslines.js` binds this adapter to core’s shared logging runtime; it does not contain a separate observer or generated bundle. See the [Logger manual](../../docs/LOGGER.md#source-and-artifact-map) for file roles and build rules.
