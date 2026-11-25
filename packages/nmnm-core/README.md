# @openlines/nmnm-core

<div align="center">

[![nmnm-core version](https://img.shields.io/npm/v/%40openlines%2Fnmnm-core?label=core&logo=npm&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-core) [![nmnm-core downloads](https://img.shields.io/npm/dt/@openlines/nmnm-core?label=downloads&logo=npm&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-core)

</div>

Deterministic local SQLite memory storage for [nanomneme](https://github.com/linellazatin/nanomneme).

Requires Node.js 22.13+ with FTS5 in built-in `node:sqlite`. The official macOS arm64 Node 22.13.0 binary lacks FTS5; use an FTS5-capable build. Node 22.19.0 is verified compatible.

```sh
npm install @openlines/nmnm-core
```

```js
import { open } from '@openlines/nmnm-core';

const store = open('./memory.db');
try {
  const memory = store.retain({ content: 'SQLite is the storage engine.' });
  console.log(store.recall({ id: memory.id }));
} finally {
  store.close();
}
```

API: `open(path)`, the 4Rs, `retrieve({ source })` filtering, canonical portability records, integrity verification and FTS repair. The [Core and CLI Manual](../../docs/CORE_CLI_MANUAL.md) covers the complete API, data contract and workflows. Imports reject unknown fields, normalization-required values and `updated_at` earlier than `created_at`. Reads/exports expose only canonical fields, even with unexpected database columns.

Use `open(path, { readOnly: true })` for diagnostics/exports without creating, migrating or modifying storage. Verification rejects normalization-required fields/tags, reporting `memory_field`/`tag_field` without repair.

Text must be well-formed Unicode: retain/import reject unpaired surrogates before writing; valid pairs round-trip unchanged.

New file-backed stores initialize in a private same-directory temporary database, then publish the complete, closed file without overwriting another creator. Hardlinks are required; concurrent creators use the winner. Failed initialization publishes no partial database; existing unversioned files are rejected, never initialized or replaced.

Queries support Unicode terms, quoted phrases (escape quotes as `""`), trailing `*` prefixes, case-insensitive `AND`/`OR`/`NOT` and parentheses up to 32 levels. Space-separated terms imply AND; proximity is `NEAR(foo bar, 2)`, not infix `foo NEAR bar`. Malformed expressions become literal terms, including operator words; punctuation-only queries match nothing. Matching uses SQLite tokenization, not substrings; storage errors propagate unchanged.

Patches/restores/soft removals advance each record's `updated_at` by at least 1 ms, using its latest stored timestamp inside the write transaction even with an unchanged/backward clock. `created_at` stays; soft removal sets `removed_at` to the new timestamp. This guarantees per-record order, not exact wall time or global order. Imports preserve timestamps; expiry and `purged_at` use wall time. Failure to advance within four-digit UTC years aborts atomically.

Patches rewrite tags only when their normalized set changes and refresh FTS only for content changes or restoration. Unchanged patches still advance timestamps. Retrieval/export load tags in bounded batches within their read snapshot; single-record reads use direct lookup. Search ordering, exact totals, canonical records and schema version are unchanged.

Writable opens atomically install an optional compact recency/count index and retire only recognized legacy definitions. It covers expiry/namespace/source/kind/scope/importance/confidence counts without canonical migration, preserving UTC millisecond ordering, UUID ties and stored timestamp text. Indexless read-only stores and previously compatible cores remain compatible; FTS source-filter expression/candidate planning are unchanged. See [upgrade costs and caller side effects](../../docs/CORE_CLI_MANUAL.md#optional-index-upgrades). Verification checks reserved names case-insensitively, reports conflicting definitions as `performance_index`, and neither requires missing indexes nor repairs conflicts. Before integrity checking, it refreshes cached FTS through a bounded read in the same snapshot; genuine corruption remains reported. Repair corrupt derived FTS explicitly, not through unrelated patches.

Soft removal keeps canonical content/tags for restoration/export; expiry hides records from active reads without deletion. Purge atomically deletes the row, tags and live FTS entry, including expired/soft-removed records. Writable connections enable SQLite `secure_delete`; write transactions enable persistent FTS5 `secure-delete` before mutation. Read-only opens do not; older stores acquire it on their next successful write. FTS5 protection requires SQLite 3.42+ and may prevent older SQLite tools from reading the index. It reduces new deletion remnants, not guaranteed erasure: historical remnants, WAL/journal history, reader snapshots, backups, exports and device-level copies remain. No automatic checkpoint, vacuum or historical cleanup.

Mutations acquire a write transaction before reading targets or checking existing import IDs. Patches merge supplied fields into the latest committed record, preserving unrelated changes; the last successful patch wins per field. Retain results are captured in that transaction; record/tag/FTS changes commit or roll back together. Recall, retrieval, export and verification each use one snapshot. Lock waiting has a five-second busy timeout; contention can fail, with no automatic retries.

On POSIX, new databases request `0600` before SQLite initialization; new directories request `0700`. Umask may further restrict both. Existing permissions stay unchanged. `verify()` reports `file_permissions` for group/other access on the database or existing journal/WAL/shared-memory files, without changing permissions. Review intentional sharing before manual restriction; mode checks neither audit ACLs nor apply on Windows. Checks use SQLite's effective filename, include sidecars through file/directory symlinks, and remain anchored after working-directory changes.

## Opt-in diagnostics

`@openlines/nmnm-core/logging` exports `createMemoryLogger` via `src/logslines.js`, loading the shared generated observer without importing SQLite. Persistence methods do not auto-emit records. Component `src/logslines.js` bindings supply identity/caller settings; standalone identity defaults to `nmnm-core`. See the [Logger manual](../../docs/LOGGER.md) for configuration, file roles and generation rules.

## Project work summaries

`validateProjectSummary(payload)` and `renderProjectSummary(payload)` validate and render explicitly supplied work summaries without model calls. `store.retainSummary({ summary, id? })` creates or updates an active project summary; `store.brief({ budget = 1000 })` renders dated historical context from one read snapshot without writes. Summaries are ordinary project notes in namespace `project-summary`; briefs are derived views, not retained memories. No transcript access or schema migration is required. See the [contract, JSON example and lifecycle](../../docs/CORE_CLI_MANUAL.md#project-work-summaries-and-briefs). Callers own physical project-store routing; concurrent updates use last-successful-write semantics. Unknown or generically edited inconsistent summaries are skipped until repaired explicitly.

Remove a contributing summary with `nmnm summary remove <id> --json` (core: `store.removeSummary({ id })`). This guarded soft removal rejects ordinary records and changes the next brief; remaining history may become the primary source. Briefs have no separate ID. Existing explicit restoration and permanent purge remain available through general memory operations. Already-injected conversation context is not erased.
