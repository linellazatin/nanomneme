#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { open } from '../src/index.js';
import { fixtureId, generateRecords } from './fixtures.js';

const [output, rawSizes = '100,1000,10000,100000', rawSamples = '30', ...extra] = process.argv.slice(2);
const sizes = rawSizes.split(',').map(Number);
const samples = Number(rawSamples);
if (!output || extra.length || !sizes.length || sizes.some(size => ![100, 1000, 10000, 100000].includes(size)) || new Set(sizes).size !== sizes.length || !Number.isInteger(samples) || samples < 30 || samples > 1000) {
  throw new Error('Usage: node packages/nmnm-core/bench/retrieval.js <output-directory> [100,1000,10000,100000] [samples>=30]');
}
mkdirSync(resolve(output), { recursive: true });
const warmups = 5;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const selectors = {
  recent: {}, namespace: { namespace: 'selected' }, source: { source: 'pi' },
  tags: { tags: ['common', 'rare'] }, page: { limit: 50, offset: 50 },
  strict: { query: 'SQLite memory' }, prefix: { query: 'Data*' },
  boolean: { query: 'SQLite OR PostgreSQL' }, phrase: { query: '"SQLite memory"' },
  near: { query: 'NEAR(SQLite retrieval, 2)' }, broad: { query: 'technical' },
  narrow: { query: '"item 24"' }, punctuation: { query: 'config.toml' },
};

function measure(work) {
  for (let index = 0; index < warmups; index += 1) work(index);
  const times = [];
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    work(index + warmups);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return { samples, warmups, p50_ms: times[Math.ceil(times.length * 0.5) - 1], p95_ms: times[Math.ceil(times.length * 0.95) - 1], min_ms: times[0], max_ms: times.at(-1) };
}

function quality() {
  const fixture = JSON.parse(readFileSync(new URL('fixtures/quality.json', import.meta.url), 'utf8'));
  const store = open(':memory:');
  try {
    store.import(fixture.records);
    return { label_status: fixture.label_status, queries: fixture.queries.map(query => {
      const items = store.retrieve({ query: query.query, limit: 5 }).items;
      const hits = items.filter(record => query.relevant.includes(record.id)).length;
      return { ...query, ids: items.map(record => record.id), precision_at_5: hits / 5, recall_at_5: query.relevant.length ? hits / query.relevant.length : null };
    }) };
  } finally { store.close(); }
}

function inspect(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const sql = {
      recent: 'SELECT m.id FROM memories m WHERE m.removed_at IS NULL AND (m.expires_at IS NULL OR m.expires_at > ?) ORDER BY m.updated_at DESC, m.id ASC LIMIT 20',
      namespace: "SELECT m.id FROM memories m WHERE m.removed_at IS NULL AND m.namespace = 'selected' AND (m.expires_at IS NULL OR m.expires_at > ?) ORDER BY m.updated_at DESC, m.id ASC LIMIT 20",
      tags: "SELECT m.id FROM memories m WHERE m.removed_at IS NULL AND (m.expires_at IS NULL OR m.expires_at > ?) AND m.id IN (SELECT memory_id FROM memory_tags WHERE tag IN ('common', 'rare') GROUP BY memory_id HAVING COUNT(DISTINCT tag) = 2) ORDER BY m.updated_at DESC, m.id ASC LIMIT 20",
      source: "SELECT m.id FROM memories m WHERE m.removed_at IS NULL AND CASE WHEN json_valid(m.metadata) THEN json_extract(m.metadata, '$.source') END = 'pi' AND (m.expires_at IS NULL OR m.expires_at > ?) ORDER BY m.updated_at DESC, m.id ASC LIMIT 20",
      source_count: "SELECT COUNT(*) FROM memories m WHERE m.removed_at IS NULL AND CASE WHEN json_valid(m.metadata) THEN json_extract(m.metadata, '$.source') END = 'pi' AND (m.expires_at IS NULL OR m.expires_at > ?)",
      count: 'SELECT COUNT(*) FROM memories m WHERE m.removed_at IS NULL AND (m.expires_at IS NULL OR m.expires_at > ?)',
    };
    const plans = Object.fromEntries(Object.entries(sql).map(([name, statement]) => [name, db.prepare('EXPLAIN QUERY PLAN ' + statement).all(new Date().toISOString()).map(row => row.detail)]));
    for (const score of ['bm25(memories_fts)', 'memories_fts.rank']) {
      plans[score] = db.prepare(`EXPLAIN QUERY PLAN SELECT m.id, ${score} AS score FROM memories m JOIN memories_fts ON memories_fts.rowid = m.rowid WHERE m.removed_at IS NULL AND memories_fts MATCH ? ORDER BY score ASC, m.importance DESC, m.id ASC LIMIT 20`).all('SQLite').map(row => row.detail);
    }
    const rootpage = db.prepare("SELECT rootpage FROM sqlite_master WHERE name = 'memories'").get().rootpage;
    const program = db.prepare('EXPLAIN ' + sql.source_count).all(new Date().toISOString());
    const cursors = new Set(program.filter(row => row.opcode === 'OpenRead' && row.p2 === rootpage && row.p3 === 0).map(row => row.p1));
    const source_count_canonical_column_reads = program.filter(row => row.opcode === 'Column' && cursors.has(row.p1)).length;
    return { sqlite: db.prepare('SELECT sqlite_version() AS version').get().version, journal_mode: db.prepare('PRAGMA journal_mode').get().journal_mode, plans, source_count_canonical_column_reads };
  } finally { db.close(); }
}

