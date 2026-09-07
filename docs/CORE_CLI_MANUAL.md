# nanomneme Core and CLI Manual

This manual is the task-oriented guide for nanomneme. It serves developers who embed
`nmnm-core` and agents or operators that call the `nmnm` CLI. Pi users should pair it
with the [Pi Adapter Manual](PI_ADAPTER_MANUAL.md). nanomneme remains a local,
deterministic SQLite memory store without required models, services, or network access.

## Audiences

### Developers

Use the developer path to install the workspace packages, open and close stores safely,
call the 4Rs, inspect the schema, and use portability and verification APIs. Examples use
Node.js ESM and the built-in `node:sqlite` runtime required by the project.

### Agents and operators

Use the agent path for deterministic CLI calls, stable JSON responses, explicit store
selection, ID-based updates, and actionable error handling. Human-readable output is for
interactive use; automated callers should request `--json`.

## Operating contract

- The core operates on one SQLite database at a time.
- The CLI selects project, global, or custom storage. Retrieval alone can compose project
  then global results with `--both`.
- `(store, id)` is the effective identity of a retrieval result.
- Canonical records live in `memories`; tags and FTS rows are derived.
- Retrieval is lexical and deterministic. Separate database scores are never compared.
- Canonical JSONL is the portable interchange format. Exact backups are closed SQLite
  file copies.

## Manual map

| Chapter | Primary audience | Outcome |
|---|---|---|
| Getting started and CLI reference | Both | Install nanomneme and complete the 4Rs. |
| Developer guide | Developers | Use the core API, lifecycle, schema, and errors safely. |
| Agent guide | Agents | Produce deterministic commands and consume JSON results. |
| Pi Adapter Manual | Pi users | Install the adapter and manage the complete JSONC settings template, store-validated JSON pins, automatic context, file lifecycle, combined list, and safe soft removal. |
| Portability and recovery | Both | Export, import, back up, verify, repair, and restore. |
| Troubleshooting | Both | Diagnose common input, storage, FTS, and schema failures. |

The tracked delivery phases are maintained in [ROADMAP.md](../ROADMAP.md).

## Getting started

### Requirements and installation

Use Node.js 22.13 or later with FTS5 available in the built-in `node:sqlite` module.
Install the CLI for terminal or agent use:

```sh
npm install --global nmnm-cli
nmnm --version
```

Install the core package in a Node.js ESM application:

```sh
npm install nmnm-core
```

From a repository checkout, install both workspaces and invoke the CLI directly:

```sh
npm install
node packages/nmnm-cli/bin/nmnm.js --help
```

Node may print an experimental warning for `node:sqlite`; supported Node versions do not
need an experimental runtime flag.

### First CLI workflow

Use `--db` in examples and scripts when the storage target should be explicit:

```sh
nmnm retain "Prefer concise documentation" --kind preference \
  --tags docs,style --db ./memory.db --json
nmnm retrieve "documentation" --db ./memory.db --json
nmnm recall <memory-id> --db ./memory.db --json
nmnm remove <memory-id> --db ./memory.db --json
```

The retain response supplies `<memory-id>`. Removal is soft by default. A later
`retain --id <memory-id>` patches and restores that row; `remove --purge` is irreversible.

### Select a store

| Selection | Database | Notes |
|---|---|---|
| No selector | `./.nanomneme/memory.db` | Project default. |
| `--global` | `~/.local/share/nanomneme/memory.db` | Linux and macOS personal store. |
| `--db <path>` | Exact supplied path | Custom store for scripts, tests, or isolation. |
| `retrieve --both` | Project, then global | Retrieval only; missing stores remain absent. |

`--global` cannot be combined with `--db`. `--both` cannot be combined with either.
The record's `scope` is a label and does not choose its database.

## CLI reference

| Command | Input | Description | Notes |
|---|---|---|---|
| `retain` | `[content]` | Create a UUID v4 record, or patch and restore an explicit ID. | New records need content. |
| `recall` | `<id>` | Read one active, unexpired record. | Returns no result when absent, removed, or expired. |
| `retrieve` | `[query]` | Return filtered, ordered, paginated records. | `--both` is retrieval-only. |
| `remove` | `<id>` | Soft-remove a record. | `--purge` permanently deletes it. |
| `verify` | None | Report schema, integrity, tag, and FTS defects. | Read-only. |
| `export` | None | Write canonical JSONL. | `--out` uses atomic replacement; no `--json`. |
| `import` | `<file>` | Validate then transactionally import canonical JSONL. | No partial import. |
| `repair` | `--rebuild-fts` | Rebuild derived FTS rows, then verify. | Writable maintenance command. |

### Common flags

| Flag | Value | Description | Notes |
|---|---|---|---|
| `--db` | `<path>` | Select an exact database. | Cannot combine with `--global` or `--both`. |
| `--global` | None | Select the standard global database. | Cannot combine with `--db` or `--both`. |
| `--json` | None | Emit structured JSON. | Invalid with `export`, which emits JSONL. |
| `--help` | None | Show current CLI usage. | Authoritative flag reference. |
| `--version`, `-v` | None | Print the installed version. | Opens no storage. |
| `--` | None | End option parsing. | Use before retain content or a retrieve query beginning with `--`. |

