import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBridge } from '../src/bridge-client.js';

test('Node bridge observes tool and browser mutations once without trusting model diagnostic fields', () => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-bridge-logging-'));
  const base = join(home, '.local/share/nanomneme');
  const ctx = { cwd: home, home, globalDir: join(home, 'agent') };
  try {
    mkdirSync(base, { recursive: true }); writeFileSync(join(base, 'config.jsonc'), '{"logging":{"enabled":true}}');
    const retained = runBridge({ op: 'tool', name: 'retain_memory', params: { content: 'PRIVATE', session_id: 'model-id', service: { component: 'evil' } }, ctx });
    assert.equal(retained.ok, true, retained.error);
    const id = JSON.parse(retained.text).id;
    runBridge({ op: 'index', ctx });
    runBridge({ op: 'mutate', mutation: 'pin', id, store: 'project', ctx });
    runBridge({ op: 'tool', name: 'recall_memory', params: { id }, ctx, diagnostic_context: { session_id: {} } });
    const records = readFileSync(join(base, 'logs/nmnm-opencode.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(records.map(r => [r.operation, r.status]), [['retain','ok'],['browser_pin','ok']]);
    assert.equal(records[0].context.session_id, null);
    assert.equal(records[0].service.component, 'nmnm-opencode');
    assert.equal(JSON.stringify(records).includes('PRIVATE'), false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
