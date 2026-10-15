import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { runBridge } from '../src/bridge-client.js';

const host = process.env.NMNM_OPENCODE_V2;
const liveModel = process.env.NMNM_OPENCODE_LIVE_MODEL;

test('native V2 host routes checkout browser RPC to server stores with authentication and schema validation', {
  skip: host ? false : 'Set NMNM_OPENCODE_V2 to a native V2 executable', timeout: liveModel ? 240000 : 60000,
}, async t => {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-browser-rpc-host-'));
  const home = join(root, 'server-home');
  const project = join(root, 'project-a');
  const other = join(root, 'project-b');
  const terminal = join(root, 'terminal');
  const empty = join(root, 'empty');
  for (const path of [home, project, other, terminal, empty, join(home, 'config/opencode')]) mkdirSync(path, { recursive: true });
  const observer = join(root, 'observer');
  mkdirSync(observer);
  writeFileSync(join(observer, 'package.json'), JSON.stringify({ name: 'nmnm-test-observer', type: 'module', main: './index.js' }));
  writeFileSync(join(observer, 'index.js'), `export default {
    id: 'nmnm-test-observer',
    async setup(api) {
      const requests = [];
      const executions = [];
      await api.tool.hook('execute.after', event => { executions.push({ sessionID: event.sessionID, tool: event.tool, status: event.status }); });
      await api.session.hook('context', event => {
        requests.push({ sessionID: event.sessionID, system: event.system });
      });
      await api.session.hook('retry', event => { event.decision = { retry: false }; });
      return (await api.rpc.register({ id: 'nmnm-test-observer', events: {}, methods: {
        probe: { input: {}, output: {} }
      } }, { async probe(input, context) {
        if (input.action === 'create') return api.session.create({ location: { directory: input.directory }, title: 'Disposable adapter test', ...(input.parentID ? { parentID: input.parentID } : {}), ...(input.model ? { model: input.model } : {}) });
        if (input.action === 'move') { await api.session.move({ sessionID: input.sessionID, directory: input.directory }); await api.session.wait({ sessionID: input.sessionID }); return api.session.get({ sessionID: input.sessionID }); }
        if (input.action === 'prompt') { await api.session.prompt({ sessionID: input.sessionID, text: input.text }); await api.session.wait({ sessionID: input.sessionID }); return api.session.context({ sessionID: input.sessionID }); }
        if (input.action === 'compact') { await api.session.compact({ sessionID: input.sessionID }); await api.session.wait({ sessionID: input.sessionID }); return api.session.context({ sessionID: input.sessionID }); }
        if (input.action === 'requests') return requests.filter(request => request.sessionID === input.sessionID);
        if (input.action === 'executions') return executions.filter(event => event.sessionID === input.sessionID);
        const tools = await api.tool.list();
        if (input.action === 'list') return tools.map(tool => tool.id);
        const tool = tools.find(tool => tool.id === input.name);
        return tool.execute(input.params, { sessionID: input.sessionID, signal: context.signal, progress: async () => {} });
      } })).dispose;
    }
  };`);
  writeFileSync(join(home, 'config/opencode/opencode.json'), JSON.stringify({
    plugins: [fileURLToPath(new URL('../', import.meta.url)), observer],
    ...(liveModel ? { providers: { 'amazon-bedrock': { settings: { profile: process.env.AWS_PROFILE, region: process.env.AWS_REGION } } } } : {}),
  }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OPENCODE_') && !key.startsWith('XDG_')));
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache'), XDG_STATE_HOME: join(home, 'state') });
  const server = spawn(host, ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', spawnError;
  server.on('error', error => { spawnError = error; });
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => {
    if (server.exitCode === null && server.signalCode === null && !spawnError) {
      const exited = new Promise(resolve => server.once('exit', resolve));
      const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
      server.kill('SIGTERM');
      try { await exited; } finally { clearTimeout(timer); }
    }
    rmSync(root, { recursive: true, force: true });
  });
  const deadline = Date.now() + 30000;
  let address, password;
  while (!(address && password)) {
    if (spawnError) throw spawnError;
    assert.equal(server.exitCode, null, 'isolated V2 server must stay running');
    assert.ok(Date.now() < deadline, 'V2 server did not announce its address and credentials');
    address = output.match(/server listening on (http:\/\/\S+)/)?.[1];
    password = output.match(/server password (\S+)/)?.[1];
    if (!(address && password)) await delay(50);
  }
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
  async function request(method, input, directory = project, authenticated = true) {
    return fetch(`${address}/api/rpc/nmnm-opencode.browser/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-opencode-directory': encodeURIComponent(directory), ...(authenticated ? { authorization } : {}) },
      body: JSON.stringify({ input }), signal: AbortSignal.timeout(liveModel ? 90000 : 15000),
    });
  }
  async function call(method, input, directory) {
    const response = await request(method, input, directory);
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result.output;
  }
  const ctx = { cwd: project, home, platform: process.platform };
  async function probe(input) {
    const response = await fetch(`${address}/api/rpc/nmnm-test-observer/probe`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization, 'x-opencode-directory': encodeURIComponent(project) },
      body: JSON.stringify({ input }), signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result.output;
  }
  const names = await probe({ action: 'list' });
  assert.deepEqual(names.filter(name => /^(retain|recall|retrieve|remove)_memory$/.test(name)).sort(), ['recall_memory', 'remove_memory', 'retain_memory', 'retrieve_memory']);
  const session = await probe({ action: 'create', directory: other });
  const execute = async (name, params) => JSON.parse((await probe({ name, params, sessionID: session.id })).content);
  assert.equal(await execute('recall_memory', { id: 'missing' }), null);
  assert.equal(existsSync(join(other, '.nanomneme/memory.db')), false);
  const nativeToolMemory = await execute('retain_memory', { content: 'Native V2 tool fact' });
  assert.equal(nativeToolMemory.metadata.source, 'opencode');
  assert.equal((await execute('recall_memory', { id: nativeToolMemory.id })).content, 'Native V2 tool fact');
  assert.equal((await execute('retrieve_memory', {})).total, 1);
  await execute('remove_memory', { id: nativeToolMemory.id });
  assert.equal(await execute('recall_memory', { id: nativeToolMemory.id }), null);
  const seed = runBridge({ op: 'tool', name: 'retain_memory', params: { content: 'native checkout RPC fact' }, ctx });
  assert.equal(seed.ok, true);
  const memory = JSON.parse(seed.text);
  const target = { store: 'project', id: memory.id };
  assert.equal((await request('mutate', { ...target, mutation: 'remove' }, project, false)).status, 401);
  const status = await call('status', {});
  assert.equal(status.ok, true, JSON.stringify(status));
  const page = await call('browse', { store: 'project', ctx: { cwd: terminal, home: terminal }, op: 'tool' });
  assert.equal(page.ok, true);
  assert.deepEqual(page.items.map(item => item.content), ['native checkout RPC fact']);
  assert.equal((await call('browse', { store: 'project' }, other)).total, 0);
  assert.equal(existsSync(join(other, '.nanomneme/memory.db')), true);
  assert.equal((await call('browse', { store: 'project' }, empty)).total, 0);
  assert.equal(existsSync(join(empty, '.nanomneme')), false);
  assert.equal((await call('detail', target)).record.id, memory.id);
  assert.equal((await call('mutate', { ...target, mutation: 'pin' })).pinned, true);
  assert.equal((await call('mutate', { ...target, mutation: 'unpin' })).pinned, false);
  assert.notEqual((await request('mutate', { ...target, mutation: 'purge' })).status, 200);
  assert.notEqual((await request('browse', { limit: 100000 })).status, 200);
  assert.equal((await call('mutate', { ...target, mutation: 'remove' })).removed, true);
  assert.deepEqual(await call('detail', target), { ok: true, memory: null });
  assert.equal((await call('browse', { store: 'project' })).total, 0);
  assert.match((await call('mutate', { ...target, mutation: 'pin' })).error, /not found/);
  assert.equal(existsSync(join(terminal, '.nanomneme')), false);
  assert.equal(existsSync(join(home, '.local/share/nanomneme/memory.db')), false);
  const child = await probe({ action: 'create', directory: other, parentID: session.id });
  assert.equal(child.parentID, session.id);
  assert.equal(JSON.parse((await probe({ name: 'retrieve_memory', params: {}, sessionID: child.id })).content).total, 0);
  const moved = await probe({ action: 'move', sessionID: session.id, directory: empty });
  assert.equal(moved.location.directory, empty);
  const movedMemory = await execute('retain_memory', { content: 'Moved session fact' });
  assert.equal((await call('browse', { store: 'project' }, empty)).items[0].id, movedMemory.id);
  assert.equal((await call('browse', { store: 'project' }, other)).total, 0);
  if (liveModel) {
    const live = await probe({ action: 'create', directory: project, model: { providerID: 'amazon-bedrock', id: liveModel } });
    const seedFact = content => {
      const result = runBridge({ op: 'tool', name: 'retain_memory', params: { content }, ctx });
      assert.equal(result.ok, true, result.error);
      return JSON.parse(result.text);
    };
    const first = seedFact('The verification beacon is amber-otter-7319.');
    const prompt = text => probe({ action: 'prompt', sessionID: live.id, text });
    const assistantText = messages => messages.filter(message => message.type === 'assistant').flatMap(message => message.content.filter(part => part.type === 'text').map(part => part.text)).join('\n');
    assert.match(assistantText(await prompt('Read only the current Nanomneme memory index in your system instructions. What is the verification beacon? Reply with its exact value only. Do not use tools.')), /amber-otter-7319/);
    const beforeTool = (await probe({ action: 'requests', sessionID: live.id })).length;
    const continued = await prompt(`Use Code Mode execute to call only the recall_memory plugin tool with id ${first.id} and store project. Discover its exact tool path if needed. Do not call any other tool or read any file. Return the result, then reply with the verification beacon from it.`);
    assert.ok(continued.some(message => message.type === 'assistant' && message.content.some(part => part.type === 'tool' && part.state.status === 'completed')), JSON.stringify(continued.filter(message => message.type === 'assistant').map(message => message.content)));
    assert.ok((await probe({ action: 'executions', sessionID: live.id })).some(event => event.tool === 'recall_memory' && event.status === 'completed'), 'provider must invoke the real recall executor');
    assert.ok((await probe({ action: 'requests', sessionID: live.id })).length >= beforeTool + 2, 'tool execution must cause a fresh primary continuation');
    const compacted = await probe({ action: 'compact', sessionID: live.id });
    assert.ok(compacted.some(message => message.type === 'compaction' && message.status === 'completed'), 'native compaction must complete');
    assert.equal((await call('mutate', { store: 'project', id: first.id, mutation: 'remove' })).removed, true);
    const second = seedFact('The verification beacon is violet-badger-9284.');
    assert.equal((await call('mutate', { store: 'project', id: second.id, mutation: 'pin' })).pinned, true);
    assert.match(assistantText(await prompt('The durable beacon has changed. Read only the CURRENT Nanomneme system memory index, not the earlier conversation. Reply with the current verification beacon only. Do not use tools.')), /violet-badger-9284/);
    const requests = await probe({ action: 'requests', sessionID: live.id });
    assert.ok(requests.length >= 2);
    assert.match(JSON.stringify(requests.at(-1).system), /violet-badger-9284/);
    assert.doesNotMatch(JSON.stringify(requests.at(-1).system), /amber-otter-7319/);
  }
});
