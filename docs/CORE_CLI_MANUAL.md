# nanomneme Core and CLI Manual

This manual is the task-oriented guide for nanomneme. It serves developers who embed `nmnm-core` and agents or operators that call the `nmnm` CLI. nanomneme remains a local, deterministic SQLite memory store without required models, services, or network access.

## Audiences

For browser-based review and cleanup outside a harness, see the [UI README](../packages/nmnm-ui/README.md). The CLI-bundled foreground UI (`nmnm ui`) uses existing core APIs, with explicit store/source selection, read-only defaults, literal search, and documented lifecycle limits. Use `nmnm ui --port <0..65535>` to select a port and `--no-auto`/`-na` to suppress default-browser opening; `ui --help` and `ui --version` use the UI launcher. Core/CLI FTS search, transfer, verification, and repair remain covered here.

### Developers

Use the developer path to install the workspace packages, open and close stores safely, call the 4Rs, inspect the schema, and use portability and verification APIs. Examples use Node.js ESM and the built-in `node:sqlite` runtime required by the project.

### Agents and operators

Use the agent path for deterministic CLI calls, stable JSON responses, explicit store selection, ID-based updates, and actionable error handling. Human-readable output is for interactive use; automated callers should request `--json`.

## Operating contract

- The core operates on one SQLite database at a time.
- The CLI selects project, global, or custom storage. Retrieval alone can compose project then global results with `--both`.
- `(store, id)` is the effective identity of a retrieval result.
- Canonical records live in `memories`; tags and FTS rows are derived.
- Retrieval is lexical and deterministic. Separate database scores are never compared.
- Canonical JSONL is the portable interchange format. Exact backups are closed SQLite file copies.

## Manual map

| Chapter | Primary audience | Outcome |
|---|---|---|
| Getting started and CLI reference | Both | Install nanomneme and complete the 4Rs. |
| Developer guide | Developers | Use the core API, lifecycle, schema, and errors safely. |
| Agent guide | Agents | Produce deterministic commands and consume JSON results. |
| Pi Adapter Manual | Pi users | Install the adapter and manage the complete JSONC settings template, store-validated JSON pins, automatic context, file lifecycle, combined list, and safe soft removal. |
| Portability and recovery | Both | Export, import, back up, verify, repair, and restore. |
| Troubleshooting | Both | Diagnose common input, storage, FTS, and schema failures. |

## Getting started

### Requirements and installation

CLI/UI require Node.js 22.19.0 or later with FTS5 available in the built-in `node:sqlite` module; independently installed core supports 22.13 or later with FTS5. Node.js 22.19.0 is tested; the official macOS arm64 Node.js 22.13.0 build lacks FTS5 and cannot run core. Install the CLI for terminal or agent use:

```sh
npm install --global @openlines/nmnm-cli
nmnm --version
```

Install the core package in a Node.js ESM application:

```sh
npm install @openlines/nmnm-core
```

From a repository checkout, install workspace dependencies and invoke the CLI directly:

```sh
npm install
node packages/nmnm-cli/bin/nmnm.js --help
```

Node may print an experimental warning for `node:sqlite`; supported Node versions do not need an experimental runtime flag.

Creating a file-backed store requires filesystem hardlink support. Core initializes a private same-directory temporary database and publishes the complete, closed file without overwriting another creator. Concurrent creators use the winning store; failed initialization leaves no published partial database. Existing unversioned files remain rejected. This is atomic publication, not a power-loss durability guarantee.

### First CLI workflow

Use `--db` in examples and scripts when the storage target should be explicit:

```sh
nmnm retain "Prefer concise documentation" --kind preference \
  --tags docs,style --db ./memory.db --scope project --json
nmnm retrieve "documentation" --db ./memory.db --json
nmnm recall <memory-id> --db ./memory.db --json
nmnm remove <memory-id> --db ./memory.db --json
```

The retain response supplies `<memory-id>`. Removal is soft by default. A later `retain --id <memory-id>` patches and restores that row; `remove --purge` is irreversible.

### Select a store

| Selection | Database | Notes |
|---|---|---|
| No selector | `./.nanomneme/memory.db` | Project default. |
| `--global` | `~/.local/share/nanomneme/memory.db` | Linux and macOS personal store. |
| `--db <path>` | Exact supplied path | Custom store for scripts, tests, or isolation. |
| `retrieve --both` | Project, then global | Retrieval only; missing stores remain absent. |

