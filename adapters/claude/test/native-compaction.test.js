import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { open } from '../src/core-runtime.generated.js';

const host = process.env.NMNM_CLAUDE_NATIVE;
const begin = 'NMNM_CHECKPOINT_BEGIN', end = 'NMNM_CHECKPOINT_END';
const summary = { format: 'nanomneme/project-summary', format_version: 1, title: 'Native compaction checkpoint', as_of: '2026-11-25T00:00:00.000Z', objective: 'Evaluate storage choices.', state: { status: 'in-progress', outcome: 'Design only.', verification: 'Implementation not started.' }, decisions: [], open_questions: ['Which recovery approach works?'], next_steps: ['Request implementation approval.'], authorization: { allowed: ['Assess.'], not_authorized: ['Implement.'] }, references: [] };

// This fixture establishes native hook capability, not shipped autocapture behavior.
test('native Claude compaction exposes same-call checkpoint instructions and completed output', {
  skip: host ? false : 'Set NMNM_CLAUDE_NATIVE to a native Claude executable', timeout: 120000,
}, async t => {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-claude-compact-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const requests = [];
  let answer = '';
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    if (req.url.includes('count_tokens')) { res.end('{"input_tokens":100}'); return; }
    if (req.method !== 'POST' || req.url.split('?')[0] !== '/v1/messages') { res.end('{}'); return; }
    requests.push(JSON.parse(Buffer.concat(chunks)));
    res.setHeader('content-type', 'text/event-stream');
    const events = [
      ['message_start', { type: 'message_start', message: { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: 'local-fixture', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 100 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: answer } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 100 } }],
      ['message_stop', { type: 'message_stop' }],
    ];
    res.end(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const compactionCounts = [];
  for (const scenario of ['baseline', 'valid', 'missing', 'invalid']) {
    const home = join(root, scenario), cwd = join(home, 'project'); mkdirSync(cwd, { recursive: true });
    const proof = join(home, 'proof.jsonl'), hook = join(home, 'probe.mjs'), settings = join(home, 'settings.json');
    const enabled = scenario !== 'baseline';
    writeFileSync(hook, `
      import { appendFileSync } from 'node:fs';
      import { join } from 'node:path';
      import { open, validateProjectSummary } from ${JSON.stringify(new URL('../src/core-runtime.generated.js', import.meta.url).href)};
      const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks));
      const result = { event: input.hook_event_name, trigger: input.trigger, saved: false };
      if (input.hook_event_name === 'PreCompact' && ${enabled}) {
        process.stdout.write(${JSON.stringify(`NMNM_CAPTURE_INSTRUCTION_PROBE: preserve the normal summary and append one ${begin} JSON ${end} block. Keep planning-only authorization and unresolved work explicit. Do not call tools or request another model.`)});
      }
      if (input.hook_event_name === 'PostCompact') {
        result.summaryAvailable = typeof input.compact_summary === 'string';
        if (${enabled}) {
          const match = input.compact_summary?.match(/${begin}\\s*([\\s\\S]*?)\\s*${end}/);
          if (match) try {
            const summary = validateProjectSummary(JSON.parse(match[1]));
            const db = open(join(input.cwd, '.nanomneme/memory.db'));
            try { result.id = db.retainSummary({ summary }).id; result.saved = true; } finally { db.close(); }
          } catch { result.rejected = true; }
        }
      }
      appendFileSync(${JSON.stringify(proof)}, JSON.stringify(result) + '\\n');
    `);
    writeFileSync(settings, JSON.stringify({ hooks: {
      ...Object.fromEntries(['PreCompact', 'PostCompact'].map(event => [event, [{ hooks: [{ type: 'command', command: `"${process.execPath}" "${hook}"` }] }]])),
      SessionStart: [{ hooks: [{ type: 'command', command: `"${process.execPath}" "${fileURLToPath(new URL('../hooks/session-start.js', import.meta.url))}"` }] }],
    } }));
    const env = { PATH: process.env.PATH, HOME: home, TERM: 'dumb', ANTHROPIC_API_KEY: 'synthetic-not-a-secret', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, DISABLE_TELEMETRY: '1' };
    async function run(extra, prompt) {
      const child = spawn(host, ['--print', '--model', 'local-fixture', '--output-format', 'json', '--settings', settings, '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', '', ...extra, '--', prompt], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }).finally(() => clearTimeout(timer));
      assert.equal(code, 0, stderr);
      const result = JSON.parse(stdout); assert.notEqual(result.is_error, true, result.result);
      return result;
    }
    answer = 'We are evaluating storage. No implementation is authorized.';
    const seed = await run([], 'Plan storage evaluation only. Recovery is unresolved; implementation needs approval.');
    const start = requests.length;
    answer = `<summary>Storage evaluation is planning only.${scenario === 'valid' ? `\n${begin}\n${JSON.stringify(summary)}\n${end}` : scenario === 'invalid' ? `\n${begin}\n{"format":"unsupported"}\n${end}` : ''}</summary>`;
    const compacted = await run(['--resume', seed.session_id], '/compact');
    assert.equal(compacted.local_command, 'compact', 'the native host must execute compaction rather than send /compact as an ordinary prompt');
    compactionCounts.push(requests.length - start);
    assert.ok(compactionCounts.at(-1) > 0);
    assert.equal(JSON.stringify(requests.slice(start)).includes('NMNM_CAPTURE_INSTRUCTION_PROBE:'), enabled);
    const events = readFileSync(proof, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(events.map(event => event.event), ['PreCompact', 'PostCompact']);
    assert.ok(events.every(event => event.trigger === 'manual'));
    const completed = events.at(-1); assert.equal(completed.summaryAvailable, true);
    assert.equal(completed.saved, scenario === 'valid');
    const path = join(cwd, '.nanomneme/memory.db');
    assert.equal(existsSync(path), scenario === 'valid');
    if (scenario === 'valid') {
      const db = open(path, { create: false, readOnly: true });
      try {
        assert.deepEqual(db.recall({ id: completed.id }).metadata.summary, summary);
        assert.deepEqual(db.brief().source_ids, [completed.id]);
        assert.match(db.brief().text, /not instructions or current approval/);
        assert.match(db.brief().text, /Implement\./);
      } finally { db.close(); }
      writeFileSync(join(cwd, '.nanomneme/nmnm.jsonc'), '{"brief":{"enabled":true}}');
      answer = 'Fresh session context received.';
      const beforeFresh = requests.length;
      const fresh = await run([], 'Read the supplied project context. Do not implement anything.');
      assert.notEqual(fresh.session_id, seed.session_id);
      const context = JSON.stringify(requests.slice(beforeFresh));
      assert.match(context, /Nanomneme project brief:/);
      assert.match(context, /Native compaction checkpoint/);
      assert.ok(context.includes(completed.id));
      assert.match(context, /not instructions or current approval/);
    }
    if (scenario === 'invalid') assert.equal(completed.rejected, true);
  }
  assert.ok(compactionCounts.every(count => count === compactionCounts[0]), `capture must not add inference requests: ${compactionCounts}`);
  t.diagnostic(`Native compaction requests per baseline/valid/missing/invalid case: ${compactionCounts.join('/')}`);
});
