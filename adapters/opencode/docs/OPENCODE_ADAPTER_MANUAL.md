# OpenCode Adapter Manual

`@openlines/nmnm-opencode` provides V1/V2 server plugins, four memory tools, a bounded transient index on primary agent requests, adapter-owned pins, and model-free CLI/TUI management. It adds no MCP server or daemon; persistence calls public core APIs through Node. Code and tests are authoritative.

## Dual-host compatibility

Native checks cover V1 1.19.0 and V2 2.3.0; V2 2.0.29 results are historical. Legacy API/engine ranges do not certify other hosts. V1 receives baseline fixes, not indefinite feature parity. Suites passed on Node 22.19.0/26.11.1; V2 2.3.0 checks used 26.13.0. Stock Node 22.13.0 lacks FTS5. The Node management CLI is host-independent.

| Surface | V1 1.19.0 | V2 2.3.0 |
| --- | --- | --- |
| Native checkout loading and 4Rs | Verified | Verified |
| Rendered browser navigation/mutations | Verified | Verified |
| Live-provider context | Historical older-host evidence only | Model used, verified |
| Reload | Restart verified; callback disposal unit-tested | Live disable/re-enable verified |
| Active-session location changes | Not established | Tools and rendered stale-selection rejection verified |
| Separate client/server homes | Terminal-local design | Authenticated loopback verified |
| Concurrent child sessions | Not established | Native tool/store and live-context isolation verified |
| Installed tarball | Historical native loader/browser evidence | Native tools/browser/reload/live provider/concurrency verified |
| Remote-machine deployment | Not established | Not established |

`index.js` preserves V1's named callback and delegates V2 to `src/server-v2.js`. V2 resolves each session's absolute directory for tools and primary context; missing routing rejects tools and omits context, never falling back to cwd. `tui.js` delegates V2 to `src/tui-v2.js`: promise dialogs, host-owned keymap layers, and connected-client RPC. Each attempt resolves the client and checks its original location; disposal aborts requests and closes owned dialogs. Status/browse/detail retry only typed `rpc.unavailable` failures, up to 50 attempts, 100 ms apart. Mutations and other failures never retry. The browser has no local fallback, retain, or purge.

Native tests isolate configuration, state, and stores:

```sh
NMNM_OPENCODE_V1=/absolute/native/v1/opencode node --test adapters/opencode/test/browser-rpc-v1-host.test.js
NMNM_OPENCODE_V2=/absolute/native/v2/opencode node --test adapters/opencode/test/browser-rpc-host.test.js
```

V2 covers readiness, authenticated RPC, 4Rs, provenance, session movement, missing stores, and concurrent child-session routing to shared/separate project stores. Optional paid Bedrock checks use `NMNM_OPENCODE_LIVE_MODEL=global.anthropic.claude-haiku-5-5` with valid AWS credentials/profile/region. Profile files need absolute `AWS_CONFIG_FILE` and `AWS_SHARED_CREDENTIALS_FILE` under isolated HOME. Checks cover model-visible memory, Code Mode recall, continuation, completed compaction, fresh pinned context, and simultaneous child prompts with distinct project beacons. They do not certify model-driven background scheduling, all providers, remote machines, or publication. Set `NMNM_ADAPTER_ROOT=/absolute/installed/package` to test an independently installed tarball. Cancellation cannot undo a dispatched synchronous mutation.

Rendered checks require test-only Python `pexpect`/`pyte`:

```sh
python adapters/opencode/test/terminal_browser.py --host /absolute/native/opencode --generation v1
python adapters/opencode/test/terminal_browser.py --host /absolute/native/opencode --generation v2 --connected
```

Disposable homes/stores cover hotkey, tabs, source filtering, 20-record pages, detail/back, selection restoration, pin/unpin, cancellation, confirmed soft removal, and reopening. V2 uses authenticated loopback with separate terminal/server homes, switches to a second-location session during confirmation to reject the stale mutation, and tests two disable/re-enable cycles without duplicate palette entries. V1 config changes require restart; restart and callback-disposal checks do not prove native in-process deactivation. These checks alone do not establish remote deployment or packed-release behavior.

