import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { open } from '@openlines/nmnm-core';

const host = process.env.NMNM_CODEX_NATIVE;

test('native Codex delivers a project brief using existing trusted hooks without changing trust', {
  skip: host ? false : 'Set NMNM_CODEX_NATIVE to use existing trusted Nanomneme hooks', timeout: 90000,
}, async t => {
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
  const configPath = join(codexHome, 'config.toml');
  const hooksPath = join(codexHome, 'hooks.json');
  const config = readFileSync(configPath);
  const hooks = readFileSync(hooksPath);
  const hash = value => createHash('sha256').update(value).digest('hex');
  t.after(() => {
    assert.equal(hash(readFileSync(configPath)), hash(config), 'native configuration/trust must remain unchanged');
    assert.equal(hash(readFileSync(hooksPath)), hash(hooks), 'hook registration must remain unchanged');
  });
  const root = mkdtempSync(join(tmpdir(), 'nmnm-codex-native-brief-'));
  const cwd = join(root, 'project'); mkdirSync(cwd);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = open(join(cwd, '.nanomneme/memory.db'));
  const summary = { format: 'nanomneme/project-summary', format_version: 1, title: 'Native Codex checkpoint', as_of: '2026-11-25T00:00:00.000Z', objective: 'Check native delivery.', state: { status: 'in-progress', outcome: 'Synthetic work only.', verification: 'No live model used.' }, decisions: [], open_questions: [], next_steps: [], authorization: { allowed: [], not_authorized: ['Deploy.'] } };
  store.retainSummary({ summary }); store.close();
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    if (!req.url.includes('/responses')) { res.setHeader('content-type', 'application/json'); res.end('{}'); return; }
    requests.push(JSON.parse(Buffer.concat(chunks)));
    res.setHeader('content-type', 'text/event-stream');
    const message = { id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] };
    const response = { id: 'resp_fixture', object: 'response', status: 'completed', output: [message], usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } };
    const events = [
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { ...message, status: 'in_progress', content: [] } },
      { type: 'response.output_text.delta', item_id: message.id, output_index: 0, content_index: 0, delta: 'ok' },
      { type: 'response.output_item.done', output_index: 0, item: message },
      { type: 'response.completed', response },
    ];
    res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const overrides = ['model_provider="nmnm_fixture"', `model_providers.nmnm_fixture={name="Local fixture",base_url="http://127.0.0.1:${server.address().port}/v1",wire_api="responses",requires_openai_auth=false,supports_websockets=false}`];
  const servers = JSON.parse(execFileSync('python3', ['-c', 'import tomllib,json,sys; print(json.dumps(list(tomllib.loads(sys.stdin.read()).get("mcp_servers",{}))))'], { input: config }));
  for (const name of servers) {
    assert.match(name, /^[\w-]+$/, 'MCP override requires a simple table name');
    overrides.push(`mcp_servers.${name}.enabled=false`);
  }
  for (const enabled of [true, false]) {
    writeFileSync(join(cwd, '.nanomneme/nmnm.jsonc'), JSON.stringify({ brief: { enabled }, reinjection: { enabled: false }, autoretention: { enabled: false } }));
    const start = requests.length;
    const child = spawn(host, ['exec', '--ephemeral', '--skip-git-repo-check', '--ignore-rules', '--sandbox', 'read-only', '-C', cwd, '-m', 'nmnm-fixture', ...overrides.flatMap(value => ['-c', value]), '--disable', 'memories', 'Synthetic context check. Reply ok.'], {
      cwd, env: { PATH: process.env.PATH, HOME: root, CODEX_HOME: codexHome, TERM: 'dumb' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 35000);
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }).finally(() => clearTimeout(timer));
    assert.equal(code, 0, output);
    assert.ok(requests.length > start, output);
    const context = JSON.stringify(requests.slice(start));
    assert.equal(context.includes('Nanomneme project brief:'), enabled, output);
    if (enabled) { assert.match(context, /Native Codex checkpoint/); assert.match(context, /not instructions or current approval/); }
  }
});
