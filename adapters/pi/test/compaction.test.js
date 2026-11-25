import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from '@openlines/nmnm-core';
import { getPiLogger } from '../src/logslines.js';
import { createCompactionCapture } from '../src/compaction.js';

function setup(t, changes = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-pi-capture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'project'), home = join(root, 'home'), agentDir = join(root, 'agent');
  mkdirSync(join(cwd, '.nanomneme'), { recursive: true });
  const settings = join(cwd, '.nanomneme/nmnm.jsonc');
  const configure = value => writeFileSync(settings, JSON.stringify(value));
  configure({ summary: { autocapture: { enabled: true } }, brief: { enabled: true } });
  const calls = [];
  const ctx = { cwd, hasUI: true, isProjectTrusted: () => true, ui: {
    editor: async (title, text) => { calls.push(['editor', title, text]); return text; },
    confirm: async (title, message) => { calls.push(['confirm', title, message]); return true; },
  }, ...changes };
  const options = { home, agentDir };
  const event = { type: 'session_compact', fromExtension: false, reason: 'manual', willRetry: false, compactionEntry: { id: 'native-private-id', type: 'compaction', timestamp: '2026-11-25T09:00:00.000Z', summary: 'Full native\n' + 'x'.repeat(6600), systemMessage: 'DO_NOT_STORE_THIS' } };
  const path = join(cwd, '.nanomneme/memory.db');
  return { ctx, calls, options, event, path, configure, capture: createCompactionCapture(options) };
}

test('Pi native capture reviews full text, saves project checkpoint once and suppresses replay', async t => {
  const env = setup(t);
  assert.equal((await env.capture(env.event, env.ctx)).state, 'saved');
  assert.equal(env.calls[0][2], env.event.compactionEntry.summary);
  assert.match(env.calls[1][2], /Never.*secrets/s);
  assert.equal((await env.capture(env.event, env.ctx)).state, 'duplicate');
  assert.equal(env.calls.length, 2);
  const db = open(env.path);
  try {
    const record = db.retrieve({ namespace: 'project-summary' }).items[0];
    assert.equal(record.metadata.source, 'pi');
    assert.equal(record.metadata.summary.text, env.event.compactionEntry.summary);
    assert.doesNotMatch(JSON.stringify(record), /native-private-id|DO_NOT_STORE_THIS/);
    assert.equal(db.brief().source_ids[0], record.id);
    db.removeSummary({ id: record.id });
    const reload = createCompactionCapture(env.options);
    assert.equal((await reload(env.event, env.ctx)).state, 'inactive');
    assert.equal(db.recall({ id: record.id }), null);
    assert.equal(db.retrieve().total, 0);
  } finally { db.close(); }
});

test('Pi ineligible or rejected native captures never create a database', async t => {
  const cases = [
    e => e.configure({}),
    e => { e.ctx.hasUI = false; },
    e => { e.ctx.isProjectTrusted = () => false; },
    e => { e.ctx.ui.editor = async () => undefined; },
    e => { e.ctx.ui.editor = async () => 'edited'; },
    e => { e.ctx.ui.confirm = async () => false; },
    e => { e.ctx.ui.confirm = async () => { e.configure({}); return true; }; },
    e => { e.ctx.ui.confirm = async () => { e.ctx.isProjectTrusted = () => false; return true; }; },
    e => { e.event.fromExtension = true; },
    e => { e.event.reason = 'unknown'; },
    e => { delete e.event.compactionEntry.timestamp; },
    e => { e.event.compactionEntry.summary = 'x'.repeat(9000); },
    e => { e.event.compactionEntry.summary = 'bad\x1b'; },
    e => { e.ctx.ui.confirm = async () => { throw new Error('private diagnostic'); }; },
  ];
  for (const change of cases) {
    await t.test(change.toString(), async t => {
      const env = setup(t); change(env);
      assert.notEqual((await env.capture(env.event, env.ctx)).state, 'saved');
      assert.equal(existsSync(env.path), false);
    });
  }
});

test('Pi simultaneous callbacks offer one review; changed policy invalidates approval', async t => {
  const env = setup(t);
  let release;
  env.ctx.ui.editor = async (_title, text) => { await new Promise(resolve => { release = resolve; }); return text; };
  const first = env.capture(env.event, env.ctx);
  assert.equal((await env.capture(env.event, env.ctx)).state, 'duplicate');
  env.configure({ summary: { autocapture: { enabled: true } }, autoretention: { enabled: true, never_persist: ['private beacon'] } });
  release();
  assert.equal((await first).state, 'changed');
  assert.equal(existsSync(env.path), false);
});


test('approved Pi checkpoint emits retain diagnostics without text or native identifiers', async t => {
  const env = setup(t);
  const directory = join(env.options.home, '.local/share/nanomneme');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'config.jsonc'), '{"logging":{"enabled":true}}');
  const capture = createCompactionCapture({ ...env.options, logger: getPiLogger(env.options) });
  assert.equal((await capture(env.event, env.ctx)).state, 'saved');
  assert.equal((await capture(env.event, env.ctx)).state, 'duplicate');
  const lines = readFileSync(join(directory, 'logs/nmnm-pi.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].operation, 'retain');
  assert.equal(lines[0].status, 'ok');
  assert.equal(lines[0].context.session_id, null);
  assert.doesNotMatch(JSON.stringify(lines), /Full native|native-private-id|DO_NOT_STORE_THIS/);
});
