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
const summary = { format: 'nanomneme/project-summary', format_version: 1, title: 'Native compaction checkpoint', as_of: '2026-11-25T00:00:00.000Z', objective: 'Evaluate storage choices.', state: { status: 'in-progress', outcome: 'Design only.', verification: 'Implementation not started.' }, decisions: [], open_questions: ['Which recovery approach works?'], next_steps: ['Request implementation approval.'], authorization: { allowed: ['Assess.'], not_authorized: ['Implement.'] }, references: [] };

// The native host owns compaction; only its inference transport is synthetic.
test('native Claude production hooks capture checkpoints without extra inference', {
  skip: host ? false : 'Set NMNM_CLAUDE_NATIVE to a native Claude executable', timeout: 120000,
}, async t => {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-claude-compact-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const requests = [];
  let answer = '', emitted, inputTokens = 100, rejectCompaction = false;
  const strings = value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    if (req.url.includes('count_tokens')) { res.end('{"input_tokens":100}'); return; }
    if (req.method !== 'POST' || req.url.split('?')[0] !== '/v1/messages') { res.end('{}'); return; }
    const body = JSON.parse(Buffer.concat(chunks)); requests.push(body);
    if (rejectCompaction) { res.statusCode = 400; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Synthetic compaction failed.' } })); return; }
    const text = typeof answer === 'function' ? answer(body) : answer;
    res.setHeader('content-type', 'text/event-stream');
    const events = [
      ['message_start', { type: 'message_start', message: { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: 'local-fixture', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: inputTokens, output_tokens: 100 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 100 } }],
      ['message_stop', { type: 'message_stop' }],
    ];
    res.end(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const compactionCounts = { manual: [], auto: [] };
  for (const scenario of ['baseline', 'valid', 'missing', 'invalid', 'malformed', 'oversized', 'cancelled', 'failed', 'auto-baseline', 'auto-valid']) {
    const home = join(root, scenario), cwd = join(home, 'project'); mkdirSync(cwd, { recursive: true });
    const proof = join(home, 'proof.jsonl'), hook = join(home, 'probe.mjs'), settings = join(home, 'settings.json');
    const automatic = scenario.startsWith('auto-');
    const enabled = !scenario.endsWith('baseline');
    const shouldSave = scenario === 'valid' || scenario === 'auto-valid';
    rejectCompaction = false;
    const temp = join(home, 'tmp'); mkdirSync(temp);
    mkdirSync(join(cwd, '.nanomneme'));
    writeFileSync(join(cwd, '.nanomneme/nmnm.jsonc'), JSON.stringify({ summary: { autocapture: { enabled } } }));
    writeFileSync(hook, `
      import { appendFileSync } from 'node:fs';
      const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks));
      appendFileSync(${JSON.stringify(proof)}, JSON.stringify({ event: input.hook_event_name, trigger: input.trigger, summaryAvailable: typeof input.compact_summary === 'string' }) + '\\n');
    `);
    const nativeCommand = `"${process.execPath}" "${fileURLToPath(new URL('../hooks/compaction.js', import.meta.url))}"`;
    writeFileSync(settings, JSON.stringify({ hooks: {
      ...Object.fromEntries(['PreCompact', 'PostCompact'].map(event => [event, [{ hooks: [{ type: 'command', command: nativeCommand }, { type: 'command', command: `"${process.execPath}" "${hook}"` }, ...(scenario === 'cancelled' && event === 'PreCompact' ? [{ type: 'command', command: `"${process.execPath}" -e "process.exit(2)"` }] : [])] }]])),
      SessionStart: [{ hooks: [{ type: 'command', command: `"${process.execPath}" "${fileURLToPath(new URL('../hooks/session-start.js', import.meta.url))}"` }] }],
    } }));
    let autoWindow = false;
    const env = { PATH: process.env.PATH, HOME: home, TMPDIR: temp, TERM: 'dumb', ANTHROPIC_API_KEY: 'synthetic-not-a-secret', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, DISABLE_TELEMETRY: '1' };
    async function run(extra, prompt) {
      const child = spawn(host, ['--print', '--model', 'local-fixture', ...(automatic && autoWindow ? ['--autocompact', '100000'] : []), '--output-format', 'json', '--settings', settings, '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', '', ...extra, '--', prompt], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }).finally(() => clearTimeout(timer));
      const expectedFailure = ['cancelled', 'failed'].includes(scenario) && prompt === '/compact';
      if (!expectedFailure) assert.equal(code, 0, stderr);
      const result = JSON.parse(stdout); if (!expectedFailure) assert.notEqual(result.is_error, true, result.result);
      return result;
    }
    answer = 'We are evaluating storage. No implementation is authorized.';
    inputTokens = 100;
    let seed = await run([], 'Plan storage evaluation only. Recovery is unresolved; implementation needs approval.');
    if (automatic) for (let index = 0; index < 6; index++) {
      inputTokens = index === 5 ? 150000 : 100;
      seed = await run(['--resume', seed.session_id], `Planning continuation ${index}; no implementation.`);
    }
    inputTokens = 100; autoWindow = true;
    const start = requests.length;
    answer = body => {
      const instruction = strings(body).find(text => text.includes('NMNM_SUMMARY_') && text.includes('"as_of":'));
      if (!instruction || scenario === 'missing') return '<summary>Planning only; no checkpoint.</summary>';
      const token = instruction.match(/NMNM_SUMMARY_([0-9a-f-]+)_BEGIN/)[1];
      emitted = { ...summary, as_of: instruction.match(/"as_of":"([^"]+)"/)[1] };
      const json = scenario === 'invalid' ? '{"format":"unsupported"}' : scenario === 'malformed' ? '{bad json' : JSON.stringify({ ...emitted, ...(scenario === 'oversized' ? { objective: 'x'.repeat(9000) } : {}) });
      return `<summary>Planning only.\nNMNM_SUMMARY_${token}_BEGIN\n${json}\nNMNM_SUMMARY_${token}_END</summary>`;
    };
    rejectCompaction = scenario === 'failed';
    const compacted = await run(['--resume', seed.session_id], automatic ? 'Continue reviewing the plan.' : '/compact');
    if (!automatic) assert.equal(compacted.local_command, 'compact');
    if (['cancelled', 'failed'].includes(scenario)) {
      const events = readFileSync(proof, 'utf8').trim().split('\n').map(JSON.parse);
      assert.deepEqual(events.map(event => event.event), ['PreCompact']);
      assert.equal(existsSync(join(cwd, '.nanomneme/memory.db')), false);
      if (scenario === 'cancelled') assert.equal(requests.length, start);
      continue;
    }
    const counts = compactionCounts[automatic ? 'auto' : 'manual'];
    counts.push(requests.length - start);
    assert.ok(counts.at(-1) > 0);
    assert.equal(JSON.stringify(requests.slice(start)).includes('Nanomneme optional project checkpoint:'), enabled);
    const events = readFileSync(proof, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(events.map(event => event.event), ['PreCompact', 'PostCompact'], JSON.stringify({ compacted: {result:compacted.result, local_command:compacted.local_command}, requests:requests.length-start, events }));
    assert.ok(events.every(event => event.trigger === (automatic ? 'auto' : 'manual')));
    const completed = events.at(-1); assert.equal(completed.summaryAvailable, true);
    const path = join(cwd, '.nanomneme/memory.db');
    assert.equal(existsSync(path), shouldSave);
    if (shouldSave) {
      const db = open(path, { create: false, readOnly: true });
      try {
        const record = db.retrieve({ namespace: 'project-summary' }).items[0];
        completed.id = record.id;
        assert.deepEqual(db.recall({ id: record.id }).metadata.summary, emitted);
        assert.equal(record.metadata.source, 'claude-code');
        assert.ok(record.metadata.summary_capture.id);
        assert.deepEqual(db.brief().source_ids, [record.id]);
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
  }
  for (const [kind, counts] of Object.entries(compactionCounts)) {
    assert.ok(counts.every(count => count === counts[0]), `capture must not add inference requests: ${counts}`);
    t.diagnostic(`Native ${kind} requests with capture disabled/enabled: ${counts.join('/')}`);
  }
});
