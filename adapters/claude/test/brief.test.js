import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { open } from '../src/core-runtime.generated.js';
import { buildMemoryIndex, settingsPath, pinsPath, writePins } from '../src/context.js';
import { renderContext } from '../src/hooks.js';

const summary = { format: 'nanomneme/project-summary', format_version: 1, title: 'Project checkpoint', as_of: '2026-11-25T00:00:00.000Z', objective: 'Finish the local plan.', state: { status: 'in-progress', outcome: 'Design chosen.', verification: 'No deployment checked.' }, decisions: [], open_questions: [], next_steps: [], authorization: { allowed: ['Assess only.'], not_authorized: ['Deploy.'] }, references: [] };
function setup(t) {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-claude-brief-'));
  const cwd = join(home, 'project'); mkdirSync(cwd);
  const options = { cwd, home, agentDir: join(home, 'agent'), globalDir: join(home, 'adapter'), env: { CODEX_HOME: home } };
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const path = join(cwd, '.nanomneme/memory.db');
  const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)); };
  const settings = (value, user = false) => write(user ? settingsPath({ ...options, store: 'global' }) : join(cwd, '.nanomneme/nmnm.jsonc'), value);
  const render = () => renderContext(buildMemoryIndex(options));
  const seed = () => { const db = open(path); try { return db.retainSummary({ summary }); } finally { db.close(); } };
  return { options, path, settings, render, seed, home, cwd };
}

test('brief is opt-in, project-only, read-only, and preserves ordinary previews', t => {
  const { path, settings, render, seed, home } = setup(t);
  const record = seed();
  const disabled = render();
  assert.equal(disabled.includes('Nanomneme project brief:'), false);
  settings({ brief: { enabled: true } });
  const before = readFileSync(path);
  const context = render();
  assert.match(context, /Nanomneme project brief: historical data/);
  assert.match(context, /No deployment checked\./);
  assert.ok(context.startsWith(disabled));
  assert.equal(context.split(record.id).length - 1, 2);
  assert.ok(context.length <= 2000);
  assert.deepEqual(readFileSync(path), before);
  const globalPath = join(home, '.local/share/nanomneme/memory.db');
  const global = open(globalPath);
  try { global.retainSummary({ summary: { ...summary, title: 'GLOBAL_PRIVATE_CHECKPOINT' } }); } finally { global.close(); }
  assert.equal(render().includes('GLOBAL_PRIVATE_CHECKPOINT'), true); // ordinary global previews remain allowed
  assert.equal(render().split('GLOBAL_PRIVATE_CHECKPOINT').length - 1, 1);
  const withGlobal = render();
  const start = withGlobal.indexOf('Nanomneme project brief:');
  assert.ok(withGlobal.indexOf('GLOBAL_PRIVATE_CHECKPOINT') < start);
  assert.equal(withGlobal.slice(start).includes('GLOBAL_PRIVATE_CHECKPOINT'), false);
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

test('optional context preserves every ordinary row that fits the budget', t => {
  const { options, path, settings, render, seed } = setup(t);
  const db = open(path);
  let pinned, recent;
  try {
    pinned = db.retain({ content: 'FIRST_ORDINARY ' + 'a'.repeat(250) });
    recent = db.retain({ content: 'SECOND_ORDINARY ' + 'b'.repeat(250) });
  } finally { db.close(); }
  writePins(pinsPath({ ...options, store: 'project' }), [pinned.id]);
  const ordinary = render();
  assert.ok(ordinary.includes(pinned.id) && ordinary.includes(recent.id));
  settings({ injection_budget: ordinary.length + 1, brief: { enabled: true } });
  assert.equal(render(), ordinary, 'an empty brief must preserve the ordinary index');

  const record = seed();
  settings({});
  const withSummary = render();
  assert.ok(withSummary.includes(record.id) && withSummary.includes(recent.id));
  settings({ injection_budget: withSummary.length + 1, brief: { enabled: true } });
  assert.equal(render(), withSummary, 'an eligible brief must not displace ordinary context');

  settings({ brief: { enabled: true } });
  const combined = render();
  assert.ok(combined.startsWith(withSummary));
  assert.match(combined, /Nanomneme project brief:/);
  assert.ok(combined.length <= 2000);
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


test('Claude startup and cadence deliver brief-only context with complete existing-tool recall', async t => {
  const { sessionStartOutput, reinjectionContext } = await import('../src/hooks.js');
  const { handleTool } = await import('../src/operations.js');
  const { options, seed, settings } = setup(t); const record = seed();
  settings({ brief: { enabled: true }, reinjection: { enabled: true, every_n_prompts: 2 } });
  assert.match(sessionStartOutput(options).hookSpecificOutput.additionalContext, /Nanomneme project brief:/);
  const first = reinjectionContext(options);
  assert.deepEqual(first.output, {});
  const second = reinjectionContext(options, first.state);
  assert.match(second.output.hookSpecificOutput.additionalContext, /Nanomneme project brief:/);
  assert.deepEqual(JSON.parse(handleTool('recall_memory', { id: record.id }, options).content[0].text), record);
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
