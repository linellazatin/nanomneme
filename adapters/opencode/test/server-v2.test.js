import test from 'node:test';
import assert from 'node:assert/strict';
import plugin from '../index.js';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-server-v2-'));
  const home = join(root, 'home');
  const project = join(root, 'project');
  const other = join(root, 'worktree');
  for (const path of [home, project, other]) mkdirSync(path);
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
  const tools = {};
  const hooks = {};
  const sessions = new Map([['parent', { location: { directory: project } }], ['child', { location: { directory: other } }]]);
  const dispose = async () => {};
  const cleanup = await plugin.setup({
    location: { directory: home },
    tool: { transform: async callback => { callback({ add: tool => { tools[tool.name] = tool; } }); return { dispose }; } },
    session: { get: async ({ sessionID }) => sessions.get(sessionID), hook: async (name, callback) => { hooks[name] = callback; return { dispose }; } },
    rpc: { register: async () => ({ dispose }) },
  });
  t.after(cleanup);
  const call = async (name, input, sessionID = 'parent', signal = new AbortController().signal) => {
    const result = await tools[name].execute(input, { sessionID, signal });
    return JSON.parse(result.content);
  };
  const context = async (sessionID = 'parent') => {
    const event = { sessionID, system: [{ type: 'text', text: 'Base instructions' }], messages: [{ role: 'user', content: 'Original' }] };
    await hooks.context(event);
    assert.deepEqual(event.messages, [{ role: 'user', content: 'Original' }]);
    return event.system;
  };
  return { root, home, project, other, sessions, tools, hooks, call, context };
}

test('V2 setup registers four replay-safe tools, primary context, and disposes all registrations', async () => {
  let transform;
  const hooks = new Map();
  const disposed = [];
  const registration = name => ({ dispose: async () => { disposed.push(name); } });
  const cleanup = await plugin.setup({
    location: { directory: '/unused-plugin-location' },
    tool: { transform: async callback => { transform = callback; return registration('tools'); } },
    session: { hook: async (name, callback) => { hooks.set(name, callback); return registration(name); } },
    rpc: { register: async () => registration('rpc') },
  });
  assert.equal(typeof transform, 'function');
  const tools = [];
  assert.equal(transform({ add: tool => tools.push(tool) }), undefined);
  assert.deepEqual(tools.map(tool => tool.name), ['retain_memory', 'recall_memory', 'retrieve_memory', 'remove_memory']);
  const replay = [];
  transform({ add: tool => replay.push(tool) });
  assert.deepEqual(replay.map(tool => tool.name), tools.map(tool => tool.name));
  assert.deepEqual([...hooks.keys()], ['context']);
  assert.deepEqual(tools[1].input.required, ['id']);
  assert.deepEqual(tools[0].input.properties.expires_at.type, ['string', 'null']);
  await cleanup();
  assert.deepEqual(disposed.sort(), ['context', 'rpc', 'tools']);
});

test('V2 tools preserve 4Rs, source, restore, range filters, scope selection and noncreating reads', async t => {
  const f = await fixture(t);
  assert.equal(await f.call('recall_memory', { id: 'missing' }), null);
  assert.deepEqual(await f.call('retrieve_memory', {}), { total: 0, items: [] });
  assert.equal(await f.call('remove_memory', { id: 'missing' }), null);
  assert.equal(existsSync(join(f.project, '.nanomneme')), false);
  await assert.rejects(f.call('retain_memory', { content: 'bad', scope: 'invalid' }), /scope must be/);
  assert.equal(existsSync(join(f.project, '.nanomneme')), false);
  const retained = await f.call('retain_memory', { content: 'V2 durable fact', importance: 0.8, expires_at: null });
  assert.equal(retained.metadata.source, 'opencode');
  assert.equal((await f.call('recall_memory', { id: retained.id })).content, retained.content);
  assert.equal((await f.call('retrieve_memory', { importance: { gte: 0.7 } })).total, 1);
  await f.call('remove_memory', { id: retained.id });
  assert.equal(await f.call('recall_memory', { id: retained.id }), null);
  assert.equal((await f.call('retain_memory', { id: retained.id, content: 'restored' })).content, 'restored');
  const global = await f.call('retain_memory', { content: 'Global fact', scope: ' global ' });
  assert.equal((await f.call('recall_memory', { id: global.id, store: 'global' }, 'child')).content, 'Global fact');
});

test('V2 tools resolve every session call, including child locations and session moves, without cwd fallback', async t => {
  const f = await fixture(t);
  await f.call('retain_memory', { content: 'parent fact' });
  await f.call('retain_memory', { content: 'child fact' }, 'child');
  assert.deepEqual((await f.call('retrieve_memory', {}, 'child')).items.map(item => item.content), ['child fact']);
  f.sessions.set('parent', { location: { directory: f.other } });
  assert.deepEqual((await f.call('retrieve_memory', {})).items.map(item => item.content), ['child fact']);
  for (const location of [undefined, { directory: 'relative' }, { directory: '' }]) {
    f.sessions.set('unknown', { location });
    await assert.rejects(f.call('retain_memory', { content: 'must not write' }, 'unknown'), /session location/);
  }
  await assert.rejects(f.call('retain_memory', { content: 'must not write' }, ''), /session location/);
  assert.equal(existsSync(join(f.home, '.nanomneme')), false);
});

test('V2 context is fresh, transient, location-scoped and fail-open', async t => {
  const f = await fixture(t);
  assert.equal((await f.context()).length, 1);
  assert.equal(existsSync(join(f.project, '.nanomneme')), false);
  const memory = await f.call('retain_memory', { content: 'Fresh context fact' });
  writeFileSync(join(f.project, '.nanomneme/nmnm.jsonc'), '{"autoretention":{"enabled":true,"always_ask":["Confirm capture."]}}');
  const system = await f.context();
  assert.equal(system.length, 2);
  assert.match(system[1].text, /Fresh context fact/);
  assert.ok(system[1].text.indexOf('## Nanomneme autoretention') < system[1].text.indexOf('Nanomneme memory index:'));
  assert.equal((await f.context('child')).length, 1);
  await f.call('remove_memory', { id: memory.id });
  assert.doesNotMatch((await f.context())[1].text, /Fresh context fact/);
  writeFileSync(join(f.project, '.nanomneme/nmnm.jsonc'), '{ invalid');
  assert.equal((await f.context()).length, 1);
  assert.equal((await f.context('unknown')).length, 1);
});

test('V2 cancellation prevents dispatch and tool diagnostics use the host session id', async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.call('retain_memory', { content: 'cancelled' }, 'parent', controller.signal), /abort/i);
  assert.equal(existsSync(join(f.project, '.nanomneme')), false);
  const base = join(f.home, '.local/share/nanomneme');
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, 'config.jsonc'), '{"logging":{"enabled":true}}');
  await f.call('retain_memory', { content: 'correlated' });
  const records = readFileSync(join(base, 'logs/nmnm-opencode.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(records[0].context.session_id, 'parent');
});
