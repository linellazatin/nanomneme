#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { open } from '../src/index.js';
import { fixtureId, generateRecords } from './fixtures.js';

const [output, beforeModule, plainModule, rawSize = '100000', ...extra] = process.argv.slice(2);
const size = Number(rawSize);
if (!output || !beforeModule || !plainModule || extra.length || ![100, 1000, 10000, 100000].includes(size)) {
  throw new Error('Usage: node packages/nmnm-core/bench/followup.js <output.json> <previous-core-module> <indexless-control-module> [size]');
}
if (existsSync(output)) throw new Error('Refusing to overwrite evidence');
const { open: before } = await import(pathToFileURL(resolve(beforeModule)));
const { open: plain } = await import(pathToFileURL(resolve(plainModule)));
const opens = { plain, before, current: open };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const report = { node: process.version, size, timestamp: new Date().toISOString(), controls: { before: { path: resolve(beforeModule), sha256: hash(beforeModule) }, plain: { path: resolve(plainModule), sha256: hash(plainModule) } }, profiles: {}, writes: [], fts: [] };
const selectors = { kind: { kind: 'decision' }, scope: { scope: 'project' }, importance: { importance: { gte: 0.5 } }, confidence: { confidence: { gte: 0.5 } }, recent: {}, source: { source: 'pi' }, mixed: { source: 'pi', kind: 'decision', importance: { gte: 0.5 } } };
const root = mkdtempSync(join(tmpdir(), 'nmnm-core-followup-'));
const denseStats = {};
function measure(work, samples = 30) {
  for (let i = 0; i < 5; i++) work(i);
  const times = [];
  for (let i = 0; i < samples; i++) { const start = performance.now(); work(i + 5); times.push(performance.now() - start); }
  times.sort((a, b) => a - b);
  return { samples, warmups: 5, p50_ms: times[Math.ceil(samples * 0.5) - 1], p95_ms: times[Math.ceil(samples * 0.95) - 1] };
}
function inspect(store, selector) {
  const prepare = DatabaseSync.prototype.prepare;
  let result;
  DatabaseSync.prototype.prepare = function (sql) {
    const statement = prepare.call(this, sql);
    if (sql.startsWith('SELECT COUNT(*) AS total FROM memories m')) {
      const get = statement.get, db = this;
      statement.get = function (...args) {
        const rootpage = prepare.call(db, "SELECT rootpage FROM sqlite_master WHERE name = 'memories'").get().rootpage;
        const program = prepare.call(db, 'EXPLAIN ' + sql).all(...args);
        const cursors = new Set(program.filter(row => row.opcode === 'OpenRead' && row.p2 === rootpage && row.p3 === 0).map(row => row.p1));
        result = { plan: prepare.call(db, 'EXPLAIN QUERY PLAN ' + sql).all(...args).map(row => row.detail), canonical_column_reads: program.filter(row => row.opcode === 'Column' && cursors.has(row.p1)).length };
        return get.apply(this, args);
      };
    }
    return statement;
  };
  try { store.retrieve(selector); return result; } finally { DatabaseSync.prototype.prepare = prepare; }
}
try {
  const version = new DatabaseSync(':memory:');
  report.sqlite = version.prepare('SELECT sqlite_version() AS version').get().version;
  version.close();
  for (const profile of ['dense', 'removed-heavy', 'expired-heavy']) {
    const records = generateRecords(size);
    if (profile !== 'dense') records.forEach((record, index) => {
      if (index % 101) record[profile === 'removed-heavy' ? 'removed_at' : 'expires_at'] = profile === 'removed-heavy' ? '2026-11-01T00:00:00.000Z' : '2000-01-01T00:00:00.000Z';
    });
    const seedPath = join(root, 'seed.db'), seed = plain(seedPath);
    seed.import(records); seed.close();
    const paths = {}, profileReport = { fixture_digest: digest(records), bytes: {}, upgrades_ms: {}, states: {} };
    report.profiles[profile] = profileReport;
    for (const [name, factory] of Object.entries(opens)) {
      paths[name] = join(root, name + '.db'); copyFileSync(seedPath, paths[name]);
      const start = performance.now(), store = factory(paths[name], { create: false }); store.close();
      profileReport.upgrades_ms[name] = performance.now() - start;
      profileReport.bytes[name] = statSync(paths[name]).size;
    }
    for (const state of ['unanalyzed', 'analyzed', 'stale']) {
      for (const name of Object.keys(opens)) if (state !== 'unanalyzed') {
        const db = new DatabaseSync(paths[name]);
        if (state === 'analyzed') {
          db.exec('PRAGMA analysis_limit = 1000; ANALYZE memories');
          if (profile === 'dense') denseStats[name] = db.prepare('SELECT * FROM sqlite_stat1').all();
        } else for (const row of denseStats[name]) {
          const parts = row.stat.split(' ');
          // Dense stores inherit sparse live-index estimates; sparse stores inherit dense estimates.
          if (profile === 'dense' && !row.idx.startsWith('sqlite_autoindex')) {
            parts[0] = String(Math.max(1, Math.round(Number(parts[0]) / 100)));
            parts[1] = String(Math.max(1, Math.round(Number(parts[1]) / 100)));
          }
          db.prepare('UPDATE sqlite_stat1 SET stat = ? WHERE idx = ?').run(parts.join(' '), row.idx);
        }
        db.close();
      }
      const stores = Object.fromEntries(Object.entries(opens).map(([name, factory]) => [name, factory(paths[name], { readOnly: true })]));
      const stateReport = { plans: {}, pairs: [] }; profileReport.states[state] = stateReport;
      const bytesBefore = readFileSync(paths.current);
      try {
        assert.deepEqual(stores.current.export(), records);
        assert.equal(stores.current.verify().ok, true);
        for (const [key, selector] of Object.entries({ ...selectors, tags: { tags: ['common', 'rare'] }, fts: { query: 'SQLite', source: 'pi' } })) {
          const expected = stores.plain.retrieve(selector);
          for (const [name, store] of Object.entries(stores)) {
            assert.deepEqual(store.retrieve(selector), expected);
            stateReport.plans[name + '_' + key] = inspect(store, selector);
          }
        }
        for (let pair = 0; pair < 3; pair++) {
          const names = Object.keys(opens), order = [...names.slice(pair), ...names.slice(0, pair)], timings = {};
          for (const [key, selector] of Object.entries(selectors)) {
            timings[key] = {};
            for (const name of order) timings[key][name] = measure(() => stores[name].retrieve(selector));
          }
          stateReport.pairs.push({ order, timings });
        }
        assert.deepEqual(readFileSync(paths.current), bytesBefore, 'read-only measurements must not change the store');
      } finally { for (const store of Object.values(stores)) store.close(); }
      console.log(`Measured ${profile}/${state}`);
    }
    for (const path of Object.values(paths)) rmSync(path);
    rmSync(seedPath);
  }
  const seedPath = join(root, 'write-seed.db'), seed = plain(seedPath);
  seed.import(generateRecords(size)); seed.close();
  for (let pair = 0; pair < 3; pair++) {
    const names = Object.keys(opens), order = [...names.slice(pair), ...names.slice(0, pair)], result = { order, modes: {} };
    for (const mode of ['reused', 'cold']) {
      const paths = {}, stores = {};
      try {
        for (const [name, factory] of Object.entries(opens)) { paths[name] = join(root, name + '.db'); copyFileSync(seedPath, paths[name]); factory(paths[name], { create: false }).close(); if (mode === 'reused') stores[name] = factory(paths[name]); }
        result.modes[mode] = {};
        for (const operation of ['create', 'content']) {
          result.modes[mode][operation] = {};
          for (const name of order) result.modes[mode][operation][name] = measure(index => {
            const store = stores[name] ?? opens[name](paths[name], { create: false });
            try { store.retain(operation === 'create' ? { content: `Created benchmark ${index}`, tags: ['created'] } : { id: fixtureId(0), content: `SQLite memory changed ${index}` }); }
            finally { if (!stores[name]) store.close(); }
          }, 100);
        }
      } finally { for (const store of Object.values(stores)) store.close(); for (const path of Object.values(paths)) rmSync(path); }
    }
    report.writes.push(result);
    console.log(`Measured write pair ${pair + 1}`);
  }
  for (const [readerName, readerOpen] of Object.entries({ before, current: open })) for (const [writerName, writerOpen] of Object.entries({ before, current: open })) for (const mutation of ['metadata', 'content']) {
    const path = join(root, `fts-${readerName}-${writerName}-${mutation}.db`), reader = readerOpen(path);
    const memory = reader.retain({ content: 'SQLite memory original', metadata: { source: 'pi' } });
    reader.retrieve({ query: 'SQLite' }); assert.equal(reader.verify().ok, true);
    const writer = writerOpen(path, { create: false });
    try {
      writer.retain(mutation === 'metadata' ? { id: memory.id, metadata: { source: 'other' } } : { id: memory.id, content: 'SQLite memory changed' });
      const cached = reader.verify();
      const fresh = readerOpen(path, { readOnly: true });
      try { assert.equal(fresh.verify().ok, true); assert.deepEqual(reader.retrieve({ query: 'changed' }), fresh.retrieve({ query: 'changed' })); } finally { fresh.close(); }
      if (readerName === 'current') assert.equal(cached.ok, true);
      assert.equal(reader.verify().ok, true);
      report.fts.push({ reader: readerName, writer: writerName, mutation, cached_ok: cached.ok, fresh_ok: true, refreshed_ok: true });
    } finally { writer.close(); reader.close(); }
  }
  writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
} finally { rmSync(root, { recursive: true, force: true }); }
