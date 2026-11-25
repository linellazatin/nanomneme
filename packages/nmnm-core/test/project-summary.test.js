import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { execFile } from 'node:child_process';
import * as core from '../src/index.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/project-summary.json', import.meta.url)));
const payload = changes => ({ ...structuredClone(fixture.base_payload), ...changes });
const empty = { text: '', source_ids: [], truncated: false, skipped_invalid: 0 };
const captureId = '22345678-1234-4234-8234-123456789abc';
function store(t) {
  const directory = mkdtempSync(join(tmpdir(), 'nmnm-summary-'));
  const path = join(directory, 'memory.db');
  const db = core.open(path);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  return { db, path };
}

test('capture instructions and extraction require one bounded event-specific validated block', () => {
  assert.equal(typeof core.summaryCaptureInstructions, 'function');
  const options = { token: captureId, as_of: fixture.base_payload.as_of };
  const instructions = core.summaryCaptureInstructions({ ...options, guidance: 'Never retain secret project beacons.' });
  assert.match(instructions, /Never retain secret project beacons/);
  assert.match(instructions, /approval/);
  assert.throws(() => core.summaryCaptureInstructions({ ...options, guidance: 'x'.repeat(9000) }), /budget/);
  const block = `NMNM_SUMMARY_${captureId}_BEGIN\n${JSON.stringify(payload())}\nNMNM_SUMMARY_${captureId}_END`;
  assert.deepEqual(core.extractSummaryCapture(`Host summary\n${block}`, options), payload());
  for (const text of ['', 'Host summary only', block + block, 'x'.repeat(1048577) + block, block.replace('_END', '_MISSING'), block.replace(captureId, 'wrong-token'), block.replace('"format_version":1', '"format_version":9'), block.replace('"format_version":1', 'broken json'), block.replace(fixture.base_payload.as_of, '2026-11-25T00:00:00.000Z'), block.replace('"objective":', '"unknown":1,"objective":'), block.replace('"objective":', `"padding":"${'x'.repeat(9000)}","objective":`)]) {
    assert.equal(core.extractSummaryCapture(text, options), null);
  }
});

test('summary capture attribution and receipts are atomic, idempotent and do not restore records', t => {
  const { db } = store(t);
  const input = { summary: payload(), source: 'claude-code', capture_id: captureId };
  const first = db.retainSummary(input);
  assert.equal(first.metadata.source, 'claude-code');
  assert.deepEqual(first.metadata.summary_capture, { id: captureId });
  assert.deepEqual(db.retainSummary(input), first);
  assert.equal(db.retrieve({ namespace: 'project-summary' }).total, 1);
  assert.throws(() => db.retainSummary({ ...input, source: 'pi' }), /capture/i);
  assert.throws(() => db.retainSummary({ ...input, summary: payload({ objective: 'Conflicting retry.' }) }), /capture/i);
  const corrected = db.retainSummary({ id: first.id, summary: payload({ objective: 'Corrected explicitly.' }) });
  assert.equal(corrected.metadata.source, 'claude-code');
  assert.deepEqual(corrected.metadata.summary_capture, { id: captureId });
  assert.throws(() => db.retainSummary({ id: first.id, summary: payload(), source: 'pi' }), /create/i);
  db.removeSummary({ id: first.id });
  assert.throws(() => db.retainSummary(input), /capture/i);
  assert.equal(db.recall({ id: first.id }), null);
  const second = db.retainSummary({ ...input, capture_id: '32345678-1234-4234-8234-123456789abc' });
  db.removeSummary({ id: second.id });
  assert.equal(db.retainSummary({ ...input, capture_id: '32345678-1234-4234-8234-123456789abc' }).removed_at !== null, true);
  assert.equal(db.recall({ id: second.id }), null);
  const expired = db.retain({ id: second.id, expires_at: '2000-01-01T00:00:00.000Z' });
  assert.deepEqual(db.retainSummary({ ...input, capture_id: '32345678-1234-4234-8234-123456789abc' }), expired);
  assert.equal(db.recall({ id: second.id }), null);
  assert.equal(db.retainSummary({ summary: payload() }).metadata.source, 'cli');
  for (const extra of [{ source: '' }, { source: null }, { source: 'bad source' }, { capture_id: 'bad' }]) assert.throws(() => db.retainSummary({ summary: payload(), ...extra }));
});

