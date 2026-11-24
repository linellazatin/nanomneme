import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { open } from '@openlines/nmnm-core';

for (const generation of ['V1', 'V2']) {
  const host = process.env[`NMNM_OPENCODE_${generation}`];
  test(`native OpenCode ${generation} delivers an opt-in brief in a provider request`, {
    skip: host ? false : `Set NMNM_OPENCODE_${generation} to a native executable`, timeout: 150000,
  }, async t => {
    const root = mkdtempSync(join(tmpdir(), 'nmnm-opencode-native-brief-'));
    const home = join(root, 'home'), cwd = join(root, 'project'), config = join(home, 'config/opencode');
    for (const path of [cwd, config]) mkdirSync(path, { recursive: true });
    const store = open(join(cwd, '.nanomneme/memory.db'));
    t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
    const record = store.retainSummary({ summary: { format: 'nanomneme/project-summary', format_version: 1, title: 'Native OpenCode checkpoint', as_of: '2026-11-25T00:00:00.000Z', objective: 'Check provider delivery.', state: { status: 'in-progress', outcome: 'Synthetic work only.', verification: 'No live model used.' }, decisions: [], open_questions: [], next_steps: [], authorization: { allowed: [], not_authorized: ['Deploy.'] } } });
    const requests = [];
    const server = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      if (!req.url.includes('/chat/completions')) { res.setHeader('content-type', 'application/json'); res.end('{}'); return; }
      requests.push(JSON.parse(Buffer.concat(chunks)));
      res.setHeader('content-type', 'text/event-stream');
      const base = { id: 'chatcmpl_fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture' };
      res.end([
        { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] },
        { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } },
      ].map(data => `data: ${JSON.stringify(data)}\n\n`).join('') + 'data: [DONE]\n\n');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
    const adapter = process.env.NMNM_ADAPTER_ROOT || fileURLToPath(new URL('../', import.meta.url));
    writeFileSync(join(config, 'opencode.json'), JSON.stringify(generation === 'V2' ? {
      plugins: [adapter], model: 'nmnm-fixture/fixture',
      providers: { 'nmnm-fixture': { name: 'Local fixture', package: '@opencode/ai/providers/openai-compatible', settings: { baseURL }, models: { fixture: { modelID: 'fixture', capabilities: { tools: true, input: ['text'], output: ['text'] }, limit: { context: 32768, output: 1024 } } } } },
    } : {
      plugin: [adapter], model: 'nmnm-fixture/fixture',
      provider: { 'nmnm-fixture': { name: 'Local fixture', npm: '@ai-sdk/openai-compatible', options: { baseURL, apiKey: 'synthetic-not-a-secret' }, models: { fixture: { name: 'Fixture', limit: { context: 32768, output: 1024 } } } } },
    }));
    const env = { PATH: process.env.PATH, HOME: home, TERM: 'dumb', XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache'), XDG_STATE_HOME: join(home, 'state'), OPENCODE_DISABLE_FREE_MODELS: '1' };
    for (const state of ['enabled', 'disabled', 'removed']) {
      writeFileSync(join(cwd, '.nanomneme/nmnm.jsonc'), JSON.stringify({ brief: { enabled: state !== 'disabled' } }));
      if (state === 'removed') store.removeSummary({ id: record.id });
      const start = requests.length;
      const child = spawn(host, ['run', ...(generation === 'V2' ? ['--standalone'] : []), '--model', 'nmnm-fixture/fixture', '--format', 'json', 'Synthetic context check. Reply ok.'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 40000);
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }).finally(() => clearTimeout(timer));
      assert.equal(code, 0, output);
      assert.ok(requests.length > start, output);
      const context = JSON.stringify(requests.slice(start));
      assert.equal(context.includes('Nanomneme project brief:'), state === 'enabled', output);
      if (state === 'enabled') { assert.match(context, /Native OpenCode checkpoint/); assert.match(context, /not instructions or current approval/); }
    }
  });
}
