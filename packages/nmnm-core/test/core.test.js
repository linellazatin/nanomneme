import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { open } from '../src/index.js';

async function createStore(t) {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-'));
  const store = open(join(directory, 'memory.db'));
  t.after(() => store.close());
  return store;
}

test('open refuses a missing database when creation is disabled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-open-'));
  const path = join(directory, 'missing.db');

  assert.throws(() => open(path, { create: false }), /does not exist/);
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
