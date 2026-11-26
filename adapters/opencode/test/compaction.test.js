import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { open } from '@openlines/nmnm-core';
import { runBridge } from '../src/bridge-client.js';

test('capture status distinguishes configuration from native availability without creating stores', t => {
  const f = fixture(t);
  assert.match(f.call('status').status, /Summary autocapture:\s+disabled/);
  f.settings({ summary: { autocapture: { enabled: true } } });
  assert.match(f.call('status').status, /Summary autocapture:\s+enabled; requires compatible native/);
  assert.match(f.call('status', { capture_availability: { supported: false, reason: 'Live events unavailable' } }).status, /unavailable: Live events unavailable/);
  assert.equal(existsSync(f.path), false);
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-opencode-capture-')), cwd = join(root, 'project'), home = join(root, 'home');
  mkdirSync(cwd); mkdirSync(home); t.after(() => rmSync(root, { recursive: true, force: true }));
  const ctx = { cwd, home, globalDir: join(home, 'opencode') };
  const settings = (value, global = false) => { const dir = global ? ctx.globalDir : join(cwd, '.nanomneme'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'nmnm.jsonc'), JSON.stringify(value)); };
  const call = (op, values = {}) => runBridge({ op, ctx, ...values });
  return { root, ctx, settings, call, path: join(cwd, '.nanomneme/memory.db') };
}
function body(capture, changes = {}) {
  return `Native summary\nNMNM_SUMMARY_${capture.token}_BEGIN\n${JSON.stringify({ format: 'nanomneme/project-summary', format_version: 1, title: 'OpenCode checkpoint', as_of: capture.as_of, objective: 'Plan storage.', state: { status: 'in-progress', outcome: 'Design only.', verification: 'Not implemented.' }, decisions: [], open_questions: [], next_steps: ['Ask for approval.'], authorization: { allowed: [], not_authorized: ['Implement.'] }, ...changes })}\nNMNM_SUMMARY_${capture.token}_END`;
}

test('Node bridge capture is opt-in, policy-aware, bounded and project-only', t => {
  const f = fixture(t);
  assert.equal(f.call('capture_prepare').status, 'disabled');
  f.settings({ summary: { autocapture: { enabled: true } }, autoretention: { enabled: false, always_ask: ['Ask before retaining identity.'] } }, true);
  f.settings({ summary: { autocapture: { enabled: false } } });
  assert.equal(f.call('capture_prepare').status, 'disabled');
  f.settings({ summary: { autocapture: { enabled: true } } });
  const prepared = f.call('capture_prepare'); assert.equal(prepared.status, 'prepared');
  assert.match(prepared.instructions, /Ask before retaining identity/);
  assert.equal(existsSync(f.path), false);
  assert.equal(f.call('capture_complete', { capture: prepared.capture, text: 'No checkpoint.' }).status, 'skipped');
  assert.equal(f.call('capture_complete', { capture: prepared.capture, text: body(prepared.capture, { unknown: true }) }).status, 'skipped');
  assert.equal(existsSync(f.path), false);
  const result = f.call('capture_complete', { capture: prepared.capture, text: body(prepared.capture) });
  assert.equal(result.status, 'saved');
  const db = open(f.path, { create: false });
  try {
    assert.equal(db.recall({ id: result.id }).metadata.source, 'opencode');
    assert.deepEqual(db.brief().source_ids, [result.id]);
    assert.equal(f.call('capture_complete', { capture: prepared.capture, text: body(prepared.capture) }).id, result.id);
    db.removeSummary({ id: result.id });
    f.call('capture_complete', { capture: prepared.capture, text: body(prepared.capture) });
    assert.equal(db.recall({ id: result.id }), null);
  } finally { db.close(); }
  assert.equal(existsSync(join(f.ctx.home, '.local/share/nanomneme/memory.db')), false);
});

test('capture refuses policy changes, different projects and expired or malformed preparation', t => {
  const f = fixture(t); f.settings({ summary: { autocapture: { enabled: true } } });
  const { capture } = f.call('capture_prepare');
  for (const invalid of [undefined, {}, { ...capture, prepared_at: 0 }, { ...capture, token: 'bad' }, { ...capture, directory: f.root }]) {
    assert.notEqual(f.call('capture_complete', { capture: invalid, text: body(capture) }).status, 'saved');
    assert.equal(existsSync(f.path), false);
  }
  f.settings({ summary: { autocapture: { enabled: true } }, autoretention: { never_persist: ['New restriction.'] } });
  assert.notEqual(f.call('capture_complete', { capture, text: body(capture) }).status, 'saved');
  assert.equal(existsSync(f.path), false);
});

