import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { open } from '../src/core-runtime.generated.js';

const summary = { format: 'nanomneme/project-summary', format_version: 1, title: 'Automatic checkpoint', objective: 'Evaluate storage.', state: { status: 'in-progress', outcome: 'Planning only.', verification: 'Not implemented.' }, decisions: [], open_questions: ['Recovery?'], next_steps: ['Ask before implementing.'], authorization: { allowed: ['Assess.'], not_authorized: ['Implement.'] }, references: [] };
async function fixture(t) {
  const { handleCompactionHook } = await import('../src/compaction.js');
  const home = mkdtempSync(join(tmpdir(), 'nmnm-claude-capture-')), cwd = join(home, 'project'), stateRoot = join(home, 'state');
  mkdirSync(cwd); t.after(() => rmSync(home, { recursive: true, force: true }));
  let now = Date.parse('2026-11-25T00:00:00.000Z');
  const options = { home, cwd, stateRoot, now: () => now };
  const base = { cwd, session_id: 'test-session', prompt_id: 'test-prompt', trigger: 'manual' };
  const call = (event, input = {}, opts = {}) => handleCompactionHook({ ...base, hook_event_name: event, ...input }, { ...options, ...opts });
  const settings = (value, global = false) => {
    const dir = global ? join(home, '.claude') : join(cwd, '.nanomneme'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'nmnm.jsonc'), JSON.stringify(value));
  };
  const dbPath = join(cwd, '.nanomneme/memory.db');
  return { home, cwd, stateRoot, call, settings, dbPath, advance: () => { now += 3600001; } };
}
function answer(pre, changes = {}) {
  const token = pre.text.match(/NMNM_SUMMARY_([a-f0-9-]+)_BEGIN/)[1];
  const as_of = pre.text.match(/"as_of":"([^"]+)"/)[1];
  return `Native summary\nNMNM_SUMMARY_${token}_BEGIN\n${JSON.stringify({ ...summary, as_of, ...changes })}\nNMNM_SUMMARY_${token}_END`;
}

test('capture is opt-in, project false overrides user true, and invalid configuration leaves ordinary context available', async t => {
  const f = await fixture(t);
  assert.equal(f.call('PreCompact').status, 'disabled');
  assert.equal(existsSync(f.stateRoot), false);
  f.settings({ summary: { autocapture: { enabled: true } } }, true);
  f.settings({ summary: { autocapture: { enabled: false } } });
  assert.equal(f.call('PreCompact').status, 'disabled');
  f.settings({ summary: { autocapture: { enabled: 'bad' } } });
  assert.equal(f.call('PreCompact').status, 'disabled');
  const { buildMemoryIndex } = await import('../src/context.js');
  assert.equal(typeof buildMemoryIndex({ cwd: f.cwd, home: f.home }).content, 'string');
  assert.equal(existsSync(f.dbPath), false);
});

for (const trigger of ['manual', 'auto']) test(`capture saves once after ${trigger} compaction with adapter provenance and original boundaries`, async t => {
  const f = await fixture(t); f.settings({ summary: { autocapture: { enabled: true } }, autoretention: { enabled: false, never_persist: ['Never capture private beacons.'], always_ask: ['Ask before retaining identity.'] } });
  const pre = f.call('PreCompact', { trigger }); assert.equal(pre.status, 'prepared');
  assert.match(pre.text, /Never capture private beacons/); assert.match(pre.text, /Ask before retaining identity/);
  assert.equal(existsSync(f.dbPath), false);
  const post = { trigger, compact_summary: answer(pre) };
  const result = f.call('PostCompact', post); assert.equal(result.status, 'saved');
  assert.equal(f.call('PostCompact', post).status, 'already_processed');
  const db = open(f.dbPath, { create: false });
  try {
    const record = db.recall({ id: result.id }); assert.equal(record.metadata.source, 'claude-code');
    assert.equal(record.metadata.summary.state.outcome, 'Planning only.');
    assert.ok(record.metadata.summary_capture.id);
    assert.deepEqual(db.brief().source_ids, [result.id]);
    db.removeSummary({ id: result.id });
    assert.equal(f.call('PostCompact', post).status, 'already_processed');
    assert.equal(db.recall({ id: result.id }), null);
  } finally { db.close(); }
  assert.equal(existsSync(join(f.home, '.local/share/nanomneme/memory.db')), false);
});

test('missing, invalid, oversized, expired and changed-policy completions never create stores', async t => {
  for (const scenario of ['missing', 'invalid', 'oversized', 'expired', 'policy', 'failed', 'identity']) {
    const f = await fixture(t); f.settings({ summary: { autocapture: { enabled: true } } });
    const pre = f.call('PreCompact'); let text = answer(pre);
    if (scenario === 'missing') text = 'No checkpoint permitted.';
    if (scenario === 'invalid') text = answer(pre, { invented: true });
    if (scenario === 'oversized') text = answer(pre, { objective: 'x'.repeat(9000) });
    if (scenario === 'expired') f.advance();
    if (scenario === 'policy') f.settings({ summary: { autocapture: { enabled: true } }, autoretention: { never_persist: ['New restriction.'] } });
    const result = f.call('PostCompact', { compact_summary: text, ...(scenario === 'failed' ? { error: 'cancelled' } : {}), ...(scenario === 'identity' ? { prompt_id: 'other-event' } : {}) });
    assert.notEqual(result.status, 'saved', scenario);
    assert.equal(existsSync(f.dbPath), false, scenario);
  }
});

