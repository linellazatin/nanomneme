import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const server = fileURLToPath(new URL('../mcp/server.js', import.meta.url));
const decode = response => JSON.parse(response.content[0].text);

test('MCP adapter runtime floor matches repository development requirements', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.engines.node, '>=22.19.0');
});

test('real stdio discovers bounded tools and performs 4Rs after schema rejection', { timeout: 15000 }, async t => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-stdio-'));
  const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { HOME: home, NMNM_PROJECT_DIR: home, CODEX_HOME: join(home, 'codex') }, stderr: 'pipe' });
  const client = new Client({ name: 'nmnm-test', version: '1.0.0' });
  t.after(async () => { await client.close(); rmSync(home, { recursive: true, force: true }); });
  await client.connect(transport);
  let stderr = ''; transport.stderr?.on('data', data => { stderr += data; });
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(t => t.name).sort(), ['recall_memory', 'remove_memory', 'retain_memory', 'retrieve_memory']);
  assert.ok(Buffer.byteLength(JSON.stringify(tools)) <= 16384);
  const retainSchema = tools.tools.find(t => t.name === 'retain_memory').inputSchema;
  assert.equal(retainSchema.additionalProperties, false);
  assert.equal(retainSchema.properties.namespace.pattern, '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$');
  assert.match(retainSchema.properties.content.description, /16384 Unicode code points/);
  const rejected = await client.callTool({ name: 'remove_memory', arguments: { id: 'bad', mode: 'purge' } });
  assert.equal(rejected.isError, true);
  const oversizedError = await client.callTool({ name: 'remove_memory', arguments: { id: 'bad', ['x'.repeat(70000)]: true } });
  assert.equal(oversizedError.isError, true);
  assert.ok(Buffer.byteLength(JSON.stringify(oversizedError)) <= 65536, 'schema errors must also fit the response budget');
  assert.equal(existsSync(join(home, '.nanomneme')), false);
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 65536);
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return decode(result);
  };
  const retained = await call('retain_memory', { content: 'Native stdio choice' });
  assert.equal((await call('recall_memory', { id: retained.id })).record.metadata.source, 'codex');
  assert.equal((await call('retrieve_memory', { query: 'stdio' })).total, 1);
  await call('retain_memory', { id: retained.id, content: 'Updated choice' });
  assert.equal((await call('recall_memory', { id: retained.id })).record.content, 'Updated choice');
  await call('remove_memory', { id: retained.id });
  assert.equal((await call('recall_memory', { id: retained.id })).status, 'not_found');
  assert.equal(stderr.includes('Native stdio choice'), false);
});

test('stdio logging honors schema boundary, restart settings, sink failures and private modes', { timeout: 15000 }, async t => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-wire-logs-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const base = join(home, '.local/share/nanomneme'); mkdirSync(base, { recursive: true });
  const config = join(base, 'config.jsonc'); writeFileSync(config, '{"logging":{"enabled":true}}');
  const log = join(base, 'logs/nmnm-codex.jsonl');
  const ajv = new Ajv(); addFormats(ajv);
  const valid = ajv.compile(JSON.parse(readFileSync(new URL('../../../external/logslines/spec/v1/schema.json', import.meta.url))));
  async function connect() {
    const client = new Client({ name: 'log-test', version: '1.0.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { HOME: home, NMNM_PROJECT_DIR: home, CODEX_HOME: join(home, 'codex'), CODEX_SESSION_ID: 'wire-session' }, stderr: 'pipe' });
    await client.connect(transport); return client;
  }
  let client = await connect();
  try {
    await client.listTools(); assert.equal(existsSync(log), false);
    assert.equal((await client.callTool({ name: 'recall_memory', arguments: { id: 'bad' } })).isError, true);
    assert.equal(existsSync(log), false);
    await client.callTool({ name: 'retrieve_memory', arguments: {} });
    await client.callTool({ name: 'retain_memory', arguments: {} });
    writeFileSync(config, '{"logging":{"enabled":false}}');
    await client.callTool({ name: 'retrieve_memory', arguments: {} });
  } finally { await client.close(); }
  const records = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.map(r => r.status), ['empty', 'failed', 'empty']);
  for (const record of records) { assert.ok(valid(record), JSON.stringify(valid.errors)); assert.equal(record.context.session_id, 'wire-session'); }
  if (process.platform !== 'win32') { assert.equal(statSync(log).mode & 0o777, 0o600); assert.equal(statSync(join(base, 'logs')).mode & 0o777, 0o700); }
  client = await connect();
  try { await client.callTool({ name: 'retrieve_memory', arguments: {} }); } finally { await client.close(); }
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 3);
  rmSync(join(base, 'logs'), { recursive: true }); writeFileSync(join(base, 'logs'), 'sink blocked');
  writeFileSync(config, '{"logging":{"enabled":true}}');
  client = await connect();
  try { assert.notEqual((await client.callTool({ name: 'retain_memory', arguments: { content: 'Sink failure survives' } })).isError, true); } finally { await client.close(); }
});

test('raw stdio negotiates supported revisions, preserves protocol stdout and closes on EOF/signals', { timeout: 15000 }, async t => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-wire-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  for (const entry of [server, fileURLToPath(new URL('../mcp/launch.js', import.meta.url))]) {
    for (const [version, signal] of [['2025-06-18', null], ['2025-11-25', 'SIGTERM'], ['2026-07-28', 'SIGINT']]) {
      const child = spawn(process.execPath, [entry], { cwd: home, env: { ...process.env, HOME: home, CODEX_HOME: join(home, 'codex'), NMNM_PROJECT_DIR: home }, stdio: ['pipe', 'pipe', 'pipe'] });
      t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
      const lines = createInterface({ input: child.stdout });
      const reader = lines[Symbol.asyncIterator]();
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: version, clientInfo: { name: 'wire', version: '1' }, capabilities: {} } }) + '\n');
      const message = JSON.parse((await reader.next()).value);
      assert.equal(message.result.protocolVersion, version === '2026-07-28' ? '2025-11-25' : version);
      assert.match(message.result.instructions, /project store/);
      const exit = once(child, 'exit');
      if (signal) child.kill(signal); else child.stdin.end();
      const [code] = await exit; assert.equal(code, 0);
      lines.close();
    }
  }
});

test('startup without explicit binding emits no protocol output or store', { timeout: 15000 }, async t => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-unbound-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const child = spawn(process.execPath, [server], { cwd: home, env: { HOME: home, PATH: process.env.PATH } });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  const [code] = await once(child, 'close');
  assert.equal(code, 1); assert.equal(stdout, ''); assert.match(stderr, /NMNM_PROJECT_DIR/);
  assert.equal(existsSync(join(home, '.nanomneme')), false);
});