### Retain flags

| Flag | Value | Description | Notes |
|---|---|---|---|
| `--id` | UUID v4 | Patch and restore a known record. | Never creates a record with a caller-supplied ID. |
| `--kind` | `note`, `decision`, `preference`, `fact`, `instruction` | Classify the record. | Optional. |
| `--scope` | `project`, `global` | Label the record scope. | Does not select the database. |
| `--namespace` | `<lowercase-slug>` | Add a namespace. | Optional. |
| `--tags` | `<lowercase-slug,...>` | Add normalized tags. | Comma-separated. |
| `--importance`, `--confidence` | `0..1` | Set ranking and confidence values. | Optional numeric values. |
| `--expires-at` | `<UTC ISO>` | Set expiry. | Omit for no expiry. |
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

`remove` also accepts `--purge`; `export` accepts `--out <file>`; `repair` requires
`--rebuild-fts`. Run `nmnm --help` for exact current syntax.

## Developer guide

### Store lifecycle

Always close the store. Use `try`/`finally` so validation, SQLite, or application errors
cannot leave a connection open:

```js
import { open } from 'nmnm-core';

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

`open(path)` creates a missing database and applies registered forward migrations.
`open(path, { create: false })` requires an existing database. Use
`open(path, { readOnly: true })` for reads that must neither create nor migrate storage;
SQLite rejects mutation methods on that connection.

### Core API

| Method | Input | Return |
|---|---|---|
| `retain(input)` | New record fields, or existing `id` plus fields to patch | Complete stored memory. |
| `recall({ id })` | UUID v4 | Active, unexpired memory or `null`. |
| `retrieve(selector)` | Query, filters, ranges, ordering, and pagination | `{ total, items }`. |
| `remove({ id, mode })` | UUID and optional `soft` or `purge` mode | Removal result; missing IDs fail. |
| `export()` | None | Canonical records in ID order, including expired and soft-removed rows. |
| `import(records)` | Array of canonical records | `{ imported }`; validation and conflicts are atomic. |
| `verify()` | None | `{ ok, schema_version, issues }` without repair. |
| `rebuildFts()` | None | `{ mode: 'rebuild-fts', rebuilt }`. |
| `close()` | None | Closes the SQLite connection. |

New `retain` inputs require `content`. Optional fields are `kind`, `scope`, `namespace`,
`importance`, `confidence`, `expires_at`, `metadata`, and `tags`. The core generates the
ID and timestamps. Passing `id` switches retain to patch/restore mode and never performs
content-based deduplication.

Retrieve selectors support `query`; scalar or array `kind`, `scope`, and `namespace`;
an array of `tags`; numeric `importance` and `confidence` values or `{ gt, gte, lt, lte }`
ranges; `expires`; `order_by`; `limit`; and `offset`. Text retrieval uses FTS5/BM25.
Equal lexical scores prefer higher importance, then ID. Without a query, the default is
newest `updated_at` first.

### Schema ownership

| Table | Ownership |
|---|---|
| `memories` | Canonical source of truth for record fields and JSON metadata. |
| `memory_tags` | Core-maintained normalized tag relation. |
| `memories_fts` | Core-maintained FTS5 index for non-removed records, including expired rows. |
| `nmnm_meta` | Core-maintained schema version. |

Do not write these tables directly. Core transactions keep canonical rows, tags, and FTS
synchronized. The core API and CLI flag tables above define accepted public values.

Public reads and exports project the canonical memory columns explicitly. If schema drift
adds a column, `verify` reports it but recall, retrieval, and canonical JSONL do not expose
the unexpected value.

### Errors

| Error | Typical cause | Caller action |
|---|---|---|
| `TypeError` | Malformed fields, timestamps, slugs, metadata, selectors, or FTS5 queries. | Correct input before retrying. |
| `RangeError` | Out-of-range values, missing mutation targets, or import ID conflicts. | Change input or resolve the conflict. |
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

Follow-up commands must select the result's store. Use no selector for `project`,
`--global` for `global`, and the original `--db <path>` for `custom`. A custom result says
`"store": "custom"`; it does not repeat the database path, so the caller must retain that
path. `--both` is retrieval-only.

### Consume JSON output

| Command | JSON contract |
|---|---|
| `retain` | Complete memory object. |
| `recall` | Complete memory object or `null`. |
| `retrieve` | `{ "total": number, "items": [...] }`; every item adds `store`. |
| `remove` | Removal result or `null` when no active record exists. |
| `verify` | `{ "ok", "schema_version", "issues" }`. |
| `import` | `{ "imported": number }`. |
| `repair` | Rebuild result plus nested `verification`. |
| `export` | Canonical JSONL on stdout, or a file with `--out`; not `--json`. |

`score` appears only for text retrieval and is transient. Lower values rank first within
one database. Do not compare scores between project and global results. With `--both`,
project items always precede global items; `total` is summed before `--offset` and
`--limit` are applied to that combined sequence.

### Handle status and errors

Capture the exit status, stdout, and stderr separately:

| Status | Meaning | Agent action |
|---|---|---|
| `0` | Command succeeded. | Parse the documented stdout format. |
| `1` with `verify --json` stdout | Verification found issues. | Parse `issues`; do not treat the report as malformed output. |
| `1` with `repair --json` stdout | Rebuild finished but verification still found issues. | Parse nested `verification` and stop mutation attempts. |
| `1` with `nmnm:` on stderr | Argument, validation, storage, or SQLite failure. | Report stderr and classify before retrying. |

Do not retry invalid options, malformed values, missing mutation targets, import
conflicts, or missing read-only databases without changing the command or state. Retry an
operational SQLite failure only with a bounded policy after inspecting stderr. Never
silently redirect a failed command to another store.

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

The export contains active, expired, and soft-removed canonical records. It excludes
retrieval-only `store`, transient `score`, tags tables, and FTS rows. File export uses a
same-directory temporary file and atomic replacement. The output must not be the source
database or a symlink or hardlink to it.

Import validates the header and every record before opening the destination, then applies
all records in one transaction. Importing into an existing store is a conflict-safe merge,
not an overwrite: duplicate IDs within the file or IDs already present in the destination
reject the complete import. Resolve conflicts by producing a new canonical file; do not
edit the database directly.

### Make and restore an exact backup

Close every process using the database before copying it:

```sh
nmnm verify --db ./source.db --json
cp ./source.db ./memory-backup.db
nmnm verify --db ./memory-backup.db --json
```

Restore only while the destination is closed, and preserve the current file separately
until the restored copy verifies. Plain copying is not an online-backup mechanism; use
JSONL export when writers cannot be stopped.

### Verify and repair

Run `verify` before transfer, after import or restore, and whenever direct inspection or
an interrupted filesystem operation makes integrity uncertain. Verification is read-only
and reports exact schema-column, SQLite integrity, foreign-key, canonical-field and
timestamp-ordering, tag, and FTS issues. It skips unsafe table queries when required
columns are missing, so malformed schemas remain structured diagnostic results.

Use repair only for derived full-text drift:

```sh
nmnm repair --rebuild-fts --db ./memory.db --json
nmnm verify --db ./memory.db --json
```

Repair rebuilds FTS rows from non-removed canonical memories, including expired rows, and
then verifies the store. It
does not change memories, tags, metadata, or schema. If canonical, schema, integrity, or
tag issues remain, stop writes and restore a verified backup or export rather than trying
manual SQL changes.

### Recover removed data

A default remove is reversible. Restore the same ID with an explicit retain patch:

```sh
nmnm retain "Restored content" --id <memory-id> --db ./memory.db --json
```

`remove --purge` is irreversible within the live store. Recovery then requires a prior
SQLite backup or JSONL export. Because exports include soft-removed records, importing an
export preserves their removed state instead of silently reactivating them.

## Troubleshooting

| Symptom | Check | Action |
|---|---|---|
| `nmnm:` argument error | Command help and option spelling | Correct the command; parsing fails before storage opens. |
| Database does not exist | Selected project, global, or custom path | Use the intended path. Read-only commands do not create stores. |
| Recall returns `null` | Store, ID, expiry, and removal state | Retrieve with `--expires any`; restore a soft removal with `retain --id`. |
| Retrieval misses expected text | FTS5 query syntax and filters | Simplify the query, then run `verify` if canonical records should match. |
| Import is rejected | Header, canonical fields, duplicate IDs, and destination conflicts | Correct the complete JSONL input; imports never partially commit. |
| Verification reports only FTS issues | `fts_*` issue groups | Run `repair --rebuild-fts`, then verify again. |
| Verification reports other issues | Schema, integrity, fields, foreign keys, or tags | Stop writes and restore a verified backup or export. |

The `node:sqlite` experimental warning can appear on supported Node versions and does not
by itself indicate command failure. Use the process exit status and documented output
instead. On platforms where `--global` is unsupported, use an explicit `--db <path>`.

## Documentation ownership

- [README.md](../README.md) defines product scope, architecture, and the documentation
  index.
- This manual owns task sequences, operational guidance, and audience-specific examples.
- [PI_ADAPTER_MANUAL.md](PI_ADAPTER_MANUAL.md) owns Pi installation, tools, configuration,
  pins, and automatic index behavior.
- Package READMEs own package installation and discovery.
- `nmnm --help` is authoritative for available CLI flags.
- Runtime code and tests are authoritative when documentation and behavior disagree; fix
  the documentation in the same change.

Examples use `nmnm` for an installed CLI and explicit placeholders such as `<memory-id>`
and `<path>`. Commands that modify storage state their target store. Destructive examples
identify irreversible operations before showing them.
