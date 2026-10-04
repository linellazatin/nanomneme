# @openlines/nmnm-core

<div align="center">

[![nmnm-core version](https://img.shields.io/npm/v/%40openlines%2Fnmnm-core?label=core&logo=npm&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-core) [![nmnm-core downloads](https://img.shields.io/npm/dt/@openlines/nmnm-core?label=downloads&logo=npm&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-core)

</div>

Deterministic local SQLite memory storage for [nanomneme](https://github.com/linellazatin/nanomneme).

Requires Node.js 22.13 or later and the built-in `node:sqlite` runtime with FTS5.

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

The public API provides `open(path)`, the 4Rs, source-filtered retrieval through `retrieve({ source })`, canonical portability records, integrity verification, and FTS repair. See the [Core and CLI Manual](../../docs/CORE_CLI_MANUAL.md) for task-based guidance and the repository README for the complete data contract. Imports reject unknown fields, values that require normalization, and `updated_at` values earlier than `created_at`. Public reads and exports return only canonical memory fields, even when verification detects unexpected database columns.

Use `open(path, { readOnly: true })` for diagnostics and exports that must not create, migrate, or modify a database.

Mutations acquire a write transaction before reading their targets or checking existing import IDs. Patches merge supplied fields with the latest committed record, preserving unrelated changes; the last successfully applied patch wins for the same field. Retain results are captured within their transaction, and record, tag, and FTS changes commit or roll back together. Recall, retrieval, export, and verification each use one database snapshot. SQLite lock waiting is bounded by a five-second busy timeout; contention can still fail, and core does not retry operations.

On POSIX systems, new database files request `0600` before SQLite initialization and newly created directories request `0700`; the caller's umask may restrict these further. Existing files and directories keep their permissions. `verify()` reports `file_permissions` for group/other access on the database or existing journal, WAL, and shared-memory files without changing them. Review intentional sharing before manually restricting existing permissions; POSIX mode checks do not audit ACLs or apply on Windows.