`--global` cannot be combined with `--db`. `--both` cannot be combined with either. Scope values are trimmed and validated before opening a database. For a custom `--db` retain, `scope` is an explicit record label; standard project and global retains derive the matching scope and reject mismatches, including padded values such as `--scope " global "` without `--global`.

Ordinary single-store 4Rs open writable, create-capable stores, including recall, retrieve, and removal; a missing store may become an empty database even when no memory changes. Adapter reads generally leave missing stores absent. Use core read-only access for non-creating diagnostics; CLI `verify` and `export` also require existing stores.

## CLI reference

| Command | Input | Description | Notes |
|---|---|---|---|
| `ui` | Launcher flags | Open the foreground browser workbench. | Separate flag parser; see the [UI README](../packages/nmnm-ui/README.md#launch). |
| `retain` | `[content]` | Create a UUID v4 record, or patch and restore an explicit ID. | New records need content. |
| `recall` | `<id>` | Read one active, unexpired record. | Returns no result when absent, removed, or expired. |
| `retrieve` | `[query words...]` | Return filtered, ordered, paginated records. | `--both` is retrieval-only. |
| `remove` | `<id>` | Soft-remove a record. | `--purge` permanently deletes it. |
| `verify` | None | Report schema, integrity, tag, and FTS defects. | Read-only. |
| `export` | None | Write canonical JSONL. | `--out` uses atomic replacement; no `--json`. |
| `import` | `<file>` | Validate then transactionally import canonical JSONL. | No partial import. |
| `repair` | `--rebuild-fts` | Rebuild derived FTS rows, then verify. | Writable maintenance command. |

### Common flags

| Flag | Value | Description | Notes |
|---|---|---|---|
| `--db` | `<path>` | Select an exact database. | Cannot combine with `--global` or `--both`; `retain` requires an explicit `--scope`. |
| `--global` | None | Select the standard global database. | Cannot combine with `--db` or `--both`; `retain` uses global scope. |
| `--json` | None | Emit structured JSON. | Invalid with `export`, which emits JSONL. |
| `--help` | None | Show current CLI usage. | Authoritative flag reference. |
| `--version`, `-v` | None | Print installed CLI, core, and UI versions on separate labeled lines. | Opens no storage. |
| `--` | None | End option parsing. | Use before retain content or a retrieve query beginning with `--`. |

### Retain flags

| Flag | Value | Description | Notes |
|---|---|---|---|
| `--id` | UUID v4 | Patch and restore a known record. | Never creates a record with a caller-supplied ID. |
| `--kind` | `note`, `decision`, `preference`, `fact`, `instruction` | Classify the record. | Optional. |
| `--scope` | `project`, `global` | Set the record scope. | Standard project/global `retain` routes require the matching scope; custom `--db` retains require it explicitly. |
| `--namespace` | `<lowercase-slug>` | Add a namespace. | Optional. |
| `--tags` | `<lowercase-slug,...>` | Add normalized tags. | Comma-separated. |
| `--importance`, `--confidence` | `0..1` | Set ranking and confidence values. | Optional numeric values. |
| `--expires-at` | `<UTC ISO>` | Set expiry. | New records default to no expiry; omission on a patch preserves existing expiry. |
| `--metadata` | `<JSON>` | Store JSON metadata. | Must be canonical JSON. |

### Retrieve flags

| Flag | Value | Description | Notes |
|---|---|---|---|
| `--both` | None | Read project results, then global results. | Cannot combine with `--db` or `--global`. |
| `--kind`, `--scope`, `--namespace`, `--tags` | Same values as retain | Filter records. | Filters combine with AND; every requested tag must match. |
| `--expires` | `active`, `expired`, `any` | Filter by expiry state. | Default is active. |
| `--importance-gte`, `--importance-lte`, `--confidence-gte`, `--confidence-lte` | `<number>` | Filter numeric ranges. | Bounds are inclusive. |
| `--order-by` | `relevance`, `id`, `created_at`, `updated_at`, `importance`, `confidence` | Select result ordering. | Default is relevance with a query, otherwise newest update. |
| `--limit` | `1..1000` | Limit returned rows. | Default is core-defined. |
| `--offset` | `0..1000` | Skip returned rows. | Applied across the combined `--both` sequence. |

`remove` also accepts `--purge`; `export` accepts `--out <file>`; `repair` requires `--rebuild-fts`. Run `nmnm --help` for exact current syntax.

## Developer guide

### Store lifecycle

Always close the store. Use `try`/`finally` so validation, SQLite, or application errors cannot leave a connection open:

```js
import { open } from '@openlines/nmnm-core';

const store = open('./memory.db');
try {
  const memory = store.retain({
    content: 'Prefer deterministic local storage',
    kind: 'preference',
    namespace: 'application',
    tags: ['architecture', 'storage'],
  });
  const result = store.retrieve({
    query: 'local storage',
    kind: 'preference',
    limit: 10,
  });
  console.log(memory.id, result.total);
} finally {
  store.close();
}
```

`open(path)` creates a missing database and applies registered forward migrations. `open(path, { create: false })` requires an existing database. Use `open(path, { readOnly: true })` for reads that must neither create nor migrate storage; SQLite rejects mutation methods on that connection.

### Core API

| Method | Input | Return |
|---|---|---|
| `retain(input)` | New record fields, or existing `id` plus fields to patch | Complete stored memory. |
| `recall({ id })` | UUID v4 | Active, unexpired memory or `null`. |
| `retrieve(selector)` | Query, filters, ranges, ordering, and pagination | `{ total, items }`. |
| `remove({ id, mode })` | UUID and optional `soft` or `purge` mode | Removal result or `null`; soft removal requires an active record, purge accepts any existing record. |
| `export()` | None | Canonical records in ID order, including expired and soft-removed rows. |
| `import(records)` | Array of canonical records | `{ imported }`; validation and conflicts are atomic. |
| `verify()` | None | `{ ok, schema_version, issues }` without repair. |
| `rebuildFts()` | None | `{ mode: 'rebuild-fts', rebuilt }`. |
| `close()` | None | Closes the SQLite connection. |

New `retain` inputs require `content`. Optional fields are `kind`, `scope`, `namespace`, `importance`, `confidence`, `expires_at`, `metadata`, and `tags`. The core generates the ID and timestamps. Passing `id` switches retain to patch/restore mode and never performs content-based deduplication.

Text inputs must contain well-formed Unicode. Unpaired surrogates produce a validation error before a retain write or import batch; valid Unicode pairs are preserved instead of being silently replaced by SQLite.

New records start with equal wall-clock `created_at` and `updated_at`. Patches (including empty patches), restores, and soft removals preserve `created_at` and strictly advance `updated_at` using the greater of wall-clock time and the latest stored `updated_at` plus one millisecond, never preceding `created_at`. Soft removal uses this same value for `removed_at`. The calculation occurs inside the write transaction and works across connections, frozen clocks, clock rollback, and future-dated imports. This guarantees per-record ordering, not global ordering or exact wall-clock time. Imports preserve canonical timestamps unchanged; expiry checks and purge's `purged_at` use wall-clock time. Exhausting the four-digit UTC year range rejects the mutation atomically without blocking purge.

Mutations acquire a write transaction before reading patch/removal targets or checking existing import IDs. Retain normalizes caller input before locking, merges patches with the latest committed record, and captures the result before commit. Unrelated concurrent patches are preserved; the last successfully applied patch wins for the same field. Canonical rows, tags, and FTS updates commit or roll back together. Recall, retrieval, export, and verification each read one database snapshot; CLI `--both` reads the two stores separately. A five-second SQLite busy timeout bounds lock waiting; contention can still fail, and core does not automatically retry operations.

Retrieve selectors support `query`; `source` matching `metadata.source`; scalar or array `kind`, `scope`, and `namespace`; an array of `tags`; numeric `importance` and `confidence` values or `{ gt, gte, lt, lte }` ranges; `expires`; `order_by`; `limit`; and `offset`. Text retrieval uses FTS5/BM25 and supports Unicode terms. Punctuation-bearing terms such as `node.js`, `C++`, and `key:value` are quoted for SQLite tokenization, not interpreted as column filters or substring searches. Space-separated terms imply AND. Case-insensitive `AND`/`OR`/`NOT`, quoted phrases (escape embedded quotes as `""`), trailing `*` prefixes, and parentheses up to 32 levels are supported. Proximity uses `NEAR(foo bar, 2)` with an optional distance from 0 through 2147483647; infix `foo NEAR bar` searches NEAR literally. Malformed expressions, including deeper grouping, fall back to quoted literal terms with operator words retained. Queries without searchable terms return zero matches. SQLite storage failures retain their original errors. Equal lexical scores prefer higher importance, then ID. Without a query, the default is newest `updated_at` first.

### Schema ownership

| Table | Ownership |
|---|---|
| `memories` | Canonical source of truth for record fields and JSON metadata. |
| `memory_tags` | Core-maintained normalized tag relation. |
| `memories_fts` | Core-maintained FTS5 index for non-removed records, including expired rows. |
| `nmnm_meta` | Core-maintained schema version. |

Do not write these tables directly. Core transactions keep canonical rows, tags, and FTS synchronized. The core API and CLI flag tables above define accepted public values.

Public reads and exports project the canonical memory columns explicitly. If schema drift adds a column, `verify` reports it but recall, retrieval, and canonical JSONL do not expose the unexpected value.

### Errors

| Error | Typical cause | Caller action |
|---|---|---|
| `TypeError` | Malformed fields, timestamps, slugs, metadata, selectors, or ordering. | Correct input before retrying. |
| `RangeError` | Out-of-range values, missing patch targets, timestamp-range exhaustion, or import ID conflicts. | Change input or resolve the conflict. |
| `Error` | Missing databases, incompatible schemas, unavailable FTS5, or SQLite failures. | Inspect storage state and error details. |

Always close the store. Do not retry validation or conflict errors without changing input.

## Agent guide

### Construct deterministic commands

| Need | Use | Notes |
|---|---|---|
| Machine-readable result | `--json` | `export` emits JSONL and rejects `--json`. |
| Positional text beginning with `--` | `--` after options | It ends option parsing; normal FTS5 query rules still apply. |
| Explicit mutation target | `--db <path>` or `--global` | No selector means the current project's store. |
| Stable page or non-query order | `--limit`, `--offset`, `--order-by` | Query results already rank score, importance, then ID. |
| Known record update or restore | `--id <memory-id>` | New retain always generates a UUID v4. |
| Cross-store identity | `(store, id)` | Matching IDs from different stores remain separate. |

For discovery across defaults, request both stores and preserve provenance:

```sh
nmnm retrieve "release decision" --both --limit 20 --offset 0 --json
```

Follow-up commands must select the result's store. Use no selector for `project`, `--global` for `global`, and the original `--db <path>` for `custom`. A custom result says `"store": "custom"`; it does not repeat the database path, so the caller must retain that path. `--both` is retrieval-only.

### Consume JSON output

| Command | JSON contract |
|---|---|
| `retain` | Complete memory object. |
| `recall` | Complete memory object or `null`. |
| `retrieve` | `{ "total": number, "items": [...] }`; every item adds `store`. |
| `remove` | Soft removal returns `null` for an inactive or missing record; purge returns `null` only for a missing ID. |
| `verify` | `{ "ok", "schema_version", "issues" }`. |
| `import` | `{ "imported": number }`. |
| `repair` | Rebuild result plus nested `verification`. |
| `export` | Canonical JSONL on stdout, or a file with `--out`; not `--json`. |

`score` appears only for text retrieval and is transient. Lower values rank first within one database. Do not compare scores between project and global results. With `--both`, project items always precede global items; `total` is summed before `--offset` and `--limit` are applied to that combined sequence.

### Handle status and errors

Capture the exit status, stdout, and stderr separately:

| Status | Meaning | Agent action |
|---|---|---|
| `0` | Command succeeded. | Parse the documented stdout format. |
| `1` with `verify --json` stdout | Verification found issues. | Parse `issues`; do not treat the report as malformed output. |
| `1` with `repair --json` stdout | Rebuild finished but verification still found issues. | Parse nested `verification` and stop mutation attempts. |
| `1` with `nmnm:` on stderr | Argument, validation, storage, or SQLite failure. | Report stderr and classify before retrying. |

Do not retry invalid options, malformed values, missing mutation targets, import conflicts, or missing read-only databases without changing the command or state. Retry an operational SQLite failure only with a bounded policy after inspecting stderr. Never silently redirect a failed command to another store.

## Portability and recovery

Choose the workflow by outcome:

| Need | Use | Boundary |
|---|---|---|
| Inspect or transfer records | Canonical JSONL export | Portable; omits derived FTS rows. |
| Restore into an empty store | Import into a new database path | Full input validation happens before destination creation. |
| Merge distinct records | Import into an existing database | Any duplicate or existing ID rejects the whole import. |
| Preserve an exact store | Closed SQLite file copy | Includes canonical and derived database state. |

### Export, restore, and merge

Export to a file, import to an explicit destination, then verify the result:

```sh
nmnm export --db ./source.db --out ./memory.jsonl
nmnm import ./memory.jsonl --db ./restored.db --json
nmnm verify --db ./restored.db --json
```

The export contains active, expired, and soft-removed canonical records. It excludes retrieval-only `store`, transient `score`, tags tables, and FTS rows. JSONL starts with `{ "_format": "nanomneme", "_version": 1 }`, followed by complete canonical records. File export uses a same-directory temporary file and atomic replacement, without a power-loss durability guarantee. The output must not be the source database, its journal/WAL/shared-memory paths, or an existing alias to those files.

On POSIX systems, database files request `0600` before SQLite initialization and new store directories request `0700`; existing permissions and arbitrary parent directories are unchanged. Export temporary files request `0600`, preserving stricter owner permissions on replacement. The caller's umask may restrict these modes further. Permission checks do not audit ACLs or apply on Windows.

Import validates the header and every record before opening the destination, then applies all records in one transaction. Importing into an existing store is a conflict-safe merge, not an overwrite: duplicate IDs within the file or IDs already present in the destination reject the complete import. Resolve conflicts by producing a new canonical file; do not edit the database directly.

### Import features and guarantees

Import supports single-entry creation, multi-record transfer, restoration into a new store, and conflict-safe merging into an existing store. CLI input is canonical JSONL; embedded callers use `store.import(records)` with an array of canonical record objects and no file header.

| Feature | Behavior |
|---|---|
| Versioned format | The first JSONL line must identify `_format: "nanomneme"` and numeric `_version: 1`; other format names or versions fail. |
| Complete-input validation | CLI parses and validates every record in a temporary in-memory store before opening or creating the destination. |
| Strict record fields | All 13 canonical fields are required; unknown fields, including retrieval-only `store` and `score`, fail. |
| Canonical values | IDs, content, kinds, scopes, namespaces, and tags must already be canonical; import does not trim, sort, deduplicate, or supply defaults to fix a record. |
| Batch atomicity | Canonical rows, tags, and FTS changes commit together; a conflict or write failure rolls back the whole batch. Valid records preceding an invalid record are not imported. |
| Conflict-safe merge | Duplicate IDs within the input or any ID already in the destination reject the batch, even if the existing record is identical, expired, or soft-removed. Checks against destination IDs occur under the write lock. |
| No content deduplication | Different IDs with identical content are separate records. Reimporting the same IDs is not an idempotent operation. |
| State preservation | IDs, timestamps, scope, metadata, expiry, and soft-removal state are preserved. Import does not generate new IDs, rewrite scope, add adapter provenance, renew expiry, or restore removed records. |
| Derived-data synchronization | Tags are inserted into their relation; FTS is populated for every non-removed record, including expired records. Soft-removed records remain unindexed. |
| Explicit destination | Project, global, and custom database routes are supported; `--both` is not an import option. Mixed project/global scope labels do not route records into separate databases. |
| Stable result | Success returns `{ "imported": N }` with `--json`, or `Imported: N` without it. Failures exit with status `1` and an explanation on stderr. |
| Empty transfer | A valid header with no records succeeds with `imported: 0`; an empty file fails. A zero-record import can still create a destination and run write-transaction setup. |

#### Rejected input

- Invalid JSON, missing/wrong headers, unsupported format versions, blank record lines, comments, trailing commas, or records split across multiple lines. JSONL accepts LF or CRLF line endings and an optional final newline.
- Non-object records, missing required fields, or unknown record fields.
- IDs that are not canonical lowercase UUID v4 values; empty, untrimmed, or malformed-Unicode content; unsupported kinds/scopes; or invalid lowercase kebab-case namespaces and tags. Valid Unicode surrogate pairs are preserved.
- Scores outside `0..1` or with the wrong type; duplicate or unsorted tags; or metadata that is not a JSON object. Embedded core callers also cannot supply metadata values that JSON would silently coerce or omit.
- Invalid calendar dates, timestamps outside the exact four-digit UTC `YYYY-MM-DDTHH:mm:ss.sssZ` format, missing creation/update timestamps, or an `updated_at` earlier than `created_at`.
- A batch containing an invalid record or a duplicate/conflicting ID, regardless of how many earlier records are valid.

#### Operational boundaries

Format validation is not automatic repair or a complete destination integrity audit. Invalid input leaves an existing destination unchanged and does not create a missing destination. Once valid input has passed validation, a later destination-open or write failure can leave a newly initialized empty database; batch rollback concerns records, not removal of the database file. Run `verify` after a successful import to check the resulting store.

Parsing uses Node's UTF-8 text decoding and `JSON.parse`, not a strict byte-level UTF-8 validator or duplicate-key detector. Avoid malformed encoded bytes and repeated JSON property names; decoding may replace invalid bytes, and repeated properties use their last parsed value. The header checks its format/version identifiers but does not reject extra header properties; unknown record fields are rejected.

The CLI reads the entire file into memory and performs a validation import before the destination import; it is not a streaming importer and has no explicit file-size or record-count limit. Allow sufficient memory for large transfers. Write-lock contention uses the core's five-second busy timeout and can fail; there is no automatic retry. Transactional import is not a filesystem or device-level power-loss guarantee.

JSONL transfers records, not SQLite files, adapter settings, pins, session state, or logs. It does not checkpoint, vacuum, back up, or repair existing storage. Canonical field values are preserved, not the original JSON whitespace or serialized bytes. The input file is read but not modified or deleted. New database permissions follow the storage rules above; import does not tighten an existing database's permissions. Keep transfer files private and review diagnostics before sharing them; shared opt-in logging observes import outcomes and preserves thrown-error messages as described in [Shared opt-in diagnostics](#shared-opt-in-diagnostics).

### Import a memory manually

Use this workflow when you need to supply a complete memory record with its own ID and timestamps. For a new note without those requirements, use `nmnm retain "Memory content"`; retain generates the ID, timestamps, and defaults for you.

#### Step 1: Choose the destination

Run project commands from the intended project directory. No selector targets `./.nanomneme/memory.db`; `--global` targets the personal store on Linux/macOS; `--db <path>` targets an explicit database. Import preserves each record's `scope`; selecting a database does not rewrite it. Use `project` for the project example below, or change it to `global` for a global entry. Do not combine `--global` and `--db`.

#### Step 2: Generate an ID

Generate a fresh lowercase UUID v4 and copy it into the record's `id` field:

```sh
node -e "console.log(require('node:crypto').randomUUID())"
```

The UUID below is illustrative. Replace it for each new entry; reimporting the same ID into a database that already contains it fails instead of updating that record.

#### Step 3: Create the JSONL file

In a text editor, save the following as a UTF-8 file named `memory.jsonl`. Keep each JSON object on one line, with the format header first and one complete record on each subsequent line. Do not wrap the records in an array, add comments, include blank lines, or pretty-print a record across multiple lines. A final newline is allowed.

```jsonl
{"_format":"nanomneme","_version":1}
{"id":"5fdbec82-e87b-4bb4-92a3-76f62e9c7421","content":"Run npm test before releasing changes.","kind":"instruction","scope":"project","namespace":"default","importance":0.8,"confidence":1,"created_at":"2026-10-04T00:00:00.000Z","updated_at":"2026-10-04T00:00:00.000Z","expires_at":null,"removed_at":null,"metadata":{},"tags":["release","testing"]}
```

All 13 record fields shown are required; import supplies no defaults and rejects unknown fields. Use a non-empty, already-trimmed `content` with well-formed Unicode; a supported `kind` and `scope`; lowercase kebab-case `namespace` and tags; and numeric `importance` and `confidence` between 0 and 1. Tags must be unique and sorted; use `[]` for none. Metadata must be a JSON object, such as `{}`, not `null` or an array. Do not include retrieval-only `store` or `score` fields.

Use real UTC timestamps in the exact `YYYY-MM-DDTHH:mm:ss.sssZ` format, with `updated_at` equal to or later than `created_at`. Set `expires_at` and `removed_at` to `null` for an unexpired, active entry. Import preserves supplied timestamps and state, so an expired or soft-removed entry will not appear in ordinary recall. Protect the file because it contains the memory's full content and metadata.

#### Step 4: Import into the selected database

For the project database:

```sh
nmnm import ./memory.jsonl --json
```

For an explicit database, use this instead:

```sh
nmnm import ./memory.jsonl --db ./memory.db --json
```

For the global database, first change the example record's `scope` to `global`, then use this instead:

```sh
nmnm import ./memory.jsonl --global --json
```

Choose one command, not all three. A successful single-record import exits with status `0` and returns `{ "imported": 1 }`. A missing destination is created only after the complete input passes validation. Invalid records or duplicate/conflicting IDs reject the entire batch without inserting any records. There is no overwrite or upsert option.

#### Step 5: Confirm the result

Replace the example ID with the UUID you used. For the project database:

```sh
nmnm recall 5fdbec82-e87b-4bb4-92a3-76f62e9c7421 --json
nmnm retrieve "releasing changes" --json
nmnm verify --json
```

Append the same `--db ./memory.db` or `--global` selector to every confirmation command if you imported elsewhere. Recall should return the entry and verification should report `"ok": true`. If import fails, inspect stderr, correct the JSONL file or resolve the destination ID conflict, and retry; rerunning an already successful import produces an ID conflict. Use `retain --id <memory-id>` to patch an existing record rather than importing it again.

### Make and restore an exact backup

Close every process using the database before copying it:

```sh
nmnm verify --db ./source.db --json
cp ./source.db ./memory-backup.db
nmnm verify --db ./memory-backup.db --json
```

Restore only while the destination is closed, and preserve the current file separately until the restored copy verifies. Plain copying is not an online-backup mechanism; use JSONL export when writers cannot be stopped. If an external tool enabled WAL, ensure committed WAL data is checkpointed before copying only the main database.

### Verify and repair

Run `verify` before transfer, after import or restore, and whenever direct inspection or an interrupted filesystem operation makes integrity uncertain. Verification is read-only and reports exact schema-column, SQLite integrity, foreign-key, canonical-field and timestamp-ordering, tag, and FTS issues. It skips unsafe table queries when required columns are missing, so malformed schemas remain structured diagnostic results.

On POSIX systems, `file_permissions` reports group/other access on the database or existing journal, WAL, and shared-memory files using the labels `database`, `journal`, `wal`, and `shm`. Verification does not change permissions. CLI verification exits with status `1` when these issues are present; inspect intentional sharing and manually restrict the affected files before verifying again. FTS repair does not fix permissions.

Use repair only for derived full-text drift:

```sh
nmnm repair --rebuild-fts --db ./memory.db --json
nmnm verify --db ./memory.db --json
```

Repair rebuilds FTS rows from non-removed canonical memories, including expired rows, and then verifies the store. It does not change canonical memories, tags, metadata, or the canonical schema; a successful write transaction also enables FTS5 deletion protection. If canonical, schema, integrity, or tag issues remain, stop writes and restore a verified backup or export rather than trying manual SQL changes.

### Recover removed data

A default remove is reversible. Restore the same ID with an explicit retain patch:

```sh
nmnm retain "Restored content" --id <memory-id> --db ./memory.db --scope project --json
```

`remove --purge` is irreversible within the live store. Recovery then requires a prior SQLite backup or JSONL export. Because exports include soft-removed records, importing an export preserves their removed state instead of silently reactivating them.

Soft removal retains canonical content, metadata, and tags for restoration/export, but removes the live FTS entry. Expiry only hides records from active reads; expired rows remain inspectable, exportable, and indexed. Soft removal returns `null` for missing, expired, or already removed records; purge can delete active, expired, or soft-removed records and returns `null` for a missing ID. Purge atomically deletes the canonical row, tags, and live FTS entry. It is logical deletion with reduced recoverability, not guaranteed forensic or device-level erasure.

Writable core connections enable and check SQLite `PRAGMA secure_delete = ON`. Each write transaction enables persistent FTS5 `secure-delete` before mutation when needed; setting failures abort the transaction rather than silently omit protection. Read-only opens do not change this setting. Existing stores acquire FTS protection on their next successful write transaction, without rewriting their historical data. FTS5 protection requires SQLite 3.42 or later and may upgrade its index format beyond older readers. The official macOS arm64 Node 22.13.0 binary has SQLite 3.47.2 but lacks FTS5; Node 22.19.0 has FTS5 and SQLite 3.50.4. Use an FTS5-capable supported Node runtime or compatible SQLite tools for protected stores. See [SQLite secure deletion](https://www.sqlite.org/pragma.html#pragma_secure_delete) and [FTS5 secure deletion](https://www.sqlite.org/fts5.html#the_secure_delete_configuration_option).

These protections apply to subsequent updates/deletes, not old remnants or separate copies. WAL/journal history, existing reader snapshots, exports, backups, filesystem snapshots, and storage hardware remain outside the purge guarantee. Core does not automatically checkpoint, vacuum, rewrite historical data, or delete external copies. Any historical cleanup workflow requires a separate reviewed design and explicit operator approval.

## Troubleshooting

| Symptom | Check | Action |
|---|---|---|
| `nmnm:` argument error | Command help and option spelling | Correct the command; parsing fails before storage opens. |
| Database does not exist | Selected project, global, or custom path | Use the intended path. Read-only commands do not create stores. |
| Recall returns `null` | Store, ID, expiry, and removal state | Retrieve with `--expires any`; restore a soft removal with `retain --id`. |
| Retrieval misses expected text | FTS5 query syntax and filters | Punctuation terms are already literal; simplify or quote operators explicitly, then run `verify` if canonical records should match. |
| Import is rejected | Header, canonical fields, duplicate IDs, and destination conflicts | Correct the complete JSONL input; imports never partially commit. |
| Verification reports only FTS issues | `fts_*` issue groups | Run `repair --rebuild-fts`, then verify again. |
| Verification reports permission issues | `file_permissions` and affected file labels | Review intentional sharing, manually restrict affected file permissions, then verify again. |
| Verification reports other issues | Schema, integrity, fields, foreign keys, or tags | Stop writes and restore a verified backup or export. |

The `node:sqlite` experimental warning can appear on supported Node versions and does not by itself indicate command failure. Use the process exit status and documented output instead. On platforms where `--global` is unsupported, use an explicit `--db <path>`.

## Documentation ownership

- [README.md](../README.md) defines product scope, architecture, and the documentation index.
- This manual owns task sequences, operational guidance, and audience-specific examples.
- [Pi Adapter Manual](../adapters/pi/docs/PI_ADAPTER_MANUAL.md) owns Pi installation, tools, configuration, pins, and automatic index behavior.
- Package READMEs own package installation and discovery.
- [UI README](../packages/nmnm-ui/README.md) owns the local workbench, cleanup workflow, HTTP/session boundaries, limitations, and future UI features.
- `nmnm --help` is authoritative for available CLI flags.
- Runtime code and tests are authoritative when documentation and behavior disagree; fix the documentation in the same change.

Examples use `nmnm` for an installed CLI and explicit placeholders such as `<memory-id>` and `<path>`. Commands that modify storage state their target store. Destructive examples identify irreversible operations before showing them.

## Shared opt-in diagnostics

Diagnostics default off. Enable shared `logging.enabled` in `~/.local/share/nanomneme/config.jsonc`. Raw error messages are not redacted. See the [Logger manual](LOGGER.md#configuration-and-record-contract) for configuration, record fields, permissions, and privacy boundaries.

The CLI observes retain, recall, retrieve, remove, import, export, verify, and repair once per command. Combined retrieval and repair have one aggregate outcome; transfer output completion is included. Help/version/unknown commands and temporary validation stores are unlogged. The terminal CLI reads shared settings per invocation, has no adapter override, and uses null correlation.

UI diagnostics use the same shared opt-in setting and write `nmnm-ui.jsonl`. Edit/expiry/restore use `retain`; remove/purge use `remove`. General request, launcher, and captured browser errors use a UI-only `ui.error` event. Successful reads/navigation and canceled actions stay quiet. Mutation failures emit once; browser reports are authenticated and best effort. See the [UI logging reference](../packages/nmnm-ui/README.md#opt-in-logslines-diagnostics).

Core persistence remains uninstrumented; explicit observers load through `@openlines/nmnm-core/logging`. CLI binding construction lives in `src/logslines.js`; command observation remains in its executable. The [Logger manual](LOGGER.md#source-and-artifact-map) owns the file-role and build reference.
