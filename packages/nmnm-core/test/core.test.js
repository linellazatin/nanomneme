import assert from 'node:assert/strict';
import { access, mkdtemp } from 'node:fs/promises';
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

test('retrieve baseline preserves deterministic relevance and explicit ordering', async (t) => {
  const store = await createStore(t);
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
  await new Promise((resolve) => setTimeout(resolve, 1));
  const newer = store.retain({ content: 'Newer listing', namespace: 'recency' });
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
