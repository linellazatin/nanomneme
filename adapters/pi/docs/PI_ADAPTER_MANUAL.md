# Pi Adapter Manual

`@openlines/nmnm-pi` is the Pi harness adapter for nanomneme. It calls `@openlines/nmnm-core` directly, keeps SQLite as the storage authority, and does not invoke or parse the CLI.

## Install

Use Node.js 22.19+ and Pi 0.87.0 or newer. This manual describes `@openlines/nmnm-pi` 0.3.0. Install the public package:

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

## Native memory tools

Pi exposes four tools to the model. Model-facing project operations require the current project to be trusted by Pi. In an untrusted project, use explicit global scope/store operations; user-invoked `/memory` commands remain available for explicit local project management.

## Logslines diagnostics

`src/logger.js` is the model-tool logging boundary for the Pi adapter and the reference template for later Nanomneme adapters. It emits one closed `logslines/v1` outcome record for each model-facing retain, recall, retrieve, or remove attempt that reaches a terminal adapter outcome. The adapter delegates record validation and envelope construction to `@openlines/logslines`.

This instrumentation currently covers only the four tools in [Native memory tools](#native-memory-tools). User-invoked `/memory` commands, the native memory browser, automatic context injection, pin operations, and other non-model adapter paths do not emit Logslines records yet.

### Emission and destination

The default Pi sink appends JSON Lines to `~/.local/share/nanomneme/logs/nmnm-pi.jsonl`: one complete JSON object followed by a newline for each emitted record. The `logs` directory is created on the first emitted record. The filename is derived from the owning Logslines service component, `nmnm-pi`. The adapter does not configure rotation, transport, indexing, search, dashboards, or telemetry.

The adapter records one of these terminal outcomes:

- A core memory operation completes, including an empty retrieval or a requested memory that is absent.
- Pi project-trust policy blocks a model-facing project operation before the core is called.
- The core operation throws.

A logger, validation, sink, serialization, or host-session lookup failure is contained. It returns no record and does not change the memory tool's result, error, mutation refresh, or trust decision. The normal tool operation remains the authority for success or failure.

### Record shape

Every emitted record has exactly the following 12 top-level fields. `logslines/v1` rejects additional top-level fields.

| Field | Type and adapter value | Meaning in this adapter |
|---|---|---|
| `schema` | String, always `"logslines/v1"` | Stable wire-contract identifier. It is independent of adapter and Logslines package versions. |
| `timestamp` | UTC RFC 3339 string ending in `Z`, created by the Logslines emitter | Time at which the record is emitted. |
| `level` | `"info"`, `"warn"`, or `"error"` | Diagnostic severity selected from the operation outcome mapping below. |
| `event` | Stable `memory.*` identifier | Specific terminal event selected from the operation outcome mapping below. |
| `message` | Fixed non-empty summary string | Human-readable outcome summary selected from the operation outcome mapping below. |
| `service` | Closed object | Constant adapter identity described in [Service identity](#service-identity). |
| `context` | Closed object with `session_id` only | Opaque Pi host-session correlation described in [Session context](#session-context). |
| `operation` | One of `retain`, `recall`, `retrieve`, or `remove` | Logical Nanomneme 4R action. |
| `status` | `ok`, `empty`, `not_found`, `blocked`, or `failed` | Terminal outcome. The full Logslines vocabulary also includes `skipped` and `partial`, but the current Pi model-tool surface does not emit them. |
| `duration_ms` | Finite non-negative number or `null` | Measured core-operation duration, or `null` for a policy block that has no meaningful operation duration. |
| `attributes` | Always `{}` | The current event catalog defines no event-specific attributes. |
| `error` | `null` except for `failed` | Generic normalized failure object described in [Failure records](#failure-records). |

#### Service identity

The `service` object is closed and always has exactly these non-empty string values:

```json
{
  "namespace": "openlines",
  "name": "nanomneme",
  "component": "nmnm-pi",
  "version": "<the adapter package version>"
}
```

`version` comes from `adapters/pi/package.json` at module load time. It identifies the adapter component, not the Logslines wire schema and not the core package version.

#### Session context

The `context` object is closed and always has exactly one property:

```json
{ "session_id": "<opaque Pi session ID or null>" }
```

When available, the adapter obtains the value from Pi's `ctx.sessionManager.getSessionId()`. It passes that value through unchanged only when it is a non-empty string. The adapter does not create, derive, sanitize, hash, or otherwise replace a session ID. When Pi provides no session manager or ID, or the lookup throws, it emits `null`.

#### Duration

For `retain`, `recall`, `retrieve`, and `remove` calls that pass the trust boundary, the adapter starts a monotonic timer immediately before invoking the core and records the elapsed milliseconds after it returns or throws. The recorded value is clamped to zero or greater. It includes the synchronous adapter-to-core operation, including selected-store presence checks that occur inside the logged operation.

A `blocked` record has `duration_ms: null`: Pi project trust rejected the model-facing project operation before a core memory operation began. The adapter does not fabricate a duration for this policy result.

### Operation outcomes and events

The event catalog is closed by `src/logger.js`. The table lists every currently emitted combination.

| Operation | Status | Level | Event | Message | When emitted |
|---|---|---|---|---|---|
| `retain` | `ok` | `info` | `memory.retained` | `Memory retention completed` | The core retain operation returns. |
| `retain` | `blocked` | `warn` | `memory.retain_blocked` | `Memory retention blocked` | Pi project trust blocks the selected project store. |
| `retain` | `failed` | `error` | `memory.retain_failed` | `Memory retention failed` | The core retain operation throws. |
| `recall` | `ok` | `info` | `memory.recalled` | `Memory recall completed` | A requested active memory is returned. |
| `recall` | `not_found` | `info` | `memory.recall_not_found` | `Memory was not found` | The requested memory is absent, inactive, expired, or the selected store does not exist. |
| `recall` | `blocked` | `warn` | `memory.recall_blocked` | `Memory recall blocked` | Pi project trust blocks the selected project store. |
| `recall` | `failed` | `error` | `memory.recall_failed` | `Memory recall failed` | The core recall operation throws. |
| `retrieve` | `ok` | `info` | `memory.retrieved` | `Memory retrieval completed` | The returned page has one or more matching records. |
| `retrieve` | `empty` | `info` | `memory.retrieved` | `Memory retrieval completed with no results` | The returned page has `total: 0`, including a missing selected store. |
| `retrieve` | `blocked` | `warn` | `memory.retrieve_blocked` | `Memory retrieval blocked` | Pi project trust blocks the selected project store. |
| `retrieve` | `failed` | `error` | `memory.retrieve_failed` | `Memory retrieval failed` | The core retrieve operation throws. |
| `remove` | `ok` | `info` | `memory.removed` | `Memory removal completed` | The core soft-remove operation returns an active memory. |
| `remove` | `not_found` | `info` | `memory.remove_not_found` | `Memory was not found` | The requested memory is absent, inactive, expired, or the selected store does not exist. |
| `remove` | `blocked` | `warn` | `memory.remove_blocked` | `Memory removal blocked` | Pi project trust blocks the selected project store. |
| `remove` | `failed` | `error` | `memory.remove_failed` | `Memory removal failed` | The core remove operation throws. |

`ok`, `empty`, and `not_found` are successful logical outcomes and therefore use `error: null`. A project-policy block is also not a core failure and uses `error: null`.

### Failure records

Only `status: "failed"` has a non-null `error` object. It is closed and currently uses this generic shape, substituting the current operation name:

```json
{
  "kind": "unknown",
  "code": "<operation>_failed",
  "message": "Memory <operation label> failed",
  "retryable": false
}
```

Examples include `retain_failed`, `recall_failed`, `retrieve_failed`, and `remove_failed`. The message is the same fixed message in the outcome table. No `cause_kind` is emitted today. The adapter deliberately does not classify underlying core exceptions, expose their error class, copy their message, include a stack trace, or infer whether a retry may work.

For every status other than `failed`, `error` is exactly `null`. In particular, `blocked`, `empty`, and `not_found` do not carry errors.

### Privacy boundary

The logger uses an empty `attributes` object for every current event. Records do not contain:

- Memory content or previews.
- Recall or removal IDs.
- Retrieval queries, filters, result totals, offsets, ordering, or tags.
- Memory kind, scope, namespace, confidence, importance, expiry, or metadata.
- Selected store, database path, working directory, home directory, settings, or pins.
- Tool arguments, model messages, prompts, or model-visible tool responses.
- Raw core error messages, error classes, causes, or stack traces.

The only potentially correlating value is Pi's opaque host-provided `context.session_id`. Operators must handle that opaque value in the append-only diagnostics file according to their own retention and privacy policy.

### Example records

A successful retain can emit:

```json
{"schema":"logslines/v1","timestamp":"2026-09-27T04:30:00.000Z","level":"info","event":"memory.retained","message":"Memory retention completed","service":{"namespace":"openlines","name":"nanomneme","component":"nmnm-pi","version":"0.3.0"},"context":{"session_id":"<opaque Pi session ID>"},"operation":"retain","status":"ok","duration_ms":2.4,"attributes":{},"error":null}
```

A project-trust block for retrieval can emit:

```json
{"schema":"logslines/v1","timestamp":"2026-09-27T04:30:00.000Z","level":"warn","event":"memory.retrieve_blocked","message":"Memory retrieval blocked","service":{"namespace":"openlines","name":"nanomneme","component":"nmnm-pi","version":"0.3.0"},"context":{"session_id":"<opaque Pi session ID or null>"},"operation":"retrieve","status":"blocked","duration_ms":null,"attributes":{},"error":null}
```

A failed removal can emit:

```json
{"schema":"logslines/v1","timestamp":"2026-09-27T04:30:00.000Z","level":"error","event":"memory.remove_failed","message":"Memory removal failed","service":{"namespace":"openlines","name":"nanomneme","component":"nmnm-pi","version":"0.3.0"},"context":{"session_id":null},"operation":"remove","status":"failed","duration_ms":1,"attributes":{},"error":{"kind":"unknown","code":"remove_failed","message":"Memory removal failed","retryable":false}}
```

Successful model-visible tool JSON is limited to 50 KiB (51,200 UTF-8 bytes). Results that fit retain their existing canonical JSON. Oversized results return valid JSON with `truncated: true`, byte-count diagnostics, stable record or page identifiers, bounded content previews, and guidance to narrow the request or use the CLI. This summary does not modify or truncate the canonical stored memory.

| Tool | Input | Description | Notes |
|---|---|---|---|
| `retain_memory` | `content`; optional `id`, canonical fields | Create, or patch and restore a known ID. | New records require `content`. Scope selects the matching write store. |
| `recall_memory` | `id`; optional `store` | Read one active, unexpired memory. | Returns canonical core JSON or `null`; missing stores remain absent. |
| `retrieve_memory` | Optional query, filters, ordering, pagination, `store` | Search or list active memories. | One store only; missing stores return `{ total: 0, items: [] }`. Punctuation query terms are matched literally. |
| `remove_memory` | `id`; optional `store` | Soft-remove an active memory. | Reversible through an explicit retain patch; irreversible purge is CLI-only; missing stores return `null`. |

For `retain_memory`, scope selects the matching write store: omitted scope means project and `scope: "global"` means global. The other tools use optional `store` (`"project"` or `"global"`) to choose a physical database. Project data is `./.nanomneme/memory.db`; global data is `~/.local/share/nanomneme/memory.db` on Linux and macOS. Results are canonical core JSON records. The adapter does not parse CLI flags or support custom database paths. Only `retain_memory` creates a missing store.

## Automatic memory index

At the first user prompt in each trusted Pi session, the adapter appends bounded Nanomneme context to that prompt's system prompt. In an untrusted project, this automatic context is global-only: the adapter does not read project settings, project pins, or the project database. Enabled global autoretention guidance takes priority, followed by a compact index. In a trusted project, project and global settings and memories compose as described below. Pinned entries come first, with recent active records after them. Rows contain `store`, a `[source]` label when recorded, ID, and a short content preview. It is not a transfer of complete records; use `recall_memory` or `retrieve_memory` for full content.

New Pi retains record `metadata.source` as `"pi"`. **Note:** ID-based patches preserve the existing source automatically; older or externally created records have no source label unless they already carry one.

The index is transient, not a session message. It is rebuilt for the next user prompt after `/memory refresh`, successful Pi compaction, or a successful retain, remove, pin, or unpin mutation. Read operations and no-op removals do not trigger it. Missing databases are empty. Missing, removed, expired, or otherwise unreadable pins are skipped and counted as unresolved. The pin remains configured until explicitly unpinned. Index reads are read-only and never create or migrate a SQLite database.

## Pins and configuration

Settings and pins are separate adapter files outside SQLite.

| Scope | JSONC settings | JSON pins |
|---|---|---|
| Project | `.nanomneme/nmnm.jsonc` | `.nanomneme/nmnm-pi.json` |
| Global | `<Pi agent directory>/nmnm.jsonc` | `~/.local/share/nanomneme/nmnm-pi.json` |

Pi's agent directory defaults to `~/.pi/agent`; current Pi uses `PI_CODING_AGENT_DIR` to override it. Settings are read-only to the adapter and may use comments or trailing commas.

### Complete settings template

This is the complete supported `nmnm.jsonc` shape for v0.1.9. Copy it to either settings location above, then adjust the budget or opt in to autoretention. This template is the maintained place to add future adapter parameters.

```jsonc
{
  // Total character limit for transient autoretention guidance and the memory index.
  "injection_budget": 2000,

  // Disabled unless explicitly true. Rebuild current bounded context every five user prompts.
  "reinjection": {
    "enabled": false,
    "every_n_prompts": 5,
  },

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

`injection_budget` is a non-negative total character limit for all transient Nanomneme context. The project value overrides the global value; the default is 2,000. Complete autoretention guidance is included before index rows; individual rules are never truncated. If enabled guidance alone exceeds the budget, no Nanomneme context is injected until the rules are shortened or the budget is raised. `autoretention` is inactive unless its effective `enabled` value is `true` (project overrides global). Rule arrays from both scopes combine with global entries first; `never_persist` takes precedence, `always_ask` requires user confirmation, and `always_persist` guides the active model when applicable. The adapter never writes memory directly for autoretention: the active model decides whether to call `retain_memory`.

`reinjection` is disabled unless its effective `enabled` value is `true` (project overrides global). When enabled, `every_n_prompts` is a positive safe integer that resolves project, then global, then `5`. After a successful context build, each eligible user prompt increments a session-local counter; the configured prompt queues a transient `cadence` rebuild in that same prompt. A successful build resets the counter, while a failed build leaves it pending. Slash commands do not count. The adapter caches the effective policy after a successful build, so ordinary prompts do not reread settings or stores; change settings with `/memory refresh` or reload the session. Cadence uses the existing total `injection_budget`, increases recurring provider input/cache activity, and creates no timer, worker, session record, memory, or SQLite write. A project pin and a global pin use the same ID format but remain distinct `(store, id)` references. The unreleased combined `nmnm-memory.json` layout is not migrated automatically.

### Normal file lifecycle

On extension load and session start, the adapter registers its tools and hooks only. It does not create a settings file, a pin file, or a database. `nmnm.jsonc` is optional and user-authored: create it only to override the default index budget, opt into autoretention, or opt into periodic reinjection. If it is absent, the adapter uses the defaults. The adapter never rewrites it.

| Event or action | Reads | Writes | What to expect |
|---|---|---|---|
| Extension load | Nothing | Nothing | No nanomneme files appear. |
| Session start | Existing settings and pins | Nothing | Read-only validation reports malformed configuration without preventing Pi startup. |
| First user prompt, queued refresh, or enabled cadence | Existing settings, pins, and SQLite stores | Nothing | A bounded index, and enabled autoretention rules, are appended transiently to the system prompt. Cadence is disabled by default and counts user prompts only. Missing files and stores are empty. |
| Successful Pi compaction | Nothing immediately | Nothing | The next user prompt rebuilds the transient index and enabled rules. Pi's own compaction summary preserves session continuity. |
| `retain_memory` | Scope-selected store when patching | Selected `memory.db` and core-derived rows | The core creates a missing selected database; a successful mutation queues next-prompt index rebuild; no Pi settings or pin file changes. |
| `recall_memory` or `retrieve_memory` | Selected existing `memory.db` | Nothing | Missing stores return `null` or an empty page without creating a database. |
| `remove_memory` | Selected existing `memory.db` | Selected `memory.db` and core-derived rows | Missing stores return `null`; successful removal queues next-prompt index rebuild; no Pi settings or pin file changes. |
| `/memory` or `/memory browse` | Existing settings, pins, and stores | Nothing unless the user pins, unpins, or confirms soft removal | In the Pi TUI, opens the model-free custom tab browser. Status is its own tab; All, Project, and Global provide search, source, records, paging, and safe management actions. Missing stores remain absent. |
| `/memory status` | Existing settings, pins, and stores | Nothing | Pi shows pin counts, effective budget, current full-payload character count (including the separator when both context sections exist), unresolved count, and transient injection lifecycle metadata; it never shows injected memory content. |
| `/memory refresh` | Nothing immediately | Nothing | The next user prompt rebuilds the hidden index. |
| `/memory list ...` | Both default stores, or the selected `memory.db` and pins | Nothing | Displays a bounded, paginated active-memory page without invoking the model. |
| `/memory remove ...` | Both stores when unqualified, otherwise the selected `memory.db` | Selected `memory.db` and core-derived rows | Soft-removes one unambiguous entry and queues next-prompt index rebuild; a matching pin remains configured. |
| `/memory pin ...` | Selected active `memory.db` and pin file when present | Selected `nmnm-pi.json` | Validates the selected store before creating the pin-file parent directory and file, then queues next-prompt index rebuild; settings remain untouched. |
| `/memory unpin ...` | Selected pin file when present | Selected `nmnm-pi.json` | Removes the configured reference even when its memory is unresolved, then queues next-prompt index rebuild. |

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

`nmnm-pi` 0.3.0 adds four model-visible tool definitions: `retain_memory`, `recall_memory`, `retrieve_memory`, and `remove_memory`. Their JSON schemas total `1,190 characters` (`retain_memory` 440, `recall_memory` 164, `retrieve_memory` 422, `remove_memory` 164). This is a schema-only reference, not a token or cost estimate: Pi adds tool names, descriptions, and provider request structure, while each provider uses its own tokenizer.

The transient memory context is separately bounded. On the first prompt and each queued refresh, Pi appends at most `injection_budget + 2` characters to the system prompt: the configured context plus its two newline separator characters. With the default budget, that is at most 2,002 characters. Autoretention guidance and index rows share that limit. Ordinary prompts without a queued refresh append no memory context unless opt-in periodic `reinjection` queues a rebuild.

```text
first or queued-turn adapter overhead =
  provider-tokenized memory tool definitions + provider-tokenized injected context (0 to injection_budget + 2 characters)
```

To measure exact overhead for a chosen model and provider, compare equivalent first-turn sessions with identical prompt, project context, and enabled non-nanomneme tools: run once with `nmnm-pi` enabled and once without it, then subtract the first assistant response's `usage.input` values in the Pi session JSONL. For later turns, report `usage.cacheRead` and `usage.cacheWrite` separately rather than treating cached input as fresh overhead. Session usage is provider-reported and is the authoritative token and cost measurement.

## Boundaries

The current production adapter injects transient context through the `before_agent_start` system-prompt return. Pi 0.87 structured prompt sections remain under a separate behavior and cache probe; this release does not claim a cache improvement or change the injection lifecycle.

This adapter has no Markdown memory storage, consolidation, separate compaction handoff, or auto-resume. Those capabilities are not implied by configuration, pins, or the browser. See the [Core and CLI Manual](../../../docs/CORE_CLI_MANUAL.md) for the core and CLI, and the [adapter quick start](../README.md) for the package-local entry point.
