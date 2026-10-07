# Pi Adapter Manual

`@openlines/nmnm-pi` is the Pi harness adapter for nanomneme. It calls `@openlines/nmnm-core` directly, keeps SQLite as the storage authority, and does not invoke or parse the CLI.

## Install

Use Node.js 22.19+ and Pi 0.87.0 or newer, verified through Pi 1.0.4. This manual describes `@openlines/nmnm-pi` 0.4.2. Install the public package:

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

For a Git installation, replace the placeholder with an existing release tag or commit. Do not treat the placeholder as an executable version:

```sh
pi install git:github.com/linellazatin/nanomneme@<released-tag-or-commit>
```

Pi runs package extensions with full local-system access. Review package, checked-out, or Git source before installing it.

## Logslines diagnostics

- `src/logslines.js` binds Pi identity, user settings, and host session correlation to `@openlines/nmnm-core/logging`. Pi uses core's generated runtime and shared catalog.
- Diagnostics default off. Shared `~/.local/share/nanomneme/config.jsonc` supplies the default; global `<Pi agent directory>/nmnm.jsonc` can override it. Project settings cannot enable logging. Run `/reload` to refresh the lazy logger's settings.
- Model-facing 4Rs, confirmed browser mutations, and explicit `/memory pin`, `unpin`, and `remove` attempts are observed. Policy blocks are recorded when enabled; timing excludes user confirmation.
- Navigation, search, Back, canceled actions, read-only commands, invalid command usage, lifecycle events, and automatic context injection remain quiet. Context diagnostics are deferred; `/memory status` reports injection state and errors.
- Records append to `~/.local/share/nanomneme/logs/nmnm-pi.jsonl`, using the adapter version and `ctx.sessionManager.getSessionId()` correlation when available, otherwise null.
- Logging failures preserve memory results, errors, notifications, and trust decisions. Raw error messages are not redacted; review logs before sharing.

