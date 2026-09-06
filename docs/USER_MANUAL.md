# nanomneme User Manual

This manual is the task-oriented guide for nanomneme 0.0.5. It serves developers who
embed `nmnm-core` and agents or operators that call the `nmnm` CLI. nanomneme remains a
local, deterministic SQLite memory store without required models, services, or network
access.

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

| Command | Syntax | Result |
|---|---|---|
| Retain | `nmnm retain [content] [options]` | Creates a UUID v4 record or patches/restores the explicit `--id`. |
| Recall | `nmnm recall <id> [options]` | Returns one active, unexpired record or no result. |
| Retrieve | `nmnm retrieve [query] [options]` | Returns filtered, ordered, paginated records. |
| Remove | `nmnm remove <id> [--purge] [options]` | Soft-removes by default or permanently deletes with `--purge`. |
| Verify | `nmnm verify [options]` | Opens read-only and reports schema, integrity, tag, and FTS defects. |
| Export | `nmnm export [--out <file>] [options]` | Writes canonical JSONL to stdout or atomically to a file. |
| Import | `nmnm import <file> [options]` | Validates canonical JSONL and imports it transactionally. |
| Repair | `nmnm repair --rebuild-fts [options]` | Rebuilds derived FTS rows, then verifies the database. |

Every command accepts `--db <path>`, `--global`, and `--help`. Commands that return
structured results accept `--json`; `export` instead emits JSONL. Use standalone
`nmnm --version` or `nmnm -v` to print the installed version without opening storage.
Place `--` after options when retain content or a retrieve query begins with `--`; it ends
option parsing but does not make an invalid FTS5 query valid.

Retain accepts `--id`, `--kind`, `--scope`, `--namespace`, `--tags`, `--importance`,
`--confidence`, `--expires-at`, and `--metadata`. New records require content. Updates
require `--id`; unspecified fields retain their current values.

Retrieve accepts `--both`, `--kind`, `--scope`, `--namespace`, `--tags`, `--expires`,
`--importance-gte`, `--importance-lte`, `--confidence-gte`, `--confidence-lte`,
`--order-by`, `--limit`, and `--offset`. Filters combine with AND, and every requested
tag must match. `--expires` accepts `active`, `expired`, or `any`. Limits are 1 through
1000; offsets are 0 through 1000. Run `nmnm --help` for the exact current option
spellings.

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
synchronized. See the [complete schema reference](../README.md#database-schema) for column
types and accepted values.

Public reads and exports project the canonical memory columns explicitly. If schema drift
adds a column, `verify` reports it but recall, retrieval, and canonical JSONL do not expose
the unexpected value.

### Errors

The API uses standard JavaScript errors rather than custom classes:

- `TypeError` reports malformed objects, fields, timestamps, slugs, metadata, selectors,
  or FTS5 queries.
- `RangeError` reports values outside supported bounds, missing mutation targets, and
  import ID conflicts.
- `Error` reports missing databases, incompatible schemas, unavailable FTS5, and SQLite
  operational failures.

Validate or report errors at the application boundary, but always close the store. Do not
retry validation or conflict errors without changing the input.

## Agent guide

### Construct deterministic commands

- Use `--json` for structured commands. `export` is the exception: it writes canonical
  JSONL and rejects `--json`.
- Put `--` after options when content or a query begins with `--`; preserve normal FTS5
  query syntax after that marker.
- Select the mutation target explicitly in automation: `--db <path>` for an exact file or
  `--global` for the standard global store. An omitted selector means the current working
  directory's project store.
- Supply `--limit`, `--offset`, and `--order-by` when pagination or non-query ordering must
  remain stable. Query results already use score, importance, then ID.
- Use `--id` only to patch or restore a known record. A new retain always creates a UUID v4
  record; content similarity does not deduplicate.
- Treat `(store, id)` as retrieval identity. Matching IDs in different stores are separate
  records.

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

- [README.md](../README.md) defines product scope, architecture, data contracts, and the
  concise command reference.
- This manual owns task sequences, operational guidance, and audience-specific examples.
- Package READMEs own package installation and discovery.
- `nmnm --help` is authoritative for available CLI flags.
- Runtime code and tests are authoritative when documentation and behavior disagree; fix
  the documentation in the same change.

Examples use `nmnm` for an installed CLI and explicit placeholders such as `<memory-id>`
and `<path>`. Commands that modify storage state their target store. Destructive examples
identify irreversible operations before showing them.
