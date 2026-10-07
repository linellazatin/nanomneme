# @openlines/nmnm-core

<div align="center">

[![nmnm-core version](https://img.shields.io/npm/v/%40openlines%2Fnmnm-core?label=core&logo=npm&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-core) [![nmnm-core downloads](https://img.shields.io/npm/dt/@openlines/nmnm-core?label=downloads&logo=npm&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-core)

</div>

Deterministic local SQLite memory storage for [nanomneme](https://github.com/linellazatin/nanomneme).

Requires Node.js 22.13 or later and the built-in `node:sqlite` runtime with FTS5.

The official macOS arm64 Node 22.13.0 binary lacks FTS5 despite its SQLite version; use an FTS5-capable build. Node 22.19.0 is a verified compatible runtime.

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

The public API provides `open(path)`, the 4Rs, source-filtered retrieval through `retrieve({ source })`, canonical portability records, integrity verification, and FTS repair. See the [Core and CLI Manual](../../docs/CORE_CLI_MANUAL.md) for the API, complete data contract, and task-based guidance. Imports reject unknown fields, values that require normalization, and `updated_at` values earlier than `created_at`. Public reads and exports return only canonical memory fields, even when verification detects unexpected database columns.

Use `open(path, { readOnly: true })` for diagnostics and exports that must not create, migrate, or modify a database.

Text inputs must contain well-formed Unicode. Retain and import reject unpaired surrogates before writing; valid Unicode pairs round-trip unchanged.

New file-backed stores initialize in a private same-directory temporary database, then publish the complete, closed file without overwriting another creator. This requires filesystem hardlink support; concurrent creators use the winning store. Failed initialization leaves no published partial database. Existing unversioned files remain rejected, not initialized or replaced.

Text queries support Unicode terms, quoted phrases (escape embedded quotes as `""`), trailing `*` prefixes, case-insensitive `AND`/`OR`/`NOT`, and parentheses up to 32 levels. Space-separated terms imply AND; proximity uses `NEAR(foo bar, 2)`, not infix `foo NEAR bar`. Malformed expressions fall back to literal terms, including operator words; punctuation-only queries return no matches. SQLite tokenization determines matches, not substring matching. Storage failures retain their original errors.

Patches, restores, and soft removals strictly advance each record's `updated_at` by at least one millisecond, using the latest stored timestamp inside the write transaction when the clock is unchanged or moves backward. `created_at` is preserved; soft removal sets `removed_at` to the same new timestamp. These are per-record ordering guarantees, not exact wall-clock times or global ordering. Imports preserve supplied timestamps, expiry checks use wall-clock time, and purge reports wall-clock `purged_at`. Mutations that cannot advance within the supported four-digit UTC year range fail atomically.

Soft removal retains canonical content and tags for restoration/export; expiry hides records from active reads without deleting them. Purge removes the canonical row, tags, and live FTS entry atomically, including expired or soft-removed records. Writable connections enable SQLite `secure_delete`; write transactions enable persistent FTS5 `secure-delete` before mutation. This reduces newly deleted data remnants, not guaranteed erasure. FTS5 protection requires SQLite 3.42 or later and can make the index unreadable by older SQLite tools. Read-only opens do not enable it, and older stores acquire it on their next successful write transaction. Historical remnants, WAL/journal history, existing reader snapshots, backups, exports, and device-level copies are not scrubbed; no automatic checkpoint, vacuum, or historical cleanup runs.

Mutations acquire a write transaction before reading their targets or checking existing import IDs. Patches merge supplied fields with the latest committed record, preserving unrelated changes; the last successfully applied patch wins for the same field. Retain results are captured within their transaction, and record, tag, and FTS changes commit or roll back together. Recall, retrieval, export, and verification each use one database snapshot. SQLite lock waiting is bounded by a five-second busy timeout; contention can still fail, and core does not retry operations.

On POSIX systems, new database files request `0600` before SQLite initialization and newly created directories request `0700`; the caller's umask may restrict these further. Existing files and directories keep their permissions. `verify()` reports `file_permissions` for group/other access on the database or existing journal, WAL, and shared-memory files without changing them. Review intentional sharing before manually restricting existing permissions; POSIX mode checks do not audit ACLs or apply on Windows.

## Opt-in diagnostics

`@openlines/nmnm-core/logging` exports `createMemoryLogger` through `src/logslines.js`; it loads the shared generated observer runtime without importing SQLite. Core persistence methods do not emit records automatically. Component `src/logslines.js` bindings supply identity and caller settings; standalone use defaults to `nmnm-core`. See the [Logger manual](../../docs/LOGGER.md) for configuration, file roles, and generation rules.
