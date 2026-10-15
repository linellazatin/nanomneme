import test from 'node:test';
import assert from 'node:assert/strict';
import plugin, { nanomnemeTui } from '../tui.js';

function fixture(steps = []) {
  const calls = [], dialogs = [], toasts = [];
  let command, location = { directory: '/server/project' };
  const record = { store: 'project', id: 'fact', content: 'Browser fact', kind: 'fact', tags: ['test'], namespace: null, importance: 0.5, updated_at: 'today', pinned: false };
  const api = {
    get location() { return location; },
    data: { location: { default: () => location } },
    client: { rpc: () => Object.fromEntries(['status', 'browse', 'detail', 'mutate'].map(op => [op, async (input, options) => {
      calls.push({ op, input, options });
      return op === 'status' ? { ok: true, status: 'Nanomneme status\nProject: 1' }
        : op === 'browse' ? { ok: true, total: 21, items: [record] }
          : op === 'detail' ? { ok: true, record } : { ok: true, pinned: input.mutation === 'pin' };
    }])) },
    keymap: { layer: factory => { command = factory().commands[0]; assert.deepEqual(factory().bindings, ['nmnm-opencode.browser']); } },
    ui: { router: { current: () => ({ type: 'home' }) }, toast: { show: value => toasts.push(value) }, dialog: {
      set: () => {}, clear: () => {},
      select: async options => { dialogs.push(options); const step = steps.shift(); return step?.(options); },
      confirm: async options => { dialogs.push(options); return steps.shift()?.(options); },
      alert: async options => { dialogs.push(options); },
    } },
  };
  return { api, calls, dialogs, toasts, record, command: () => command, move: () => { location = { directory: '/server/other' }; } };
}
const choose = title => options => {
  const option = options.options.find(option => option.title.includes(title));
  assert.ok(option, `Missing option ${title} in ${options.title}`);
  return option.value;
};

test('dual TUI entry registers V2 promise dialogs and keeps the V1 callback', async () => {
  assert.equal(plugin.tui, nanomnemeTui);
  assert.equal(typeof plugin.setup, 'function');
  const f = fixture();
  const dispose = await plugin.setup(f.api);
  assert.equal(f.command().id, 'nmnm-opencode.browser');
  assert.equal(f.command().bind, 'ctrl+alt+m');
  assert.equal(f.command().palette, true);
  await f.command().run();
  assert.equal(f.dialogs.length, 1);
  assert.match(f.dialogs[0].title, /status/i);
  dispose();
  assert.equal(f.calls[0].options.signal.aborted, true);
  await f.command().run();
  assert.equal(f.dialogs.length, 1);
});

test('V2 browser navigates, restores selected ID, pins, and cancels removal without mutation', async () => {
  const f = fixture([choose('All'), choose('Browser fact'), choose('Pin'), choose('Remove'), () => false, choose('Back to list'), () => undefined]);
  await plugin.setup(f.api);
  await f.command().run();
  assert.deepEqual(f.calls.filter(call => call.op === 'mutate').map(call => call.input.mutation), ['pin']);
  assert.equal(f.dialogs.at(-1).current, 'record:project:fact');
  assert.equal(f.toasts[0].message, 'Pinned');
});

test('V2 browser cycles sources, pages, and confirms soft removal', async () => {
  const f = fixture([choose('All'), choose('Source:'), choose('Next page'), choose('Previous page'), choose('Browser fact'), choose('Remove'), () => true, () => undefined]);
  await plugin.setup(f.api);
  await f.command().run();
  const pages = f.calls.filter(call => call.op === 'browse').map(call => call.input);
  assert.deepEqual(pages.map(page => [page.source, page.offset, page.limit]), [['all', 0, 20], ['opencode', 0, 20], ['opencode', 20, 20], ['opencode', 0, 20], ['opencode', 0, 20]]);
  assert.deepEqual(f.calls.find(call => call.op === 'mutate').input, { store: 'project', id: 'fact', mutation: 'remove' });
});

test('V2 browser rejects a changed location before confirming a selected mutation', async () => {
  const f = fixture([choose('All'), choose('Browser fact'), choose('Remove'), () => { f.move(); return true; }]);
  await plugin.setup(f.api);
  await f.command().run();
  assert.equal(f.calls.filter(call => call.op === 'mutate').length, 0);
  assert.match(f.dialogs.at(-1).message, /location changed/i);
});

test('V2 browser surfaces missing RPC once without retry or dialog reopen', async () => {
  const f = fixture();
  f.api.client.rpc = () => ({ status: async () => { throw new Error('Server plugin unavailable'); } });
  await plugin.setup(f.api);
  await f.command().run();
  assert.equal(f.dialogs.length, 1);
  assert.match(f.dialogs[0].message, /Server plugin unavailable/);
});

test('V2 browser ignores a second hotkey and never mutates after disposal during confirmation', async () => {
  let resolveConfirmation;
  const f = fixture([choose('All'), choose('Browser fact'), choose('Remove')]);
  f.api.ui.dialog.confirm = () => new Promise(resolve => { resolveConfirmation = resolve; });
  const dispose = await plugin.setup(f.api);
  const running = f.command().run();
  while (!resolveConfirmation) await Promise.resolve();
  await f.command().run();
  assert.equal(f.dialogs.length, 3);
  dispose();
  resolveConfirmation(true);
  await running;
  assert.equal(f.calls.filter(call => call.op === 'mutate').length, 0);
});

test('V2 detail uses the server record and cancellation exits without reopening', async () => {
  const f = fixture([choose('All'), choose('Browser fact'), choose('View detail'), choose('Back'), () => undefined]);
  await plugin.setup(f.api);
  await f.command().run();
  assert.equal(f.calls.filter(call => call.op === 'detail').length, 1);
  assert.ok(f.dialogs[3].options.some(option => option.title === 'Tags        test'));
  assert.equal(f.dialogs.length, 5);
});
