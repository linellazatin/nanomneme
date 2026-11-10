import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';
import { ExtensionRunner, SessionManager, wrapRegisteredTool } from '@earendil-works/pi-coding-agent';

import { loadPiAdapter, piHostVersion } from './host-helper.js';
import { runMemory } from '../src/store.js';

const { buildSystemPrompt } = await import(new URL('./core/system-prompt.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const customStarts = semver.gte(piHostVersion, '1.2.0');

async function fixture(t, { trusted = true, ...settings } = {}) {
  const environment = await loadPiAdapter(t, settings);
  const { cwd, loaded } = environment;
  const sessionManager = SessionManager.inMemory(cwd);
  const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, cwd, sessionManager, {});
  const errors = [];
  const notifications = [];
  runner.onError(error => errors.push(error));
  runner.setUIContext({ notify: message => notifications.push(message) });
  const base = { cwd, customPrompt: 'Synthetic base prompt', selectedTools: [] };
  runner.bindCore({}, {
    getModel: () => undefined,
    getScopedModels: () => [],
    isIdle: () => true,
    isProjectTrusted: () => trusted,
    getSignal: () => undefined,
    abort() {},
    hasPendingMessages: () => false,
    shutdown() {},
    getContextUsage: () => undefined,
    compact() {},
    getSystemPrompt: () => buildSystemPrompt(base),
  });
  t.after(() => assert.deepEqual(errors, []));
  await runner.emit({ type: 'session_start', reason: 'startup' });
  const tools = new Map([...loaded.extensions[0].tools].map(([name, tool]) => [name, wrapRegisteredTool(tool, runner)]));
  return {
    ...environment, runner, notifications,
    async tool(name, args) {
      return JSON.parse((await tools.get(name).execute('runner-call', args)).content[0].text);
    },
    async start(custom = false) {
      const result = customStarts
        ? await runner.emitBeforeAgentStart(custom
          ? { messageType: 'custom', message: { role: 'custom', customType: 'probe', content: 'probe', display: false, timestamp: 0 } }
          : { messageType: 'user', prompt: 'probe' }, base)
        : await runner.emitBeforeAgentStart('probe', undefined, base);
      return buildSystemPrompt(result.systemPromptOptions);
    },
  };
}

test('Pi runner composes first-prompt memories and guidance, then omits ordinary transient injection', async t => {
  const host = await fixture(t, { projectSettings: { autoretention: { enabled: true, always_ask: ['Ask before retaining synthetic preferences'] } } });
  const memory = runMemory({ cwd: host.cwd, operation: 'retain', input: { content: 'Synthetic project decision' } });
  const first = await host.start();
  assert.match(first, /Synthetic base prompt/);
  assert.match(first, /Synthetic project decision/);
  assert.match(first, /Ask before retaining synthetic preferences/);
  assert.ok(first.indexOf('Ask before retaining synthetic preferences') < first.indexOf(memory.id));
  const ordinary = await host.start();
  assert.doesNotMatch(ordinary, /Synthetic project decision|Ask before retaining synthetic preferences/);
});

test('Pi runner cadence counts user starts and custom starts preserve pending injection', async t => {
  const host = await fixture(t, { globalSettings: { reinjection: { enabled: true, every_n_prompts: 2 } } });
  await host.tool('retain_memory', { content: 'Synthetic cadence memory' });
  // Older hosts have no custom-start event. User cadence remains mandatory there.
  if (customStarts) assert.doesNotMatch(await host.start(true), /Synthetic cadence memory/);
  assert.match(await host.start(), /Synthetic cadence memory/);
  assert.doesNotMatch(await host.start(), /Synthetic cadence memory/);
  if (customStarts) assert.doesNotMatch(await host.start(true), /Synthetic cadence memory/);
  assert.match(await host.start(), /Synthetic cadence memory/);
  if (customStarts) {
    await host.runner.emit({ type: 'session_compact' });
    assert.doesNotMatch(await host.start(true), /Synthetic cadence memory/);
    assert.match(await host.start(), /Synthetic cadence memory/);
  }
});

test('Pi runner successful compaction and wrapped mutations refresh the next user prompt', async t => {
  const host = await fixture(t);
  const memory = await host.tool('retain_memory', { content: 'Synthetic refresh memory' });
  assert.match(await host.start(), /Synthetic refresh memory/);
  assert.doesNotMatch(await host.start(), /Synthetic refresh memory/);
  await host.runner.emit({ type: 'session_compact' });
  assert.match(await host.start(), /Synthetic refresh memory/);
  await host.tool('retain_memory', { id: memory.id, content: 'Synthetic revised memory' });
  const revised = await host.start();
  assert.match(revised, /Synthetic revised memory/);
  assert.doesNotMatch(revised, /Synthetic refresh memory/);
  await host.tool('remove_memory', { id: memory.id });
  assert.doesNotMatch(await host.start(), /Synthetic revised memory/);
  assert.equal(await host.tool('recall_memory', { id: memory.id }), null);
  assert.equal(host.notifications.length, 0);
});

test('Pi runner untrusted context excludes project files and blocks wrapped project tools', async t => {
  const host = await fixture(t, { trusted: false });
  runMemory({ cwd: host.cwd, operation: 'retain', input: { content: 'Synthetic private project memory' } });
  writeFileSync(join(host.cwd, '.nanomneme', 'nmnm.jsonc'), '{ invalid project settings');
  writeFileSync(join(host.cwd, '.nanomneme', 'nmnm-pi.json'), '{ invalid project pins');
  await host.runner.emit({ type: 'session_start', reason: 'startup' });
  await host.tool('retain_memory', { content: 'Synthetic global memory', scope: 'global' });
  const prompt = await host.start();
  assert.match(prompt, /Synthetic global memory/);
  assert.doesNotMatch(prompt, /Synthetic private project memory/);
  for (const [name, args] of [
    ['retain_memory', { content: 'Blocked project write' }],
    ['recall_memory', { id: 'missing' }],
    ['retrieve_memory', {}],
    ['remove_memory', { id: 'missing' }],
  ]) await assert.rejects(host.tool(name, args), /trusted project/);
  assert.equal(host.notifications.length, 0);
});

test('Pi runner blocked project retention does not create a missing store', async t => {
  const host = await fixture(t, { trusted: false });
  await assert.rejects(host.tool('retain_memory', { content: 'Blocked' }), /trusted project/);
  assert.equal(existsSync(join(host.cwd, '.nanomneme', 'memory.db')), false);
});
