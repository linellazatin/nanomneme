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
