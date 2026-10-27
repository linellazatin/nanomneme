# OpenCode Adapter Manual

The OpenCode adapter (`@openlines/nmnm-opencode`) is a native OpenCode **server plugin** built on `@opencode-ai/plugin`, plus an optional **TUI plugin** browser. It gives the OpenCode agent the same four memory tools as the Pi and Claude Code adapters, injects a bounded transient memory index into every model request, keeps adapter-owned pins, and offers two model-free management surfaces: a deterministic CLI and an interactive TUI memory browser. It adds no MCP server, daemon, direct SQLite write, or core/CLI behavior change.

Runtime code and tests are authoritative if this manual disagrees with behavior.

## Dual-host compatibility

The adapter targets native V1 1.19.0 and V2 2.0.29. Unchanged legacy API and Node engine bounds do not certify broader host compatibility. V1 receives compatibility fixes for the tested baseline, not indefinite feature parity. The standalone Node CLI is independent of host APIs. The adapter suite passes on Node 22.19.0 and 26.11.1; the tested stock 22.13.0 binary lacks required FTS5. Independently installed 0.3.0 packages passed native loading, tools, both rendered browsers, and V2 live-provider checks.

| Surface | V1 1.19.0 | V2 2.0.29 |
| --- | --- | --- |
| Native checkout loading and 4Rs | Verified | Verified |
| Rendered browser navigation/mutations | Verified | Verified |
| Live-provider context | Historical older-host evidence only | Bedrock Haiku 5.5 verified |
| Reload | Restart verified; callback disposal unit-tested | Live disable/re-enable verified |
| Active-session location changes | Not established | Tools and rendered stale-selection rejection verified |
| Separate client/server homes | Terminal-local design | Authenticated loopback verified |
| Current installed tarball | Native loader/browser verified | Native tools/browser/live provider verified |
| Remote-machine deployment | Not established | Not established |

`index.js` preserves V1's named callback and delegates V2 setup to `src/server-v2.js`. V2 tools and primary context resolve each session's absolute directory; missing routing rejects tools and silently omits context without cwd fallback. Only primary requests receive the fresh transient index. `tui.js` preserves V1 and delegates V2 setup to `src/tui-v2.js`, using promise dialogs, host-owned keymap layers, and connected-client RPC. Each call resolves the active location; origin mismatches reject stale selections. Disposal aborts requests and closes owned dialogs. Status/browse/detail/mutate use server-owned paths without local fallback, automatic retries, retain, or purge.

Native regression tests use V1 1.19.0 and V2 2.0.29 with isolated configuration, state, and memory stores. Run `NMNM_OPENCODE_V1=/absolute/path/to/v1/opencode node --test adapters/opencode/test/browser-rpc-v1-host.test.js` and `NMNM_OPENCODE_V2=/absolute/path/to/v2/opencode node --test adapters/opencode/test/browser-rpc-host.test.js`. V1 observes retain/index behavior; V2 verifies authenticated RPC, native 4Rs, source metadata, child-session routing, actual session movement, and missing-store safety. For optional paid Bedrock checks, also set `NMNM_OPENCODE_LIVE_MODEL=global.anthropic.claude-haiku-5-5` and valid AWS credentials/profile/region; isolated HOME requires absolute `AWS_CONFIG_FILE` and `AWS_SHARED_CREDENTIALS_FILE` when using profile files. This verifies model-visible memory, real recall execution through Code Mode, completed compaction, and newly retained/pinned context after removing the old fact. It does not establish remote-machine deployment, rendered UI, all providers, or packed-release readiness. Cancellation cannot roll back an already dispatched synchronous mutation; ambiguous failures must not be retried automatically.

Rendered terminal checks require Python `pexpect` and `pyte`, not shipped runtime dependencies. Run `python adapters/opencode/test/terminal_browser.py --host /absolute/native/opencode --generation v1` or `--generation v2 --connected`. Disposable homes and stores cover the hotkey, all tabs, source filtering, 20-record pagination, detail/back, selection restoration, pin/unpin, explicit cancellation, confirmed soft removal, and reopening. V2's connected check uses authenticated loopback with different terminal/server homes, changes to an actual second-location session during confirmation, rejects the stale mutation, and exercises two live disable/re-enable cycles without duplicate palette entries. V1 configuration changes require terminal restart; restart-based removal/reloading and callback-level disposal tests do not establish native in-process deactivation. This is not remote-machine deployment or packed-release evidence.

