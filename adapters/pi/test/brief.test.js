import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { open } from '@openlines/nmnm-core';
import { buildMemoryIndex, settingsPath, pinsPath, writePins } from '../src/context.js';

const summary = { format: 'nanomneme/project-summary', format_version: 1, title: 'Project checkpoint', as_of: '2026-11-25T00:00:00.000Z', objective: 'Finish the local plan.', state: { status: 'in-progress', outcome: 'Design chosen.', verification: 'No deployment checked.' }, decisions: [], open_questions: [], next_steps: [], authorization: { allowed: ['Assess only.'], not_authorized: ['Deploy.'] }, references: [] };
function setup(t) {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-pi-brief-'));
  const cwd = join(home, 'project'); mkdirSync(cwd);
  const options = { cwd, home, agentDir: join(home, 'agent'), globalDir: join(home, 'adapter'), env: { CODEX_HOME: home } };
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const path = join(cwd, '.nanomneme/memory.db');
  const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)); };
  const settings = (value, user = false) => write(user ? settingsPath({ ...options, store: 'global' }) : join(cwd, '.nanomneme/nmnm.jsonc'), value);
  const render = () => (() => { const index = buildMemoryIndex(options); return [index.autoretention, (index.total || index.brief) ? index.content.trimEnd() : ''].filter(Boolean).join('\n\n'); })();
  const seed = () => { const db = open(path); try { return db.retainSummary({ summary }); } finally { db.close(); } };
  return { options, path, settings, render, seed, home, cwd };
}

test('brief is opt-in, project-only, read-only, and suppresses only emitted recent previews', t => {
  const { path, settings, render, seed, home } = setup(t);
  const record = seed();
  const disabled = render();
  assert.equal(disabled.includes('Nanomneme project brief:'), false);
  settings({ brief: { enabled: true } });
  const before = readFileSync(path);
  const context = render();
  assert.match(context, /Nanomneme project brief: historical data/);
  assert.match(context, /No deployment checked\./);
  assert.equal(context.split(record.id).length - 1, 1);
  assert.ok(context.length <= 2000);
  assert.deepEqual(readFileSync(path), before);
  const globalPath = join(home, '.local/share/nanomneme/memory.db');
  const global = open(globalPath);
  try { global.retainSummary({ summary: { ...summary, title: 'GLOBAL_PRIVATE_CHECKPOINT' } }); } finally { global.close(); }
  assert.equal(render().includes('GLOBAL_PRIVATE_CHECKPOINT'), true); // ordinary global previews remain allowed
  assert.equal(render().split('GLOBAL_PRIVATE_CHECKPOINT').length - 1, 1);
  const withGlobal = render();
  const start = withGlobal.indexOf('Nanomneme project brief:');
  const end = withGlobal.indexOf('Nanomneme memory index:', start);
  assert.equal(withGlobal.slice(start, end).includes('GLOBAL_PRIVATE_CHECKPOINT'), false);
  settings({ brief: { enabled: false } });
  assert.equal(render().includes('Nanomneme project brief:'), false);
});

test('user enablement inherits, project false and malformed brief-only settings disable without losing ordinary context', t => {
  const { settings, render, seed, path } = setup(t); seed();
  const db = open(path); try { db.retain({ content: 'ORDINARY_KEEP' }); } finally { db.close(); }
  settings({ brief: { enabled: true } }, true);
  assert.match(render(), /Nanomneme project brief:/);
  for (const brief of [{ enabled: false }, { enabled: 'yes' }, null, [], { unexpected: true }]) {
    settings({ brief });
    const context = render();
    assert.equal(context.includes('Nanomneme project brief:'), false);
    assert.match(context, /ORDINARY_KEEP/);
  }
});

test('enabled briefs leave absent project stores absent and obey zero/tight budgets', t => {
  const { settings, render, seed, options, cwd } = setup(t);
  settings({ brief: { enabled: true } }, true);
  assert.equal(render(), '');
  assert.equal(existsSync(join(cwd, '.nanomneme')), false);
  seed();
  for (const budget of [0, 1, 100, 400, 800, 1000, 2000]) {
    settings({ injection_budget: budget, brief: { enabled: true } });
    const content = render();
    assert.ok(content.length <= budget, `${budget}: ${content.length}`);
    assert.equal(content.isWellFormed(), true);
  }
  assert.equal(buildMemoryIndex({ ...options, includeProject: false }).content.includes('Nanomneme project brief:'), false);
});

test('brief-only query failure and inconsistent summaries preserve ordinary context', t => {
  const { seed, settings, path, render } = setup(t); const record = seed();
  const db = open(path); try { db.retain({ content: 'KEEP_ON_FAILURE' }); } finally { db.close(); }
  settings({ brief: { enabled: true } });
  const prepare = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, 'prepare', function(sql) {
    if (sql.includes("'$.summary.as_of'")) throw new Error('Synthetic brief failure');
    return prepare.call(this, sql);
  });
  assert.match(render(), /KEEP_ON_FAILURE/);
  assert.equal(render().includes('Nanomneme project brief:'), false);
  t.mock.restoreAll();
  const writer = open(path); try { writer.retain({ id: record.id, content: 'GENERIC_EDIT_KEEP' }); } finally { writer.close(); }
  assert.match(render(), /GENERIC_EDIT_KEEP/);
});

test('rules and pins keep priority; a pinned summary may also have detailed brief context', t => {
  const { seed, settings, path, options, render } = setup(t); const record = seed();
  const db = open(path); let pinned;
  try { pinned = db.retain({ content: 'PIN_FIRST' }); } finally { db.close(); }
  writePins(pinsPath({ ...options, store: 'project' }), [pinned.id]);
  settings({ brief: { enabled: true }, autoretention: { enabled: true, always_ask: ['RULE_FIRST'] } });
  const context = render();
  assert.ok(context.indexOf('RULE_FIRST') < context.indexOf(pinned.id));
  assert.ok(context.indexOf(pinned.id) < context.indexOf('Nanomneme project brief:'));
  assert.ok(context.length <= 2000);
  writePins(pinsPath({ ...options, store: 'project' }), [record.id]);
  assert.equal(render().split(record.id).length - 1, 2);
});


test('Pi loaded host registry delivers brief-only context after startup and compaction', async t => {
  const { loadPiAdapter } = await import('./host-helper.js');
  const host = await loadPiAdapter(t, { projectSettings: { brief: { enabled: true } } });
  const db = open(join(host.cwd, '.nanomneme/memory.db')); let record;
  try { record = db.retainSummary({ summary }); } finally { db.close(); }
  const extension = host.loaded.extensions[0];
  const ctx = { cwd: host.cwd, isProjectTrusted: () => true, sessionManager: { getSessionId: () => 'brief-host' }, ui: { notify() {} } };
  for (const handler of extension.handlers.get('session_start')) handler({}, ctx);
  const before = extension.handlers.get('before_agent_start')[0];
  assert.match((await before({ messageType: 'user', systemPrompt: 'Base' }, ctx)).systemPrompt, /Nanomneme project brief:/);
  const detail = await extension.tools.get('recall_memory').definition.execute('call', { id: record.id }, undefined, undefined, ctx);
  assert.deepEqual(JSON.parse(detail.content[0].text), record);
  assert.equal(await before({ messageType: 'user', systemPrompt: 'Base' }, ctx), undefined);
  for (const handler of extension.handlers.get('session_compact')) handler({}, ctx);
  assert.match((await before({ messageType: 'user', systemPrompt: 'Base' }, ctx)).systemPrompt, /Nanomneme project brief:/);
});