`.github/workflows/validate.yml` runs the blocking Ubuntu V1 baseline/V2 baseline-current matrix for PRs, main, and releases, using Node 22/Python 3.14. Exact hosts are in the workflow and runner. Installs use an isolated prefix with required postinstall scripts; checkout manifests/locks stay unchanged. Run `node scripts/check-opencode-compatibility.js <v1|v2> <reviewed-version> /absolute/native/opencode` to verify the executable, require one unskipped passing native test, run adapter tests, and render the browser (`--connected` for V2). `python` must have `pexpect`/`pyte`. The runner strips live-model, AWS, host-option, and adapter-root overrides; no provider credentials or model requests are required. `release.yml` waits for every shared job, including Pi compatibility and workbench UI. Paid-provider/tarball checks are separate.

## Requirements and architecture

- Node.js 22.13+ with FTS5 in built-in `node:sqlite` (22.19.0 is tested), available on `PATH` (or set `NMNM_NODE` to its absolute path).
- Native host evidence is scoped to the compatibility table, not every host accepted by the legacy API dependency. The V1 system-transform hook remains experimental upstream.

OpenCode's Bun host lacks `node:sqlite`; its `bun:sqlite` is incompatible with core. Plugins therefore import only core's SQLite-free logging subpath and delegate persistence to Node:

```text
OpenCode (Bun) plugin  ->  spawns  node  src/bridge.js  (per core call)  ->  @openlines/nmnm-core
```

The Bun-safe `index.js` gets V1's named callback from `src/server-v1.js` (legacy tools/system transform). `src/bridge-client.js` spawns `src/bridge.js` per tool/index call: JSON stdin request, JSON stdout response, SQLite warnings on stderr. No daemon or network service runs. Only Node accesses core persistence; Bun logs proven spawn failures through `@openlines/nmnm-core/logging`.

V1's separate `./tui` entry (`tui.js` → `src/tui-v1.js`) uses the same bridge for `status`/`browse`/`detail`/`mutate` and native dialog/keymap APIs without an LLM turn. Public entrypoints and named callbacks remain stable; host-specific modules preserve shared memory behavior.

## Install

