import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { open } from '@openlines/nmnm-core';
import { buildContext } from '../src/context.js';

const summary = { format: 'nanomneme/project-summary', format_version: 1, title: 'Project checkpoint', as_of: '2026-11-25T00:00:00.000Z', objective: 'Finish the local plan.', state: { status: 'in-progress', outcome: 'Design chosen.', verification: 'No deployment checked.' }, decisions: [], open_questions: [], next_steps: [], authorization: { allowed: ['Assess only.'], not_authorized: ['Deploy.'] }, references: [] };
function setup(t) {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-codex-brief-'));
  const cwd = join(home, 'project'); mkdirSync(cwd);
  const options = { cwd, home, agentDir: join(home, 'agent'), globalDir: join(home, 'adapter'), env: { CODEX_HOME: home } };
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const path = join(cwd, '.nanomneme/memory.db');
  const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)); };
  const settings = (value, user = false) => write(user ? join(home, 'nmnm.jsonc') : join(cwd, '.nanomneme/nmnm.jsonc'), value);
  const render = () => buildContext(options);
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


test('Codex startup/cadence hooks deliver briefs and paged recall recovers complete summary details', async t => {
  const { handleHook } = await import('../src/hooks.js');
  const { createMemoryOperations } = await import('../src/operations.js');
  const { options, path, settings } = setup(t);
  settings({ brief: { enabled: true }, reinjection: { enabled: true, every_n_prompts: 2 } });
  const db = open(path); let record;
  try { record = db.retainSummary({ summary: { ...summary, decisions: Array(4).fill('long evidence '.repeat(60)) } }); } finally { db.close(); }
  const payload = { cwd: options.cwd, session_id: 'synthetic-brief-session', hook_event_name: 'SessionStart' };
  const stateRoot = join(options.home, 'cadence');
  assert.match(handleHook(payload, { ...options, stateRoot }).hookSpecificOutput.additionalContext, /Nanomneme project brief:/);
  assert.deepEqual(handleHook({ ...payload, hook_event_name: 'UserPromptSubmit', turn_id: 'one' }, { ...options, stateRoot }), {});
  assert.match(handleHook({ ...payload, hook_event_name: 'UserPromptSubmit', turn_id: 'two' }, { ...options, stateRoot }).hookSpecificOutput.additionalContext, /Nanomneme project brief:/);
  const operations = createMemoryOperations(options);
  let offset = 0, json = '';
  do {
    const response = JSON.parse(operations('recall_memory', { id: record.id, content_offset: offset }).content[0].text);
    json += response.record_json;
    offset = response.next_offset;
  } while (offset !== null);
  assert.deepEqual(JSON.parse(json), record);
});


test('native Pi checkpoints render through the shared core with read-only opt-in delivery', t => {
  const { path, settings, render } = setup(t);
  const db = open(path);
  let record;
  try { record = db.retainSummary({ source: 'pi', summary: { format: 'nanomneme/native-compaction-summary', format_version: 1, title: 'Native checkpoint', as_of: '2026-11-25T09:00:00.000Z', text: 'Historical native checkpoint text.' } }); } finally { db.close(); }
  assert.equal(render().includes('Nanomneme project brief:'), false);
  settings({ brief: { enabled: true } });
  const before = readFileSync(path);
  const context = render();
  assert.match(context, /native \(unverified\)/);
  assert.match(context, /Historical native checkpoint text/);
  assert.ok(context.includes(record.id));
  assert.deepEqual(readFileSync(path), before);
});