The [Logger manual](../../../docs/LOGGER.md#configuration-and-record-contract) defines the shared record contract, configuration, permissions, and privacy boundaries. The [shared catalog](../../../shared/logger/catalog.js) defines exact operation/outcome combinations.

## Native memory tools

Pi exposes four tools to the model. Model-facing project operations require the current project to be trusted by Pi. In an untrusted project, use explicit global scope/store operations; user-invoked `/memory` commands remain available for explicit local project management.

Successful model-visible tool JSON is limited to 50 KiB (51,200 UTF-8 bytes). Results that fit retain their existing canonical JSON. Oversized results return valid JSON with `truncated: true`, byte-count diagnostics, stable record or page identifiers, bounded content previews, and guidance to narrow the request or use the CLI. This summary does not modify or truncate the canonical stored memory.

| Tool | Input | Description | Notes |
|---|---|---|---|
| `retain_memory` | `content`; optional `id`, canonical fields | Create, or patch and restore a known ID. | New records require `content`. Scope selects the matching write store. |
| `recall_memory` | `id`; optional `store` | Read one active, unexpired memory. | Returns canonical core JSON or `null`; missing stores remain absent. |
| `retrieve_memory` | Optional query, filters, ordering, pagination, `store` | Search or list active memories. | One store only; missing stores return `{ total: 0, items: [] }`. Core FTS syntax and malformed-query fallback apply; this is not substring search. |
| `remove_memory` | `id`; optional `store` | Soft-remove an active memory. | Reversible through an explicit retain patch; irreversible purge requires CLI or UI workbench action; missing stores return `null`. |

For `retain_memory`, scope selects the matching write store: omitted scope means project and `scope: "global"` means global. Scope is trimmed and validated before routing or project-trust checks; invalid scope never creates a store. The other tools use optional `store` (`"project"` or `"global"`) to choose a physical database. Project data is `./.nanomneme/memory.db`; global data is `~/.local/share/nanomneme/memory.db` on Linux and macOS. Results are canonical core JSON records. The adapter does not parse CLI flags or support custom database paths. Only `retain_memory` creates a missing store.

Tool schemas describe metadata as a JSON object or `null`, which retain normalizes to an empty object before adding new-record provenance. Retrieval `importance` and `confidence` accept a number from 0 to 1, a non-empty range object using `gt`, `gte`, `lt`, or `lte` with values from 0 to 1, or `null` for no filter. Core validates nested metadata JSON values and rejects unsupported range operators.

## Automatic memory index

At the first user prompt in each trusted Pi session, the adapter appends bounded Nanomneme context to that prompt's system prompt. In an untrusted project, this automatic context is global-only: the adapter does not read project settings, project pins, or the project database. Enabled global autoretention guidance takes priority, followed by a compact index. In a trusted project, project and global settings and memories compose as described below. Pinned entries come first, with recent active records after them. Rows contain `store`, a `[source]` label when recorded, ID, and a short content preview. It is not a transfer of complete records; use `recall_memory` or `retrieve_memory` for full content.

New Pi retains record `metadata.source` as `"pi"`. **Note:** ID-based patches preserve existing source when metadata is omitted; older or externally created records have no source label unless they already carry one.

The index is transient, not a session message. It is rebuilt for the next user prompt after `/memory refresh`, successful Pi compaction, or a successful retain, remove, pin, or unpin mutation. Read operations and no-op removals do not trigger it. Missing databases are empty. Missing, removed, expired, or otherwise unreadable pins are skipped and counted as unresolved. The pin remains configured until explicitly unpinned. Index reads are read-only and never create or migrate a SQLite database.

## Pins and configuration

Settings and pins are separate adapter files outside SQLite.

| Scope | JSONC settings | JSON pins |
|---|---|---|
| Project | `.nanomneme/nmnm.jsonc` | `.nanomneme/nmnm-pi.json` |
| Global | `<Pi agent directory>/nmnm.jsonc` | `~/.local/share/nanomneme/nmnm-pi.json` |

Pi's agent directory defaults to `~/.pi/agent`; current Pi uses `PI_CODING_AGENT_DIR` to override it. Settings are read-only to the adapter and may use comments or trailing commas.

### Complete settings template

This is the supported `nmnm.jsonc` shape. Copy it to either settings location above for context options. Only the global file can opt in to logging.

```jsonc
{
  // Total character limit for transient autoretention guidance and the memory index.
  "injection_budget": 2000,

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

Use concise, scope-appropriate natural-language rules. Global rules provide baseline safeguards across projects; project rules add project-specific guidance.

Pin files are plain JSON arrays, written only by `/memory pin` and `/memory unpin`:

```json
["<memory-id>"]
```

Pin mutations take an exclusive same-directory lock, reread the current array while holding it, then atomically replace the file. Production mutations create or replace the pin file with owner read/write permission (`0600`). A concurrent pin or unpin reports that updates are in progress and can be retried. Lock ownership is never reclaimed automatically, because a stale observer could otherwise delete a newly acquired lock; use the manual recovery procedure below only after a Pi crash.

`injection_budget` is a non-negative total character limit for all transient Nanomneme context. The project value overrides the global value; the default is 2,000. Complete autoretention guidance is included before index rows; individual rules are never truncated. If enabled guidance alone exceeds the budget, no Nanomneme context is injected until the rules are shortened or the budget is raised. `autoretention` is inactive unless its effective `enabled` value is `true` (project overrides global). Rule arrays from both scopes combine with global entries first; `never_persist` takes precedence, `always_ask` requires user confirmation, and `always_persist` guides the active model when applicable. The adapter never writes memory directly for autoretention: the active model decides whether to call `retain_memory`.

`reinjection` is disabled unless its effective `enabled` value is `true` (project overrides global). When enabled, `every_n_prompts` is a positive safe integer that resolves project, then global, then `5`. After a successful context build, each eligible user prompt increments a session-local counter; the configured prompt queues a transient `cadence` rebuild in that same prompt. A successful build resets the counter, while a failed build leaves it pending. Slash commands do not count. The adapter caches the effective policy after a successful build, so ordinary prompts do not reread settings or stores; change settings with `/memory refresh` or reload the session. Cadence uses the existing total `injection_budget`, increases recurring provider input/cache activity, and creates no timer, worker, session record, memory, or SQLite write. A project pin and a global pin use the same ID format but remain distinct `(store, id)` references. The unreleased combined `nmnm-memory.json` layout is not migrated automatically.

### Normal file lifecycle

On extension load and session start, the adapter registers its tools and hooks only. It does not create a settings file, a pin file, or a database. `nmnm.jsonc` is optional and user-authored: create it only to override the default index budget or opt into autoretention, periodic reinjection, or global-only logging. If it is absent, the adapter uses the defaults. The adapter never rewrites it.

| Event or action | Reads | Writes | What to expect |
|---|---|---|---|
| Extension load | Nothing | Nothing | No nanomneme files appear; global logging opt-in is read on the first eligible attempt. |
| Session start | Existing settings and pins | Nothing | Read-only validation reports malformed configuration without preventing Pi startup. |
| First user prompt, queued refresh, or enabled cadence | Existing settings, pins, and SQLite stores | Nothing | A bounded index, and enabled autoretention rules, are appended transiently to the system prompt. Cadence is disabled by default and counts user prompts only. Missing files and stores are empty. |
| Successful Pi compaction | Nothing immediately | Nothing | The next user prompt rebuilds the transient index and enabled rules. Pi's own compaction summary preserves session continuity. |
| `retain_memory` | Scope-selected store when patching | Selected `memory.db` and core-derived rows | The core creates a missing selected database; a successful mutation queues next-prompt index rebuild; no Pi settings or pin file changes. |
| `recall_memory` or `retrieve_memory` | Selected existing `memory.db` | Nothing | Missing stores return `null` or an empty page without creating a database. |
| `remove_memory` | Selected existing `memory.db` | Selected `memory.db` and core-derived rows | Missing stores return `null`; successful removal queues next-prompt index rebuild; no Pi settings or pin file changes. |
| `/memory` or `/memory browse` | Existing settings, pins, and stores | Pins or stores only on explicit mutation; if global diagnostics are enabled, a JSONL outcome for a browser mutation | Opens the model-free memory browser. Navigation, search, and canceled removal do not write diagnostic records; missing stores remain absent. |
| `/memory status` | Existing settings, pins, and stores | Nothing | Pi shows pin counts, effective budget, current full-payload character count (including the separator when both context sections exist), unresolved count, and transient injection lifecycle metadata; it never shows injected memory content. |
| `/memory refresh` | Nothing immediately | Nothing | The next user prompt rebuilds the hidden index. |
| `/memory list ...` | Both default stores, or the selected `memory.db` and pins | Nothing | Displays a bounded, paginated active-memory page without invoking the model. |
| `/memory remove ...` | Both stores when unqualified, otherwise the selected `memory.db` | Selected `memory.db` on success; an outcome JSONL line if logging is enabled | Soft-removes one unambiguous entry and queues next-prompt index rebuild; ambiguous IDs emit `blocked` without mutation. |
| `/memory pin ...` | Selected active `memory.db` and pin file when present | Selected `nmnm-pi.json` on success; an outcome JSONL line if logging is enabled | Validates the selected store before creating the pin file, serializes the atomic update, then queues next-prompt index rebuild; settings remain untouched. |
| `/memory unpin ...` | Selected pin file when present | Selected `nmnm-pi.json` and, if logging is enabled, an outcome JSONL line | Serializes the atomic update, removes the reference even when its memory is unresolved, and preserves the existing notification and refresh behavior for an absent pin. |

To create project settings manually before starting Pi or between prompts, create the directory, then copy the complete template above into `.nanomneme/nmnm.jsonc` and adjust `injection_budget`, autoretention, or reinjection if needed:

```sh
mkdir -p .nanomneme
```

An invalid settings or pin file leaves the file unchanged. Session start reports the configuration issue without preventing Pi startup. The next-prompt injection remains pending, so after correcting the file the following prompt retries automatically; `/memory refresh` is not required.

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
| Browser | In the Pi TUI, `/memory` and `/memory browse` open a custom menu with `Status`, `All`, `Project`, and `Global` tabs. Left/right selects tabs; configured `tui.select.up`, `tui.select.down`, `tui.select.confirm`, and `tui.select.cancel` bindings control selection, confirmation, and cancellation. Raw `h`/`l` change tabs and `j`/`k` navigate rows. Status renders the shared read-only card. Store tabs contain search, source selection, records, paging, and Close. Text search uses FTS retrieval (hyphenated terms are literal); changing search or source resets that tab’s pagination. Source `all` includes legacy records; `pi` matches `metadata.source: "pi"`. The selected row remains selected after tab changes, details, and pin/unpin; removal selects the nearest remaining row. Non-TUI UI modes retain the native dialog browser; non-UI modes should use explicit subcommands. |
| Browser details | Selecting a row opens a native action dialog whose title contains full canonical content and fields, then offers exact-store pin/unpin, confirmed soft removal, or back. Closing it returns to the custom browser with the previous selection retained. |
| List order | Unscoped list and browser `both` pages combine project entries before global entries; selected-store views read one store. |
| List display | Browser rows include `[project]` or `[global]`; `*` marks an exact `(store, id)` pin. They omit IDs; details show the selected record's ID. Previews normalize whitespace, show 60 characters, and append `...` only when truncated. |
| List output | The notification reports `showing <n> of <total>` and is local command output, not a model request. |
| Pin validation | An unscoped pin needs an active project memory. A global-only ID leaves pin files unchanged and reports `/memory pin global <id>`. Explicit scopes validate their selected store. |
| Identity | UUID v4 collisions are unlikely, but explicit IDs and imports can duplicate IDs across stores; use `(store, id)`. |
| Index refresh | `refresh`, successful compaction, successful model retain/remove, and successful slash `pin`, `unpin`, or removal make the index eligible for the next prompt; they do not alter other memory records. |
| Unresolved pins | Removed, expired, missing, or unreadable targets stay configured until unpinned and are counted as unresolved. |

### Pin update locks

Browser and slash-command pin/unpin mutations use a same-directory `nmnm-pi.json.lock` and replace the pin file atomically. Any existing lock causes the command to fail with a retry message. The lock records its owner PID for diagnosis only; it is never automatically reclaimed based on age, malformed ownership, or PID liveness, because doing so can delete a lock acquired by another process. If writing ownership fails during acquisition, the adapter closes its descriptor and removes the incomplete lock. Cleanup always attempts the temporary file, descriptor, and lock; if a completed pin update cannot finish cleanup, Pi reports a stable manual-recovery error and the logging observer emits one `failed` outcome whose `error.message` is that recovery error. Pin payloads are not included in that record.

After a Pi or Node process crashes during a pin mutation, stop every Pi process that could write the affected pin file. Inspect the lock's PID only as supporting evidence, then remove the lock manually and retry the command:

```sh
rm -- .nanomneme/nmnm-pi.json.lock
# or, for global pins:
rm -- ~/.local/share/nanomneme/nmnm-pi.json.lock
```

Never remove a lock merely because it is old, malformed, or its PID appears absent; a concurrent Pi process could have acquired it after inspection. The stop-all-writers step is mandatory: a pathname lock is not a process-owned kernel lock, so removing it while a writer remains live can invalidate that writer's ownership.

A crash before atomic replacement can also leave an inert same-directory `nmnm-pi.json.<pid>.<timestamp>.tmp` file. It does not alter or block the pin file. After stopping writers, it is safe to remove that temporary file along with a confirmed crash-left lock.

### Status card fields

`/memory status` and the Pi TUI browser’s Status tab show the same read-only card:

| Field | Meaning |
|---|---|
| `Injection pending` | `yes` means the next eligible agent start will rebuild and attempt transient context injection. Session start, compaction, refresh, cadence, and successful memory mutations can make it pending. |
| `Periodic reinjection` | The effective periodic policy: `disabled` or the configured interval after which eligible prompts queue a rebuild. |
| `Prompts since injection` | Eligible prompt count since the last successful injection while periodic reinjection is enabled. It resets after a successful injection. |
| `Last` | The most recent successful transient-memory injection in this Pi session. `none` means no injection has succeeded. Otherwise it reports the trigger, timestamp, index-entry count, and full injected character count. It is not the last database write or browser action. |
| `Autoretention` | Whether effective autoretention guidance is enabled for the current index. |
| `Pins` | Configured project and global pin counts, including pins whose targets are currently unresolved. |
| `Index` | Effective character budget, the full current next-injection payload size (including its separator when both sections exist), and unresolved pin count. The card does not expose payload content. |
| `Error` | The latest context-build or status-read error recorded in this session, with its timestamp; `none` means no error is currently recorded. A successful injection clears it. |

### Pi token overhead

`nmnm-pi` 0.4.x adds four model-visible tool definitions: `retain_memory`, `recall_memory`, `retrieve_memory`, and `remove_memory`. Metadata and score-filter parameters have explicit schemas; their serialized size depends on the adapter and host version. Schema size alone is not a token or cost estimate: Pi adds tool names, descriptions, and provider request structure, while each provider uses its own tokenizer.

The transient memory context is separately bounded. On the first prompt and each queued refresh, Pi appends at most `injection_budget + 2` characters to the system prompt: the configured context plus its two newline separator characters. With the default budget, that is at most 2,002 characters. Autoretention guidance and index rows share that limit. Ordinary prompts without a queued refresh append no memory context unless opt-in periodic `reinjection` queues a rebuild.

```text
first or queued-turn adapter overhead =
  provider-tokenized memory tool definitions + provider-tokenized injected context (0 to injection_budget + 2 characters)
```

To measure exact overhead for a chosen model and provider, compare equivalent first-turn sessions with identical prompt, project context, and enabled non-nanomneme tools: run once with `nmnm-pi` enabled and once without it, then subtract the first assistant response's `usage.input` values in the Pi session JSONL. For later turns, report `usage.cacheRead` and `usage.cacheWrite` separately rather than treating cached input as fresh overhead. Session usage is provider-reported and is the authoritative token and cost measurement.

## Boundaries

The current production adapter injects transient context through the `before_agent_start` system-prompt return. Pi 0.87 structured prompt sections remain under a separate behavior and cache probe; Pi 0.99 documentation prefers those sections over a whole-prompt replacement, but the replacement path is unchanged and this release does not claim a cache improvement or change the injection lifecycle.

This adapter has no Markdown memory storage, consolidation, separate compaction handoff, or auto-resume. Those capabilities are not implied by configuration, pins, or the browser. See the [Core and CLI Manual](../../../docs/CORE_CLI_MANUAL.md) for the core and CLI, and the [adapter quick start](../README.md) for the package-local entry point.

See the [Logger manual](../../../docs/LOGGER.md#source-and-artifact-map) for the shared source/artifact map and build/distribution checks.
