# nanomneme

`nanomneme` is a small, deterministic SQLite memory store for people and agents.
It uses lexical FTS5/BM25 retrieval and structured filters. It does not use an LLM,
embeddings, a vector store, a server, or background processing.

## Architecture

```text
nmnm CLI
   |
   v
nmnm-core: 4Rs + verify, export/import, and FTS repair
   |
   v
node:sqlite + SQLite FTS5
   |
   v
project database or separate global database
```

`nmnm-core` owns validation, schema creation, transactional writes, tag maintenance,
and FTS synchronization. The CLI only parses options, calls one core operation, and
formats the result. No harness, protocol, or model dependency is in the core.

## Scope and database location

`scope` labels a memory. Database selection determines which SQLite file receives a
command. Project and global databases use the same schema but are never merged.

| Use | Scope value | Database path |
|---|---|---|
| Project memory | `project` (default) | `./.nanomneme/memory.db` (default) |
| Shared personal memory | `global` (default with `--global`) | `~/.local/share/nanomneme/memory.db` |

The default project layout is:

```text
my-project/
├── .nanomneme/
│   └── memory.db
└── ...
```

On Linux and macOS, `--global` selects the global path and gives new retained records
`scope=global`. `scope` accepts only `project` or `global`; an explicit `--scope`
overrides that default but does not select a different database.

```sh
nmnm retain "Prefer concise operator docs" \
  --global
nmnm retrieve "operator docs" --global
```

`--global` and `--db` cannot be combined. On other platforms, use `--db` explicitly.
Reading both databases in one command, including precedence rules, is deliberately
deferred.

## Requirements

- Node.js 22.13 or later
- SQLite FTS5 support in Node's built-in `node:sqlite` runtime

`node:sqlite` may print Node's experimental-feature warning. It does not require an
experimental runtime flag on the supported Node versions.

## Install and use

From this workspace:

```sh
npm install
node packages/nmnm-cli/bin/nmnm.js retain "Use SQLite for storage" \
  --kind decision --tags architecture,storage
nmnm --version
```

`nmnm --version` (or `nmnm -v`) prints the installed CLI version without opening or
creating a database.

The CLI uses `./.nanomneme/memory.db` by default. Use `--global` for the dedicated
global database, or `--db <path>` for another SQLite file. nanomneme does not merge
global and project databases.

## The 4Rs

| Operation | What it does |
|---|---|
| `retain` | Creates a memory, or explicitly patches/restores one by `id`. It never deduplicates by content. |
| `recall` | Resolves one known active, unexpired memory by `id`; returns no result when absent. |
| `retrieve` | Discovers active memories with FTS5/BM25 text search, filters, ordering, and pagination. It can inspect expired records when requested. |
| `remove` | Soft-deletes by default. `--purge` permanently deletes the memory, its tags, and its FTS entry. |

```sh
# Retain or explicitly patch a memory.
nmnm retain "Prefer concise documentation" --kind preference --tags docs,style
nmnm retain "Prefer short operator docs" --id <memory-id>
nmnm retain "Prefers dark interfaces" --global

# Direct lookup, lexical retrieval, and removal.
nmnm recall <memory-id>
nmnm retrieve "documentation" --kind preference --tags docs
nmnm retrieve --expires expired
nmnm remove <memory-id>
nmnm retain "Updated documentation preference" --id <memory-id>
nmnm remove <memory-id> --purge
nmnm retrieve "interfaces" --global
nmnm verify --json
nmnm export --out memory.jsonl
nmnm import memory.jsonl --db restored.db --json
nmnm repair --rebuild-fts --json
```

`verify`, `export`, `import`, and `repair` are maintenance/portability operations, not
additional memory operations. `verify` is a report-only database diagnostic. It checks
schema, SQLite integrity, field conventions, foreign keys, tags, and FTS consistency.
It never repairs a database. A defect report exits with status `1`; a missing database
also fails rather than creating an empty SQLite file.

