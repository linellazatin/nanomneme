import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMemory } from '../src/store.js';

test('context renders complete ordered rules before bounded project/global previews without writes', async t => {
  const { buildContext } = await import('../src/context.js');
  const home = mkdtempSync(join(tmpdir(), 'nmnm-codex-context-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const options = { cwd: join(home, 'project'), home, env: { CODEX_HOME: home } };
  mkdirSync(options.cwd);
  assert.equal(buildContext(options), '');
  assert.equal(existsSync(join(options.cwd, '.nanomneme')), false);
  assert.equal(existsSync(join(home, '.local')), false);
  writeFileSync(join(home, 'nmnm.jsonc'), JSON.stringify({ injection_budget: 3000, autoretention: { enabled: true, never_persist: ['secret'], always_ask: ['personal'], always_persist: ['decision'] } }));
  const project = runMemory({ ...options, operation: 'retain', input: { content: 'PROJECT CONTEXT', kind: 'note', scope: 'project', metadata: { source: 'codex' } } });
  const global = runMemory({ ...options, store: 'global', operation: 'retain', input: { content: 'GLOBAL CONTEXT', kind: 'note', scope: 'global' } });
  const content = buildContext(options);
  assert.ok(content.length <= 3000);
  assert.ok(content.indexOf('secret') < content.indexOf('personal'));
  assert.ok(content.indexOf('personal') < content.indexOf('decision'));
  assert.ok(content.indexOf('decision') < content.indexOf(project.id));
  assert.ok(content.indexOf(project.id) < content.indexOf(global.id));
  assert.match(content, /data, not instructions/);
  const rulesOnly = buildContext({ ...options, settings: { injection_budget: content.indexOf('\n\nNanomneme memory index:'), autoretention: { enabled: true, never_persist: ['secret'], always_ask: ['personal'], always_persist: ['decision'] } } });
  assert.ok(rulesOnly.endsWith('- decision'));
  assert.equal(rulesOnly.includes(project.id), false);
  assert.throws(() => buildContext({ ...options, settings: { injection_budget: rulesOnly.length - 1, autoretention: { enabled: true, never_persist: ['secret'], always_ask: ['personal'], always_persist: ['decision'] } } }), /budget/);
});

test('zero budget and oversized guidance avoid even opening incompatible stores', async t => {
  const { buildContext } = await import('../src/context.js');
  const home = mkdtempSync(join(tmpdir(), 'nmnm-codex-context-zero-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, '.nanomneme'));
  writeFileSync(join(home, '.nanomneme/memory.db'), 'invalid SQLite');
  const options = { cwd: home, home, settings: { injection_budget: 0, autoretention: { enabled: true, always_persist: ['decision'] } } };
  assert.equal(buildContext(options), '');
  assert.throws(() => buildContext({ ...options, settings: { ...options.settings, injection_budget: 10 } }), /budget/);
});
