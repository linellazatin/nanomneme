import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { fixtureId, generateRecords } from '../bench/fixtures.js';
import { open } from '../src/index.js';

const corpus = JSON.parse(readFileSync(new URL('../bench/fixtures/quality.json', import.meta.url), 'utf8'));

test('benchmark records are deterministic canonical fixtures with varied lifecycle and tags', () => {
  const records = generateRecords(100);
  assert.equal(records.length, 100);
  assert.deepEqual(records, generateRecords(100));
  assert.equal(new Set(records.map(record => record.id)).size, 100);
  for (const size of [0, -1, 1.5, 100001, NaN]) assert.throws(() => generateRecords(size), RangeError);
  assert.equal(records[0].id, fixtureId(0));
  assert(records.some(record => record.removed_at !== null));
  assert(records.some(record => record.expires_at === '2000-01-01T00:00:00.000Z'));
  assert(records.some(record => record.expires_at === '9999-01-01T00:00:00.000Z'));
  assert(records.some(record => record.tags.length === 0));
  assert(records.some(record => record.tags.length > 1));
  const store = open(':memory:');
  try {
    store.import(records);
    assert.deepEqual(store.export(), records);
    assert.equal(store.verify().ok, true);
    assert.equal(store.retrieve({ query: '!!!' }).total, 0);
    assert.deepEqual(store.retrieve({ query: 'SQLite', order_by: 'id' }), store.retrieve({ query: 'SQLite', order_by: 'id' }));
  } finally { store.close(); }
});

test('quality fixture labels reference canonical records and have separate evaluation splits', () => {
  const ids = new Set(corpus.records.map(record => record.id));
  assert.equal(ids.size, corpus.records.length);
  assert.deepEqual([...new Set(corpus.queries.map(query => query.split))].sort(), ['development', 'held-out']);
  for (const query of corpus.queries) {
    assert.equal(typeof query.query, 'string');
    assert(query.relevant.every(id => ids.has(id)));
  }
  const store = open(':memory:');
  try {
    store.import(corpus.records);
    assert.equal(store.verify().ok, true);
    assert.deepEqual(store.retrieve({ query: 'DatabaseSync' }).items.map(record => record.id), [fixtureId(3)]);
    assert.equal(store.retrieve({ query: 'postgresql' }).total, 1);
    assert.equal(store.retrieve({ query: '!!!' }).total, 0);
  } finally { store.close(); }
});

test('benchmark runner records comparable modes and refuses to overwrite evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nmnm-benchmark-test-'));
  const runner = new URL('../bench/retrieval.js', import.meta.url);
  const args = [fileURLToPath(runner), directory, '100', '30'];
  try {
    execFileSync(process.execPath, args, { stdio: 'pipe' });
    const report = JSON.parse(readFileSync(join(directory, '100.json'), 'utf8'));
    assert.equal(report.size, 100);
    assert.equal(report.modes.cold.result_digest, report.modes.reused.result_digest);
    for (const mode of Object.values(report.modes)) {
      assert.equal(mode.timings.export.samples, 30);
      assert.equal(mode.timings.restore.warmups, 5);
      assert(mode.timings.recall.p95_ms >= mode.timings.recall.p50_ms);
      assert(mode.plans['memories_fts.rank'].length > 0);
      assert(mode.bytes.database > 0);
    }
    assert.throws(() => execFileSync(process.execPath, args, { stdio: 'pipe' }), /EEXIST/);
    assert.throws(() => execFileSync(process.execPath, [fileURLToPath(runner), directory, '100', '1'], { stdio: 'pipe' }), /Usage:/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
