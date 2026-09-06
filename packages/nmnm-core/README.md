# nmnm-core

Deterministic local SQLite memory storage for [nanomneme](https://github.com/linellazatin/nanomneme).

Requires Node.js 22.13 or later and the built-in `node:sqlite` runtime with FTS5.

```sh
npm install nmnm-core
```

```js
import { open } from 'nmnm-core';

const store = open('./memory.db');
try {
  const memory = store.retain({ content: 'SQLite is the storage engine.' });
  console.log(store.recall({ id: memory.id }));
} finally {
  store.close();
}
```

The public API provides `open(path)`, the 4Rs, canonical portability records,
integrity verification, and FTS repair. See the repository README for the complete
data contract and API examples.
