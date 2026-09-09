# Pi Adapter Manual

`nmnm-pi` is the Pi harness adapter for nanomneme 0.1.3. It calls `nmnm-core`
directly, keeps SQLite as the storage authority, and does not invoke or parse the CLI.

## Install

Use Node.js 22.13+ and Pi. From a nanomneme checkout, try the extension without
installing it:

```sh
pi -e ./adapters/pi/extensions/index.js
```

To add the checkout to this project's Pi settings, use an absolute package path:

```sh
pi install -l "$(pwd)/adapters/pi"
```

For a Git installation, replace the placeholder with an existing release tag or commit.
Do not treat the placeholder as an executable version:

```sh
pi install git:github.com/linellazatin/nanomneme@<released-tag-or-commit>
```

Pi runs package extensions with full local-system access. Review the checked-out or Git
source before installing it. Public npm publication is not available yet.

## Native memory tools

Pi exposes four tools to the model:

| Tool | Input | Description | Notes |
|---|---|---|---|
| `retain_memory` | `content`; optional `id`, canonical fields, `store` | Create, or patch and restore a known ID. | New records require `content`. |
| `recall_memory` | `id`; optional `store` | Read one active, unexpired memory. | Returns canonical core JSON or `null`; missing stores remain absent. |
| `retrieve_memory` | Optional query, filters, ordering, pagination, `store` | Search or list active memories. | One store only; missing stores return `{ total: 0, items: [] }`. |
| `remove_memory` | `id`; optional `store` | Soft-remove an active memory. | Reversible through an explicit retain patch; irreversible purge is CLI-only; missing stores return `null`. |

`store` accepts `"project"` or `"global"`; omitted means project. Project data is
`./.nanomneme/memory.db`; global data is `~/.local/share/nanomneme/memory.db` on Linux
and macOS. Results are canonical core JSON records. The adapter does not parse CLI flags
or support custom database paths. Only `retain_memory` creates a missing store.

## Automatic memory index

At the first user prompt in each Pi session, the adapter appends bounded Nanomneme context to
that prompt's system prompt. Enabled autoretention guidance takes priority, followed by a compact
index that lists project pins first, then global pins, then recent active records from each store.
Rows contain `store`, ID, and a short content preview. It is not a transfer of complete records;
use `recall_memory` or `retrieve_memory` for full content.

The index is transient, not a session message. It is rebuilt for the next user prompt after
`/memory refresh`, successful Pi compaction, or a successful retain, remove, pin, or unpin
mutation. Read operations and no-op removals do not trigger it. Missing databases are empty.
Missing, removed, expired, or otherwise unreadable pins are skipped and counted as unresolved.
The pin remains configured until explicitly unpinned. Index reads are read-only and never create
or migrate a SQLite database.

## Pins and configuration

Settings and pins are separate adapter files outside SQLite.

| Scope | JSONC settings | JSON pins |
|---|---|---|
| Project | `.nanomneme/nmnm.jsonc` | `.nanomneme/nmnm-pi.json` |
| Global | `<Pi agent directory>/nmnm.jsonc` | `~/.local/share/nanomneme/nmnm-pi.json` |

Pi's agent directory defaults to `~/.pi/agent`; current Pi uses
`PI_CODING_AGENT_DIR` to override it. Settings are read-only to the adapter and may use
comments or trailing commas.

### Complete settings template

This is the complete supported `nmnm.jsonc` shape for v0.1.3. Copy it to either settings
location above, then adjust the budget or opt in to autoretention. This template is the
maintained place to add future adapter parameters.

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

Use concise, scope-appropriate natural-language rules. Global rules provide baseline safeguards
across projects; project rules add project-specific guidance.

Pin files are plain JSON arrays, written only by `/memory pin` and `/memory unpin`:

```json
["<memory-id>"]
```

`injection_budget` is a non-negative total character limit for all transient Nanomneme context.
The project value overrides the global value; the default is 2,000. Complete autoretention
guidance is included before index rows; individual rules are never truncated. If enabled guidance
alone exceeds the budget, no Nanomneme context is injected until the rules are shortened or the
budget is raised. `autoretention` is inactive unless its effective `enabled` value is `true`
(project overrides global). Rule arrays from both scopes combine with global entries first;
`never_persist` takes precedence, `always_ask` requires user confirmation, and `always_persist`
guides the active model when applicable. The adapter never writes memory directly for
autoretention: the active model decides whether to call `retain_memory`.

`reinjection` is disabled unless its effective `enabled` value is `true` (project overrides global).
When enabled, `every_n_prompts` is a positive safe integer that resolves project, then global,
then `5`. After a successful context build, each eligible user prompt increments a session-local
counter; the configured prompt queues a transient `cadence` rebuild in that same prompt. A
successful build resets the counter, while a failed build leaves it pending. Slash commands do not
count. The adapter caches the effective policy after a successful build, so ordinary prompts do not
reread settings or stores; change settings with `/memory refresh` or reload the session. Cadence
uses the existing total `injection_budget`, increases recurring provider input/cache activity, and
creates no timer, worker, session record, memory, or SQLite write. A project pin and a global pin
use the same ID format but remain distinct `(store, id)` references. The unreleased combined
`nmnm-memory.json` layout is not migrated automatically.