## Requirements and architecture

- Node.js 22.13+ with FTS5 in built-in `node:sqlite` (22.19.0 is tested), available on `PATH` (or set `NMNM_NODE` to its absolute path).
- Native baselines are V1 1.19.0 and V2 2.0.29. Legacy API dependency `@opencode-ai/plugin >=1.18.15` and locked 1.18.15 are not older-host compatibility promises. Historical probes used V1 1.18.31/1.18.35. Current independent installed-package checks cover both browsers and V2 tools/context/RPC. The V1 system-transform hook remains experimental upstream.

OpenCode loads server plugins under **Bun**, and its Bun build provides no `node:sqlite` (only the incompatible `bun:sqlite`). Because `@openlines/nmnm-core` requires `node:sqlite`, the plugin does **not** import core persistence in the Bun host; it can use the sqlite-free logging subpath. Instead:

```text
OpenCode (Bun) plugin  ->  spawns  node  src/bridge.js  (per core call)  ->  @openlines/nmnm-core
```

`index.js` is the Bun-safe dual server entry; its named V1 callback comes from `src/server-v1.js`, which registers the legacy tools and system transform. Every core operation (a 4R tool call or the bounded index) runs in a short-lived `node` bridge process (`src/bridge.js` via `src/bridge-client.js`). The bridge reads a JSON request on stdin and writes a JSON response on stdout; the core's SQLite experimental warning goes to stderr and never pollutes the result. This is a stateless process-per-call, not a daemon or network service, so the "thin core client, no direct SQLite" rule holds: only Node bridge processes touch core persistence; the Bun host uses `@openlines/nmnm-core/logging` for proven spawn failures.

The V1 TUI browser (`tui.js`, exported as `./tui` and forwarding to `src/tui-v1.js`) is a separate OpenCode **TUI plugin** module that runs under the same Bun host, so it reuses the identical Node bridge (`status`/`browse`/`detail`/`mutate` ops) rather than importing the core. It only drives OpenCode's native dialog and keymap API and never performs an LLM turn. The public entrypoints and named callback exports remain stable; the version-specific modules isolate V1 host APIs without changing shared memory behavior.

## Install

Registry examples use the published package; use the local development instructions below for unpublished changes. Manifests and lockfiles define dependency requirements. Root-only security overrides do not propagate to independently installed adapters or Bun-managed caches; upstream dependency fixes remain pending.

### OpenCode V2

Add `{"$schema":"https://opencode.ai/config.json","plugins":["@openlines/nmnm-opencode"]}` to server `opencode.json(c)`. The CLI automatically loads the package's `./tui` component from the connected server's plugin list. Explicit terminal registration belongs in global `${XDG_CONFIG_HOME:-~/.config}/opencode/cli.json`: `{"plugins":["@openlines/nmnm-opencode"]}`. There is no project-local CLI configuration. Press **ctrl+alt+m**, or use the command palette.

For development, use the absolute adapter directory in `plugins`, such as `{"plugins":["/absolute/path/to/nanomneme/adapters/opencode"]}`. V2 rejects individual entrypoint file paths; V1 examples below are not V2 examples. The connected server must enable the server plugin and have Node for its bridge. Its home, project directory, settings, and pins own persistence; there is no terminal-local fallback. RPC errors are visible without mutation retries. Changed active locations reject selected actions; reopen the browser in the new location.

### OpenCode V1

#### Option A: npm plugin

Add the package to OpenCode config. OpenCode installs npm plugins and their dependencies via Bun at startup and caches them under `~/.cache/opencode/node_modules`.

```jsonc
// opencode.json (project) or ~/.config/opencode/opencode.json (global)
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@openlines/nmnm-opencode"]
}
```

