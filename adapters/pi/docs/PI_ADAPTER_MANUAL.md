# Pi Adapter Manual

`@openlines/nmnm-pi` calls `@openlines/nmnm-core` directly, with SQLite as the storage authority; it never invokes or parses the CLI.

## Install

Requires Node.js 22.19+ and Pi 0.87.0+. See [Boundaries](#boundaries) for compatibility and live-test limits. Install the public package:

```sh
pi install npm:@openlines/nmnm-pi
```

From a nanomneme checkout, try the extension without installing it:

```sh
pi -e ./adapters/pi/extensions/index.js
```

To add the checkout to this project's Pi settings, use an absolute package path:

```sh
pi install -l "$(pwd)/adapters/pi"
```

For Git installation, replace `<released-tag-or-commit>` with an existing tag or commit:

```sh
pi install git:github.com/linellazatin/nanomneme@<released-tag-or-commit>
```

Extensions have full local-system access; review package, checkout, or Git source before installation.

## Logslines diagnostics

- `src/logslines.js` binds Pi identity, user settings, and host session correlation to `@openlines/nmnm-core/logging`. Pi uses core's generated runtime and shared catalog.
- Diagnostics default off. Shared `~/.local/share/nanomneme/config.jsonc` supplies defaults; global `<Pi agent directory>/nmnm.jsonc` overrides them. Project settings cannot enable logging. `/reload` refreshes the lazy logger's settings.
- Diagnostics cover model 4Rs, confirmed browser mutations, and `/memory pin`, `unpin`, and `remove` attempts, including policy blocks. Timing excludes confirmation.
- Navigation, search, Back, cancellation, read-only/invalid commands, lifecycle events, and context injection are unlogged. Context diagnostics are deferred; use `/memory status` for injection state/errors.
- Records append to `~/.local/share/nanomneme/logs/nmnm-pi.jsonl`, using the adapter version and `ctx.sessionManager.getSessionId()` correlation when available, otherwise null.
- Logging failures preserve memory results, errors, notifications, and trust decisions. Raw error messages are not redacted; review logs before sharing.

The [Logger manual](../../../docs/LOGGER.md#configuration-and-record-contract) defines the shared record contract, configuration, permissions, and privacy boundaries. The [shared catalog](../../../shared/logger/catalog.js) defines exact operation/outcome combinations.

## Native memory tools

Four model tools require Pi project trust for project operations. Explicit global scope/store remains available in untrusted projects, as do user-invoked `/memory` project commands.

Successful tool JSON is capped at 50 KiB (51,200 UTF-8 bytes). Fitting results remain canonical; oversized results return valid JSON with `truncated: true`, byte diagnostics, record identifiers/page summaries, bounded previews, and narrowing/CLI guidance. Stored records remain unchanged.

| Tool | Input | Description | Notes |
|---|---|---|---|
| `retain_memory` | `content`; optional `id`, canonical fields | Create, or patch and restore a known ID. | New records require `content`. Scope selects the matching write store. |
| `recall_memory` | `id`; optional `store` | Read one active, unexpired memory. | Returns canonical core JSON or `null`; missing stores remain absent. |
| `retrieve_memory` | Optional query, filters, ordering, pagination, `store` | Search or list active memories. | One store only; missing stores return `{ total: 0, items: [] }`. Core FTS syntax and malformed-query fallback apply; this is not substring search. |
| `remove_memory` | `id`; optional `store` | Soft-remove an active memory. | Reversible through an explicit retain patch; irreversible purge requires CLI or UI workbench action; missing stores return `null`. |

`retain_memory` selects its store through `scope` (default `project`); other tools use `store: "project" | "global"`, also defaulting to project. Retain scope is trimmed/validated before routing or trust checks; invalid scope never creates a store. Only retain creates missing stores. Paths are `./.nanomneme/memory.db` and, on Linux/macOS, `~/.local/share/nanomneme/memory.db`. No CLI flags or custom database paths are supported.

Creation examples: `{"content":"Use SQLite for storage."}` or, for a cross-project preference, `{"content":"Prefer concise documentation.","kind":"preference","scope":"global"}`. Omit `id` and unnecessary fields. Patch the latter with `{"id":"<returned-id>","scope":"global","content":"Prefer concise documentation with runnable examples."}`, substituting its returned UUID. Patch/restore only an existing ID in its original scope; records never move stores. Successful retain confirms the write without a follow-up recall.

Creation defaults: `kind: "note"`, `namespace: "default"`, `importance: 0.5`, `confidence: 1`, empty tags, no expiry. Patches preserve omitted fields; supplied tags/metadata replace, not merge.

Retain schemas describe kinds (`note`, `decision`, `preference`, `fact`, `instruction`), project/global scope, inclusive 0–1 scores, lowercase kebab-case namespaces/tags (e.g. `node-22`), and generated UUID v4 IDs. Expiry accepts `null` or calendar-valid UTC with milliseconds (e.g. `2030-01-01T00:00:00.000Z`). Creation requires non-whitespace content. Schemas request unpadded values; core still trims text and validates Unicode, calendar dates, and record existence. Schema/loader checks alone do not prove provider acceptance or first-attempt model success.

Historical live evidence: Pi 1.3.0 with `amazon-bedrock/global.openai.gpt-6-luna` (low thinking) passed five fresh synthetic sessions covering project autoretention, global preference creation, tags/scores, expiry, and a known-ID global patch. Each made one successful retain without retries/post-write reads; the patch used one pre-write recall. Records/routing were independently checked read-only. This single-model sample supplements compatibility checks and does not guarantee categorization: the project decision retained default `kind: "note"`.

Metadata accepts a JSON object or `null`; null becomes `{}`, with provenance added on creation. Retrieval `importance`/`confidence` accept an inclusive 0–1 number, a nonempty `gt`/`gte`/`lt`/`lte` range object with 0–1 values, or `null` (no filter). Core validates nested JSON and rejects unsupported range operators.

## Automatic memory index

The first user prompt receives bounded system-prompt context: enabled autoretention guidance, then pins, then recent active memories. Trusted projects compose project/global settings and records; untrusted projects use only global data, without reading project settings, pins, or databases. Index rows contain store, optional `[source]`, ID, and preview; use recall/retrieve for full records.

New Pi records get `metadata.source: "pi"`; ID patches preserve it when metadata is omitted. Older/external records show a source only if one exists.

Context is transient, not a session message. Refresh, successful compaction, and successful retain/remove/pin/unpin queue a rebuild for the next user prompt; reads and no-op removals do not. Index reads never create/migrate databases; missing stores are empty. Missing/removed/expired/unreadable pin targets are skipped and counted as unresolved, but remain configured until unpinned.

## Pins and configuration

Settings and pins are separate adapter files outside SQLite.

| Scope | JSONC settings | JSON pins |
|---|---|---|
| Project | `.nanomneme/nmnm.jsonc` | `.nanomneme/nmnm-pi.json` |
| Global | `<Pi agent directory>/nmnm.jsonc` | `~/.local/share/nanomneme/nmnm-pi.json` |

The Pi agent directory defaults to `~/.pi/agent`, overridden by `PI_CODING_AGENT_DIR`. The adapter only reads settings; comments/trailing commas are allowed.

### Complete settings template

Copy this `nmnm.jsonc` template to either settings location for context options. Only global settings can enable logging.

```jsonc
{
  // Total character limit for transient autoretention guidance and the memory index.
  "injection_budget": 2000,
  "brief": { "enabled": false },
  "summary": { "autocapture": { "enabled": false } },

  // Disabled unless explicitly true. Rebuild current bounded context every five user prompts.
  "reinjection": {
    "enabled": false,
    "every_n_prompts": 5,
  },

  // Read from global Pi settings only. Reload Pi after changing it.
  "logging": { "enabled": false },

  // Disabled unless explicitly true. Rules guide the active model's retain_memory calls.
  "autoretention": {
    "enabled": false,

    // Durable facts the agent may retain without asking again.
    "always_persist": [
      "Project architecture decisions that affect future work.",
      "Validated commands or environment configuration required to work in this project.",
    ],

    // Never retain sensitive or short-lived material automatically.
    "never_persist": [
      "Secrets, credentials, API tokens, private keys, or personal data.",
      "Tool output, logs, or routine progress updates.",
    ],

    // Ask before retaining facts whose durable value depends on the user.
    "always_ask": [
      "User preferences or workflow conventions not explicitly stated as durable.",
      "Potentially sensitive project details that are not credentials.",
    ],
  },
}
```

Write concise, scope-appropriate rules: global safeguards plus project-specific guidance.

Pin files are JSON arrays, updated by browser actions or `/memory pin` and `/memory unpin`:

```json
["<memory-id>"]
```

Pin mutations take an exclusive same-directory lock, reread the pin array, and atomically replace the pin file with owner-only permissions (`0600`). Competing writers receive a retry error. Locks are never reclaimed automatically; see [Pin update locks](#pin-update-locks) for crash recovery.

`injection_budget` is the nonnegative total context character limit: project overrides global, default 2,000. Complete guidance precedes index rows; rules are never truncated. Enabled guidance includes a creation example, original-store patch routing, and a reminder not to redirect untrusted project memories to global. This invocation reminder consumes 290 characters including its newline within the unchanged budget. If guidance alone exceeds it, context is omitted until rules shrink or the budget increases.

Autoretention defaults off; project `enabled` overrides global. Rule arrays combine global-first: `never_persist` takes precedence, `always_ask` requires confirmation, and `always_persist` guides applicable retention. The active model decides whether to call `retain_memory`; the adapter never writes automatically.

Reinjection also defaults off, with project `enabled` overriding global. `every_n_prompts` must be a positive safe integer, resolved project → global → `5`. Eligible user prompts increment a session-local counter; reaching the interval rebuilds context in that prompt (`cadence`). Successful builds reset the counter; failures stay pending. Slash commands/custom-message runs do not count, and custom runs preserve pending injection for the next user prompt. Effective policy is cached after a successful build; apply settings changes with `/memory refresh` or session reload. Cadence shares the context budget, increases recurring provider input/cache activity, and creates no timer, worker, session record, memory, or SQLite write.

Project/global pins use identical ID formats but distinct `(store, id)` references. The unreleased combined `nmnm-memory.json` layout is not migrated.

### Normal file lifecycle

Loading registers tools/hooks; session start validates existing configuration. Neither creates settings, pins, or databases. Optional, user-authored `nmnm.jsonc` overrides the budget or enables autoretention, reinjection, or global-only logging. Missing settings use defaults; the adapter never rewrites them.

| Event or action | Reads | Writes | What to expect |
|---|---|---|---|
| Extension load | Nothing | Nothing | No nanomneme files appear; global logging opt-in is read on the first eligible attempt. |
| Session start | Existing settings and pins | Nothing | Read-only validation reports malformed configuration without preventing Pi startup. |
| First user prompt, queued refresh, or enabled cadence | Existing settings, pins, and SQLite stores | Nothing | Appends bounded index/enabled rules transiently. Cadence defaults off and counts user prompts only; missing files/stores are empty. |
| Successful Pi compaction | Nothing immediately | Nothing | The next user prompt rebuilds the transient index and enabled rules. Pi's own compaction summary preserves session continuity. |
| `retain_memory` | Scope-selected store when patching | Selected `memory.db` and core-derived rows | Creates missing store; success queues next-prompt rebuild. Settings/pins unchanged. |
| `recall_memory` or `retrieve_memory` | Selected existing `memory.db` | Nothing | Missing stores return `null` or an empty page without creating a database. |
| `remove_memory` | Selected existing `memory.db` | Selected `memory.db` and core-derived rows | Missing store returns `null`; removal queues next-prompt rebuild. Settings/pins unchanged. |
| `/memory` or `/memory browse` | Existing settings, pins, and stores | Explicit pin/store mutations; mutation JSONL if diagnostics enabled | Model-free browser; navigation/search/canceled removal are unlogged. Missing stores stay absent. |
| `/memory status` | Existing settings, pins, and stores | Nothing | Shows pin counts, budget, payload characters (including inter-section separator), unresolved pins, and injection lifecycle; no memory content. |
| `/memory refresh` | Nothing immediately | Nothing | The next user prompt rebuilds the hidden index. |
| `/memory list ...` | Both default stores, or the selected `memory.db` and pins | Nothing | Displays a bounded, paginated active-memory page without invoking the model. |
| `/memory remove ...` | Both stores if unqualified, otherwise selected `memory.db` | Selected `memory.db` on success; JSONL if logging enabled | Unambiguous soft removal queues next-prompt rebuild; ambiguity yields `blocked` without mutation. |
| `/memory pin ...` | Selected active `memory.db` and existing pins | Selected `nmnm-pi.json` on success; JSONL if logging enabled | Validates target before pin-file creation; serialized atomic update queues rebuild. Settings unchanged. |
| `/memory unpin ...` | Existing selected pins | Selected `nmnm-pi.json`; JSONL if logging enabled | Serialized atomic update removes unresolved references too; absent pins still notify and queue refresh. |

Before startup or between prompts, create the directory and copy the template to `.nanomneme/nmnm.jsonc`; adjust budget, autoretention, or reinjection:

```sh
mkdir -p .nanomneme
```

Invalid settings/pins stay unchanged. Startup reports errors without blocking Pi; failed injection stays pending and retries after correction on the next user prompt, without `/memory refresh`.

## Slash command reference

| Command | Input example | Description | Notes |
|---|---|---|---|
| `/memory` | None | Open the memory browser. | Equivalent to `/memory browse`; requires a UI-capable mode. |
| `/memory browse` | None | Browse, search, inspect, pin/unpin, or soft-remove active memories. | In the Pi TUI, use left/right arrows for `Status`, `All`, `Project`, and `Global` tabs. Store tabs contain search, source, records, paging, and Close; never invokes the model. |
| `/memory refresh` | None | Queue a hidden index rebuild. | The next user prompt performs the read-only rebuild. |
| `/memory status` | None | Show a compact transient-context status card. | Reports aligned field values defined below without exposing injected content or writing files/stores. |
| `/memory list [store] [all\|pi] [limit] [offset]` | `/memory list global pi 50` | List active memories without the model. | Omit source or use `all` for every record, including legacy records without a source. `limit` is 1-100; `offset` is 0-1,000. |
| `/memory remove [store] <id>` | `/memory remove global <memory-id>` | Soft-remove an active memory. | Unscoped IDs resolve one store or refuse ambiguity. Pins remain durable. |
| `/memory pin [store] <id>` | `/memory pin global <memory-id>` | Pin an active memory for Pi index injection. | Omit `store` for project. Validation occurs before any pin-file write. |
| `/memory unpin [store] <id>` | `/memory unpin <memory-id>` | Remove a Pi pin reference. | Omit `store` for project; unresolved references can be removed. |

### Slash command behavior

| Topic | Behavior |
|---|---|
| Browser controls | TUI tabs are `Status`, `All`, `Project`, `Global`; left/right or `h`/`l` switches tabs. Configured `tui.select.up`, `tui.select.down`, `tui.select.confirm`, `tui.select.cancel` control navigation/actions; `j`/`k` also navigate. Status shows the shared read-only card. Store tabs offer search, source, records, paging, and Close. Non-TUI UI modes use native dialogs; non-UI modes need explicit subcommands. |
| Browser filtering | Search uses FTS (hyphenated terms are literal). Source `all` includes legacy records; `pi` matches `metadata.source: "pi"`. Changing search/source resets that tab’s pagination. |
| Browser pagination | Both modes stop at offset 1,000 (records 1,001–1,020). If more remain, Next page is omitted with guidance to narrow search/source/store. |
| Browser selection | Tabs, details, and pin/unpin preserve selection; removal selects the nearest remaining row. Concurrently emptied pages fall back with valid selection, even when no records remain. Height-bounded windows follow selection/resizing; the host cursor marker keeps selection visible in smaller fullscreen docks. Very short terminals show only the selected row, with navigation still active. |
| Browser details | Native action-dialog titles show a 10-displayed-line content preview (including any truncation notice), then all canonical fields. Wrapping uses terminal width, default 80 columns; stored content is unchanged. Actions: exact-store pin/unpin, confirmed soft removal, back. Closing preserves browser selection. |
| List order | Unscoped list and browser `both` pages combine project entries before global entries; selected-store views read one store. |
| List display | Rows show store labels and exact `(store, id)` pin marker `*`. Browser rows omit IDs (shown in details); slash lists include them. Native dialogs add unique page-local row numbers to distinguish identical previews. Previews normalize whitespace, cap at 60 characters, and append `...` when truncated. Browser/notification text escapes stored C0/C1 controls except layout newlines/tabs as literal Unicode escapes; canonical content is unchanged. |
| List output | The notification reports `showing <n> of <total>` and is local command output, not a model request. |
| Pin validation | An unscoped pin needs an active project memory. A global-only ID leaves pin files unchanged and reports `/memory pin global <id>`. Explicit scopes validate their selected store. |
| Identity | UUID v4 collisions are unlikely, but explicit IDs and imports can duplicate IDs across stores; use `(store, id)`. |
| Index refresh | `refresh`, successful compaction, successful model retain/remove, and successful slash `pin`, `unpin`, or removal make the index eligible for the next prompt; they do not alter other memory records. |
| Unresolved pins | Removed, expired, missing, or unreadable targets stay configured until unpinned and are counted as unresolved. |

### Pin update locks

Browser/slash pin updates use `nmnm-pi.json.lock` beside the pin file. Existing locks return a retry error; owner PID is diagnostic only. Age, malformed ownership, or apparent PID death never authorize automatic reclamation: another process may have acquired the lock. Failed ownership writes close the descriptor and remove the incomplete lock. Cleanup attempts temporary-file removal, descriptor close, and lock removal. If cleanup fails after a committed update, Pi reports a stable manual-recovery error; enabled diagnostics emit one `failed` outcome with that `error.message`, without pin payloads.

After a Pi/Node pin-writer crash, stop every Pi writer of that file before removing its lock and retrying. PID inspection is supporting evidence only:

```sh
rm -- .nanomneme/nmnm-pi.json.lock
# or, for global pins:
rm -- ~/.local/share/nanomneme/nmnm-pi.json.lock
```

Stopping all writers is mandatory: this pathname lock is not a process-owned kernel lock. Removing it while a writer runs can invalidate ownership. A crash before replacement may also leave inert `nmnm-pi.json.<pid>.<timestamp>.tmp` files beside the pins; they neither alter nor block pins and may be removed after writers stop.

### Status card fields

`Summary autocapture` reports disabled or automatic native capture requirements. `Last summary capture` reports the most recent outcome; enabled configuration never promises a write.

`/memory status` and the Pi TUI browser’s Status tab show the same read-only card:

| Field | Meaning |
|---|---|
| `Injection pending` | `yes`: rebuild/attempt injection on the next eligible start. Set by session start, compaction, refresh, cadence, or successful memory mutations. |
| `Periodic reinjection` | Effective policy: `disabled` or eligible-prompt rebuild interval. |
| `Prompts since injection` | Eligible prompts counted with reinjection enabled; resets after a successful context build. |
| `Last` | This session's last successful injection: trigger, timestamp, entry count, and full character count, or `none`. Not a database write/browser action. |
| `Autoretention` | Whether effective autoretention guidance is enabled for the current index. |
| `Summary autocapture` | Effective capture enablement and trusted-project requirements. |
| `Last summary capture` | Latest capture outcome or `none`; saved checkpoints still contain unverified historical claims. |
| `Pins` | Configured project and global pin counts, including pins whose targets are currently unresolved. |
| `Index` | Effective budget, next-injection payload characters (including inter-section separator), and unresolved pins; no payload content. |
| `Error` | Latest context-build/status-read error and timestamp, or `none`; successful context builds clear it. |

### Pi token overhead

The four tool definitions include retain field descriptions, kind/scope values, score bounds, slug/UUID/expiry patterns, create/patch guidance, metadata schemas, and retrieval score filters. Serialized size depends on adapter/host; it is not a token/cost estimate. Pi adds tool names, descriptions, and request structure; each provider uses its own tokenizer.

First/queued prompts append at most `injection_budget + 2` system-prompt characters (default 2,002): shared guidance/index budget plus two separating newlines. Ordinary prompts append nothing unless a refresh or opt-in cadence is queued.

```text
first or queued-turn adapter overhead =
  provider-tokenized memory tool definitions + provider-tokenized injected context (0 to injection_budget + 2 characters)
```

Measure a model/provider with equivalent first-turn sessions, keeping prompt, project context, and other tools identical. Subtract first-response `usage.input` in session JSONL with/without `nmnm-pi`. On later turns, report `usage.cacheRead`/`usage.cacheWrite` separately from fresh input. Provider-reported session usage is authoritative for token/cost measurement.

## Boundaries

Pi's floor is 0.87.0. Main CI/releases use the reviewed lockfile; development-host checks accept stable `~1.6.0`. A blocking matrix covers `0.87.0`, `~0.87.0`, `~0.99.0`, `~1.2.0`, `~1.5.0`, and `~1.6.0`, reporting Pi/TUI/AI/TypeBox versions. It tests loading, provider schema constraints, host argument validation, and captured regular/fullscreen rendering, excluding only the development-host version assertion. It does not certify live providers/terminals or every intermediate release. Reproduce after `npm ci` in a disposable checkout with `node scripts/check-pi-compatibility.js '~1.6.0'` (or another selector); only `node_modules` changes, not manifests/locks.

Runner tests cover host-generated contexts, transient prompts, cadence, compaction refresh, wrapped mutations, and trust. From Pi 1.5.1, SDK threading tests use the real Anthropic provider with fake HTTP/SSE to check refresh/removal with/without native mid-conversation system messages, continuation fallback, and cache-warming replay isolation. Older hosts skip without loading newer APIs. Current-host CI rejects skipped/empty/missing threading coverage; reproduce with `NMNM_PI_REQUIRE_THREADING_TESTS=1` before the matrix command in a disposable checkout. These tests make no live requests and do not establish provider acceptance, cache savings, or terminal behavior.

Pi 1.5 introduced pi-schema tool validation; the adapter retains TypeBox imports and ordinary JSON Schema constraints. Its browser uses the floor-compatible host cursor marker with local escaping/row disambiguation, requiring no newer runtime API. Tests accept equivalent Google `const`/single-value `enum` constraints and check host validation, rejection, coercion, and nullable patches without engine-specific error wording.

Injection still uses the `before_agent_start` system-prompt return. Structured sections introduced in Pi 0.87 remain a separate behavior/cache probe; Pi 0.99 guidance prefers them over whole-prompt replacement. This release changes neither the replacement path nor injection lifecycle and claims no cache improvement.

Markdown memory/handoff storage, consolidation and automatic session resume remain unsupported, regardless of settings/pins/browser use. See the [Core and CLI Manual](../../../docs/CORE_CLI_MANUAL.md) and [adapter quick start](../README.md).

See the [Logger manual](../../../docs/LOGGER.md#source-and-artifact-map) for the shared source/artifact map and build/distribution checks.

## Project startup briefs

A summary is a persisted project work account supplied explicitly or captured by a supported adapter during compaction. A brief is an on-demand deterministic historical view of eligible summaries; it is not another memory record and uses no separate model or transcript access. Save the [JSON example](../../../docs/examples/project-summary.json) using `nmnm summary add --file summary.json --json`, then inspect `nmnm brief`. Configure the existing user or project `nmnm.jsonc`:

```json
{
  "brief": { "enabled": true }
}
```

Brief delivery defaults off. Project `brief.enabled` overrides the user value, including explicit false. A malformed brief-only object disables the brief without discarding otherwise valid ordinary context. Invalid broader settings retain their existing behavior. User settings may enable delivery across projects, but each brief reads only the receiving project's store. Existing ordinary global previews remain available; no global brief is constructed.

Pi delivers the brief at session startup and on its existing refresh, compaction and enabled prompt-cadence events. Untrusted project context is excluded; global memory is never a fallback for a project brief.

The adapter budgets ordinary guidance and memory previews first, including pins where supported. The brief uses up to 1000 UTF-16 code units of spare space after separators. It can repeat a summary already shown as an ordinary preview. The core emits full primary content or a complete UUID, date, status and title pointer with recall guidance. If neither fits, or the brief read fails, ordinary context remains available.

Use the existing `recall_memory` tool with the returned project UUID for full detail; existing tool output limits still apply. `nmnm summary update <id> --file summary.json` corrects an active supported summary. Existing removal, explicit restoration, expiry and transfer operations apply. Brief reads are read-only and unlogged and never create a missing store. See the [core/CLI contract](../../../docs/CORE_CLI_MANUAL.md#project-work-summaries-and-briefs) for fields, limits, historical scope and concurrent-update behavior.

To remove a brief source, use `nmnm summary remove <id> --json` with its project summary UUID. Briefs have no separate stored ID; the next configured refresh/reinjection or new session renders the remaining eligible summaries, or no brief when none remain. Already-injected context is unchanged.


## Native compaction checkpoints

Compaction autosummary is an additional memory feature: Pi generates the summary during normal compaction, and Nanomneme automatically saves eligible completed text when `summary.autocapture.enabled` is true. This explicit operator opt-in is standing authorization for capture; no editor, confirmation or further approval is requested. Interactive and headless sessions use the same path. Native text is not semantically filtered or certified safe by schema validation.

Capture defaults false and is independent of ordinary `autoretention.enabled`, `always_persist`, `always_ask` and `never_persist` guidance. These rules still guide ordinary model-directed memory operations but do not gate this separate capture feature. Project capture settings override user settings, including false; invalid capture-only settings disable capture without losing ordinary context. Malformed broader settings retain existing fail-open behavior. Disable `summary.autocapture.enabled` to stop capture. `brief.enabled` independently controls deterministic read-side delivery and never enables capture itself.

The adapter reads the successful `session_compact` event’s completed summary. It does not change compaction prompts, replace compaction, rewrite provider requests or make another inference call. A trusted project is required. Effective capture enablement, project location and trust are checked again before saving; ineligible or disabled events create no store. There is no durable pending-text queue or automatic repair/retry.

Records are project/note/project-summary with source pi and format `nanomneme/native-compaction-summary`. Full normalized text is preserved within the 8192 UTF-8 byte payload limit; oversized/invalid text is skipped whole. Completion dates do not verify claims inside the prose. Whole events, system messages, branch entries, native session/entry IDs and transcripts are not retained. Extension-produced compactions and unknown trigger values skip capture; absent trigger values are not invented. Required native entry type, bounded identifier and canonical timestamp must be present.

In-process receipts suppress repeated callbacks while retained in the bounded 256-entry set. Project-scoped opaque core receipts prevent another record or restoration on replay across reloads, without prompting. Conflicts fail without repair. Generic metadata replacement, purge or store replacement can erase receipts; they are not an immutable audit ledger. No historical catch-up or global fallback occurs.

Startup and `/memory status` report configuration and trusted-project requirements. The last capture row reports saved, untrusted, disabled, changed, duplicate, inactive, invalid or unavailable outcomes. A successful save queues the existing context refresh. Fresh sessions and other adapters consume the same core-rendered historical brief when their independent brief setting is enabled. Long native text normally appears as a complete recall pointer within existing budgets; use its UUID for full recall. Correct sources through `nmnm summary update <id> --file native-summary.json`; removal, explicit restoration and transfer use existing CLI/core operations.

Native RPC checks use a local synthetic provider to exercise manual/automatic threshold capture, zero editor/confirmation requests, ordinary retention-rule independence, disablement, untrusted projects, provider failure and cancellation. Successful compaction uses one existing compaction request; capture adds none. Real-model summary semantics, overflow recovery and extension-generated capture remain unverified.

Additional loaded-agent-runtime simulation completed 15 provider-scripted memory operations covering project/global creation, recall/search, patch, removal and restoration in 16 requests including the final continuation. The actual SDK built requests, parsed SSE and executed registered tools; only transport was substituted. This is runtime/tool-loop evidence, not native-terminal or real-model acceptance.

Run `NMNM_PI_NATIVE=/absolute/path/to/pi node --test adapters/pi/test/native-compaction.test.js` from the repository root to reproduce native capture and fresh-session checks. It loads the production adapter with a local synthetic provider and no review prompts against disposable homes/projects; personal registration, trust and stores stay unchanged.
