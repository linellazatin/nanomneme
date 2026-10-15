import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import plugin, { NanomnemePlugin } from '../index.js';
import { runBridge } from '../src/bridge-client.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-browser-rpc-'));
  const home = join(root, 'server-home');
  const project = join(root, 'project');
  mkdirSync(home);
  mkdirSync(project);
  const previous = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = join(home, '.config');
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  const ctx = { cwd: project, home, platform: process.platform };
  const seed = content => {
    const result = runBridge({ op: 'tool', name: 'retain_memory', params: { content }, ctx });
    assert.equal(result.ok, true);
    return JSON.parse(result.text);
  };
  let definition, handlers, disposed = 0;
  const api = {
    location: { directory: project },
    session: { hook: async () => ({ dispose: async () => {} }) },
    tool: { transform: async () => ({ dispose: async () => {} }) },
    rpc: { register: async (contract, implementation) => {
      definition = contract;
      handlers = implementation;
      return { dispose: async () => { disposed++; } };
    } },
  };
  return { root, home, project, ctx, api, seed, get definition() { return definition; }, get handlers() { return handlers; }, get disposed() { return disposed; } };
}

const callContext = () => ({ signal: new AbortController().signal });

test('dual server entry retains V1 callback and skips its limited setup context', async () => {
  assert.equal(plugin.server, NanomnemePlugin);
  assert.equal(typeof plugin.setup, 'function');
  assert.equal(await plugin.setup({ options: {}, agent: {}, command: {} }), undefined);
});

test('V2 browser RPC registers only the four management methods and disposes registration', async t => {
  const f = fixture(t);
  const cleanup = await plugin.setup(f.api);
  assert.equal(f.definition.id, 'nmnm-opencode.browser');
  assert.deepEqual(Object.keys(f.handlers).sort(), ['browse', 'detail', 'mutate', 'status']);
  assert.deepEqual(Object.keys(f.definition.methods).sort(), ['browse', 'detail', 'mutate', 'status']);
  await cleanup();
  assert.equal(f.disposed, 1);
});

test('RPC uses server-owned project/home and cannot accept bridge or diagnostic overrides', async t => {
  const f = fixture(t);
  await plugin.setup(f.api);
  const record = f.seed('server-owned fact');
  const wrong = join(f.root, 'terminal-project');
  mkdirSync(wrong);
  const page = await f.handlers.browse({ store: 'project', ctx: { cwd: wrong, home: wrong }, op: 'tool', name: 'retain_memory', diagnostic_context: { session_id: 'untrusted' } }, callContext());
  assert.equal(page.ok, true);
  assert.deepEqual(page.items.map(item => item.id), [record.id]);
  assert.equal(existsSync(join(wrong, '.nanomneme')), false);
  assert.equal(existsSync(join(wrong, '.local')), false);
});

test('RPC preserves detail, pin/unpin, soft removal, and missing-store noncreation', async t => {
  const f = fixture(t);
  await plugin.setup(f.api);
  assert.equal((await f.handlers.status({}, callContext())).ok, true);
  assert.equal(existsSync(join(f.project, '.nanomneme')), false);
  const memory = f.seed('removable fact');
  const target = { store: 'project', id: memory.id };
  assert.equal((await f.handlers.detail(target, callContext())).record.content, 'removable fact');
  assert.equal((await f.handlers.mutate({ ...target, mutation: 'pin' }, callContext())).pinned, true);
  assert.equal((await f.handlers.mutate({ ...target, mutation: 'unpin' }, callContext())).pinned, false);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.handlers.mutate({ ...target, mutation: 'remove' }, { signal: controller.signal }));
  assert.equal((await f.handlers.browse({ store: 'project' }, callContext())).total, 1);
  assert.equal((await f.handlers.mutate({ ...target, mutation: 'remove' }, callContext())).removed, true);
  assert.equal((await f.handlers.browse({ store: 'project' }, callContext())).total, 0);
  assert.equal(existsSync(join(f.home, '.local/share/nanomneme/memory.db')), false);
});

test('RPC refuses an absent or relative server location instead of using process cwd', async t => {
  const f = fixture(t);
  for (const location of [undefined, {}, { directory: '.' }]) {
    await assert.rejects(plugin.setup({ ...f.api, location }), /location|directory/i);
  }
});

test('RPC mutations cannot accept caller-supplied diagnostic correlation', async t => {
  const f = fixture(t);
  const base = join(f.home, '.local/share/nanomneme');
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, 'config.jsonc'), '{"logging":{"enabled":true}}');
  await plugin.setup(f.api);
  const memory = f.seed('diagnostic fact');
  await f.handlers.mutate({ store: 'project', id: memory.id, mutation: 'pin', diagnostic_context: { session_id: 'untrusted' } }, callContext());
  const records = readFileSync(join(base, 'logs/nmnm-opencode.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const record = records.find(item => item.operation === 'browser_pin');
  assert.ok(record);
  assert.equal(record.context.session_id, null);
});
