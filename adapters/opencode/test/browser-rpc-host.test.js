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

test('native V2 host routes checkout browser RPC to server stores with authentication and schema validation', {
  skip: host ? false : 'Set NMNM_OPENCODE_V2 to a native V2 executable', timeout: 60000,
}, async t => {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-browser-rpc-host-'));
  const home = join(root, 'server-home');
  const project = join(root, 'project-a');
  const other = join(root, 'project-b');
  const terminal = join(root, 'terminal');
  for (const path of [home, project, other, terminal, join(home, 'config/opencode')]) mkdirSync(path, { recursive: true });
  writeFileSync(join(home, 'config/opencode/opencode.json'), JSON.stringify({ plugins: [fileURLToPath(new URL('../', import.meta.url))] }));
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
      body: JSON.stringify({ input }), signal: AbortSignal.timeout(15000),
    });
  }
  async function call(method, input, directory) {
    const response = await request(method, input, directory);
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result.output;
  }
  const ctx = { cwd: project, home, platform: process.platform };
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
  assert.equal(existsSync(join(other, '.nanomneme/memory.db')), false);
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
});
