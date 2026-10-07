import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPiLogger, piSessionId } from '../src/logslines.js';

test('Pi inherits shared JSONC, overrides explicitly, and reloads lazy settings', () => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-pi-logging-'));
  const agentDir = join(home, 'agent');
  const base = join(home, '.local/share/nanomneme');
  const path = join(base, 'logs/nmnm-pi.jsonl');
  try {
    mkdirSync(base, { recursive: true }); mkdirSync(agentDir);
    const first = getPiLogger({ home, agentDir });
    assert.equal(existsSync(path), false);
    writeFileSync(join(base, 'config.jsonc'), '{"logging":{"enabled":true}}');
    first.run({ operation: 'retain', session_id: 'host-1' }, () => ({}));
    writeFileSync(join(agentDir, 'nmnm.jsonc'), '{"logging":{"enabled":false}}');
    first.run({ operation: 'retain', session_id: 'host-2' }, () => ({}));
    getPiLogger({ home, agentDir }).run({ operation: 'retain' }, () => ({}));
    const records = readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(records.map(r => r.context.session_id), ['host-1', 'host-2']);
    assert.equal(records[0].service.component, 'nmnm-pi');
    writeFileSync(join(base, 'config.jsonc'), 'bad');
    writeFileSync(join(agentDir, 'nmnm.jsonc'), '{"logging":{"enabled":true}}');
    getPiLogger({ home, agentDir }).run({ operation: 'retain' }, () => ({}));
    assert.equal(readFileSync(path, 'utf8').trim().split('\n').length, 2);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('Pi session normalization contains host errors and changes per action', () => {
  assert.equal(piSessionId({ sessionManager: { getSessionId: () => 'host' } }), 'host');
  assert.equal(piSessionId({ sessionManager: { getSessionId: () => { throw Error('private'); } } }), null);
  assert.equal(piSessionId({}), null);
});