function bytes(path) {
  return Object.fromEntries(['', '-journal', '-wal', '-shm'].map(suffix => {
    try { return [suffix || 'database', statSync(path + suffix).size]; }
    catch (error) { if (error.code !== 'ENOENT') throw error; return [suffix || 'database', 0]; }
  }));
}

const root = mkdtempSync(join(tmpdir(), 'nmnm-benchmark-'));
try {
  const qualityResult = quality();
  for (const size of sizes) {
    const records = generateRecords(size);
    const report = { size, node: process.version, platform: process.platform, arch: process.arch, timestamp: new Date().toISOString(), fixture_digest: digest(records), quality: qualityResult, modes: {} };
    for (const mode of ['reused', 'cold']) {
      const path = join(root, `${size}-${mode}.db`);
      let store = open(path);
      const importStart = performance.now();
      store.import(records);
      const import_ms = performance.now() - importStart;
      assert.deepEqual(store.export(), records);
      assert.equal(store.verify().ok, true);
      assert.deepEqual(store.recall({ id: fixtureId(0) }), records[0]);
      const results = Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
        const result = store.retrieve(selector);
        assert.deepEqual(result, store.retrieve(selector));
        return [name, result];
      }));
      const initial = { import_ms, bytes: bytes(path), result_digest: digest(results), ...inspect(path) };
      if (mode === 'cold') { store.close(); store = null; }
      const run = work => {
        if (store) return work(store);
        const cold = open(path, { create: false });
        try { return work(cold); } finally { cold.close(); }
      };
      try {
        const timings = { recall: measure(() => run(current => current.recall({ id: fixtureId(0) }))) };
        for (const [name, selector] of Object.entries(selectors)) timings[name] = measure(() => run(current => current.retrieve(selector)));
        timings.export = measure(() => run(current => current.export()));
        timings.create = measure(index => run(current => current.retain({ content: `Created benchmark ${index}`, tags: ['created'] })));
        const patches = {
          content: index => ({ content: `SQLite memory changed ${index}` }),
          tags: index => ({ tags: index % 2 ? ['changed'] : ['other'] }),
          metadata: index => ({ metadata: { source: 'pi', sample: index } }),
          score: index => ({ importance: index % 2 ? 0.2 : 0.8 }),
          expiry: index => ({ expires_at: index % 2 ? null : '9999-01-01T00:00:00.000Z' }),
        };
        for (const [name, patch] of Object.entries(patches)) timings[`patch_${name}`] = measure(index => run(current => current.retain({ id: fixtureId(0), ...patch(index) })));
        // Prepare each lifecycle operation outside its measured interval.
        for (const operation of ['remove', 'restore']) {
          const times = [];
          for (let index = 0; index < warmups + samples; index += 1) {
            run(current => operation === 'remove' ? current.retain({ id: fixtureId(0) }) : current.remove({ id: fixtureId(0) }));
            const start = performance.now();
            run(current => operation === 'remove' ? current.remove({ id: fixtureId(0) }) : current.retain({ id: fixtureId(0) }));
            if (index >= warmups) times.push(performance.now() - start);
          }
          times.sort((a, b) => a - b);
          timings[operation] = { samples, warmups, p50_ms: times[Math.ceil(samples * 0.5) - 1], p95_ms: times[Math.ceil(samples * 0.95) - 1], min_ms: times[0], max_ms: times.at(-1) };
        }
        report.modes[mode] = { ...initial, timings, final_bytes: bytes(path) };
      } finally { store?.close(); }
    }
    assert.equal(report.modes.reused.result_digest, report.modes.cold.result_digest);
    writeFileSync(join(resolve(output), `${size}.json`), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    process.stdout.write(`Measured ${size} memories\n`);
  }
} finally { rmSync(root, { recursive: true, force: true }); }
