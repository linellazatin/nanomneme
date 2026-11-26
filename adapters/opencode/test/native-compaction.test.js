import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { open } from '@openlines/nmnm-core';

const nativeSummary = '## Objective\n- Evaluate storage.\n\n## Requirements\n- Planning only; implementation needs approval.\n\n## Decisions\n- No implementation decision.\n\n## Work State\n### Completed\n- Compared options.\n### Active\n- Planning.\n### Blocked\n- Approval required.\n\n## Next Move\n1. Request approval.\n\n## Relevant Files\n- (none)\n\n## Important Context\n- Planning only.';
const leafStrings = value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(leafStrings) : [];

for (const generation of ['V1', 'V2']) {
  const host = process.env[`NMNM_OPENCODE_${generation}`];
  test(`native OpenCode ${generation} captures live completed checkpoints without extra inference`, { skip: host ? false : `Set NMNM_OPENCODE_${generation}`, timeout: 120000 }, async t => {
    const root = mkdtempSync(join(tmpdir(), 'nmnm-opencode-compact-')), home = join(root, 'home'), cwd = join(root, 'project');
    for (const p of [home, cwd, join(home, 'config/opencode'), join(cwd, '.nanomneme')]) mkdirSync(p, { recursive: true });
    const requests = []; let stage = 'seed', scenario, emitted;
    const provider = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      if (!req.url.includes('/chat/completions')) { res.end('{}'); return; }
      const body = JSON.parse(Buffer.concat(chunks)); requests.push(body);
      if (stage === 'compact' && scenario === 'failed') { res.statusCode = 400; res.setHeader('content-type', 'application/json'); res.end('{"error":{"message":"Synthetic compaction failure","type":"invalid_request_error"}}'); return; }
      let text = stage === 'compact' ? nativeSummary : 'Planning only.';
      const instruction = leafStrings(body).find(text => text.includes('Nanomneme optional project checkpoint:') && text.includes('"as_of":'));
      if (stage === 'compact' && instruction && !['missing', 'failed'].includes(scenario)) {
        const token = instruction.match(/NMNM_SUMMARY_([0-9a-f-]+)_BEGIN/)[1];
        emitted = { format: 'nanomneme/project-summary', format_version: 1, title: 'Native OpenCode capture', as_of: instruction.match(/"as_of":"([^"]+)"/)[1], objective: 'Evaluate storage.', state: { status: 'in-progress', outcome: 'Design only.', verification: 'No implementation.' }, decisions: [], open_questions: ['Recovery?'], next_steps: ['Ask for approval.'], authorization: { allowed: ['Assess.'], not_authorized: ['Implement.'] }, references: [] };
        const json = scenario === 'invalid' ? '{broken json' : JSON.stringify(emitted);
        text += `\nNMNM_SUMMARY_${token}_BEGIN\n${json}\nNMNM_SUMMARY_${token}_END`;
      }
      const base = { id: 'chatcmpl_fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture' };
      res.setHeader('content-type', 'text/event-stream');
      res.end([
        { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
        { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } },
      ].map(data => `data: ${JSON.stringify(data)}\n\n`).join('') + 'data: [DONE]\n\n');
    });
    await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
    const adapter = process.env.NMNM_ADAPTER_ROOT || fileURLToPath(new URL('../', import.meta.url));
    const observer = join(root, 'observer'); mkdirSync(observer);
    writeFileSync(join(observer, 'package.json'), '{"name":"nmnm-capture-observer","type":"module","main":"index.js"}');
    writeFileSync(join(observer, 'index.js'), `export default {id:'nmnm-capture-observer',async setup(api){
      await api.session.hook('retry',e=>{e.decision={retry:false};});
      return (await api.rpc.register({id:'nmnm-capture-observer',events:{},methods:{probe:{input:{},output:{}}}},{async probe(i){
        if(i.action==='create')return api.session.create({location:{directory:i.directory},title:'Disposable capture test',model:{providerID:'local',id:'fixture'}});
        if(i.action==='prompt'){await api.session.prompt({sessionID:i.sessionID,text:'Plan only.'});await api.session.wait({sessionID:i.sessionID});}
        if(i.action==='compact'){await api.session.compact({sessionID:i.sessionID});await api.session.wait({sessionID:i.sessionID});}
        return {};
      }})).dispose;
    }};`);
    const baseURL = `http://127.0.0.1:${provider.address().port}/v1`;
    writeFileSync(join(home, 'config/opencode/opencode.json'), JSON.stringify(generation === 'V2' ? {
      plugins: [adapter, observer], model: 'local/fixture', compaction: { background: false },
      providers: { local: { name: 'Local', package: '@opencode/ai/providers/openai-compatible', settings: { baseURL }, models: { fixture: { modelID: 'fixture', capabilities: { tools: true, input: ['text'], output: ['text'] }, limit: { context: 32768, output: 1024 } } } } },
    } : {
      plugin: [adapter], model: 'local/fixture', provider: { local: { name: 'Local', npm: '@ai-sdk/openai-compatible', options: { baseURL, apiKey: 'synthetic-not-a-secret' }, models: { fixture: { name: 'Fixture', limit: { context: 32768, output: 1024 } } } } },
    }));
    const env = { PATH: process.env.PATH, HOME: home, TERM: 'dumb', XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache'), XDG_STATE_HOME: join(home, 'state'), OPENCODE_DISABLE_FREE_MODELS: '1' };
    const server = spawn(host, ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', spawnError; server.on('error', error => { spawnError = error; }); server.stdout.on('data', chunk => { output += chunk; }); server.stderr.on('data', chunk => { output += chunk; });
    t.after(async () => {
      if (server.exitCode === null && !spawnError) {
        const exited = new Promise(resolve => server.once('close', resolve)), timer = setTimeout(() => server.kill('SIGKILL'), 5000);
        server.kill('SIGTERM'); await exited; clearTimeout(timer);
      }
      provider.closeAllConnections(); provider.close(); rmSync(root, { recursive: true, force: true });
    });
    const deadline = Date.now() + 30000; let address, password;
    while (!(address && (generation === 'V1' || password))) {
      if (spawnError) throw spawnError;
      assert.equal(server.exitCode, null, output); assert.ok(Date.now() < deadline, 'native server startup timed out');
      address = output.match(/server listening on (http:\/\/\S+)/)?.[1]; password = output.match(/server password (\S+)/)?.[1];
      await delay(30);
    }
    async function request(path, input) {
      for (let attempt = 0; ; attempt++) {
        const response = await fetch(address + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-opencode-directory': encodeURIComponent(cwd), ...(password ? { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } : {}) }, body: JSON.stringify(input), signal: AbortSignal.timeout(25000) });
        const text = await response.text(), result = text ? JSON.parse(text) : {};
        if (response.status === 400 && JSON.stringify(result).includes('rpc.unavailable') && attempt < 99) { await delay(50); continue; }
        assert.equal(response.status, 200, JSON.stringify(result)); return generation === 'V2' ? result.output : result;
      }
    }
    const probe = input => request('/api/rpc/nmnm-capture-observer/probe', { input });
    const create = () => generation === 'V2' ? probe({ action: 'create', directory: cwd }) : request('/session', { title: 'Disposable capture test' });
    const prompt = sessionID => generation === 'V2' ? probe({ action: 'prompt', sessionID }) : request(`/session/${sessionID}/message`, { model: { providerID: 'local', modelID: 'fixture' }, parts: [{ type: 'text', text: 'Plan only.' }] });
    const compact = sessionID => generation === 'V2' ? probe({ action: 'compact', sessionID }) : request(`/session/${sessionID}/summarize`, { providerID: 'local', modelID: 'fixture' });
    const path = join(cwd, '.nanomneme/memory.db'), counts = [];
    for (scenario of ['baseline', 'valid', 'missing', 'invalid', 'failed']) {
      if (existsSync(path)) { const db = open(path); try { for (const record of db.export()) db.remove({ id: record.id, mode: 'purge' }); } finally { db.close(); } }
      writeFileSync(join(cwd, '.nanomneme/nmnm.jsonc'), JSON.stringify({ summary: { autocapture: { enabled: scenario !== 'baseline' } }, brief: { enabled: true } }));
      stage = 'seed'; const session = await create(); await prompt(session.id); const start = requests.length;
      stage = 'compact'; await compact(session.id);
      if (scenario !== 'failed') counts.push(requests.length - start);
      if (scenario === 'valid') {
        const until = Date.now() + 5000;
        while (Date.now() < until) {
          let saved = false;
          if (existsSync(path)) {
            const reader = open(path, { create: false, readOnly: true });
            try { saved = reader.export().length === 1; } finally { reader.close(); }
          }
          if (saved) break;
          await delay(20);
        }
        assert.equal(existsSync(path), true, 'a completed native checkpoint must be saved');
        const db = open(path, { create: false, readOnly: true }); let id;
        try { const records = db.export(); assert.equal(records.length, 1); const record = records[0]; id = record.id; assert.equal(record.metadata.source, 'opencode'); assert.deepEqual(record.metadata.summary, emitted); assert.ok(record.metadata.summary_capture.id); assert.deepEqual(db.brief().source_ids, [id]); } finally { db.close(); }
        stage = 'fresh'; const fresh = await create(); const before = requests.length; await prompt(fresh.id);
        assert.match(JSON.stringify(requests.slice(before)), /Nanomneme project brief:/); assert.ok(JSON.stringify(requests.slice(before)).includes(id));
      } else if (existsSync(path)) {
        const db = open(path, { create: false, readOnly: true }); try { assert.equal(db.export().length, 0, scenario); } finally { db.close(); }
      }
    }
    assert.ok(counts[0] > 0); assert.ok(counts.every(count => count === counts[0]), `capture cannot add requests: ${counts}`);
    assert.equal(existsSync(join(home, '.local/share/nanomneme/memory.db')), false);
    t.diagnostic(`Native ${generation} requests per baseline/valid/missing/invalid compaction: ${counts.join('/')}`);
  });
}