Use the same adapter version in the server and TUI registrations for reproducibility. Older version pins below are rollback instructions, not the normal installation path.

To also enable the TUI memory browser, register the same package in the **TUI** config; OpenCode resolves its `./tui` export:

```jsonc
// ~/.config/opencode/tui.jsonc
{ "plugin": ["@openlines/nmnm-opencode"] }
```

Restart OpenCode after saving the TUI config, then press **ctrl+alt+m**. The browser is model-free and provides Status, All, Project, and Global tabs with source filtering, pin/unpin, and confirmed soft removal. The server plugin and TUI plugin are separate registrations: `opencode.json` enables the memory tools and `tui.jsonc` enables the browser.

#### Option B: local development loading

From this checkout, point the entry at the source. Plugins in a project `opencode.json`, or files under `.opencode/plugins/`, are discovered automatically.

```jsonc
{ "plugin": ["file:///absolute/path/to/nanomneme/adapters/opencode/index.js"] }
```

For the TUI browser from a checkout, point the TUI config's `plugin` at the sibling `tui.js` file path instead:

```jsonc
// ~/.config/opencode/tui.jsonc
{ "plugin": ["file:///absolute/path/to/nanomneme/adapters/opencode/tui.js"] }
```

Run `npm install` at the monorepo root first so `@openlines/nmnm-core` resolves for the Node bridge. Then verify discovery without a model round-trip:

```sh
opencode debug config   # the plugin path appears under "plugin" and "plugin_origins"
```

## Native memory tools

The plugin registers exactly four tools; each forwards through the Node bridge to `@openlines/nmnm-core`, resolving the project store from the tool-context directory (not `process.cwd()`).

| Tool | Purpose | Notable args |
| --- | --- | --- |
| `retain_memory` | Create or explicitly patch a memory. | `content`, `id`, `kind`, `scope`, `namespace`, `tags`, `importance`, `confidence`, `expires_at`, `metadata` |
| `recall_memory` | Read one active memory by id. | `id`, `store` |
| `retrieve_memory` | Search (FTS/BM25) or list active memories. | `query`, `store`, `kind`, `scope`, `namespace`, `tags`, `expires`, `importance`, `confidence`, `order_by`, `limit`, `offset` |
| `remove_memory` | Soft-remove a memory by id. | `id`, `store` |

Behavior:

- New retains add `metadata.source: "opencode"`; ID-based patches preserve existing source when metadata is omitted.
- `retain_memory` trims and validates scope before routing: `global` selects the global store; `project` or omitted scope selects the project store. Invalid scope fails without creating a database. Retain is the **only** operation that creates a missing database.
- `store: "project" | "global"` selects the physical store for recall/retrieve/remove; a missing selected store returns `null` (or `{ total: 0, items: [] }`) without creating it.
- `remove_memory` is always soft and reversible; purge is not exposed to the model.
- Core hardening introduced in `0.3.0` passes through unchanged: Unicode/structured search, malformed-text and numeric-range validation, private first-use storage, and monotonic mutation timestamps. Bridge tests cover serialization and project/global creation; handler tests use frozen/backward clocks across reopened stores. Retain still accepts null metadata (new records add the OpenCode source; patches normalize it to `{}`); null rejection applies to core import/verification. Export/import/verification remain `nmnm` CLI operations.

## System-prompt injection

On `experimental.chat.system.transform` the plugin appends a transient `# Nanomneme memory` block containing the bounded index and optional autoretention guidance. It is **never** written to disk and is **not** a persistent session-message snapshot.

OpenCode rebuilds the system prompt for every model request rather than carrying an injected message across the session, so the block is appended to **each request whose context is non-empty**. This makes the memory index continuously available and means a Pi/Claude-style periodic reinjection cadence is unnecessary: the `reinjection` setting is parsed for schema compatibility but is **inert on OpenCode**. Because OpenCode forwards a single merged system string, the block is appended to the last system entry (pushed only when none exists), matching how other working OpenCode plugins inject context.

Settings, store, or bridge failures are caught and the block is omitted, so injection can never block a chat. An empty index plus no guidance injects nothing.