Use [`--json` with every command for stable machine-readable output](#json-responses):

```sh
nmnm retrieve "SQLite" --namespace nanomneme --json
```

Without `--json`, `retain` and `recall` print the complete stored record: identity,
content, classification, scores, tags, expiry, timestamps, and metadata. `retrieve`
stays compact for scanning; use `recall <id>` to inspect one result. `remove` prints
the selected mode and its removal or purge timestamp.

`retrieve` combines every supplied filter with AND. When multiple tags are supplied,
each returned memory has every requested tag. Active memories are returned by default;
use `--expires expired` or `--expires any` to inspect expiry state. Text queries use
FTS5 syntax and rank by BM25. Without a query, results are ordered by most recently
updated memory. `--expires` accepts `active`, `expired`, or `any`; `--order-by` accepts
`id`, `created_at`, `updated_at`, `importance`, `confidence`, or `relevance` with a query.

## Database schema

The database contains four tables. `memories` is the source of truth; the other three
serve tags, full-text retrieval, and schema metadata.

### `memories`

| Column | Type | Default | Description and allowed values |
|---|---|---|---|
| `id` | `TEXT` | Core-generated | Lowercase UUID v4 generated by the core. Invalid IDs fail; a valid unknown ID returns no result. |
| `content` | `TEXT` | None, required | Any non-empty, trimmed string. |
| `kind` | `TEXT` | `note` | Exactly one of `note`, `decision`, `preference`, `fact`, or `instruction`. |
| `scope` | `TEXT` | `project` | Exactly `project` or `global`. `retain --global` defaults new records to `global`; this label does not determine the database path. |
| `namespace` | `TEXT` | `default` | Lowercase kebab-case domain/owner slug, such as `nanomneme` or `user`. It partitions one database; use `default` otherwise. |
| `importance` | `REAL` | `0.5` | Finite number from `0` through `1`, inclusive. |
| `confidence` | `REAL` | `1.0` | Finite number from `0` through `1`, inclusive. |
| `created_at` | `TEXT` | Core-generated | UTC ISO-8601 timestamp set when the record is created. |
| `updated_at` | `TEXT` | Core-generated | UTC ISO-8601 timestamp set on create, patch, soft removal, or restoration. |
| `expires_at` | `TEXT` | `NULL` | `NULL` or a UTC timestamp in `YYYY-MM-DDTHH:mm:ss.sssZ` form. Expired records are excluded from normal reads. |
| `removed_at` | `TEXT` | `NULL` | `NULL` when active or restored; a core-generated UTC ISO-8601 timestamp after soft removal. |
| `metadata` | `TEXT` | `{}` | JSON object stored as inspectable text. Values may be strings, numbers, booleans, `null`, arrays, or objects. No reserved keys or retrieval semantics. |

### `memory_tags`

| Column | Type | Default | Description and allowed values |
|---|---|---|---|
| `memory_id` | `TEXT` | None, required | An existing `memories.id` UUID. It is maintained by the core. |
| `tag` | `TEXT` | None, required | Lowercase kebab-case slug, e.g. `architecture` or `operator-docs`; trimmed, deduplicated, and sorted. |

The composite primary key is `(memory_id, tag)`.

### `memories_fts`

| Column | Type | Default | Description and allowed values |
|---|---|---|---|
| `rowid` | `INTEGER` | Core-synchronized | The internal SQLite rowid of the matching `memories` row. |
| `content` | `TEXT` | Core-synchronized | The matching memory's non-empty content text, indexed by FTS5 for BM25 retrieval. |

### `nmnm_meta`

| Column | Type | Default | Description and allowed values |
|---|---|---|---|
| `key` | `TEXT` | `schema_version` | Core-owned metadata key. The current schema stores only `schema_version`. |
| `value` | `TEXT` | `1` | Current schema version. |

New databases start at `schema_version=1`. Future cores apply registered forward
migrations transactionally. A database created by a newer core, or an existing
unversioned database, is rejected without modification.

## Record fields

`retain` requires `content` for a new record. Its defaults are:

```text
kind=note  scope=project  namespace=default  importance=0.5  confidence=1.0
```

Sample `retain`:

```bash
> node packages/nmnm-cli/bin/nmnm.js retain "Always sample the samples before sampling"

  ID: 0807d...
  Content: Always sample the samples before sampling
  Kind: note
  Scope: project
  Namespace: default
  Tags:
```
```bash
> node packages/nmnm-cli/bin/nmnm.js retain "Use nanomneme for any memory handling" --global \
  --kind decision --tags architecture,storage

  ID: 6e5cd...
  Content: Use nanomneme for any memory handling
  Kind: decision
  Scope: global
  Namespace: default
  Tags: architecture, storage
```

Optional fields are `kind`, `scope`, `namespace`, `tags`, `metadata` (a JSON object),
`expires_at`, `importance`, and `confidence`. Updates require the target `id`; content
similarity never modifies an existing record. `retain --global` changes the default
new-record scope to `global`; it does not alter the scope of an `--id` patch.

## JSON responses

Use `--json` for valid machine-readable JSON.

### Memory object

`retain` returns this object. `recall` returns this object or `null`. Each
`retrieve.items` entry uses it; `score` appears only for a text query.

```jsonc
{
  "id": "0807d73a-33ff-4583-86e7-c6555594dc8e", // generated UUID v4
  "content": "Always sample the samples before sampling", // memory text
  "kind": "note", // note | decision | preference | fact | instruction
  "scope": "project", // project | global
  "namespace": "default", // logical partition in this database
  "importance": 0.5, // caller priority, 0..1
  "confidence": 1, // caller certainty, 0..1
  "created_at": "2026-08-25T10:39:24.997Z", // creation time
  "updated_at": "2026-08-25T10:39:24.997Z", // latest write time
  "expires_at": null, // UTC expiry timestamp, or null
  "removed_at": null, // soft-removal timestamp, or null
  "metadata": {}, // caller JSON object
  "tags": [], // normalized tag slugs
  "score": -9.243697478991598e-7 // FTS5 relevance, text retrieve only
}
```

`score` is not stored memory data and is unrelated to `importance` or `confidence`.
It is SQLite FTS5's BM25 relevance value. nanomneme orders it ascending, so a lower
(more negative) value ranks first. See [SQLite FTS5 BM25](https://www.sqlite.org/fts5.html#the_bm25_function).

### `retain --json`

Returns the memory object above after creation, explicit patching, or restoration.
`score` is omitted.

### `recall <id> --json`

Returns the memory object above for one active, unexpired ID; otherwise returns `null`:

### `retrieve [query] --json`

```jsonc
{
  "total": 1, // all matches before limit and offset
  "items": [
    { /* memory object above; score is included only when query is supplied */ }
  ]
}
```

### `remove <id> --json`

Soft removal is the default. A missing active record returns `null`.

```jsonc
{
  "id": "0807d73a-33ff-4583-86e7-c6555594dc8e",
  "mode": "soft", // soft | purge
  "removed_at": "2026-08-25T10:40:00.000Z"
} // restorable

{
  "id": "0807d73a-33ff-4583-86e7-c6555594dc8e",
  "mode": "purge", // soft | purge
  "purged_at": "2026-08-25T10:41:00.000Z"
} // --purge; irreversible
```

### `verify --json`

Verification always returns a report. `issues` is empty when `ok` is `true`; otherwise
each group identifies the failed check, its count, and affected memory IDs or schema
object names.

```jsonc
{
  "ok": false,
  "schema_version": 1,
  "issues": [
    {
      "code": "fts_missing", // sqlite_integrity | foreign_key | schema_* | memory_field | tag_field | fts_*
      "count": 1,
      "ids": ["0807d73a-33ff-4583-86e7-c6555594dc8e"]
    }
  ]
}
```

## Runtime references

- [Node.js 22 `node:sqlite` documentation](https://nodejs.org/download/release/v22.23.2/docs/api/sqlite.html)
- [SQLite FTS5 and BM25 documentation](https://www.sqlite.org/fts5.html#the_bm25_function)

## Portability and repair

`export` writes canonical JSONL: a format header followed by one complete record per
line. Active, expired, and soft-removed records are included; transient `score` is not.
Use `--out <file>` for a file or omit it to write JSONL to stdout. `import <file>`
validates the complete input before opening the destination and commits atomically;
duplicate or existing IDs reject the whole import.

```sh
nmnm export --out memory.jsonl
nmnm import memory.jsonl --db another.db --json
```

`repair --rebuild-fts` rebuilds only derived FTS rows for active memories, then runs
verification. It never changes canonical records, tags, metadata, or schema and exits
nonzero if verification still reports issues.

## Operations and recovery

`remove` is a soft delete by default. It removes the record from ordinary recall and
retrieve operations, but retains the row, tags, and ID. Restore it with `retain --id`:

```sh
nmnm remove <memory-id>
nmnm retain "Restored or updated content" --id <memory-id>
```

Use `--purge` only when permanent deletion is intended. It deletes the memory row,
its tags, and its full-text entry; the ID cannot be restored.

```sh
nmnm remove <memory-id> --purge
```

To back up a database, close all nanomneme processes and copy its SQLite file:

```sh
cp .nanomneme/memory.db memory-backup.db
```

The database is ordinary SQLite and can be inspected with any SQLite tool. Direct
writes are unsupported because they can desynchronize the FTS index and tags. Use
`nmnm verify` to diagnose this drift; it reports defects but never repairs or changes
stored data.

## Namespace

`namespace` partitions memories within one SQLite database and is an AND-filter, not
an access-control boundary. It neither chooses a database path nor merges project and
global records. Use `default` unless one database intentionally serves multiple domains.

## Example entries

The following illustrates how one project and one global record look in the database.
Timestamps and UUIDs are shortened only for display.

```text
memories
────────────────────────────────────────────────────────────────────────────────────────
id        scope    namespace  kind        content
01HQ…A31  project  nanomneme  decision    SQLite is the embedded storage engine.
01HQ…B92  global   user       preference  Prefer concise operator documentation.

id        importance  confidence  expires_at  removed_at  metadata
01HQ…A31  0.90        1.00        NULL        NULL        {"source":"architecture"}
01HQ…B92  0.70        1.00        NULL        NULL        {"source":"user"}

memory_tags
────────────────────────────
memory_id  tag
01HQ…A31   architecture
01HQ…A31   storage
01HQ…B92   docs
01HQ…B92   preference
```

The project record would normally live in `./.nanomneme/memory.db`; the global record
would live in `~/.local/share/nanomneme/memory.db`. Both use the same schema.
