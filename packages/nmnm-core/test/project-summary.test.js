import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import * as core from '../src/index.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/project-summary.json', import.meta.url)));
const payload = changes => ({ ...structuredClone(fixture.base_payload), ...changes });
const empty = { text: '', source_ids: [], truncated: false, skipped_invalid: 0 };
function store(t) {
  const directory = mkdtempSync(join(tmpdir(), 'nmnm-summary-'));
  const path = join(directory, 'memory.db');
  const db = core.open(path);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  return { db, path };
}

test('summary validates and renders the independent handoff fixture canonically', () => {
  assert.equal(typeof core.validateProjectSummary, 'function');
  assert.deepEqual(core.validateProjectSummary(payload()), fixture.base_payload);
  assert.equal(core.renderProjectSummary(payload()), fixture.expected_primary_content);
  const reordered = Object.fromEntries(Object.entries(payload()).reverse());
  assert.equal(JSON.stringify(core.validateProjectSummary(reordered)), JSON.stringify(fixture.base_payload));
  assert.equal(core.validateProjectSummary(payload({ title: '  Example  ' })).title, 'Example');
  const missingReferences = payload(); delete missingReferences.references;
  assert.deepEqual(core.validateProjectSummary(missingReferences).references, []);
});

test('summary rejects invalid contracts before mutation and accepts partial evidence', t => {
  const { db } = store(t);
  for (const example of fixture.cases.filter(c => c.change || c.omit)) {
    const input = payload(example.change);
    for (const name of example.omit ?? []) delete input[name];
    if (example.expect.valid_payload === false) {
      assert.throws(() => db.retainSummary({ summary: input }), TypeError, example.name);
    } else {
      const record = db.retainSummary({ summary: input });
      assert.deepEqual(record.metadata.summary, core.validateProjectSummary(input));
      for (const text of example.expect.must_preserve ?? []) assert.ok(record.content.includes(text), text);
    }
  }
  const before = db.export();
  for (const input of [payload({ title: '\ud800' }), payload({ objective: 'ESC\x1b' }), payload({ title: 'x'.repeat(161) }), payload({ decisions: Array(17).fill('x') }), payload({ state: { ...payload().state, extra: true } })]) {
    assert.throws(() => db.retainSummary({ summary: input }), TypeError);
  }
  const oversized = payload({ decisions: Array(8).fill('界'.repeat(1024)) });
  assert.throws(() => db.retainSummary({ summary: oversized }), /8192/);
  assert.deepEqual(db.export(), before);
  assert.equal(db.verify().ok, true);
});

test('brief exactly renders full or fallback context and never writes', t => {
  const { db, path } = store(t);
  assert.deepEqual(db.brief(), empty);
  const record = db.retainSummary({ summary: payload() });
  assert.equal(record.namespace, 'project-summary');
  assert.equal(record.scope, 'project');
  assert.equal(record.kind, 'note');
  assert.deepEqual(record.metadata, fixture.expected_record_fields.metadata);
  const expected = fixture.expected_full_brief.replaceAll(fixture.fixture_record_id, record.id);
  const fallback = fixture.expected_fallback_brief.replaceAll(fixture.fixture_record_id, record.id);
  assert.deepEqual(db.brief({ budget: expected.length }), { ...empty, text: expected, source_ids: [record.id] });
  assert.deepEqual(db.brief({ budget: fallback.length }), { ...empty, text: fallback, source_ids: [record.id], truncated: true });
  for (const budget of [0, 1, fallback.length - 1]) assert.deepEqual(db.brief({ budget }), { ...empty, truncated: true });
  for (const budget of [-1, NaN, 1.5, Infinity, '1000']) assert.throws(() => db.brief({ budget }));
  const before = readFileSync(path);
  const reader = core.open(path, { readOnly: true });
  try { assert.equal(reader.brief().text, expected); } finally { reader.close(); }
  assert.deepEqual(readFileSync(path), before);
  assert.deepEqual(db.recall({ id: record.id }), record);
});

test('summary update preserves identity/provenance, repairs content, and rejects wrong or inactive targets', t => {
  const { db } = store(t);
  const record = db.retainSummary({ summary: payload() });
  db.retain({ id: record.id, content: 'Generic edit', metadata: { ...record.metadata, source: 'original-author', custom: true }, tags: ['keep'], importance: 0.7 });
  assert.equal(db.brief().skipped_invalid, 1);
  const updated = db.retainSummary({ id: record.id, summary: payload({ objective: 'Corrected objective' }) });
  assert.equal(updated.id, record.id);
  assert.equal(updated.created_at, record.created_at);
  assert.equal(updated.metadata.source, 'original-author');
  assert.equal(updated.metadata.custom, true);
  assert.equal(updated.importance, 0.7);
  assert.deepEqual(updated.tags, ['keep']);
  assert.ok(updated.updated_at > record.updated_at);
  assert.ok(db.brief().text.includes('Corrected objective'));
  const note = db.retain({ content: 'Ordinary note' });
  for (const id of [note.id, '11111111-1111-4111-8111-111111111111']) assert.throws(() => db.retainSummary({ id, summary: payload() }));
  db.remove({ id: record.id });
  assert.deepEqual(db.brief(), empty);
  assert.throws(() => db.retainSummary({ id: record.id, summary: payload() }));
  db.retain({ id: record.id });
  assert.equal(db.brief().source_ids[0], record.id);
  db.retain({ id: record.id, expires_at: '2000-01-01T00:00:00.000Z' });
  assert.throws(() => db.retainSummary({ id: record.id, summary: payload() }));
  assert.deepEqual(db.brief(), empty);
});

