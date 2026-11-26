import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { open } from '../src/core-runtime.generated.js';

const host = process.env.NMNM_CLAUDE_NATIVE;

test('native Claude delivers an opted-in project brief to a local synthetic provider', {
  skip: host ? false : 'Set NMNM_CLAUDE_NATIVE to a native Claude executable', timeout: 60000,
}, async t => {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-claude-native-brief-'));
  const cwd = join(root, 'project'); mkdirSync(cwd);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = open(join(cwd, '.nanomneme/memory.db'));
  try {
    store.retainSummary({ summary: { format: 'nanomneme/project-summary', format_version: 1, title: 'Native brief probe', as_of: '2026-11-25T00:00:00.000Z', objective: 'Check context delivery.', state: { status: 'in-progress', outcome: 'Synthetic work only.', verification: 'No live model used.' }, decisions: [], open_questions: [], next_steps: [], authorization: { allowed: [], not_authorized: ['Deploy.'] } } });
  } finally { store.close(); }
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.url.includes('count_tokens')) { res.setHeader('content-type', 'application/json'); res.end('{"input_tokens":10}'); return; }
    if (req.method !== 'POST' || req.url.split('?')[0] !== '/v1/messages') { res.setHeader('content-type', 'application/json'); res.end('{}'); return; }
    requests.push(JSON.parse(Buffer.concat(chunks)));
    res.setHeader('content-type', 'text/event-stream');
    const events = [
      ['message_start', { type: 'message_start', message: { id: 'msg_synthetic', type: 'message', role: 'assistant', model: 'local-fixture', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }],
      ['message_stop', { type: 'message_stop' }],
    ];
    res.end(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const plugin = fileURLToPath(new URL('../', import.meta.url));
  const env = { PATH: process.env.PATH, HOME: root, TERM: 'dumb', ANTHROPIC_API_KEY: 'synthetic-not-a-secret', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, DISABLE_TELEMETRY: '1' };
  for (const enabled of [true, false]) {
    writeFileSync(join(cwd, '.nanomneme/nmnm.jsonc'), JSON.stringify({ brief: { enabled } }));
    const start = requests.length;
    const child = spawn(host, ['--print', '--model', 'local-fixture', '--output-format', 'json', '--plugin-dir', plugin, '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', '', '--', 'Synthetic context check. Reply ok.'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 25000);
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }).finally(() => clearTimeout(timer));
    assert.equal(code, 0, stderr);
    assert.equal(JSON.parse(stdout).is_error, false);
    assert.ok(requests.length > start);
    const context = JSON.stringify(requests.slice(start));
    assert.equal(context.includes('Nanomneme project brief:'), enabled);
    if (enabled) assert.match(context, /not instructions or current approval/);
  }
});