## Memory management CLI

A deterministic, model-free command backs human management. After an npm install it is on the `nmnm-opencode` bin; from a checkout run the script directly. `NMNM_PROJECT_DIR` selects the project store (otherwise the current directory). It runs under Node and uses `nmnm-core` directly (no bridge).

```sh
nmnm-opencode status
nmnm-opencode list [project|global] [limit] [offset] [--source all|opencode]
nmnm-opencode search <query> [project|global] [limit] [offset] [--source all|opencode]
nmnm-opencode show [project|global] <id>
nmnm-opencode pin [project|global] <id>      # resolves an unambiguous store
nmnm-opencode unpin [project|global] <id>
nmnm-opencode remove [project|global] <id>   # reversible soft removal
```

`list`/`search` with no store compose a project-then-global page (combined pagination, store labels, `*` pin markers, compact previews) without comparing BM25 scores across databases. Unqualified `remove`/`show`/`pin` resolve a single match or refuse on ambiguity. Purge requires the core CLI (`nmnm remove --purge`) or the separate UI workbench.

There is no model-free OpenCode slash command; the CLI and the TUI browser below are the management surfaces.

## TUI memory browser

The TUI plugin (`tui.js`) opens a model-free, dialog-driven browser on **ctrl+alt+m**. V1 requires a separate `tui.jsonc` registration. V2 loads the package's `./tui` entry automatically from the connected server's plugin list, or through explicit global `cli.json` registration; see the version-specific installation steps above. No LLM turn is involved.

