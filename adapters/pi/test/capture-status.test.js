import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as context from '../src/context.js';

test('Pi reports native review support and preserves trust/config precedence', t => {
  assert.equal(typeof context.captureAvailability, 'function');
  const root = mkdtempSync(join(tmpdir(), 'nmnm-pi-capture-status-')), cwd = join(root, 'project'), home = join(root, 'home'), agentDir = join(home, 'agent');
  mkdirSync(join(cwd, '.nanomneme'), { recursive: true }); mkdirSync(agentDir, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const options = { cwd, home, agentDir };
  writeFileSync(join(cwd, '.nanomneme/nmnm.jsonc'), '{"summary":{"autocapture":{"enabled":true}}}');
  assert.deepEqual(context.captureAvailability(options), { enabled: true, supported: true, reason: 'Native compaction text requires trusted project and interactive review', guidance: '' });
  assert.equal(context.captureAvailability({ ...options, includeProject: false }).enabled, false);
  writeFileSync(join(agentDir, 'nmnm.jsonc'), '{"summary":{"autocapture":{"enabled":true}}}');
  writeFileSync(join(cwd, '.nanomneme/nmnm.jsonc'), '{"summary":{"autocapture":{"enabled":false}}}');
  assert.equal(context.captureAvailability(options).enabled, false);
  assert.equal(context.captureAvailability({ ...options, includeProject: false }).enabled, true);
  writeFileSync(join(cwd, '.nanomneme/nmnm.jsonc'), '{"summary":{"autocapture":{"enabled":"yes"}},"injection_budget":1200}');
  assert.equal(context.captureAvailability(options).enabled, false);
  assert.equal(context.readSettings(join(cwd, '.nanomneme/nmnm.jsonc')).injection_budget, 1200);
  assert.equal(existsSync(join(cwd, '.nanomneme/memory.db')), false);
});