test('new attempts reject old blocks without consuming the current event, and disabled hooks touch no state', async t => {
  const f = await fixture(t); f.settings({ summary: { autocapture: { enabled: true } } });
  const old = f.call('PreCompact'), current = f.call('PreCompact');
  assert.notEqual(old.text, current.text);
  assert.equal(f.call('PostCompact', { compact_summary: answer(old) }).status, 'stale');
  assert.equal(f.call('PostCompact', { compact_summary: answer(current) }).status, 'saved');
  const before = readdirSync(f.stateRoot).map(name => [name, readFileSync(join(f.stateRoot, name), 'utf8')]);
  f.settings({ summary: { autocapture: { enabled: false } } });
  assert.equal(f.call('PostCompact', { compact_summary: answer(current) }).status, 'disabled');
  assert.deepEqual(readdirSync(f.stateRoot).map(name => [name, readFileSync(join(f.stateRoot, name), 'utf8')]), before);
  assert.notEqual(f.call('PreCompact', { prompt_id: undefined }).status, 'prepared');
});

test('capture rejects unsafe temporary roots and lock contention without writes', async t => {
  for (const unsafe of ['permissions', 'symlink', 'locked', 'malformed']) {
    const f = await fixture(t); f.settings({ summary: { autocapture: { enabled: true } } });
    if (unsafe === 'permissions') { mkdirSync(f.stateRoot, { mode: 0o700 }); chmodSync(f.stateRoot, 0o777); }
    if (unsafe === 'symlink') { const target = join(f.home, 'target'); mkdirSync(target); symlinkSync(target, f.stateRoot); }
    if (['permissions', 'symlink'].includes(unsafe)) {
      assert.equal(f.call('PreCompact').status, 'unavailable');
    } else {
      const pre = f.call('PreCompact');
      const path = join(f.stateRoot, readdirSync(f.stateRoot)[0]);
      if (unsafe === 'locked') writeFileSync(path + '.lock', '');
      else writeFileSync(path, '{broken');
      assert.equal(f.call('PostCompact', { compact_summary: answer(pre) }).status, 'unavailable');
    }
    assert.equal(existsSync(f.dbPath), false);
  }
});

test('capture observes one retain without logging summary text or event identifiers', async t => {
  const f = await fixture(t); f.settings({ summary: { autocapture: { enabled: true } } });
  const shared = join(f.home, '.local/share/nanomneme'); mkdirSync(shared, { recursive: true });
  writeFileSync(join(shared, 'config.jsonc'), '{"logging":{"enabled":true}}');
  const pre = f.call('PreCompact'); const post = { compact_summary: answer(pre) };
  assert.equal(f.call('PostCompact', post).status, 'saved');
  f.call('PostCompact', post);
  const raw = readFileSync(join(shared, 'logs/nmnm-claude.jsonl'), 'utf8');
  const rows = raw.trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(row => [row.operation, row.status]), [['retain', 'ok']]);
  assert.equal(rows[0].context.session_id, null);
  assert.doesNotMatch(raw, /Automatic checkpoint|Evaluate storage|test-session|test-prompt/);
});

test('capture requires complete native event routing and never falls back across projects', async t => {
  const f = await fixture(t); f.settings({ summary: { autocapture: { enabled: true } } }, true);
  for (const input of [{ session_id: undefined }, { prompt_id: undefined }, { trigger: 'unknown' }, { cwd: '.' }]) {
    assert.equal(f.call('PreCompact', input).status, 'unavailable');
  }
  assert.equal(existsSync(f.stateRoot), false);
  const pre = f.call('PreCompact');
  const other = join(f.home, 'other'); mkdirSync(other);
  assert.equal(f.call('PostCompact', { cwd: other, compact_summary: answer(pre) }).status, 'no_pending');
  assert.equal(existsSync(join(other, '.nanomneme')), false);
  assert.equal(f.call('PostCompact', { compact_summary: answer(pre) }).status, 'saved');
});

test('a storage failure consumes the attempt without retrying or creating a later store', async t => {
  const f = await fixture(t); f.settings({ summary: { autocapture: { enabled: true } } });
  const pre = f.call('PreCompact');
  mkdirSync(f.dbPath);
  const completion = { compact_summary: answer(pre) };
  assert.equal(f.call('PostCompact', completion).status, 'unavailable');
  rmSync(f.dbPath, { recursive: true });
  assert.equal(f.call('PostCompact', completion).status, 'already_processed');
  assert.equal(existsSync(f.dbPath), false);
});