Registry examples use the published package; use the local development instructions below for unpublished changes. Manifests and lockfiles define dependency requirements. See the [standalone dependency audit exception](#standalone-dependency-audit-exception) before choosing an installation route.

### Standalone dependency audit exception

The release accepts known high-severity advisories in the independently resolved OpenCode dependency tree while upstream fixes are pending. Fresh standalone npm installs of the previous release and this release candidate both failed `npm audit --omit=dev --audit-level=high`. The affected tree comes through `@opencode-ai/plugin`, including [Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) and [TOML](https://github.com/advisories/GHSA-4qx8-w7c3-pj3p) via Effect. The audit identifies affected versions; it does not establish whether Nanomneme reaches the affected code.

The blocking checkout audit remains in place. Its root overrides do not apply to standalone npm installs or OpenCode's Bun-managed plugin cache. To use the audited resolution for these dependencies, run `npm ci` in the checkout and load the adapter by local path as described below. Retire this exception once an upstream-compatible standalone install passes the high-severity audit and the native compatibility checks.

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

Use the same adapter release for server and TUI registrations.

To also enable the TUI memory browser, register the same package in the **TUI** config; OpenCode resolves its `./tui` export:

```jsonc
// ~/.config/opencode/tui.jsonc
{ "plugin": ["@openlines/nmnm-opencode"] }
```

Restart OpenCode, then press **ctrl+alt+m**. `opencode.json` enables memory tools; the separate `tui.jsonc` registration enables the model-free browser described below.

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

Four tools forward to core through the Node bridge. V1 uses the tool-context directory; V2 resolves the session's absolute directory. Neither uses the plugin cwd when valid routing is supplied.

| Tool | Purpose | Notable args |
| --- | --- | --- |
| `retain_memory` | Create or explicitly patch a memory. | `content`, `id`, `kind`, `scope`, `namespace`, `tags`, `importance`, `confidence`, `expires_at`, `metadata` |
| `recall_memory` | Read one active memory by id. | `id`, `store` |
| `retrieve_memory` | Search (FTS/BM25) or list active memories. | `query`, `store`, `kind`, `scope`, `namespace`, `tags`, `expires`, `importance`, `confidence`, `order_by`, `limit`, `offset` |
| `remove_memory` | Soft-remove a memory by id. | `id`, `store` |

Behavior:

- New retains add `metadata.source: "opencode"`; ID-based patches preserve existing source when metadata is omitted.
- `retain_memory` trims and validates scope before routing: `global` selects the global store; `project` or omitted scope selects the project store. Invalid scope fails without creating a database. Among memory tools, retain is the **only** operation that creates a missing database; eligible opt-in compaction capture can also create the project store.
- `store: "project" | "global"` selects the physical store for recall/retrieve/remove; a missing selected store returns `null` (or `{ total: 0, items: [] }`) without creating it.
- `remove_memory` is always soft and reversible; purge is not exposed to the model.
- Core hardening introduced in `0.3.0` passes through unchanged: Unicode/structured search, malformed-text and numeric-range validation, private first-use storage, and monotonic mutation timestamps. Bridge tests cover serialization and project/global creation; handler tests use frozen/backward clocks across reopened stores. Retain still accepts null metadata (new records add the OpenCode source; patches normalize it to `{}`); null rejection applies to core import/verification. Export/import/verification remain `nmnm` CLI operations.

## System-prompt injection

V1's `experimental.chat.system.transform` appends to the last system string. V2's primary-session `context` hook pushes a text block, including on tool continuations. Both rebuild transient `# Nanomneme memory` context with autoretention guidance before the bounded index; the adapter never persists it to disk/session messages.

`reinjection` is parsed but inert. V2 auxiliary title/generate requests have no additional hook; optional capture uses a separate compaction hook; the next primary request rebuilds context. Settings/store/bridge failures omit context without failing chat; an empty index without guidance emits nothing.

## Memory management CLI

The model-free `nmnm-opencode` command runs under Node and calls core directly, without a bridge. Use the installed bin or `node adapters/opencode/bin/memory.js` from the checkout. `NMNM_PROJECT_DIR` selects the project directory; otherwise cwd applies.

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

Press **ctrl+alt+m** for the model-free `tui.js` browser. V1 requires `tui.jsonc`; V2 loads `./tui` from the connected server's plugin list or global `cli.json` (see Install).

- Tabs: **Status**, **All** (project + global), **Project**, **Global**; `‹ / ›` nav rows page between them. The source filter cycles **all → opencode** from a `Source:` row (the same `--source` semantics as the CLI). Pinned rows are prefixed `* `.
- The **Status** tab shows a compact, label-aligned summary: `Injection budget` (budget, current rendered size, unresolved pins), `Periodic reinjection`, `Autoretention`, `Summary autocapture`, `Pins`, and `Memories` (per-store totals).
- A record opens **View detail**, **Pin**/**Unpin**, confirmed **Remove (soft)**, or **Back to list**. Detail shows single-line `Tags`, `Namespace`, `Kind`, `Importance`, and `Updated`; it omits content already previewed in the list. No purge is available.
- **Back** returns within the browser; returning to a list restores the record highlight. V1 uses `xlarge` dialogs with `renderFilter: false` outside lists; V2 uses `large` promise dialogs.
- **All** composes project-then-global pages like the CLI, without comparing BM25 scores across stores; **Global** reads only global.

V1 dispatches reads and mutations through its terminal-local Node bridge. V2 sends RPC to the connected server, which owns the Node bridge and store paths; the terminal imports no persistence code. Avoid assigning the same hotkey to another TUI plugin.

## Configuration

Settings are hand-authored and read-only; pins are adapter-owned (per-adapter, not shared). Memory itself is shared across adapters.

### Settings: `nmnm.jsonc`

The Node bridge validates JSONC at load. Invalid syntax/values omit injected context without failing chat; management commands report errors.

- **Project** (shared across adapters): `<project>/.nanomneme/nmnm.jsonc`.
- **Global**: `${XDG_CONFIG_HOME:-~/.config}/opencode/nmnm.jsonc`.

Project settings override global. Template:

```jsonc
{
  // Character budget for all transient injected context (index + autoretention).
  // Non-negative integer. Default 2000.
  "injection_budget": 2000,
  "brief": { "enabled": false },
  "summary": { "autocapture": { "enabled": false } },

  // Inert on OpenCode: context is rebuilt for each applicable request (primary only on V2).
  // Parsed so project settings remain compatible with Pi and Claude.
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

`injection_budget` bounds the index, optional project brief and autoretention guidance together; a rule is never partially emitted, and guidance that alone exceeds the budget is an error (context omitted).

### Pins: `nmnm-opencode.json`

JSON array of memory IDs, adapter-owned.

- **Project**: `<project>/.nanomneme/nmnm-opencode.json`.
- **Global**: `~/.local/share/nanomneme/nmnm-opencode.json`.

Pins precede recent memories, project then global. Missing/expired/removed targets stay configured and count as unresolved. Manage them through the browser, `nmnm-opencode pin`/`unpin`, or file edits. Unpin reads pin files, not databases, so unresolved targets can be removed; IDs pinned in both stores require an explicit store.

Pin mutations use a same-directory lock and atomic replacement. Competing writers receive a retry error; locks are never reclaimed automatically. After a crash, stop all adapter writers, remove the affected pin file’s `.lock` manually, then retry.

## Safety boundaries

- Model-facing `remove_memory` and CLI `remove` are soft-only and reversible; purge requires an explicit CLI or UI workbench action.
- Reads, removal, injection, and the index never create a missing store; `retain_memory` and eligible opt-in compaction capture do.
- Injection is transient, with no automatic memory write or persisted snapshot. Bun retains browser/registration state, not database handles; each bridge call starts a fresh Node process.
- Plugins never write SQLite directly or parse CLI output. Persistence uses `@openlines/nmnm-core` through the Node bridge; the Node management CLI calls core directly.
- Do not commit `.nanomneme/`, personal global databases, or pin files with local data.

## Compatibility probes

The following table records historical OpenCode 1.18.31 probes, not fresh checkout evidence. Use the dual-host matrix above for current results:

| Probe | Result |
| --- | --- |
| Local `file://` / npm server plugin is discovered by `opencode.json` | Verified: `opencode debug config` lists the plugin under `plugin`/`plugin_origins` |
| Plugin host runtime | OpenCode runs server plugins under **Bun 1.3.14** (reports a Node 24 shim) |
| `node:sqlite` in the plugin host | **Unavailable** under Bun (`bun:sqlite` only); core runs in a spawned Node bridge |
| Relative `./src/*.js` imports under the Bun host | Work in general; the original failure was the transitive `node:sqlite` import, not path resolution |
| Zod tool schemas load offline | Verified — plugin tests exercise the real `tool()`/`tool.schema` API |
| `experimental.chat.system.transform` reaches the model | **Verified live**: appended to the last merged system entry; a seeded project memory was echoed by the model, and `--pure` correctly reported it missing |
| Native tool write path | **Verified live**: the model called `retain_memory`; the record was written through the Node bridge with `metadata.source: "opencode"` |
| System prompt persistence across requests | OpenCode rebuilds per request, so injection is per-request; no cadence/mutation/compaction gating is required and `reinjection` stays inert |
| TUI plugin host | OpenCode loads the `./tui` export under the same Bun host (`tui.jsonc`); a TUI module default-exports `{ id, tui }` and uses `api.keymap.registerLayer` + `api.ui.dialog` |

## Manual smoke check

Confirmed against OpenCode 1.18.31 with a configured provider:

1. With the plugin enabled and a seeded project memory, a turn that must read the injected index answered with the seeded codeword; the `--pure` control (no plugins) could not.
2. A turn instructed to call `retain_memory` did so, and reading the project store confirmed a new record with `metadata.source: "opencode"` in the project store.
3. Reads and soft removal left a missing store absent.

For native and terminal checks against an independent install, set `NMNM_ADAPTER_ROOT` to its absolute package directory; otherwise tests use this checkout. Installed 0.3.0 checks passed without workspace dependencies. Remote deployment and V1 in-process deactivation remain unverified. For V1 rollback, choose a verified compatible changelog release, match both registrations, and restart. V2 support began in adapter `0.3.0`; earlier releases cannot serve as V2 rollback targets. Disabling the plugin neither migrates nor deletes stores.

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

User overrides use OpenCode's config-directory resolver. Diagnostics cover Node tool operations, CLI mutations, and confirmed TUI mutations, not index/navigation reads. Each bridge reloads settings. Proven spawn failures emit one Bun-host `failed` record with the verbatim error; post-spawn transport/parse failures stay unlogged because the bridge may have recorded the outcome. Server tools forward the tool-context `sessionID`; TUI/CLI correlation is null.

`src/logslines.js` supplies the adapter-specific logging binding. The [Logger manual](../../../docs/LOGGER.md#source-and-artifact-map) owns the shared source, generated-artifact, and package-check reference.

## Project startup briefs

A summary is a persisted project work account supplied explicitly or captured by a supported adapter during compaction. A brief is an on-demand deterministic historical view of eligible summaries; it is not another memory record and uses no separate model or transcript access. Save the [JSON example](../../../docs/examples/project-summary.json) using `nmnm summary add --file summary.json --json`, then inspect `nmnm brief`. Configure the existing user or project `nmnm.jsonc`:

```json
{
  "brief": { "enabled": true }
}
```

Brief delivery defaults off. Project `brief.enabled` overrides the user value, including explicit false. A malformed brief-only object disables the brief without discarding otherwise valid ordinary context. Invalid broader settings retain their existing behavior. User settings may enable delivery across projects, but each brief reads only the receiving project's store. Existing ordinary global previews remain available; no global brief is constructed.

Both OpenCode server versions deliver the brief through the existing Node bridge on each primary model request. Reinjection cadence remains inert; the next primary request rebuilds context after changes.

Run `NMNM_OPENCODE_V1=/absolute/v1/opencode NMNM_OPENCODE_V2=/absolute/v2/opencode node --test adapters/opencode/test/native-brief.test.js` from the repository for native provider-request observations. Each selected host loads the adapter in a temporary home and sends requests to a local synthetic OpenAI-compatible endpoint. Fresh sessions cover enabled delivery with the historical warning, project disablement and summary removal. These checks establish native request delivery, not real-model compliance or same-session refresh; bridge/lifecycle tests cover context rebuilding separately. Unset host selectors produce explicit skips.

The adapter budgets ordinary guidance and memory previews first, including pins where supported. The brief uses up to 1000 UTF-16 code units of spare space after separators. It can repeat a summary already shown as an ordinary preview. The core emits full primary content or a complete UUID, date, status and title pointer with recall guidance. If neither fits, or the brief read fails, ordinary context remains available.

Use the existing `recall_memory` tool with the returned project UUID for full detail; existing tool output limits still apply. `nmnm summary update <id> --file summary.json` corrects an active supported summary. Existing removal, explicit restoration, expiry and transfer operations apply. Brief reads are read-only and unlogged and never create a missing store. See the [core/CLI contract](../../../docs/CORE_CLI_MANUAL.md#project-work-summaries-and-briefs) for fields, limits, historical scope and concurrent-update behavior.

To remove a brief source, use `nmnm summary remove <id> --json` with its project summary UUID. Briefs have no separate stored ID; the next configured refresh/reinjection or new session renders the remaining eligible summaries, or no brief when none remain. Already-injected context is unchanged.


## Automatic compaction checkpoints

Capture is default-off and independent of read-only brief delivery. Use either existing user/project settings location; project false overrides user true, and invalid capture-only settings disable capture without discarding ordinary valid context:

```json
{
  "summary": { "autocapture": { "enabled": true } },
  "brief": { "enabled": true }
}
```

V1 appends bounded instructions to `experimental.session.compacting` context, observes only an identified live compaction message through `experimental.text.complete`, and waits for successful `session.compacted`. V2 appends instructions through `api.session.hook('compaction')` and consumes completed plain text from live `session.compaction.ended` events. The host's normal compaction prompt and result stay intact. No session-history API, transcript read, provider-payload rewriting, replacement compaction, extra model call or tool loop is introduced. Opaque/native provider checkpoints without readable output cannot be captured.

A random marker and exact supplied date bind output to the pending attempt. The Node bridge reloads configuration/policy, validates the shared 8192-byte JSON contract and writes through core with `metadata.source: opencode` and a transactional capture receipt. Pending markers live only in the plugin process and disappear on reload; terminal events consume attempts before writing. Failed/missing/invalid/oversized output, moved sessions, policy changes and attempts older than one hour skip capture. Completed text is bounded to 1 MiB. Retried receipt writes preserve the original record, including removal; a new successful compaction appends a new dated summary. No global fallback exists.

Never/ask guidance applies even when ordinary autoretention injection is disabled. The compaction model must omit the checkpoint when retention needs approval or no useful permitted facts are available. Schema/marker checks do not establish factual accuracy, consent or semantic policy compliance. Capture can add prompt/output tokens within the existing request. Missing output is never repaired with another request.

Management status reports enabled/disabled configuration and native callback requirements. Connected V2 status additionally reports unavailable hook/event registration or a disconnected event stream; standalone CLI status cannot certify a running host. Briefs stay deterministic project-local reads, refreshed through existing context delivery. Use ordinary CLI summary update/remove to correct or remove captured sources; briefs have no separate ID.

Native production-plugin checks use disposable homes and a local synthetic provider: disabled/valid/missing/invalid cases each use one existing compaction request, provider failure saves nothing, and a valid checkpoint reaches a fresh session through its brief/source UUID. These checks prove delivery and persistence, not real-model generation or policy compliance. Run `NMNM_OPENCODE_V1=/absolute/v1 NMNM_OPENCODE_V2=/absolute/v2 node --test adapters/opencode/test/native-compaction.test.js` from the root. Personal plugin registration/trust and paid-provider acceptance remain separate.

Observed native compaction capture on V1 1.19.0 and V2 2.0.29, 2.3.0 and 2.4.1. The reviewed V1/V2 compatibility runners also pass terminal navigation/mutations and V2 unload/reload. V2 2.0.29 delivers unrelated events despite subscription filters; the adapter filters terminal event types itself. OpenCode automatic compaction triggering, cancellation and real-provider generation remain unverified; the native capture probe covers manual compaction and provider failure.


Additional disposable native V1/V2 simulations each completed 15 provider-scripted memory operations covering project/global creation, recall/search, patch, removal and restoration, with returned results and canonical state checked each round. V2 used Code Mode discovery and execution. Ordinary workflow counts include auxiliary/continuation requests and are separate from capture overhead. Real-model judgment remains unverified.

Enabled project briefs can also include Pi native compaction checkpoints. The shared core labels that text historical/unverified and uses a complete recall pointer when full text exceeds the brief budget. Recall the project UUID for full detail; summary updates must preserve their original format.