test('independent writers serialize one capture receipt to one record', async t => {
  const { db, path } = store(t);
  const script = `import {open} from ${JSON.stringify(new URL('../src/index.js', import.meta.url).href)}; const db=open(${JSON.stringify(path)}); try { console.log(db.retainSummary(${JSON.stringify({ summary: fixture.base_payload, source: 'claude-code', capture_id: captureId })}).id); } finally { db.close(); }`;
  const ids = await Promise.all([0, 1].map(() => new Promise((resolve, reject) => {
    execFile(process.execPath, ['--input-type=module', '-e', script], (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  })));
  assert.equal(ids[0], ids[1]);
  assert.equal(db.retrieve({ namespace: 'project-summary' }).total, 1);
});

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

test('summary removal is ID-based, guarded, reversible and changes the next brief', t => {
  const { db } = store(t);
  const older = db.retainSummary({ summary: payload() });
  const latest = db.retainSummary({ summary: payload({ as_of: '2026-11-25T00:00:00.000Z' }) });
  const note = db.retain({ content: 'Keep ordinary memory' });
  assert.throws(() => db.removeSummary({ id: note.id }));
  assert.throws(() => db.removeSummary({ id: latest.id, mode: 'purge' }), TypeError);
  assert.equal(db.recall({ id: note.id }).content, note.content);
  const removed = db.removeSummary({ id: latest.id });
  assert.equal(removed.mode, 'soft');
  assert.equal(removed.id, latest.id);
  assert.equal(db.recall({ id: latest.id }), null);
  assert.deepEqual(db.brief().source_ids, [older.id]);
  assert.equal(db.removeSummary({ id: latest.id }), null);
  db.retain({ id: latest.id });
  assert.equal(db.brief().source_ids[0], latest.id);
  db.removeSummary({ id: latest.id }); db.removeSummary({ id: older.id });
  assert.equal(db.brief().text, '');
  assert.equal(db.verify().ok, true);
});

const native = changes => ({ format: 'nanomneme/native-compaction-summary', format_version: 1, title: 'Pi compaction checkpoint', as_of: '2026-11-25T09:00:00.000Z', text: 'Native context\n\tUnicode 界', ...changes });

test('native summary contract preserves full bounded text without weakening structured validation', t => {
  const { db, path } = store(t);
  const summary = native({ text: 'Native\n' + 'x'.repeat(6600) });
  assert.throws(() => core.validateProjectSummary(summary));
  const first = db.retainSummary({ summary, source: 'pi', capture_id: captureId });
  assert.deepEqual(first.metadata.summary, summary);
  assert.ok(first.content.endsWith(summary.text));
  assert.match(first.content, /unverified/);
  assert.deepEqual(db.retainSummary({ summary, source: 'pi', capture_id: captureId }), first);
  assert.equal(db.brief({ budget: 10000 }).text.endsWith(summary.text), true);
  const fallback = db.brief({ budget: 1000 });
  assert.deepEqual(fallback.source_ids, [first.id]);
  assert.match(fallback.text, /native.*unverified/);
  assert.match(fallback.text, /recall_memory/);
  assert.equal(fallback.truncated, true);
  const before = readFileSync(path);
  const reader = core.open(path, { readOnly: true });
  try { assert.deepEqual(reader.brief(), fallback); } finally { reader.close(); }
  assert.deepEqual(readFileSync(path), before);
  const structured = db.retainSummary({ summary: payload() });
  assert.throws(() => db.retainSummary({ id: first.id, summary: payload() }), /format/);
  assert.throws(() => db.retainSummary({ id: structured.id, summary }), /format/);
  const corrected = db.retainSummary({ id: first.id, summary: native({ text: 'Reviewed correction' }) });
  assert.equal(corrected.metadata.source, 'pi');
  assert.deepEqual(corrected.metadata.summary_capture, { id: captureId });
  assert.throws(() => db.retainSummary({ summary, source: 'pi', capture_id: captureId }), /conflict/);
  assert.equal(db.brief({ budget: 10000 }).source_ids[0], first.id);
  db.removeSummary({ id: first.id });
  assert.ok(!db.brief().source_ids.includes(first.id));
  assert.throws(() => db.retainSummary({ summary, source: 'pi', capture_id: captureId }), /conflict/);
  assert.equal(db.recall({ id: first.id }), null);
  for (const invalid of [native({ text: '' }), native({ text: '\ud800' }), native({ text: 'ESC\x1b' }), native({ text: '界'.repeat(3000) }), native({ title: 'x'.repeat(161) }), native({ as_of: '2026-02-30T00:00:00.000Z' }), native({ extra: true }), native({ format_version: 2 })]) {
    assert.throws(() => db.retainSummary({ summary: invalid }), TypeError);
  }
  assert.equal(db.verify().ok, true);
});

test('native byte boundary, mixed date ties and invalid content are deterministic', t => {
  const { db } = store(t);
  const minimum = native({ text: 'x' });
  const remaining = 8192 - Buffer.byteLength(JSON.stringify(minimum));
  const exact = native({ text: 'x'.repeat(remaining + 1) });
  assert.equal(Buffer.byteLength(JSON.stringify(core.validateSummary(exact))), 8192);
  assert.throws(() => core.validateSummary({ ...exact, text: exact.text + 'x' }), /8192/);
  const first = db.retainSummary({ summary: native() });
  const second = db.retainSummary({ summary: payload({ as_of: first.metadata.summary.as_of }) });
  assert.deepEqual(db.brief({ budget: 10000 }).source_ids, [first.id, second.id].sort());
  db.retain({ id: first.id, content: 'Generic inconsistent native edit' });
  assert.deepEqual(db.brief().source_ids, [second.id]);
  assert.equal(db.brief().skipped_invalid, 1);
});
