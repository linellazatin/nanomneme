import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const adapter = fileURLToPath(new URL('..', import.meta.url));
const decode = result => {
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return JSON.parse(result.content[0].text);
};

test('direct launcher binds concurrent workspaces despite stale environment and spaced entry paths', { timeout: 15000 }, async t => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm direct '));
  const parent = join(home, 'parent directory');
  const projects = [join(home, 'workspace one'), join(home, 'workspace two')];
  for (const path of [parent, ...projects]) mkdirSync(path);
  // This alias checks entry-path handling; independent physical artifacts are tested separately.
  const installation = join(home, 'adapter installation');
  symlinkSync(adapter, installation, 'dir');
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map(client => client.close()));
    rmSync(home, { recursive: true, force: true });
  });
  await Promise.all(projects.map(async (cwd, index) => {
    const client = new Client({ name: 'direct-launch-test', version: '1.0.0' });
    clients.push(client);
    await client.connect(new StdioClientTransport({
      command: process.execPath, args: [join(installation, 'mcp/launch.js')], cwd,
      env: { HOME: home, CODEX_HOME: join(home, 'codex'), PWD: parent, NMNM_PROJECT_DIR: parent }, stderr: 'pipe',
    }));
    assert.equal((await client.listTools()).tools.length, 4);
    assert.equal(decode(await client.callTool({ name: 'retrieve_memory', arguments: {} })).status, 'empty');
    assert.equal(existsSync(join(cwd, '.nanomneme')), false);
    const retained = decode(await client.callTool({ name: 'retain_memory', arguments: { content: `Workspace ${index}` } }));
    const recalled = decode(await client.callTool({ name: 'recall_memory', arguments: { id: retained.id } }));
    assert.equal(recalled.record.content, `Workspace ${index}`);
  }));
  assert.equal(existsSync(join(parent, '.nanomneme')), false);
  for (const cwd of projects) assert.equal(existsSync(join(cwd, '.nanomneme/memory.db')), true);
  assert.equal(decode(await clients[0].callTool({ name: 'retrieve_memory', arguments: {} })).total, 1);
  assert.equal(decode(await clients[1].callTool({ name: 'retrieve_memory', arguments: {} })).total, 1);
});

test('direct launcher honors custom CODEX_HOME logging and adopts settings only after restart', { timeout: 15000 }, async t => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-direct-config-'));
  const codex = join(home, 'custom codex');
  const base = join(home, '.local/share/nanomneme');
  mkdirSync(codex); mkdirSync(base, { recursive: true });
  writeFileSync(join(base, 'config.jsonc'), '{"logging":{"enabled":false}}');
  const config = join(codex, 'nmnm.jsonc');
  writeFileSync(config, '// user override\n{"logging":{"enabled":true,},}');
  const log = join(base, 'logs/nmnm-codex.jsonl');
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map(client => client.close()));
    rmSync(home, { recursive: true, force: true });
  });
  async function connect() {
    const client = new Client({ name: 'direct-config-test', version: '1.0.0' });
    clients.push(client);
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [join(adapter, 'mcp/launch.js')], cwd: home,
      env: { HOME: home, CODEX_HOME: codex, CODEX_SESSION_ID: 'direct-session' }, stderr: 'pipe' }));
    return client;
  }
  const first = await connect();
  const retrieve = client => client.callTool({ name: 'retrieve_memory', arguments: {} }).then(decode);
  await retrieve(first);
  writeFileSync(config, '{"logging":{"enabled":false}}');
  await retrieve(first);
  await first.close();
  const records = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(records.length, 2);
  assert.ok(records.every(record => record.context.session_id === 'direct-session'));
  await retrieve(await connect());
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 2);
  assert.equal(existsSync(join(home, '.nanomneme')), false);
});