### Normal file lifecycle

On extension load and session start, the adapter registers its tools and hooks only. It
does not create a settings file, a pin file, or a database. `nmnm.jsonc` is optional and
user-authored: create it only to override the default index budget, opt into autoretention, or
opt into periodic reinjection. If it is absent, the adapter uses the defaults. The adapter never
rewrites it.

| Event or action | Reads | Writes | What to expect |
|---|---|---|---|
| Extension load | Nothing | Nothing | No nanomneme files appear. |
| Session start | Existing settings and pins | Nothing | Read-only validation reports malformed configuration without preventing Pi startup. |
| First user prompt, queued refresh, or enabled cadence | Existing settings, pins, and SQLite stores | Nothing | A bounded index, and enabled autoretention rules, are appended transiently to the system prompt. Cadence is disabled by default and counts user prompts only. Missing files and stores are empty. |
| Successful Pi compaction | Nothing immediately | Nothing | The next user prompt rebuilds the transient index and enabled rules. Pi's own compaction summary preserves session continuity. |
| `retain_memory` | Existing selected store when patching | Selected `memory.db` and core-derived rows | The core creates a missing selected database; a successful mutation queues next-prompt index rebuild; no Pi settings or pin file changes. |
| `recall_memory` or `retrieve_memory` | Selected existing `memory.db` | Nothing | Missing stores return `null` or an empty page without creating a database. |
| `remove_memory` | Selected existing `memory.db` | Selected `memory.db` and core-derived rows | Missing stores return `null`; successful removal queues next-prompt index rebuild; no Pi settings or pin file changes. |
| `/memory` or `/memory browse` | Existing settings, pins, and stores | Nothing unless the user pins, unpins, or confirms soft removal | Shows the shared status card, then opens a model-free native-dialog browser with search and store quick actions above project/global/both pages, plus details and safe management actions. Missing stores remain absent. |
| `/memory status` | Existing settings, pins, and stores | Nothing | Pi shows pin counts, effective budget, current full-payload character count (including the separator when both context sections exist), unresolved count, and transient injection lifecycle metadata; it never shows injected memory content. |
| `/memory refresh` | Nothing immediately | Nothing | The next user prompt rebuilds the hidden index. |
| `/memory list ...` | Both default stores, or the selected `memory.db` and pins | Nothing | Displays a bounded, paginated active-memory page without invoking the model. |
| `/memory remove ...` | Both stores when unqualified, otherwise the selected `memory.db` | Selected `memory.db` and core-derived rows | Soft-removes one unambiguous entry and queues next-prompt index rebuild; a matching pin remains configured. |
| `/memory pin ...` | Selected active `memory.db` and pin file when present | Selected `nmnm-pi.json` | Validates the selected store before creating the pin-file parent directory and file, then queues next-prompt index rebuild; settings remain untouched. |
| `/memory unpin ...` | Selected pin file when present | Selected `nmnm-pi.json` | Removes the configured reference even when its memory is unresolved, then queues next-prompt index rebuild. |

To create project settings manually before starting Pi or between prompts, create the
directory, then copy the complete template above into `.nanomneme/nmnm.jsonc` and adjust
`injection_budget`, autoretention, or reinjection if needed:

```sh
mkdir -p .nanomneme
```

An invalid settings or pin file leaves the file unchanged. Session start reports the
configuration issue without preventing Pi startup. The next-prompt injection remains pending,
so after correcting the file the following prompt retries automatically; `/memory refresh` is
not required.

## Slash command reference

| Command | Input example | Description | Notes |
|---|---|---|---|
| `/memory` | None | Open the native-dialog memory browser. | Equivalent to `/memory browse`; requires a UI-capable mode. |
| `/memory browse` | None | Browse, search, inspect, pin/unpin, or soft-remove active memories. | Shows the shared status card once, then keeps search and store selection above each 20-row project/global/both page; never invokes the model. |
| `/memory refresh` | None | Queue a hidden index rebuild. | The next user prompt performs the read-only rebuild. |
| `/memory status` | None | Show a compact transient-context status card. | Reports aligned field values defined below without exposing injected content or writing files/stores. |
| `/memory list [store] [limit] [offset]` | `/memory list global 50` | List active memories without the model. | Omit `store` for project-first, then global. `limit` is 1-100; `offset` is 0-1,000. |
| `/memory remove [store] <id>` | `/memory remove global <memory-id>` | Soft-remove an active memory. | Unscoped IDs resolve one store or refuse ambiguity. Pins remain durable. |
| `/memory pin [store] <id>` | `/memory pin global <memory-id>` | Pin an active memory for Pi index injection. | Omit `store` for project. Validation occurs before any pin-file write. |
| `/memory unpin [store] <id>` | `/memory unpin <memory-id>` | Remove a Pi pin reference. | Omit `store` for project; unresolved references can be removed. |