test('V1 capture waits for successful compaction and rejects ordinary text and repeated completion', async t => {
  const { createCaptureHooksV1 } = await import('../src/capture-hooks.js');
  const f = fixture(t); f.settings({ summary: { autocapture: { enabled: true } } });
  const hooks = createCaptureHooksV1(f.ctx);
  const output = { context: [] }; await hooks['experimental.session.compacting']({ sessionID: 'session' }, output);
  assert.equal(output.context.length, 1);
  const instruction = output.context[0];
  const capture = { token: instruction.match(/NMNM_SUMMARY_([0-9a-f-]+)_BEGIN/)[1], as_of: instruction.match(/"as_of":"([^"]+)"/)[1] };
  await hooks['experimental.text.complete']({ sessionID: 'session', messageID: 'ordinary' }, { text: body(capture) });
  await hooks.event({ event: { type: 'message.updated', properties: { info: { sessionID: 'session', id: 'summary', summary: true, role: 'assistant', path: { cwd: f.ctx.cwd } } } } });
  await hooks['experimental.text.complete']({ sessionID: 'session', messageID: 'summary' }, { text: body(capture) });
  assert.equal(existsSync(f.path), false);
  await hooks.event({ event: { type: 'message.updated', properties: { info: { sessionID: 'session', id: 'summary', summary: true, role: 'assistant', path: { cwd: f.ctx.cwd }, time: { completed: Date.now() }, finish: 'stop' } } } });
  const ended = { event: { type: 'session.compacted', properties: { sessionID: 'session' } } };
  await hooks.event(ended); await hooks.event(ended);
  const db = open(f.path, { create: false });
  try { assert.equal(db.retrieve({ namespace: 'project-summary' }).total, 1); } finally { db.close(); }
});

test('V2 live completion captures once and rejects failed, opaque or moved results', async t => {
  const { registerCaptureV2 } = await import('../src/capture-hooks.js');
  for (const scenario of ['valid', 'failed', 'opaque', 'moved']) {
    const f = fixture(t); f.settings({ summary: { autocapture: { enabled: true } } });
    let callback, deliver, nextRead, current = f.ctx.cwd;
    const api = { session: { hook: async (_name, handler) => { callback = handler; return { dispose() {} }; } }, event: { subscribe({ signal }) {
      signal.addEventListener('abort', () => deliver?.({ done: true }), { once: true });
      return { [Symbol.asyncIterator]() { return this; }, next() { nextRead?.(); nextRead = undefined; return new Promise(resolve => { deliver = resolve; }); } };
    } } };
    const registration = await registerCaptureV2(api, async () => ({ ...f.ctx, cwd: current }));
    assert.equal(registration.supported, true);
    const event = { sessionID: 'session', system: [] }; await callback(event);
    const instruction = event.system[0].text;
    const capture = { token: instruction.match(/NMNM_SUMMARY_([0-9a-f-]+)_BEGIN/)[1], as_of: instruction.match(/"as_of":"([^"]+)"/)[1] };
    if (scenario === 'moved') { current = join(f.root, 'other'); mkdirSync(current); }
    const complete = { type: scenario === 'failed' ? 'session.compaction.failed' : 'session.compaction.ended', location: { directory: f.ctx.cwd }, data: { sessionID: 'session', ...(scenario === 'opaque' ? { native: { encrypted: 'opaque' } } : { text: body(capture) }) } };
    const emit = async event => { const finished = new Promise(resolve => { nextRead = resolve; }); deliver({ value: event, done: false }); await finished; };
    // Earlier V2 hosts ignore the subscription type filter and deliver all live events.
    await emit({ type: 'session.inbox.delivered', data: { sessionID: 'session' } });
    await emit({ type: 'session.compaction.started', data: { sessionID: 'session' } });
    await emit(complete); await emit(complete); await registration.dispose();
    assert.equal(existsSync(f.path), scenario === 'valid');
    if (existsSync(f.path)) { const db = open(f.path, { create: false }); try { assert.equal(db.export().length, 1); } finally { db.close(); } }
  }
});

test('V2 capture reports a disconnected live stream and stops preparing instructions', async t => {
  const { registerCaptureV2 } = await import('../src/capture-hooks.js');
  const f = fixture(t); f.settings({ summary: { autocapture: { enabled: true } } });
  let callback, end;
  const api = { session: { hook: async (_name, handler) => { callback = handler; return { dispose() {} }; } }, event: {
    subscribe() { return { [Symbol.asyncIterator]() { return this; }, next() { return new Promise(resolve => { end = resolve; }); } }; },
  } };
  const registration = await registerCaptureV2(api, async () => f.ctx);
  const event = { sessionID: 'session', system: [] }; await callback(event);
  assert.equal(event.system.length, 1);
  end({ done: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(registration.supported, false);
  assert.match(registration.reason, /stream ended/);
  const later = { sessionID: 'session', system: [] }; await callback(later);
  assert.deepEqual(later.system, []);
  await registration.dispose();
  assert.equal(existsSync(f.path), false);
});
