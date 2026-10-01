import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleRequest } from '../src/runner.js';
import { buildMemoryIndex } from '../src/context.js';

test('Codex explicit operations inherit and override while context reads remain unlogged', () => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-codex-logging-'));
  const base = join(home, '.local/share/nanomneme');
  const agent = join(home, 'agent');
  const ctx = { cwd: home, home, env: { CODEX_HOME: agent } };
  try {
    mkdirSync(base, { recursive: true }); mkdirSync(agent);
    writeFileSync(join(base, 'config.jsonc'), '{"logging":{"enabled":true}}');
    handleRequest({ operation: 'retrieve', input: {}, session_id: 'untrusted' }, ctx);
    const memory = handleRequest({ operation: 'retain', input: { content: 'PRIVATE' } }, ctx);
    buildMemoryIndex(ctx);
    const path = join(base, 'logs/nmnm-codex.jsonl');
    let records = readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(records.map(r => [r.operation,r.status]), [['retrieve','empty'],['retain','ok']]);
    assert.equal(records[0].context.session_id, null);
    assert.equal(JSON.stringify(records).includes(memory.id), false);
    assert.equal(JSON.stringify(records).includes('PRIVATE'), false);
    writeFileSync(join(agent, 'nmnm.jsonc'), '{"logging":{"enabled":false}}');
    handleRequest({ operation: 'retrieve', input: {} }, ctx);
    assert.equal(readFileSync(path, 'utf8').trim().split('\n').length, 2);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('Codex records host correlation with precedence and fallback instead of request fields', () => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-codex-correlation-'));
  const base = join(home, '.local/share/nanomneme');
  const cases = [
    [{ CODEX_THREAD_ID: 'host-thread', CODEX_SESSION_ID: 'host-session' }, 'host-thread'],
    [{ CODEX_SESSION_ID: 'host-session' }, 'host-session'],
    [{ CODEX_THREAD_ID: ' \t', CODEX_SESSION_ID: 'fallback-session' }, 'fallback-session'],
    [{ CODEX_THREAD_ID: 123, CODEX_SESSION_ID: 'fallback-session' }, 'fallback-session'],
    [{ CODEX_THREAD_ID: 'opaque host value' }, 'opaque host value'],
    [{ CODEX_THREAD_ID: '', CODEX_SESSION_ID: ' ' }, null],
    [{}, null],
    [{ get CODEX_THREAD_ID() { throw new Error('private host failure'); } }, null],
  ];
  try {
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'config.jsonc'), '{"logging":{"enabled":true}}');
    for (const [host] of cases) {
      const env = Object.defineProperties({ CODEX_HOME: join(home, 'agent') }, Object.getOwnPropertyDescriptors(host));
      const result = handleRequest({ operation: 'retrieve', input: {}, session_id: 'request-spoof',
        context: { session_id: 'nested-request-spoof' } }, { cwd: home, home, env });
      assert.deepEqual(result, { total: 0, items: [] });
    }
    const records = readFileSync(join(base, 'logs/nmnm-codex.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(records.map(record => record.context.session_id), cases.map(([, expected]) => expected));
    assert.equal(JSON.stringify(records).includes('request-spoof'), false);
    assert.equal(JSON.stringify(records).includes('private host failure'), false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