test('brief skips corrupt/unsupported records, preserves ordering, limits earlier pointers and falls back historically', t => {
  const { db, path } = store(t);
  const records = [];
  for (let day = 1; day <= 6; day++) records.push(db.retainSummary({ summary: payload({ as_of: `2026-11-0${day}T00:00:00.000Z` }) }));
  db.retain({ id: records[0].id, content: records[0].content }); // mutation recency does not override evidence date
  const unsupported = db.retainSummary({ summary: payload({ as_of: '2026-12-01T00:00:00.000Z' }) });
  db.retain({ id: unsupported.id, metadata: { summary: payload({ format_version: 99 }) } });
  const superseded = db.retainSummary({ summary: payload({ state: { ...payload().state, status: 'superseded' } }) });
  assert.ok(!db.brief({ budget: 10000 }).source_ids.includes(superseded.id));
  const result = db.brief({ budget: 10000 });
  assert.deepEqual(result.source_ids, records.slice(2).reverse().map(r => r.id));
  assert.equal(result.truncated, true);
  assert.equal(result.skipped_invalid, 1);
  db.remove({ id: records.at(-1).id });
  assert.equal(db.brief().source_ids[0], records.at(-2).id);
  assert.match(db.brief().text, /historical data/);
  const raw = new DatabaseSync(path);
  try { raw.prepare('UPDATE memories SET metadata = ? WHERE id = ?').run('{broken', unsupported.id); } finally { raw.close(); }
  // Invalid JSON sorts after dated candidates; ensure this scan reaches it.
  db.remove({ id: records[0].id });
  db.remove({ id: records[1].id });
  assert.equal(db.brief().skipped_invalid, 1);
});

test('brief uses UUID ties, excludes nonproject candidates and round-trips canonical records', t => {
  const { db } = store(t);
  const first = db.retainSummary({ summary: payload() });
  const second = db.retainSummary({ summary: payload() });
  db.retain({ content: first.content, namespace: 'project-summary', scope: 'global', metadata: first.metadata });
  const expected = [first.id, second.id].sort();
  assert.deepEqual(db.brief({ budget: 10000 }).source_ids, expected);
  assert.equal(db.retrieve({ query: 'recovery', namespace: 'project-summary', scope: 'project' }).total, 2);
  const copy = core.open(':memory:');
  try {
    copy.import(db.export());
    assert.deepEqual(copy.brief({ budget: 10000 }), db.brief({ budget: 10000 }));
    assert.deepEqual(copy.export(), db.export());
  } finally { copy.close(); }
  assert.equal(db.verify().ok, true);
});

test('summary limits count Unicode code points and normalized UTF-8 bytes exactly', () => {
  assert.equal(core.validateProjectSummary(payload({ title: '😀'.repeat(160) })).title.length, 320);
  assert.throws(() => core.validateProjectSummary(payload({ title: '😀'.repeat(161) })));
  const boundary = payload({ decisions: Array(7).fill('x'.repeat(1000)), objective: 'x' });
  const remaining = 8192 - Buffer.byteLength(JSON.stringify(boundary));
  boundary.objective += 'x'.repeat(remaining);
  assert.equal(Buffer.byteLength(JSON.stringify(boundary)), 8192);
  assert.deepEqual(core.validateProjectSummary(boundary), boundary);
  boundary.objective += 'x';
  assert.throws(() => core.validateProjectSummary(boundary), /8192/);
});

test('brief streams past invalid candidates and a budget never emits a partial pointer', t => {
  const { db } = store(t);
  for (let i = 0; i < 25; i++) db.retain({ content: 'Not a summary', namespace: 'project-summary', metadata: { summary: payload({ as_of: '2026-12-01T00:00:00.000Z', format_version: 99 }) } });
  const record = db.retainSummary({ summary: payload({ title: '😀 related history' }) });
  const before = db.export();
  const full = db.brief({ budget: 10000 });
  assert.equal(full.skipped_invalid, 25);
  assert.deepEqual(full.source_ids, [record.id]);
  for (let budget = 0; budget <= full.text.length; budget++) {
    const result = db.brief({ budget });
    assert.ok(result.text.length <= budget);
    assert.equal(result.text.isWellFormed(), true);
    if (result.text) assert.ok(result.text.includes(record.id));
  }
  assert.deepEqual(db.export(), before);
});
