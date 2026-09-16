import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanomnemeTui } from '../tui.js';
import { runBridge } from '../src/bridge-client.js';

function temp(name) {
  return mkdtempSync(join(tmpdir(), name));
}

// Records every dialog the plugin renders and lets a test drive the latest selection directly.
function harness() {
  const renders = [];
  const sizes = [];
  const api = {
    state: { path: { directory: null } },
    keymap: { registerLayer: (layer) => { api.__layer = layer; return () => { api.__disposed = true; }; } },
    lifecycle: { onDispose: (fn) => { api.__dispose = fn; } },
    ui: {
      toast: (t) => renders.push({ kind: 'toast', ...t }),
      dialog: { setSize: (size) => sizes.push(size), replace: (render) => renders.push(render()) },
      DialogSelect: (props) => ({ kind: 'select', props }),
      DialogAlert: (props) => ({ kind: 'alert', props }),
      DialogConfirm: (props) => ({ kind: 'confirm', props }),
    },
  };
  const last = () => renders[renders.length - 1];
  const selectOption = (titleFragment) => last().props.options.find((o) => o.title.includes(titleFragment));
  const choose = (opt) => last().props.onSelect(opt);
  return { api, renders, sizes, last, selectOption, choose };
}

async function open(t) {
  const project = temp('nmnm-opencode-tui-project-');
  const home = temp('nmnm-opencode-tui-home-');
  t.after(() => { rmSync(project, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });
  const h = harness();
  h.api.state.path.directory = project;
  h.ctx = { cwd: project, home, platform: 'darwin' };
  // The plugin resolves `home` via os.homedir() inside the bridge host, so isolate HOME too.
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  t.after(() => { process.env.HOME = previousHome; });
  await nanomnemeTui(h.api);
  return { ...h, project, home, ctx: h.ctx, seed: (content, extra = {}) => JSON.parse(runBridge({ op: 'tool', name: 'retain_memory', params: { content, ...extra }, ctx: h.ctx }).text) };
}

test('the tui registers one memory command bound to ctrl+alt+m', async (t) => {
  const { api } = await open(t);
  const command = api.__layer.commands[0];
  assert.equal(command.name, 'nmnm-opencode.browser');
  assert.equal(api.__layer.bindings[0].key, 'ctrl+alt+m');
  assert.equal(typeof command.run, 'function');
});

test('the tui browser opens on Status and exposes tab navigation', async (t) => {
  const { api, last, selectOption, choose } = await open(t);
  api.__layer.commands[0].run();
  assert.equal(last().kind, 'select');
  assert.match(last().props.title, /Nanomneme status/i);
  const allRow = selectOption('All');
  assert.ok(allRow);
  choose(allRow);
  assert.match(last().props.title, /^All/);
});

test('list tab renders memories without ids and flags pinned rows with an asterisk', async (t) => {
  const { api, ctx, seed, last, selectOption, choose } = await open(t);
  const memory = seed('project alpha fact');
  runBridge({ op: 'mutate', ctx, store: 'project', id: memory.id, mutation: 'pin' });
  seed('project beta note');
  const records = () => last().props.options.filter((o) => o.value?.record);
  api.__layer.commands[0].run();
  choose(selectOption('All'));
  const rows = records();
  assert.equal(rows.length, 2);
  // Same-millisecond writes can reorder; assert set membership, not order.
  assert.ok(rows.some((r) => r.title === '* [project] project alpha fact'));
  assert.ok(rows.some((r) => r.title === '[project] project beta note'));
  assert.ok(!rows.some((r) => r.title.includes(memory.id)));
});

test('viewing a memory exposes pin, soft-remove (confirmed), and back without leaving the browser', async (t) => {
  const { api, ctx, renders, seed, last, selectOption, choose } = await open(t);
  const memory = seed('viewable record');
  api.__layer.commands[0].run();
  choose(selectOption('All'));
  choose(last().props.options.find((o) => o.value?.record));
  assert.equal(last().props.title, 'Nanomneme [project] note');
  assert.ok(['View detail', 'Pin', 'Remove (soft)', 'Back to list'].every((title) => selectOption(title)));
  choose(selectOption('Pin'));
  assert.equal(last().props.title, '* Nanomneme [project] note');
  assert.ok(renders.some((r) => r.kind === 'toast' && r.message === 'Pinned'));
  assert.equal(JSON.parse(runBridge({ op: 'tool', name: 'recall_memory', params: { id: memory.id, store: 'project' }, ctx }).text).content, 'viewable record');
  choose(selectOption('Remove (soft)'));
  assert.equal(last().kind, 'confirm');
  last().props.onConfirm();
  assert.ok(renders.some((r) => r.kind === 'toast' && r.message === 'Memory soft-removed'));
  assert.match(last().props.title, /^All/);
  assert.deepEqual(runBridge({ op: 'browse', store: 'project', ctx }).items, []);
});

test('detail view shows selected fields, then returns to the memory action menu', async (t) => {
  const { api, seed, last, selectOption, choose } = await open(t);
  seed('detailed content', { tags: ['x', 'y'], namespace: 'memory', kind: 'decision', importance: 0.8 });
  api.__layer.commands[0].run();
  choose(selectOption('All'));
  choose(selectOption('Project'));
  choose(last().props.options.find((o) => o.value?.record));
  choose(selectOption('View detail'));
  assert.equal(last().kind, 'select');
  assert.equal(last().props.title, 'Nanomneme [project] detail');
  const titles = last().props.options.map((o) => o.title);
  assert.ok(titles.some((title) => title === 'Tags        x, y'));
  assert.ok(titles.some((title) => title === 'Namespace   memory'));
  assert.ok(titles.some((title) => title === 'Kind        decision'));
  assert.ok(titles.some((title) => title === 'Importance  0.8'));
  assert.ok(titles.some((title) => title.startsWith('Updated     ')));
  assert.ok(!titles.some((title) => title.startsWith('Content')));
  choose(selectOption('Back'));
  assert.equal(last().props.title, 'Nanomneme [project] decision');
  assert.ok(selectOption('View detail'));
});

test('source cycling narrows the browser to opencode-authored memories', async (t) => {
  const { api, ctx, seed, last, selectOption, choose } = await open(t);
  seed('from opencode');
  runBridge({ op: 'tool', name: 'retain_memory', params: { content: 'from elsewhere' }, ctx });
  // Force a non-opencode provenance so source cycling is meaningful.
  const foreign = JSON.parse(runBridge({ op: 'tool', name: 'retrieve_memory', params: { query: 'elsewhere' }, ctx }).text).items[0];
  runBridge({ op: 'tool', name: 'retain_memory', params: { id: foreign.id, metadata: { source: 'pi' } }, ctx });
  const records = () => last().props.options.filter((o) => o.value?.record).length;
  api.__layer.commands[0].run();
  choose(selectOption('All'));
  assert.equal(records(), 2);
  assert.ok(!/source:/.test(last().props.title)); // 'all' is the default and unlabeled
  choose(selectOption('Source: all'));
  assert.equal(records(), 1);
  assert.match(last().props.title, /source: opencode/);
});

test('the browser opens at xlarge width so long rows are not clipped', async (t) => {
  const { api, sizes } = await open(t);
  api.__layer.commands[0].run();
  assert.ok(sizes.includes('xlarge'));
});

test('detail view omits content because it is already visible in the list', async (t) => {
  const { api, seed, last, selectOption, choose } = await open(t);
  seed('long content', { tags: ['long'] });
  api.__layer.commands[0].run();
  choose(selectOption('All'));
  choose(last().props.options.find((o) => o.value?.record));
  choose(selectOption('View detail'));
  const titles = last().props.options.map((o) => o.title);
  assert.ok(!titles.some((title) => title.startsWith('Content')));
});

test('returning to the list restores the highlight on the last-selected record', async (t) => {
  const { api, seed, last, selectOption, choose } = await open(t);
  seed('alpha one');
  seed('beta two');
  api.__layer.commands[0].run();
  choose(selectOption('All'));
  const target = last().props.options.find((o) => o.value?.record?.content.startsWith('beta'));
  assert.ok(target);
  choose(target);
  assert.equal(last().props.title, 'Nanomneme [project] note');
  choose(selectOption('Back to list'));
  assert.equal(last().props.current, target);
});

test('the highlight resets when switching tabs', async (t) => {
  const { api, seed, last, selectOption, choose } = await open(t);
  seed('alpha one');
  api.__layer.commands[0].run();
  choose(selectOption('All'));
  const target = last().props.options.find((o) => o.value?.record);
  choose(target);
  choose(selectOption('Back to list'));
  assert.equal(last().props.current, target);
  choose(selectOption('Project'));
  assert.equal(last().props.current, undefined);
});