- Tabs: **Status**, **All** (project + global), **Project**, **Global**; `‹ / ›` nav rows page between them. The source filter cycles **all → opencode** from a `Source:` row (the same `--source` semantics as the CLI). Pinned rows are prefixed `* `.
- The **Status** tab shows a compact, label-aligned summary: `Injection budget` (budget, current rendered size, unresolved pins), `Periodic reinjection`, `Autoretention`, `Pins`, and `Memories` (per-store totals).
- A row opens a memory action menu: **View detail** (`Tags`, `Namespace`, `Kind`, `Importance`, and `Updated` rows), **Pin**/**Unpin**, **Remove (soft)** (with a confirm), and **Back to list**. Content is intentionally omitted because it is already visible in the memory list. Removal stays soft and reversible; there is no purge path.
- **Back** returns to the previous screen inside the browser (it never closes it), and returning to a list restores the highlight on the record you last opened.
- The detail view uses explicit single-line `Tags`, `Namespace`, `Kind`, `Importance`, and `Updated` rows. The browser opens at the widest preset (`xlarge`) to reduce clipping; OpenCode exposes only `medium`/`large`/`xlarge` presets, not a percentage or pixel width. The non-list screens pass `renderFilter: false` to hide the dialog's search box (OpenCode's own internal dialogs use this flag; `skipFilter` alone still shows the input).
- Combined All/Global listing uses the same project-then-global pagination as the CLI and never compares BM25 scores across databases.

Because the TUI host runs under Bun (no `node:sqlite`), every read and mutation is dispatched to the same short-lived `node` bridge the server plugin uses; the browser module itself imports only `src/bridge-client.js` and OpenCode's `api.ui`/`api.keymap`. Avoid assigning the same hotkey to another OpenCode TUI plugin.

## Configuration

Settings are hand-authored and read-only; pins are adapter-owned (per-adapter, not shared). Memory itself is shared across adapters.

### Settings — `nmnm.jsonc`

JSONC, validated at load in the Node bridge. Invalid JSONC or out-of-contract values raise an error that is caught so it never blocks a chat.

- **Project** (shared across adapters): `<project>/.nanomneme/nmnm.jsonc`.
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

`injection_budget` bounds the index plus any autoretention guidance together; a rule is never partially emitted, and guidance that alone exceeds the budget is an error (context omitted).

### Pins — `nmnm-opencode.json`

JSON array of memory IDs, adapter-owned.

- **Project**: `<project>/.nanomneme/nmnm-opencode.json`.
- **Global**: `~/.local/share/nanomneme/nmnm-opencode.json`.

Pinned memories are injected first, in store order (project then global). Missing, expired, or soft-removed pin targets remain configured and are counted as unresolved; they are not silently rewritten. Manage pins with `nmnm-opencode pin`/`unpin` or by editing the files. Unpin resolves IDs from pin files without reading the database, including unresolved targets; an ID pinned in both stores requires an explicit project or global selection.

Pin mutations use a same-directory lock and atomic replacement. Competing writers receive a retry error; locks are never reclaimed automatically. After a crash, stop all adapter writers, remove the affected pin file’s `.lock` manually, then retry.

## Safety boundaries

- Model-facing `remove_memory` and CLI `remove` are soft-only and reversible; purge requires an explicit CLI or UI workbench action.
- Reads, removal, injection, and the index never create a missing store; only `retain_memory` does.
- Injection is transient context, never a persistent snapshot or an automatic write. The Bun plugin holds no state; each core call is a fresh short-lived Node process.
- The adapter never writes SQLite directly or parses CLI output; all operations go through `@openlines/nmnm-core` inside the Node bridge.
- Do not commit `.nanomneme/`, personal global databases, or pin files with local data.

## Compatibility probes

The following table records historical OpenCode 1.18.31 probes, not fresh checkout evidence. Use the dual-host matrix above for current results:

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
| TUI plugin host | OpenCode loads the `./tui` export under the same Bun host (`tui.jsonc`); a TUI module default-exports `{ id, tui }` and uses `api.keymap.registerLayer` + `api.ui.dialog` |

## Manual smoke check

Confirmed against OpenCode 1.18.31 with a configured provider:

1. With the plugin enabled and a seeded project memory, a turn that must read the injected index answered with the seeded codeword; the `--pure` control (no plugins) could not.
2. A turn instructed to call `retain_memory` did so, and reading the project store confirmed a new record with `metadata.source: "opencode"` in the project store.
3. Reads and soft removal left a missing store absent.

The terminal checks exercise navigation, confirmation, filtering, paging, detail/back, and selection restoration on both hosts. V1 requests `xlarge`; V2 requests `large`. Tabs use navigation rows. Set `NMNM_ADAPTER_ROOT` to the absolute independently installed package directory for both native host tests and the Python terminal checks; the default targets this checkout. Installed 0.3.0 checks passed without workspace dependencies. Remote deployment and V1 in-process deactivation remain unverified. For V1 rollback, select a previously verified compatible release from the changelog and use the same selection in both registrations before restarting. V2 support was introduced in adapter `0.3.0`; earlier releases are not suitable V2 rollback targets. Disabling the plugin does not migrate or delete stores.

```sh
npm test
npm pack --dry-run --workspace @openlines/nmnm-opencode
```

## Cross-adapter use

Memory retained through OpenCode is readable by the Pi and Claude Code adapters and the `nmnm` CLI against the same store. For the global store:

```sh
node packages/nmnm-cli/bin/nmnm.js retrieve "<query>" --global
```

## Shared opt-in diagnostics

Diagnostics default off. Enable shared `logging.enabled` in `~/.local/share/nanomneme/config.jsonc`. User-level adapter settings can override it. Raw error messages are not redacted. See the [Logger manual](../../../docs/LOGGER.md#configuration-and-record-contract) for configuration, record fields, permissions, and privacy boundaries.

OpenCode uses its existing user settings resolver under the OpenCode config directory. Node tool operations, CLI mutations, and confirmed TUI mutations are observed; index/navigation reads are unlogged. Each bridge process resolves settings anew. Bridge spawn failures emit one `failed` record from the Bun plugin host itself (the bridge provably never ran), carrying the spawn error verbatim; post-spawn transport/parse failures have no diagnostic record because the bridge may already have logged the true outcome. Server tools forward the host tool-context `sessionID`; TUI and CLI management use null correlation.

`src/logslines.js` supplies the adapter-specific logging binding. The [Logger manual](../../../docs/LOGGER.md#source-and-artifact-map) owns the shared source, generated-artifact, and package-check reference.
