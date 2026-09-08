# Pi Adapter Manual

`nmnm-pi` is the Pi harness adapter for nanomneme 0.1.1. It calls `nmnm-core`
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
| `remove_memory` | `id`; optional `store`, `purge` | Soft-remove, or purge when requested by the model. | `purge: true` is irreversible; missing stores return `null`. |

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

This is the complete supported `nmnm.jsonc` shape for v0.1.1. Copy it to either settings
location above, then adjust the budget or opt in to autoretention. This template is the
maintained place to add future adapter parameters.

```jsonc
{
  // Total character limit for transient autoretention guidance and the memory index.
  "injection_budget": 2000,

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
autoretention: the active model decides whether to call `retain_memory`. A project pin and a
global pin use the same ID format but remain distinct `(store, id)` references. The unreleased
combined `nmnm-memory.json` layout is not migrated automatically.

### Normal file lifecycle

On extension load and session start, the adapter registers its tools and hooks only. It
does not create a settings file, a pin file, or a database. `nmnm.jsonc` is optional and
user-authored: create it only to override the default index budget. If it is absent, the
adapter uses the default. The adapter never rewrites it.

| Event or action | Reads | Writes | What to expect |
|---|---|---|---|
| Extension load | Nothing | Nothing | No nanomneme files appear. |
| Session start | Existing settings and pins | Nothing | Read-only validation reports malformed configuration without preventing Pi startup. |
| First user prompt, or a queued refresh | Existing settings, pins, and SQLite stores | Nothing | A bounded index, and enabled autoretention rules, are appended transiently to the system prompt. Missing files and stores are empty. |
| Successful Pi compaction | Nothing immediately | Nothing | The next user prompt rebuilds the transient index and enabled rules. Pi's own compaction summary preserves session continuity. |
| `retain_memory` | Existing selected store when patching | Selected `memory.db` and core-derived rows | The core creates a missing selected database; a successful mutation queues next-prompt index rebuild; no Pi settings or pin file changes. |
| `recall_memory` or `retrieve_memory` | Selected existing `memory.db` | Nothing | Missing stores return `null` or an empty page without creating a database. |
| `remove_memory` | Selected existing `memory.db` | Selected `memory.db` and core-derived rows | Missing stores return `null`; successful removal queues next-prompt index rebuild; no Pi settings or pin file changes. |
| `/memory status` | Existing settings, pins, and stores | Nothing | Pi shows pin counts, effective budget, and unresolved count. |
| `/memory refresh` | Nothing immediately | Nothing | The next user prompt rebuilds the hidden index. |
| `/memory list ...` | Both default stores, or the selected `memory.db` and pins | Nothing | Displays a bounded, paginated active-memory page without invoking the model. |
| `/memory remove ...` | Both stores when unqualified, otherwise the selected `memory.db` | Selected `memory.db` and core-derived rows | Soft-removes one unambiguous entry and queues next-prompt index rebuild; a matching pin remains configured. |
| `/memory pin ...` | Selected active `memory.db` and pin file when present | Selected `nmnm-pi.json` | Validates the selected store before creating the pin-file parent directory and file, then queues next-prompt index rebuild; settings remain untouched. |
| `/memory unpin ...` | Selected pin file when present | Selected `nmnm-pi.json` | Removes the configured reference even when its memory is unresolved, then queues next-prompt index rebuild. |

To create project settings manually before starting Pi or between prompts, create the
directory, then copy the complete template above into `.nanomneme/nmnm.jsonc` and adjust
`injection_budget` if needed:

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
| `/memory refresh` | None | Queue a hidden index rebuild. | The next user prompt performs the read-only rebuild. |
| `/memory status` | None | Show pin counts, budget, and unresolved pins. | Does not write files or stores. |
| `/memory list [store] [limit] [offset]` | `/memory list global 50` | List active memories without the model. | Omit `store` for project-first, then global. `limit` is 1-100; `offset` is 0-1,000. |
| `/memory remove [store] <id>` | `/memory remove global <memory-id>` | Soft-remove an active memory. | Unscoped IDs resolve one store or refuse ambiguity. Pins remain durable. |
| `/memory pin [store] <id>` | `/memory pin global <memory-id>` | Pin an active memory for Pi index injection. | Omit `store` for project. Validation occurs before any pin-file write. |
| `/memory unpin [store] <id>` | `/memory unpin <memory-id>` | Remove a Pi pin reference. | Omit `store` for project; unresolved references can be removed. |

### Slash command behavior

| Topic | Behavior |
|---|---|
| List order | Unscoped list combines project entries before global entries; selected-store lists read one store. |
| List display | Rows include `[project]` or `[global]`; `*` after an ID means that exact `(store, id)` is pinned. Previews normalize whitespace, show 60 characters, and append `...` only when truncated. |
| List output | The notification reports `showing <n> of <total>` and is local command output, not a model request. |
| Pin validation | An unscoped pin needs an active project memory. A global-only ID leaves pin files unchanged and reports `/memory pin global <id>`. Explicit scopes validate their selected store. |
| Identity | UUID v4 collisions are unlikely, but explicit IDs and imports can duplicate IDs across stores; use `(store, id)`. |
| Index refresh | `refresh`, successful compaction, successful model retain/remove, and successful slash `pin`, `unpin`, or removal make the index eligible for the next prompt; they do not alter other memory records. |
| Unresolved pins | Removed, expired, missing, or unreadable targets stay configured until unpinned and are counted as unresolved. |

## Boundaries

This adapter has no Markdown memory storage, consolidation, separate compaction handoff, auto-resume, or browser. Those capabilities are not implied by configuration or pins.
See the [Core and CLI Manual](CORE_CLI_MANUAL.md) for the core and CLI, and the
[adapter quick start](../adapters/pi/README.md) for the package-local entry point.
