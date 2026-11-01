import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryOperations } from '../src/operations.js';

function setup(t, global, override) {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-mcp-logs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = join(root, '.local/share/nanomneme'); mkdirSync(config, { recursive: true });
  const codex = join(root, 'codex'); mkdirSync(codex);
  if (global !== undefined) writeFileSync(join(config, 'config.jsonc'), global);
  if (override !== undefined) writeFileSync(join(codex, 'nmnm.jsonc'), override);
  const context = { cwd: root, home: root, env: { CODEX_HOME: codex, CODEX_THREAD_ID: 'trusted-thread' } };
  return { root, config, codex, context, path: join(config, 'logs/nmnm-codex.jsonl') };
}

test('MCP observes canonical outcomes once and freezes logging at first operation', t => {
  const f = setup(t, '{"logging":{"enabled":true}}');
  const call = createMemoryOperations(f.context);
  const decode = r => JSON.parse(r.content[0].text);
  call('retrieve_memory', {});
  const { id } = decode(call('retain_memory', { content: 'PRIVATE_MEMORY' }));
  call('recall_memory', { id });
  call('remove_memory', { id });
  call('recall_memory', { id });
  call('retain_memory', { content: '', session_id: 'spoof' });
  writeFileSync(join(f.codex, 'nmnm.jsonc'), '{"logging":{"enabled":false}}');
  call('retrieve_memory', {});
  const records = readFileSync(f.path, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.map(r => [r.operation, r.status]), [['retrieve','empty'],['retain','ok'],['recall','ok'],['remove','ok'],['recall','not_found'],['retain','failed'],['retrieve','empty']]);
  assert.ok(records.every(r => r.context.session_id === 'trusted-thread' && r.service.component === 'nmnm-codex'));
  assert.equal(JSON.stringify(records).includes('PRIVATE_MEMORY'), false);
  assert.equal(JSON.stringify(records).includes(id), false);
  createMemoryOperations(f.context)('retrieve_memory', {});
  assert.equal(readFileSync(f.path, 'utf8').trim().split('\n').length, 7);
});

test('default-off, user override, invalid settings and failed sinks preserve operations', t => {
  for (const [global, override, enabled] of [
    [undefined, undefined, false], ['{"logging":{"enabled":true}}', '{"logging":{"enabled":false}}', false],
    ['{"logging":{"enabled":false}}', '{"logging":{"enabled":true}}', true],
    ['{"logging":{"enabled":true}}', '{broken', false],
  ]) {
    const f = setup(t, global, override);
    const response = createMemoryOperations({ ...f.context, env: { CODEX_HOME: f.codex } })('retain_memory', { content: 'works' });
    assert.notEqual(response.isError, true);
    assert.equal(existsSync(f.path), enabled);
    if (enabled) assert.equal(JSON.parse(readFileSync(f.path, 'utf8')).context.session_id, null);
  }
  const f = setup(t, '{"logging":{"enabled":true}}');
  writeFileSync(join(f.config, 'logs'), 'not a directory');
  const response = createMemoryOperations(f.context)('retain_memory', { content: 'write survives failed log sink' });
  assert.notEqual(response.isError, true);
});
