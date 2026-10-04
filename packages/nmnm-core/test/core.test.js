import assert from 'node:assert/strict';
import { access, mkdtemp } from 'node:fs/promises';
import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import test from 'node:test';

import { open } from '../src/index.js';

async function createStore(t) {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-'));
  const store = open(join(directory, 'memory.db'));
  t.after(() => store.close());
  return store;
}

function runContendedOperation(t, path, operation, input, releaseWriter = () => {}, hold = null) {
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { DatabaseSync } = await import('node:sqlite');
      const { open } = await import(workerData.core);
      const store = open(workerData.path, { create: false });
      const exec = DatabaseSync.prototype.exec;
      DatabaseSync.prototype.exec = function (sql) {
        if (sql === 'BEGIN IMMEDIATE') parentPort.postMessage({ type: 'write_requested' });
        if (sql === 'COMMIT' && workerData.commitGate) {
          parentPort.postMessage({ type: 'commit_pending' });
          if (Atomics.wait(new Int32Array(workerData.commitGate), 0, 0, 7000) === 'timed-out') throw new Error('Writer coordination timed out');
        }
        return exec.call(this, sql);
      };
      try {
        parentPort.postMessage({ type: 'result', value: store[workerData.operation](workerData.input) });
      } catch (error) {
        parentPort.postMessage({ type: 'result', error: { name: error.name, message: error.message, code: error.code } });
      } finally { store.close(); }
    })().catch(error => { throw error; });
  `, { eval: true, workerData: { core: new URL('../src/index.js', import.meta.url).href, path, operation, input, commitGate: hold?.gate } });
  t.after(() => worker.terminate());
  return new Promise((resolve, reject) => {
    let result;
    worker.on('message', message => {
      if (message.type === 'write_requested') {
        try { releaseWriter(); } catch (error) { reject(error); }
      } else if (message.type === 'commit_pending') hold.ready();
      else result = message;
    });
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code !== 0 || !result) reject(new Error(`SQLite worker exited ${code} without a result`));
      else resolve(result);
    });
  });
}

function afterSqlRead(match, mutation, work) {
  const prepare = DatabaseSync.prototype.prepare;
  let fired = false;
  DatabaseSync.prototype.prepare = function (sql) {
    const statement = prepare.call(this, sql);
    if (match(sql)) {
      for (const method of ['get', 'all']) {
        const execute = statement[method];
        statement[method] = function (...args) {
          const result = execute.apply(this, args);
          if (!fired) { fired = true; mutation(); }
          return result;
        };
      }
    }
    return statement;
  };
  try {
    const result = work();
    assert.equal(fired, true, 'the concurrent writer must run after the selected read');
    return result;
  } finally { DatabaseSync.prototype.prepare = prepare; }
}

test('a contended content patch preserves an unrelated committed importance change', { timeout: 10000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-contended-patch-'));
  const path = join(directory, 'memory.db');
  const store = open(path);
  t.after(() => store.close());
  const memory = store.retain({ content: 'Original', importance: 0.5 });
  const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  let ready;
  const held = new Promise(resolve => { ready = resolve; });
  const writer = runContendedOperation(t, path, 'retain', { id: memory.id, importance: 0.9 }, undefined, { gate, ready });
  await Promise.race([held, writer.then(() => { throw new Error('Writer finished before holding its transaction'); })]);
  const release = () => { Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0); };
  let result;
  try { result = await runContendedOperation(t, path, 'retain', { id: memory.id, content: 'Updated' }, release); }
  finally { release(); }
  assert.equal((await writer).error, undefined);
  assert.equal(result.error, undefined);
  assert.equal(result.value.content, 'Updated');
  assert.equal(result.value.importance, 0.9);
  assert.equal(store.recall({ id: memory.id }).importance, 0.9);
});

test('a contended removal observes a committed expiry instead of removing a stale target', { timeout: 10000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-contended-remove-'));
  const path = join(directory, 'memory.db');
  const store = open(path);
  const raw = new DatabaseSync(path);
  t.after(() => { raw.close(); store.close(); });
  const memory = store.retain({ content: 'Expiry target' });
  raw.exec('BEGIN IMMEDIATE');
  raw.prepare('UPDATE memories SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', memory.id);
  const result = await runContendedOperation(t, path, 'remove', { id: memory.id }, () => raw.exec('COMMIT'));
  assert.equal(result.error, undefined);
  assert.equal(result.value, null);
  assert.equal(store.export()[0].removed_at, null);
});

test('a contended import reports a committed ID conflict before applying records', { timeout: 10000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-contended-import-'));
  const path = join(directory, 'memory.db');
  const store = open(path);
  const raw = new DatabaseSync(path);
  t.after(() => { raw.close(); store.close(); });
  const memory = store.retain({ content: 'Import conflict' });
  const [record] = store.export();
  store.remove({ id: memory.id, mode: 'purge' });
  raw.exec('BEGIN IMMEDIATE');
  raw.prepare('INSERT INTO memories (id, content, kind, scope, namespace, importance, confidence, created_at, updated_at, expires_at, removed_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(record.id, record.content, record.kind, record.scope, record.namespace, record.importance, record.confidence, record.created_at, record.updated_at, null, null, '{}');
  raw.prepare('INSERT INTO memories_fts(rowid, content) SELECT rowid, content FROM memories WHERE id = ?').run(record.id);
  const result = await runContendedOperation(t, path, 'import', [record], () => raw.exec('COMMIT'));
  assert.equal(result.error?.name, 'RangeError');
  assert.match(result.error.message, /already exists/);
  assert.deepEqual(store.export(), [record]);
  assert.equal(store.verify().ok, true);
});

for (const operation of ['recall', 'export', 'retrieve', 'verify']) test(`${operation} keeps one snapshot while another connection commits`, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-snapshot-'));
  const path = join(directory, 'memory.db');
  const reader = open(path);
  const writer = open(path);
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL');
  t.after(() => { raw.close(); writer.close(); reader.close(); });
  const memory = writer.retain({ content: 'Before', tags: ['before'] });
  const result = afterSqlRead(
    sql => operation === 'recall' ? sql.includes('FROM memories m WHERE m.id = ?')
      : operation === 'export' ? sql.includes('FROM memories m ORDER BY m.id')
        : operation === 'retrieve' ? sql.startsWith('SELECT COUNT(*) AS total FROM memories m')
          : sql === 'SELECT rowid, * FROM memories ORDER BY id',
    () => writer.retain({ id: memory.id, content: 'After', tags: ['after'] }),
    () => operation === 'recall' ? reader.recall({ id: memory.id })
      : operation === 'export' ? reader.export()
        : operation === 'retrieve' ? reader.retrieve({ query: 'Before' }) : reader.verify(),
  );
  if (operation === 'verify') assert.equal(result.ok, true);
  else {
    const item = operation === 'recall' ? result : operation === 'export' ? result[0] : result.items[0];
    if (operation === 'retrieve') assert.equal(result.total, 1);
    assert.equal(item?.content, 'Before');
    assert.deepEqual(item.tags, ['before']);
  }
  assert.equal(writer.recall({ id: memory.id }).content, 'After');
});

test('patch input getters run before locking and each supplied field is read once', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-input-before-lock-'));
  const path = join(directory, 'memory.db');
  const store = open(path);
  const writer = open(path);
  t.after(() => { writer.close(); store.close(); });
  const memory = store.retain({ content: 'Original' });
  let reads = 0;
  const result = store.retain({ id: memory.id, get content() {
    reads += 1;
    writer.retain({ id: memory.id, importance: 0.9 });
    return 'Updated';
  } });
  assert.equal(reads, 1);
  assert.equal(result.importance, 0.9);
  assert.equal(result.content, 'Updated');
});

test('a failed patch restores record, tags, and search while preserving an automatic rollback error', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-patch-rollback-'));
  const path = join(directory, 'memory.db');
  const store = open(path);
  const raw = new DatabaseSync(path);
  t.after(() => { raw.close(); store.close(); });
  const memory = store.retain({ content: 'Original rollback target', tags: ['original'] });
  raw.exec("CREATE TRIGGER reject_tag BEFORE INSERT ON memory_tags WHEN NEW.tag = 'rollback' BEGIN SELECT RAISE(ROLLBACK, 'injected tag rollback'); END");
  assert.throws(() => store.retain({ id: memory.id, content: 'Replacement', tags: ['rollback'] }), /injected tag rollback/);
  assert.deepEqual(store.recall({ id: memory.id }), memory);
  assert.equal(store.retrieve({ query: 'Original' }).total, 1);
  assert.equal(store.retrieve({ query: 'Replacement' }).total, 0);
  assert.equal(store.verify().ok, true);
  assert.equal(store.retain({ id: memory.id, importance: 0.9 }).importance, 0.9);
});

test('failed soft removal and purge restore canonical rows, tags, and FTS', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-remove-rollback-'));
  const path = join(directory, 'memory.db');
  const store = open(path);
  const raw = new DatabaseSync(path);
  t.after(() => { raw.close(); store.close(); });
  const memory = store.retain({ content: 'Removal rollback target', tags: ['original'] });
  raw.exec("CREATE TRIGGER reject_soft BEFORE UPDATE OF removed_at ON memories BEGIN SELECT RAISE(ABORT, 'injected removal failure'); END");
  raw.exec("CREATE TRIGGER reject_purge BEFORE DELETE ON memories BEGIN SELECT RAISE(ABORT, 'injected removal failure'); END");
  for (const mode of ['soft', 'purge']) {
    assert.throws(() => store.remove({ id: memory.id, mode }), /injected removal failure/);
    assert.deepEqual(store.recall({ id: memory.id }), memory);
    assert.equal(store.retrieve({ query: 'Removal' }).total, 1);
    assert.equal(store.verify().ok, true);
  }
});

test('a mid-import write failure rolls back the complete batch and its search index', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-import-rollback-'));
  const path = join(directory, 'memory.db');
  const target = open(path);
  const source = open(':memory:');
  const raw = new DatabaseSync(path);
  t.after(() => { raw.close(); source.close(); target.close(); });
  source.retain({ content: 'First import record' });
  source.retain({ content: 'Rejected import record', tags: ['rollback'] });
  const records = source.export().sort((left, right) => left.tags.length - right.tags.length);
  raw.exec("CREATE TRIGGER reject_tag BEFORE INSERT ON memory_tags WHEN NEW.tag = 'rollback' BEGIN SELECT RAISE(ABORT, 'injected import failure'); END");
  assert.throws(() => target.import(records), /injected import failure/);
  assert.deepEqual(target.export(), []);
  assert.equal(target.retrieve({ query: 'import' }).total, 0);
  assert.equal(target.verify().ok, true);
});

test('retain returns its own committed record even if another writer immediately patches it', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-return-snapshot-'));
  const path = join(directory, 'memory.db');
  const store = open(path);
  const writer = open(path);
  t.after(() => { writer.close(); store.close(); });
  const memory = store.retain({ content: 'Original' });
  const exec = DatabaseSync.prototype.exec;
  let fired = false;
  DatabaseSync.prototype.exec = function (sql) {
    const result = exec.call(this, sql);
    if (sql === 'COMMIT' && !fired) {
      fired = true;
      writer.retain({ id: memory.id, content: 'Later commit', tags: ['later'] });
    }
    return result;
  };
  let result;
  try { result = store.retain({ id: memory.id, content: 'My commit', tags: ['mine'] }); }
  finally { DatabaseSync.prototype.exec = exec; }
  assert.equal(fired, true);
  assert.equal(result.content, 'My commit');
  assert.deepEqual(result.tags, ['mine']);
  assert.equal(store.recall({ id: memory.id }).content, 'Later commit');
});

test('a writer held beyond the busy timeout leaves a rejected patch unapplied', { timeout: 10000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-busy-timeout-'));
  const path = join(directory, 'memory.db');
  const store = open(path);
  const raw = new DatabaseSync(path);
  t.after(() => { raw.close(); store.close(); });
  const memory = store.retain({ content: 'Busy target', tags: ['original'] });
  raw.exec('BEGIN IMMEDIATE');
  const result = await runContendedOperation(t, path, 'retain', { id: memory.id, content: 'Rejected', tags: ['rejected'] });
  assert.match(result.error?.message ?? '', /locked|busy/i);
  raw.exec('ROLLBACK');
  assert.deepEqual(store.recall({ id: memory.id }), memory);
  assert.equal(store.verify().ok, true);
  assert.equal(store.retain({ id: memory.id, content: 'Recovered' }).content, 'Recovered');
});

test('new databases and directories are private under a permissive umask', { skip: process.platform === 'win32' }, (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'nmnm-permissions-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  chmodSync(directory, 0o755);
  const path = join(directory, 'private', 'nested', 'memory.db');
  const previous = process.umask(0);
  let store;
  try {
    store = open(path);
    store.retain({ content: 'Private memory' });
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(join(directory, 'private')).mode & 0o777, 0o700);
    assert.equal(statSync(join(directory, 'private', 'nested')).mode & 0o777, 0o700);
    assert.equal(statSync(directory).mode & 0o777, 0o755);
    assert.equal(process.umask(), 0);
  } finally { store?.close(); process.umask(previous); }
});

test('verify reports existing unsafe permissions without changing files or directories', { skip: process.platform === 'win32' }, (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'nmnm-existing-permissions-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'memory.db');
  open(path).close();
  chmodSync(path, 0o644);
  chmodSync(directory, 0o755);
  const store = open(path, { readOnly: true });
  try {
    assert.deepEqual(store.verify().issues, [{ code: 'file_permissions', count: 1, ids: ['database'] }]);
    assert.equal(statSync(path).mode & 0o777, 0o644);
    assert.equal(statSync(directory).mode & 0o777, 0o755);
  } finally { store.close(); }
  const writable = open(path);
  writable.close();
  assert.equal(statSync(path).mode & 0o777, 0o644);
});

test('permission verification keeps the database path when the working directory changes', { skip: process.platform === 'win32' }, (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'nmnm-permissions-cwd-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const original = process.cwd();
  let store;
  try {
    process.chdir(directory);
    store = open('memory.db');
    process.chdir(original);
    assert.equal(store.verify().ok, true);
  } finally { process.chdir(original); store?.close(); }
});

test('new database rollback journals and WAL files remain private', { skip: process.platform === 'win32' }, (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'nmnm-sidefile-permissions-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'memory.db');
  const previous = process.umask(0);
  let store, raw;
  try {
    store = open(path);
    const memory = store.retain({ content: 'Journal target' });
    raw = new DatabaseSync(path);
    raw.exec('BEGIN IMMEDIATE');
    raw.prepare('UPDATE memories SET importance = ? WHERE id = ?').run(0.9, memory.id);
    assert.equal(statSync(`${path}-journal`).mode & 0o777, 0o600);
    raw.exec('ROLLBACK; PRAGMA journal_mode = WAL');
    store.retain({ content: 'WAL target' });
    for (const suffix of ['-wal', '-shm']) assert.equal(statSync(`${path}${suffix}`).mode & 0o777, 0o600);
    assert.equal(store.verify().ok, true);
    chmodSync(`${path}-wal`, 0o644);
    assert.deepEqual(store.verify().issues, [{ code: 'file_permissions', count: 1, ids: ['wal'] }]);
  } finally { raw?.close(); store?.close(); process.umask(previous); }
});

test('open refuses a missing database when creation is disabled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-open-'));
  const path = join(directory, 'missing.db');

  assert.throws(() => open(path, { create: false }), /does not exist/);
});

test('open readOnly mode refuses a missing database without creating it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-read-only-missing-'));
  const path = join(directory, 'missing.db');
  let store;

  try {
    assert.throws(() => { store = open(path, { readOnly: true }); }, /does not exist/);
  } finally {
    store?.close();
  }
  await assert.rejects(access(path));
});

test('open readOnly mode permits reads and rejects writes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-read-only-'));
  const path = join(directory, 'memory.db');
  const writable = open(path);
  const memory = writable.retain({ content: 'Read-only target' });
  writable.close();
  const readOnly = open(path, { readOnly: true });
  t.after(() => readOnly.close());

  assert.equal(readOnly.recall({ id: memory.id }).id, memory.id);
  assert.throws(() => readOnly.retain({ content: 'Rejected write' }), /readonly/);
});

test('open validates the readOnly option before filesystem changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-read-only-option-'));
  const path = join(directory, 'missing.db');

  assert.throws(() => open(path, { readOnly: 'yes' }), /readOnly must be a boolean/);
  await assert.rejects(access(path));
});

test('open rejects a database created by a newer schema', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-schema-'));
  const path = join(directory, 'memory.db');
  const store = open(path);
  store.close();
  const db = new DatabaseSync(path);
  db.prepare("UPDATE nmnm_meta SET value = '2' WHERE key = 'schema_version'").run();
  db.close();

  assert.throws(() => open(path), /newer than this version of nanomneme/);
});

test('open rejects an existing unversioned database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-unversioned-'));
  const path = join(directory, 'memory.db');
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE memories (id TEXT PRIMARY KEY) STRICT');
  db.close();

  assert.throws(() => open(path), /not a versioned nanomneme database/);
});

test('verify reports a healthy database without modifying it', async (t) => {
  const store = await createStore(t);
  const memory = store.retain({ content: 'Verify target', tags: ['integrity'] });

  assert.deepEqual(store.verify(), { ok: true, schema_version: 1, issues: [] });
  assert.equal(store.recall({ id: memory.id }).id, memory.id);
});

test('verify reports field, tag, and FTS defects without repairing them', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-verify-'));
  const path = join(directory, 'memory.db');
  const store = open(path);
  t.after(() => store.close());
  const active = store.retain({ content: 'Original FTS content' });
  const removed = store.retain({ content: 'Soft removed FTS content' });
  store.remove({ id: removed.id });
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys = OFF');
  db.prepare("UPDATE memories SET content = ?, kind = ? WHERE id = ?").run('Changed canonical content', 'summary', active.id);
  db.prepare('INSERT INTO memory_tags(memory_id, tag) VALUES (?, ?)').run(active.id, 'Invalid Tag');
  const removedRow = db.prepare('SELECT rowid FROM memories WHERE id = ?').get(removed.id);
  db.prepare('INSERT INTO memories_fts(rowid, content) VALUES (?, ?)').run(removedRow.rowid, 'Soft removed FTS content');
  db.prepare('INSERT INTO memories_fts(rowid, content) VALUES (?, ?)').run(9999, 'Orphan FTS content');

  const result = store.verify();
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues.map(({ code }) => code), ['fts_mismatch', 'fts_orphan', 'fts_removed', 'memory_field', 'tag_field']);
  assert.equal(db.prepare('SELECT content FROM memories_fts WHERE rowid = ?').get(removedRow.rowid).content, 'Soft removed FTS content');
});

test('verify requires an FTS5 virtual table rather than a same-named table', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-verify-schema-'));
  const path = join(directory, 'memory.db');
  const initial = open(path);
  initial.close();
  const db = new DatabaseSync(path);
  db.exec('DROP TABLE memories_fts; CREATE TABLE memories_fts (content TEXT NOT NULL) STRICT');
  db.close();
  const store = open(path);
  t.after(() => store.close());

  assert.equal(store.verify().issues.find(({ code }) => code === 'schema_fts').ids[0], 'memories_fts');
});

test('verify reports unexpected schema columns', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-verify-extra-column-'));
  const path = join(directory, 'memory.db');
  const store = open(path);
  t.after(() => store.close());
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  db.exec('ALTER TABLE memories ADD COLUMN extra TEXT');

  assert.deepEqual(store.verify().issues, [
    { code: 'schema_columns', count: 1, ids: ['memories'] },
  ]);
});

test('public memory results omit unexpected database columns', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-canonical-results-'));
  const path = join(directory, 'memory.db');
  const store = open(path);
  t.after(() => store.close());
  const memory = store.retain({ content: 'Canonical result target' });
  const db = new DatabaseSync(path);
  db.exec('ALTER TABLE memories ADD COLUMN extra TEXT');
  db.prepare('UPDATE memories SET extra = ? WHERE id = ?').run('must not leak', memory.id);
  db.close();
  const fields = [
    'confidence', 'content', 'created_at', 'expires_at', 'id', 'importance', 'kind',
    'metadata', 'namespace', 'removed_at', 'scope', 'tags', 'updated_at',
  ];

  assert.deepEqual(Object.keys(store.recall({ id: memory.id })).sort(), fields);
  assert.deepEqual(Object.keys(store.retrieve({}).items[0]).sort(), fields);
});

test('export remains importable with unexpected database columns', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-canonical-export-'));
  const sourcePath = join(directory, 'source.db');
  const source = open(sourcePath);
  t.after(() => source.close());
  const memory = source.retain({ content: 'Canonical export target' });
  const db = new DatabaseSync(sourcePath);
  db.exec('ALTER TABLE memories ADD COLUMN extra TEXT');
  db.prepare('UPDATE memories SET extra = ? WHERE id = ?').run('must not export', memory.id);
  db.close();
  assert.equal(source.verify().ok, false);
  const records = source.export();
  const target = open(join(directory, 'target.db'));
  t.after(() => target.close());

  assert.equal(Object.hasOwn(records[0], 'extra'), false);
  assert.deepEqual(target.import(records), { imported: 1 });
  assert.equal(target.recall({ id: memory.id }).id, memory.id);
});

test('verify reports unusable table columns without throwing', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-verify-unusable-columns-'));
  const path = join(directory, 'memory.db');
  const initial = open(path);
  initial.close();
  const db = new DatabaseSync(path);
  db.exec('DROP TABLE memories_fts; CREATE TABLE memories_fts (wrong TEXT) STRICT');
  db.close();
  const store = open(path);
  t.after(() => store.close());

  assert.deepEqual(store.verify().issues, [
    { code: 'schema_columns', count: 1, ids: ['memories_fts'] },
    { code: 'schema_fts', count: 1, ids: ['memories_fts'] },
  ]);
});

test('export preserves canonical records, including expired and soft-removed memories', async (t) => {
  const store = await createStore(t);
  const active = store.retain({ content: 'Active export target', metadata: { source: 'test' }, tags: ['portable'] });
  const removed = store.retain({ content: 'Removed export target', tags: ['portable'] });
  store.remove({ id: removed.id });
  const expired = store.retain({ content: 'Expired export target', expires_at: '2000-01-01T00:00:00.000Z' });

  const records = store.export();
  assert.deepEqual(records.map(({ id }) => id), [active.id, expired.id, removed.id].sort());
  assert.equal(records.find(({ id }) => id === active.id).metadata.source, 'test');
  assert.equal(Object.hasOwn(records[0], 'score'), false);
  assert.equal(records.find(({ id }) => id === removed.id).removed_at != null, true);
});

test('import round-trips records and rejects conflicts atomically', async (t) => {
  const source = await createStore(t);
  const memory = source.retain({ content: 'Portable memory', tags: ['portable'], metadata: { source: 'test' } });
  const records = source.export();
  const target = await createStore(t);

  assert.deepEqual(target.import(records), { imported: 1 });
  assert.deepEqual(target.recall({ id: memory.id }), memory);
  assert.throws(() => target.import([
    records[0],
    { ...records[0], id: '11111111-1111-4111-8111-111111111111' },
  ]), /already exists/);
  assert.equal(target.retrieve({}).total, 1);
});

test('import rejects fields outside the canonical record', async (t) => {
  const source = await createStore(t);
  const target = await createStore(t);
  source.retain({ content: 'Unknown field target' });
  const [record] = source.export();

  assert.throws(() => target.import([{ ...record, score: 0 }]), /unknown field score/);
  assert.equal(target.export().length, 0);
});

test('import rejects values that require canonical normalization', async (t) => {
  const source = await createStore(t);
  const target = await createStore(t);
  source.retain({ content: 'Canonical import target', tags: ['alpha', 'beta'] });
  const [record] = source.export();

  for (const [field, value] of [
    ['id', ` ${record.id}`],
    ['content', ` ${record.content}`],
    ['kind', ` ${record.kind}`],
    ['scope', ` ${record.scope}`],
    ['namespace', ` ${record.namespace}`],
    ['tags', ['beta', 'alpha']],
  ]) {
    assert.throws(() => target.import([{ ...record, [field]: value }]), new RegExp(field));
  }
  assert.equal(target.export().length, 0);
});

test('import rejects updated_at earlier than created_at', async (t) => {
  const source = await createStore(t);
  const target = await createStore(t);
  const memory = source.retain({ content: 'Timestamp order target' });

  assert.throws(() => target.import([{
    ...memory,
    created_at: '2026-09-06T01:00:00.000Z',
    updated_at: '2026-09-06T00:00:00.000Z',
  }]), /updated_at must not precede created_at/);
  assert.equal(target.export().length, 0);
});

test('rebuildFts repairs derived rows without changing canonical memories', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-rebuild-'));
  const path = join(directory, 'memory.db');
  const store = open(path);
  t.after(() => store.close());
  const first = store.retain({ content: 'First rebuild target' });
  const second = store.retain({ content: 'Second rebuild target' });
  const db = new DatabaseSync(path);
  db.prepare('DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)').run(first.id);
  db.prepare('INSERT INTO memories_fts(rowid, content) VALUES (?, ?)').run(9999, 'Orphan rebuild row');
  db.close();
  assert.deepEqual(store.rebuildFts(), { mode: 'rebuild-fts', rebuilt: 2 });
  assert.equal(store.verify().ok, true);
  assert.equal(store.recall({ id: first.id }).content, 'First rebuild target');
});

test('retain creates an active memory that recall returns', async (t) => {
  const store = await createStore(t);

  const memory = store.retain({
    content: 'Use SQLite as the embedded store.',
    kind: 'decision',
    tags: ['architecture', 'storage'],
    metadata: { source: 'test' },
  });

  assert.match(memory.id, /^[0-9a-f-]{36}$/i);
  assert.equal(memory.content, 'Use SQLite as the embedded store.');
  assert.equal(memory.kind, 'decision');
  assert.equal(memory.scope, 'project');
  assert.deepEqual(memory.tags, ['architecture', 'storage']);
  assert.deepEqual(memory.metadata, { source: 'test' });
  assert.deepEqual(store.recall({ id: memory.id }), memory);
});

test('retain patches only an existing explicit id', async (t) => {
  const store = await createStore(t);
  const created = store.retain({ content: 'Old decision', tags: ['old'] });
  const updated = store.retain({
    id: created.id,
    content: 'New decision',
    importance: 0.9,
    tags: ['architecture'],
  });

  assert.equal(updated.id, created.id);
  assert.equal(updated.content, 'New decision');
  assert.equal(updated.importance, 0.9);
  assert.deepEqual(updated.tags, ['architecture']);
  assert.throws(
    () => store.retain({ id: '00000000-0000-4000-8000-000000000000', content: 'No target' }),
    /does not exist/,
  );
});

test('retrieve combines FTS, field filters, and all requested tags', async (t) => {
  const store = await createStore(t);
  const sqlite = store.retain({
    content: 'SQLite is the embedded storage engine.',
    kind: 'decision',
    namespace: 'nanomneme',
    tags: ['architecture', 'storage'],
  });
  store.retain({
    content: 'DuckDB supports analytical workloads.',
    kind: 'fact',
    namespace: 'nanomneme',
    tags: ['storage'],
  });

  const result = store.retrieve({
    query: 'SQLite storage',
    kind: 'decision',
    namespace: 'nanomneme',
    tags: ['architecture', 'storage'],
  });

  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, sqlite.id);
  assert.equal(typeof result.items[0].score, 'number');
});

test('retrieve treats hyphenated query terms as literal phrases', async (t) => {
  const store = await createStore(t);
  const both = store.retain({ content: 'pi-adapter trust-store combined' });
  const piOnly = store.retain({ content: 'pi-adapter only' });
  const trustOnly = store.retain({ content: 'trust-store only' });

  assert.deepEqual(store.retrieve({ query: 'pi-adapter' }).items.map(({ id }) => id).sort(), [both.id, piOnly.id].sort());
  assert.deepEqual(store.retrieve({ query: 'pi-adapter trust-store' }).items.map(({ id }) => id), [both.id]);
  assert.deepEqual(store.retrieve({ query: 'pi-adapter OR trust-store' }).items.map(({ id }) => id).sort(), [both.id, piOnly.id, trustOnly.id].sort());
  assert.deepEqual(store.retrieve({ query: '"pi-adapter"' }).items.map(({ id }) => id).sort(), [both.id, piOnly.id].sort());
});

test('retrieve treats punctuation and identifier terms as literal phrases', async (t) => {
  const store = await createStore(t);
  const node = store.retain({ content: 'node.js runtime' });
  const version = store.retain({ content: 'released v1.2.3 patch' });
  const cpp = store.retain({ content: 'C++ language feature' });
  const hash = store.retain({ content: 'C# language feature' });
  const percent = store.retain({ content: '50% of the work' });
  const snake = store.retain({ content: 'foo_bar helper token' });

  assert.deepEqual(store.retrieve({ query: 'node.js' }).items.map(({ id }) => id), [node.id]);
  assert.deepEqual(store.retrieve({ query: 'v1.2.3' }).items.map(({ id }) => id), [version.id]);
  assert.deepEqual(store.retrieve({ query: '50%' }).items.map(({ id }) => id), [percent.id]);
  assert.deepEqual(store.retrieve({ query: 'foo_bar' }).items.map(({ id }) => id), [snake.id]);
  assert.ok(store.retrieve({ query: 'C++' }).items.some(({ id }) => id === cpp.id));
  assert.ok(store.retrieve({ query: 'C#' }).items.some(({ id }) => id === hash.id));
});

test('retrieve treats colon syntax and URLs as literal phrases', async (t) => {
  const store = await createStore(t);
  const keyValue = store.retain({ content: 'scope:project configuration entry' });
  const url = store.retain({ content: 'saved https://example.com link' });

  assert.deepEqual(store.retrieve({ query: 'scope:project' }).items.map(({ id }) => id), [keyValue.id]);
  assert.deepEqual(store.retrieve({ query: 'https://example.com' }).items.map(({ id }) => id), [url.id]);
});

test('retrieve treats leading and stray minus signs as literal text', async (t) => {
  const store = await createStore(t);
  const fooBar = store.retain({ content: 'foo bar here' });
  const scopeOnly = store.retain({ content: 'scope only' });

  assert.deepEqual(store.retrieve({ query: 'foo - bar' }).items.map(({ id }) => id), [fooBar.id]);
  assert.deepEqual(store.retrieve({ query: '-scope' }).items.map(({ id }) => id), [scopeOnly.id]);
  assert.doesNotThrow(() => store.retrieve({ query: '-' }));
  assert.deepEqual(store.retrieve({ query: '--' }), { total: 0, items: [] });
});

test('retrieve treats dangling boolean operators as literal text', async (t) => {
  const store = await createStore(t);
  const orMemory = store.retain({ content: 'the OR literal world' });
  const foo = store.retain({ content: 'foo the target' });
  const bar = store.retain({ content: 'bar the target' });

  assert.deepEqual(store.retrieve({ query: 'OR' }).items.map(({ id }) => id), [orMemory.id]);
  assert.doesNotThrow(() => store.retrieve({ query: 'OR foo' }));
  assert.doesNotThrow(() => store.retrieve({ query: 'foo OR' }));
  assert.doesNotThrow(() => store.retrieve({ query: 'NOT foo' }));
  assert.doesNotThrow(() => store.retrieve({ query: 'foo AND' }));
  assert.deepEqual(store.retrieve({ query: 'foo NOT bar' }).items.map(({ id }) => id), [foo.id]);
  assert.deepEqual(store.retrieve({ query: 'foo OR bar' }).items.map(({ id }) => id).sort(), [foo.id, bar.id].sort());
});

test('retrieve tolerates bare and dangling NEAR operators', async (t) => {
  const store = await createStore(t);
  const near = store.retain({ content: 'one near two phrase' });

  assert.deepEqual(store.retrieve({ query: 'NEAR' }).items.map(({ id }) => id), [near.id]);
  assert.doesNotThrow(() => store.retrieve({ query: 'foo NEAR' }));
  assert.doesNotThrow(() => store.retrieve({ query: 'NEAR foo' }));
});

test('retrieve tolerates unbalanced quotes without erroring', async (t) => {
  const store = await createStore(t);
  const hello = store.retain({ content: 'hello world memory' });

  assert.deepEqual(store.retrieve({ query: '"hello' }).items.map(({ id }) => id), [hello.id]);
  assert.deepEqual(store.retrieve({ query: 'hello "' }).items.map(({ id }) => id), [hello.id]);
  assert.deepEqual(store.retrieve({ query: '"' }), { total: 0, items: [] });
});

test('retrieve preserves balanced parentheses and tolerates unbalanced ones', async (t) => {
  const store = await createStore(t);
  const foo = store.retain({ content: 'foo group member' });
  const bar = store.retain({ content: 'bar group member' });

  assert.deepEqual(store.retrieve({ query: '(foo OR bar)' }).items.map(({ id }) => id).sort(), [foo.id, bar.id].sort());
  assert.deepEqual(store.retrieve({ query: '(foo' }).items.map(({ id }) => id), [foo.id]);
  assert.deepEqual(store.retrieve({ query: 'foo)' }).items.map(({ id }) => id), [foo.id]);
  assert.deepEqual(store.retrieve({ query: '()' }), { total: 0, items: [] });
});

test('retrieve treats a trailing star as a prefix and a stray star as inert', async (t) => {
  const store = await createStore(t);
  const foo = store.retain({ content: 'foo bar' });
  const football = store.retain({ content: 'football game' });
  const foosball = store.retain({ content: 'foosball rally' });

  assert.deepEqual(store.retrieve({ query: 'foo*' }).items.map(({ id }) => id).sort(), [foo.id, football.id, foosball.id].sort());
  assert.doesNotThrow(() => store.retrieve({ query: '*foo' }));
  assert.deepEqual(store.retrieve({ query: '*' }), { total: 0, items: [] });
});

test('retrieve returns no matches for punctuation-only queries', async (t) => {
  const store = await createStore(t);
  store.retain({ content: 'irrelevant memory' });

  for (const query of ['!!!', '...', '---', '*', '"', '()']) {
    assert.deepEqual(store.retrieve({ query }), { total: 0, items: [] }, query);
  }
});

test('retrieve matches case and diacritics insensitively', async (t) => {
  const store = await createStore(t);
  const cafe = store.retain({ content: 'Café créme recipe' });

  assert.deepEqual(store.retrieve({ query: 'cafe' }).items.map(({ id }) => id), [cafe.id]);
  assert.deepEqual(store.retrieve({ query: 'CAFÉ CRÈME' }).items.map(({ id }) => id), [cafe.id]);
});

test('retrieve searches Unicode-only terms and Unicode prefixes', async (t) => {
  const store = await createStore(t);
  for (const content of ['東京', '中文', 'é', 'Привет', 'مرحبا']) store.retain({ content });
  for (const query of ['東京', '中文', 'é', 'Привет', 'مرحبا']) {
    assert.deepEqual(store.retrieve({ query }).items.map(item => item.content), [query]);
  }
  assert.deepEqual(store.retrieve({ query: '東*' }).items.map(item => item.content), ['東京']);
});

test('retrieve combines Boolean groups, adjacent groups, and consistent operator casing', async (t) => {
  const store = await createStore(t);
  for (const content of ['foo', 'bar baz', 'bar qux', 'foo baz', 'foo bar']) store.retain({ content });
  for (const [query, expected] of [
    ['foo OR (bar AND baz)', ['bar baz', 'foo', 'foo bar', 'foo baz']],
    ['foo or (bar and baz)', ['bar baz', 'foo', 'foo bar', 'foo baz']],
    ['(foo OR bar) baz', ['bar baz', 'foo baz']],
    ['foo (bar OR baz)', ['foo bar', 'foo baz']],
    ['(foo) (baz)', ['foo baz']],
    ['foo NOT (bar OR qux)', ['foo', 'foo baz']],
    ['foo NOT bar baz', ['foo', 'foo bar', 'foo baz']],
  ]) assert.deepEqual(store.retrieve({ query }).items.map(item => item.content).sort(), expected, query);
});

test('retrieve uses literal fallback for malformed expressions without broadening Boolean results', async (t) => {
  const store = await createStore(t);
  for (const content of ['foo', 'bar', 'foo OR bar literal', 'foo AND OR bar literal']) store.retain({ content });
  assert.deepEqual(store.retrieve({ query: 'foo OR (bar' }).items.map(item => item.content).sort(), ['foo AND OR bar literal', 'foo OR bar literal']);
  assert.deepEqual(store.retrieve({ query: 'foo AND OR bar' }).items.map(item => item.content), ['foo AND OR bar literal']);
  for (const query of ['(())', '(()())', '"!!!"']) assert.deepEqual(store.retrieve({ query }), { total: 0, items: [] });
});

test('retrieve supports escaped phrases, phrase prefixes, and NUL separators', async (t) => {
  const store = await createStore(t);
  for (const content of ['say hello', 'say filler hello', 'foo bar', 'foo baz']) store.retain({ content });
  assert.deepEqual(store.retrieve({ query: '"say ""hello"""' }).items.map(item => item.content), ['say hello']);
  assert.deepEqual(store.retrieve({ query: '"foo ba"*' }).items.map(item => item.content).sort(), ['foo bar', 'foo baz']);
  assert.deepEqual(store.retrieve({ query: 'foo\0bar' }).items.map(item => item.content), ['foo bar']);
});

test('retrieve implements NEAR groups and keeps infix NEAR literal', async (t) => {
  const store = await createStore(t);
  for (const content of ['alpha beta', 'beta alpha', 'alpha x beta', 'alpha near beta', 'alpha beta gamma']) store.retain({ content });
  for (const query of ['NEAR(alpha beta, 0)', 'near(alpha beta,0)']) {
    assert.deepEqual(store.retrieve({ query }).items.map(item => item.content).sort(), ['alpha beta', 'alpha beta gamma', 'beta alpha']);
  }
  assert.deepEqual(store.retrieve({ query: 'NEAR("alpha beta" gam*, 0)' }).items.map(item => item.content), ['alpha beta gamma']);
  assert.deepEqual(store.retrieve({ query: 'alpha NEAR beta' }).items.map(item => item.content), ['alpha near beta']);
});

test('retrieve handles generated malformed syntax and deep groups without parser errors', async (t) => {
  const store = await createStore(t);
  store.retain({ content: 'foo bar near and or 東京 é pi-adapter' });
  const atoms = ['foo', 'bar', '東京', 'é', 'pi-adapter', 'AND', 'or', 'NOT', 'NEAR', '(', ')', '"', '"foo bar"', '*', '!!!', ',', '0', '\0'];
  let state = 123456789;
  for (let sample = 0; sample < 1000; sample += 1) {
    const query = Array.from({ length: 8 }, () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return atoms[state % atoms.length];
    }).join(' ');
    assert.doesNotThrow(() => store.retrieve({ query }), query);
  }
  assert.equal(store.retrieve({ query: '('.repeat(2048) + 'foo' + ')'.repeat(2048) }).total, 1);
});

test('retrieve preserves database errors instead of labeling them invalid search syntax', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-search-storage-error-'));
  const path = join(directory, 'memory.db');
  const store = open(path);
  const raw = new DatabaseSync(path);
  t.after(() => { raw.close(); store.close(); });
  store.retain({ content: 'Search target' });
  raw.exec('DROP TABLE memories_fts');
  assert.throws(() => store.retrieve({ query: 'Search' }), error => error.code === 'ERR_SQLITE_ERROR' && !(error instanceof TypeError));
  assert.equal(store.export().length, 1);
});

test('retrieve filters memories by metadata source', async (t) => {
  const store = await createStore(t);
  const pi = store.retain({ content: 'Pi source memory', metadata: { source: 'pi' } });
  store.retain({ content: 'Claude source memory', metadata: { source: 'claude-code' } });
  store.retain({ content: 'Legacy source memory' });

  const result = store.retrieve({ source: 'pi' });

  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map(({ id }) => id), [pi.id]);
  assert.throws(() => store.retrieve({ source: '' }), /source must be a non-empty string/);
});

test('retrieve baseline preserves deterministic relevance and explicit ordering', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-'));
  const path = join(directory, 'memory.db');
  const store = open(path);
  t.after(() => store.close());
  const exact = store.retain({
    content: 'SQLite memory retrieval',
    kind: 'decision',
    namespace: 'retrieval',
    tags: ['architecture', 'retrieval'],
    importance: 0.9,
    confidence: 0.8,
  });
  const sqlite = store.retain({
    content: 'SQLite retrieval',
    kind: 'note',
    namespace: 'retrieval',
    tags: ['retrieval'],
    importance: 0.7,
    confidence: 0.9,
  });
  const memory = store.retain({
    content: 'Memory retrieval',
    kind: 'note',
    namespace: 'retrieval',
    tags: ['retrieval'],
    importance: 0.5,
    confidence: 0.6,
  });
  const expired = store.retain({
    content: 'SQLite memory retrieval expired',
    namespace: 'retrieval',
    expires_at: '2000-01-01T00:00:00.000Z',
  });
  const removed = store.retain({ content: 'SQLite memory retrieval removed', namespace: 'retrieval' });
  const firstTie = store.retain({ content: 'First tie', namespace: 'ties', importance: 0.5 });
  const secondTie = store.retain({ content: 'Second tie', namespace: 'ties', importance: 0.5 });
  const older = store.retain({ content: 'Older listing', namespace: 'recency' });
  const newer = store.retain({ content: 'Newer listing', namespace: 'recency' });
  const db = new DatabaseSync(path);
  db.prepare('UPDATE memories SET created_at = ?, updated_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', older.id);
  db.prepare('UPDATE memories SET created_at = ?, updated_at = ? WHERE id = ?').run('2026-01-01T00:00:01.000Z', '2026-01-01T00:00:01.000Z', newer.id);
  db.close();
  store.remove({ id: removed.id });

  assert.deepEqual(store.retrieve({ query: 'SQLite memory retrieval', namespace: 'retrieval' }).items.map(({ id }) => id), [exact.id]);
  const overlap = store.retrieve({ query: 'SQLite OR memory', namespace: 'retrieval' }).items.map(({ id }) => id);
  assert.equal(overlap[0], exact.id);
  assert.deepEqual(overlap.slice(1), [sqlite.id, memory.id]);
  assert.deepEqual(
    store.retrieve({ namespace: 'retrieval', tags: ['architecture', 'retrieval'] }).items.map(({ id }) => id),
    [exact.id],
  );
  assert.deepEqual(
    store.retrieve({ namespace: 'retrieval', order_by: 'importance' }).items.map(({ id }) => id),
    [memory.id, sqlite.id, exact.id],
  );
  assert.deepEqual(
    store.retrieve({ namespace: 'retrieval', order_by: 'confidence' }).items.map(({ id }) => id),
    [memory.id, exact.id, sqlite.id],
  );
  assert.deepEqual(store.retrieve({ namespace: 'retrieval', expires: 'expired' }).items.map(({ id }) => id), [expired.id]);
  assert.deepEqual(
    store.retrieve({ namespace: 'ties', order_by: 'importance' }).items.map(({ id }) => id),
    [firstTie.id, secondTie.id].sort(),
  );
  assert.deepEqual(store.retrieve({ namespace: 'recency' }).items.map(({ id }) => id), [newer.id, older.id]);
});

test('relevance prefers importance when lexical scores tie', async (t) => {
  const store = await createStore(t);
  const record = {
    content: 'Priority ranking target',
    kind: 'note',
    scope: 'project',
    namespace: 'priority',
    confidence: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    expires_at: null,
    removed_at: null,
    metadata: {},
    tags: [],
  };
  store.import([
    { ...record, id: '10000000-0000-4000-8000-000000000001', importance: 0.1 },
    { ...record, id: 'f0000000-0000-4000-8000-000000000002', importance: 0.9 },
  ]);

  assert.deepEqual(
    store.retrieve({ query: 'Priority ranking target', namespace: 'priority' }).items.map(({ importance }) => importance),
    [0.9, 0.1],
  );
});

test('retrieve excludes expired and removed memories and supports pagination', async (t) => {
  const store = await createStore(t);
  const first = store.retain({ content: 'first visible memory' });
  const second = store.retain({ content: 'second visible memory' });
  const expired = store.retain({
    content: 'expired visible memory',
    expires_at: '2000-01-01T00:00:00.000Z',
  });
  store.remove({ id: second.id });

  assert.equal(store.recall({ id: expired.id }), null);
  assert.equal(store.recall({ id: second.id }), null);
  const result = store.retrieve({ order_by: 'id', limit: 1, offset: 0 });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, first.id);
});

test('retrieve can explicitly inspect expired memories', async (t) => {
  const store = await createStore(t);
  const expired = store.retain({ content: 'expired memory', expires_at: '2000-01-01T00:00:00.000Z' });

  assert.equal(store.retrieve({}).total, 0);
  assert.equal(store.retrieve({ expires: 'expired' }).items[0].id, expired.id);
});

test('FTS follows retained updates and removal', async (t) => {
  const store = await createStore(t);
  const memory = store.retain({ content: 'Initial keyword' });
  store.retain({ id: memory.id, content: 'Replacement keyword' });

  assert.equal(store.retrieve({ query: 'Initial' }).total, 0);
  assert.equal(store.retrieve({ query: 'Replacement' }).items[0].id, memory.id);
  store.remove({ id: memory.id });
  assert.equal(store.retrieve({ query: 'Replacement' }).total, 0);
});

test('retain restores a soft-removed memory and preserves unspecified fields', async (t) => {
  const store = await createStore(t);
  const memory = store.retain({
    content: 'Original keyword',
    kind: 'decision',
    importance: 0.9,
    tags: ['architecture'],
  });
  const removed = store.remove({ id: memory.id });
  assert.equal(removed.mode, 'soft');

  const restored = store.retain({ id: memory.id, content: 'Restored keyword' });
  assert.equal(restored.content, 'Restored keyword');
  assert.equal(restored.kind, 'decision');
  assert.equal(restored.importance, 0.9);
  assert.deepEqual(restored.tags, ['architecture']);
  assert.equal(restored.removed_at, null);
  assert.equal(store.recall({ id: memory.id }).id, memory.id);
  assert.equal(store.retrieve({ query: 'Restored' }).items[0].id, memory.id);
});

test('purge remove permanently deletes active and soft-removed memories', async (t) => {
  const store = await createStore(t);
  const active = store.retain({ content: 'Active purge target', tags: ['active'] });
  const purgedActive = store.remove({ id: active.id, mode: 'purge' });
  assert.equal(purgedActive.mode, 'purge');
  assert.equal(store.retrieve({ query: 'Active purge' }).total, 0);
  assert.throws(() => store.retain({ id: active.id, content: 'Cannot restore' }), /does not exist/);

  const removed = store.retain({ content: 'Removed purge target', tags: ['removed'] });
  store.remove({ id: removed.id });
  const purgedRemoved = store.remove({ id: removed.id, mode: 'purge' });
  assert.equal(purgedRemoved.mode, 'purge');
  assert.throws(() => store.retain({ id: removed.id, content: 'Cannot restore' }), /does not exist/);
});

test('mutation timestamps advance under frozen and backward clocks across connections', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-clock-'));
  const path = join(directory, 'memory.db');
  const store = open(path);
  const other = open(path);
  t.after(() => { other.close(); store.close(); });
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-04T00:00:00.000Z') });
  const memory = store.retain({ content: 'Clock target' });
  assert.equal(memory.created_at, '2026-10-04T00:00:00.000Z');
  assert.equal(memory.updated_at, memory.created_at);
  const first = store.retain({ id: memory.id, content: 'Frozen patch' });
  assert.equal(first.updated_at, '2026-10-04T00:00:00.001Z');
  t.mock.timers.setTime(Date.parse('2026-10-03T00:00:00.000Z'));
  const second = other.retain({ id: memory.id, importance: 0.8 });
  assert.equal(second.updated_at, '2026-10-04T00:00:00.002Z');
  const removal = store.remove({ id: memory.id });
  assert.equal(removal.removed_at, '2026-10-04T00:00:00.003Z');
  assert.equal(store.export()[0].updated_at, removal.removed_at);
  const restored = other.retain({ id: memory.id });
  assert.equal(restored.updated_at, '2026-10-04T00:00:00.004Z');
  assert.equal(restored.created_at, memory.created_at);
  assert.equal(restored.removed_at, null);
  t.mock.timers.setTime(Date.parse('2026-10-06T00:00:00.000Z'));
  assert.equal(store.retain({ id: memory.id }).updated_at, '2026-10-06T00:00:00.000Z');
  assert.equal(store.verify().ok, true);
});

test('future imports retain exact timestamps and mutations advance them without changing expiry time', async (t) => {
  const store = await createStore(t);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-04T00:00:00.000Z') });
  const seed = store.retain({ content: 'Future import target' });
  store.remove({ id: seed.id, mode: 'purge' });
  const record = { ...seed, created_at: '2099-01-01T00:00:00.000Z', updated_at: '2099-01-02T00:00:00.000Z', expires_at: '2026-10-05T00:00:00.000Z' };
  store.import([record]);
  assert.deepEqual(store.export(), [record]);
  const patched = store.retain({ id: seed.id, tags: ['future'] });
  assert.equal(patched.updated_at, '2099-01-02T00:00:00.001Z');
  assert.equal(store.recall({ id: seed.id }).id, seed.id);
  assert.equal(store.retrieve().total, 1);
  t.mock.timers.setTime(Date.parse('2026-10-05T00:00:00.000Z'));
  assert.equal(store.recall({ id: seed.id }), null);
  assert.equal(store.retrieve().total, 0);
});

test('timestamp exhaustion rejects patches and soft removal atomically but permits purge', async (t) => {
  const store = await createStore(t);
  const seed = store.retain({ content: 'Timestamp boundary', tags: ['original'] });
  store.remove({ id: seed.id, mode: 'purge' });
  const record = { ...seed, updated_at: '9999-12-31T23:59:59.999Z' };
  store.import([record]);
  assert.throws(() => store.retain({ id: seed.id, content: 'Must roll back', tags: ['changed'] }), RangeError);
  assert.throws(() => store.remove({ id: seed.id }), RangeError);
  assert.deepEqual(store.export(), [record]);
  assert.equal(store.retrieve({ query: 'boundary' }).total, 1);
  assert.equal(store.verify().ok, true);
  assert.equal(store.remove({ id: seed.id, mode: 'purge' }).mode, 'purge');
});

test('creation rejects a clock outside the canonical timestamp range without storing a record', async (t) => {
  const store = await createStore(t);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('+010000-01-01T00:00:00.000Z') });
  assert.throws(() => store.retain({ content: 'Out of range clock', tags: ['clock'] }), /created_at/);
  assert.deepEqual(store.export(), []);
  assert.equal(store.verify().ok, true);
});

test('rejects impossible canonical timestamps on retain and import', async (t) => {
  const store = await createStore(t);
  const memory = store.retain({ content: 'Valid timestamp target' });
  const impossible = '2026-02-31T00:00:00.000Z';

  assert.throws(() => store.retain({ content: 'Impossible date', expires_at: impossible }), /expires_at/);
  assert.throws(() => store.import([{ ...memory, created_at: impossible }]), /created_at/);
});

test('rejects non-canonical kebab-case slugs across public paths', async (t) => {
  const store = await createStore(t);
  const memory = store.retain({ content: 'Valid slug target' });

  assert.throws(() => store.retain({ content: 'Trailing hyphen', namespace: 'project-' }), /namespace/);
  assert.throws(() => store.retrieve({ tags: ['double--hyphen'] }), /tag/);
  assert.throws(() => store.import([{ ...memory, namespace: 'project-' }]), /namespace/);
});

test('rejects metadata values that JSON would silently coerce or omit', async (t) => {
  const store = await createStore(t);

  assert.throws(() => store.retain({ content: 'Undefined metadata', metadata: { value: undefined } }), /metadata/);
  assert.throws(() => store.retain({ content: 'Non-finite metadata', metadata: { value: NaN } }), /metadata/);
  assert.throws(() => store.retain({ content: 'Nested metadata', metadata: { values: [1, undefined] } }), /metadata/);
  assert.throws(() => store.retain({ content: 'Date metadata', metadata: { value: new Date() } }), /metadata/);
  assert.throws(() => store.retain({ content: 'Map metadata', metadata: { value: new Map() } }), /metadata/);
});

test('verify reports impossible stored timestamps', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-verify-date-'));
  const path = join(directory, 'memory.db');
  const store = open(path);
  t.after(() => store.close());
  const memory = store.retain({ content: 'Corrupt timestamp target' });
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run('2026-02-31T00:00:00.000Z', memory.id);

  assert.deepEqual(store.verify().issues, [{ code: 'memory_field', count: 1, ids: [memory.id] }]);
});

test('verify reports updated_at earlier than created_at', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-verify-date-order-'));
  const path = join(directory, 'memory.db');
  const store = open(path);
  t.after(() => store.close());
  const memory = store.retain({ content: 'Corrupt timestamp order target' });
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  db.prepare('UPDATE memories SET created_at = ?, updated_at = ? WHERE id = ?')
    .run('2026-09-06T01:00:00.000Z', '2026-09-06T00:00:00.000Z', memory.id);

  assert.deepEqual(store.verify().issues, [{ code: 'memory_field', count: 1, ids: [memory.id] }]);
});

test('enforces canonical public field conventions', async (t) => {
  const store = await createStore(t);
  assert.throws(() => store.retain({ content: 'x', metadata: '{not json' }), /metadata/);
  assert.throws(() => store.retain({ content: 'x', kind: 'summary' }), /kind/);
  assert.throws(() => store.retrieve({ kind: 'summary' }), /kind/);
  assert.throws(() => store.retain({ content: 'x', scope: 'team' }), /scope/);
  assert.throws(() => store.retrieve({ scope: 'team' }), /scope/);
  assert.throws(() => store.retain({ content: 'x', namespace: 'Project Name' }), /namespace/);
  assert.throws(() => store.retrieve({ namespace: 'Project Name' }), /namespace/);
  assert.throws(() => store.retain({ content: 'x', tags: ['Project Name'] }), /tag/);
  assert.throws(() => store.retrieve({ tags: ['Project Name'] }), /tag/);
  assert.throws(() => store.retain({ content: 'x', expires_at: '2026-08-25' }), /expires_at/);
  assert.throws(() => store.recall({ id: 'not-a-uuid' }), /id/);
  assert.throws(() => store.remove({ id: 'not-a-uuid' }), /id/);
  assert.throws(() => store.retain({ content: 'x', importance: 1.1 }), /importance/);
  assert.throws(() => store.retrieve({ limit: 0 }), /limit/);
  assert.throws(() => store.retrieve({ confidence: { gte: 2 } }), /confidence/);
  assert.throws(() => store.remove({ id: '00000000-0000-4000-8000-000000000000', mode: 'hard' }), /mode/);
  assert.throws(() => store.remove({ id: '00000000-0000-4000-8000-000000000000', mode: 'forever' }), /mode/);
});