### Slash command behavior

| Topic | Behavior |
|---|---|
| Browser | `/memory` and `/memory browse` show the shared status card before opening Pi-native dialogs. Search and current store selection are the first two actions before record rows. Text search uses FTS retrieval; changing search or store resets pagination. Pi's selector also supports vertical arrows and Vim-style `j`/`k` navigation. Non-UI modes should use explicit subcommands. |
| Browser details | Selecting a row opens a native action dialog whose title contains full canonical content and fields, then offers exact-store pin/unpin, confirmed soft removal, or back. Closing it returns to the browser under the existing status card. Structured filter controls are intentionally deferred. |
| List order | Unscoped list and browser `both` pages combine project entries before global entries; selected-store views read one store. |
| List display | Rows include `[project]` or `[global]`; `*` after an ID means that exact `(store, id)` is pinned. Previews normalize whitespace, show 60 characters, and append `...` only when truncated. |
| List output | The notification reports `showing <n> of <total>` and is local command output, not a model request. |
| Pin validation | An unscoped pin needs an active project memory. A global-only ID leaves pin files unchanged and reports `/memory pin global <id>`. Explicit scopes validate their selected store. |
| Identity | UUID v4 collisions are unlikely, but explicit IDs and imports can duplicate IDs across stores; use `(store, id)`. |
| Index refresh | `refresh`, successful compaction, successful model retain/remove, and successful slash `pin`, `unpin`, or removal make the index eligible for the next prompt; they do not alter other memory records. |
| Unresolved pins | Removed, expired, missing, or unreadable targets stay configured until unpinned and are counted as unresolved. |

### Status card fields

`/memory status` and both browser entry points show the same read-only card:

| Field | Meaning |
|---|---|
| `Injection pending` | `yes` means the next eligible agent start will rebuild and attempt transient context injection. Session start, compaction, refresh, cadence, and successful memory mutations can make it pending. |
| `Periodic reinjection` | The effective periodic policy: `disabled` or the configured interval after which eligible prompts queue a rebuild. |
| `Prompts since injection` | Eligible prompt count since the last successful injection while periodic reinjection is enabled. It resets after a successful injection. |
| `Last` | The most recent successful transient-memory injection in this Pi session. `none` means no injection has succeeded. Otherwise it reports the trigger, timestamp, index-entry count, full injected character count, and whether autoretention guidance was included. It is not the last database write or browser action. |
| `Pins` | Configured project and global pin counts, including pins whose targets are currently unresolved. |
| `Index` | Effective character budget, the full current next-injection payload size (including its separator when both sections exist), and unresolved pin count. The card does not expose payload content. |
| `Error` | The latest context-build or status-read error recorded in this session, with its timestamp; `none` means no error is currently recorded. A successful injection clears it. |

### Pi token overhead

`nmnm-pi` adds four model-visible tool definitions: `retain_memory`, `recall_memory`,
`retrieve_memory`, and `remove_memory`. Their JSON schemas total `1,190 characters`
(`retain_memory` 440, `recall_memory` 164, `retrieve_memory` 422, `remove_memory` 164).
This is a schema-only reference, not a token or cost estimate: Pi adds tool names,
descriptions, and provider request structure, while each provider uses its own tokenizer.

The transient memory context is separately bounded. On the first prompt and each queued
refresh, Pi appends at most `injection_budget + 2` characters to the system prompt: the
configured context plus its two newline separator characters. With the default budget, that
is at most 2,002 characters. Autoretention guidance and index rows share that limit. Ordinary
prompts without a queued refresh append no memory context unless opt-in periodic `reinjection`
queues a rebuild.

```text
first or queued-turn adapter overhead =
  provider-tokenized memory tool definitions + provider-tokenized injected context (0 to injection_budget + 2 characters)
```

To measure exact overhead for a chosen model and provider, compare equivalent first-turn
sessions with identical prompt, project context, and enabled non-nanomneme tools: run once
with `nmnm-pi` enabled and once without it, then subtract the first assistant response's
`usage.input` values in the Pi session JSONL. For later turns, report `usage.cacheRead` and
`usage.cacheWrite` separately rather than treating cached input as fresh overhead. Session
usage is provider-reported and is the authoritative token and cost measurement.

## Boundaries

This adapter has no Markdown memory storage, consolidation, separate compaction handoff,
or auto-resume. Those capabilities are not implied by configuration, pins, or the browser.
See the [Core and CLI Manual](CORE_CLI_MANUAL.md) for the core and CLI, and the
[adapter quick start](../adapters/pi/README.md) for the package-local entry point.
