import test from 'node:test';
import assert from 'node:assert/strict';
import semver from 'semver';
import { createAgentSession, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';

import { loadPiAdapter, piHostVersion } from './host-helper.js';
import { runMemory } from '../src/store.js';

const supportsThreading = semver.gte(piHostVersion, '1.5.1');
const requireThreading = process.env.NMNM_PI_REQUIRE_THREADING_TESTS === '1';
const threadingOptions = { skip: !supportsThreading && !requireThreading ? 'Anthropic threading was introduced in Pi 1.5.1' : false };
// Resolve newer APIs only on applicable hosts. Missing APIs on those hosts must fail.
const api = supportsThreading ? await import('@earendil-works/pi-ai/api/anthropic-messages') : undefined;
const ai = supportsThreading ? await import('@earendil-works/pi-ai') : undefined;
const warming = supportsThreading ? await import(new URL('./cache-warming.js', import.meta.resolve('@earendil-works/pi-ai'))) : undefined;

function response(model, id) {
  const events = [
    { type: 'message_start', message: { id, model: model.id, role: 'assistant', content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
}

async function fixture(t, nativeSystemMessages = false, settings = {}) {
  assert.ok(supportsThreading, `Threading coverage requires Pi >=1.5.1; resolved ${piHostVersion}`);
  const host = await loadPiAdapter(t, settings);
  const model = {
    id: 'synthetic-thread-model', name: 'Synthetic thread model', api: 'anthropic-messages', provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com', input: ['text'], reasoning: false, contextWindow: 10000, maxTokens: 100,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsMidConvoSystemMessages: nativeSystemMessages },
  };
  const requests = [];
  const contexts = [];
  let rejectContinuation = false;
  // Fake only the transport boundary; Pi builds requests, parses SSE, and owns thread state.
  const fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(structuredClone(body));
    if (rejectContinuation && body.thread?.type === 'continue') {
      rejectContinuation = false;
      return new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Synthetic expired thread', details: { error_code: 'thread_not_found' } } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    return response(model, `synthetic-reply-${requests.length}`);
  };
  const sessionManager = SessionManager.inMemory(host.cwd);
  const runtime = await ModelRuntime.create({ authPath: `${host.agentDir}/auth.json`, modelsPath: null, refreshOnCreate: false });
  t.mock.method(runtime, 'hasConfiguredAuth', () => true);
  t.mock.method(runtime, 'streamSimple', (selectedModel, context, options) => {
    contexts.push({ context, options });
    return api.stream(selectedModel, ai.normalizeContext(context), { ...options, fetch, apiKey: 'synthetic-api-key', cacheRetention: 'short', maxRetries: 0 });
  });
  const resourceLoader = {
    getExtensions: () => host.loaded,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => 'Synthetic base prompt',
    getAppendSystemPrompt: () => [],
    extendResources() {},
  };
  const { session } = await createAgentSession({
    cwd: host.cwd, agentDir: host.agentDir, model, modelRuntime: runtime, sessionManager, resourceLoader,
    noTools: 'builtin', thinkingLevel: 'off',
    settingsManager: SettingsManager.inMemory({ cacheWarming: 'off', compaction: { enabled: false }, retry: { enabled: false } }),
  });
  const errors = [];
  t.after(() => {
    session.dispose();
    ai.cleanupSessionResources(sessionManager.getSessionId());
    assert.deepEqual(errors, []);
  });
  await session.bindExtensions({ onError: error => errors.push(error) });
  return {
    ...host, session, requests, contexts,
    rejectNextContinuation() { rejectContinuation = true; },
    async prompt() {
      await session.prompt('Synthetic user prompt');
      const answer = session.messages.findLast(message => message.role === 'assistant');
      assert.equal(answer?.stopReason, 'stop', answer?.errorMessage);
      return requests.at(-1);
    },
    async warm() {
      const { context, options } = contexts.at(-1);
      const answer = await api.stream(model, ai.normalizeContext(context), {
        ...warming.getCacheWarmingRequestOptions({ ...options, cacheRetention: 'short' }, new AbortController().signal), fetch, apiKey: 'synthetic-api-key',
      }).result();
      assert.equal(answer.stopReason, 'stop', answer.errorMessage);
      return requests.at(-1);
    },
  };
}

for (const nativeSystemMessages of [false, true]) {
  test(`Pi threading preserves adapter context through refresh/removal (native system messages: ${nativeSystemMessages})`, threadingOptions, async t => {
    const host = await fixture(t, nativeSystemMessages);
    const memory = runMemory({ cwd: host.cwd, operation: 'retain', input: { content: 'Synthetic original memory' } });
    const first = await host.prompt();
    assert.equal(first.thread.type, 'create');
    assert.match(JSON.stringify(first.system), /Synthetic original memory/);
    assert.deepEqual(first.tools.map(tool => tool.name), ['retain_memory', 'recall_memory', 'retrieve_memory', 'remove_memory']);
    const ordinary = await host.prompt();
    assert.equal(ordinary.thread.type, 'create');
    assert.doesNotMatch(JSON.stringify(ordinary.system), /Synthetic original memory/);
    const stable = await host.prompt();
    assert.equal(stable.thread.type, 'continue');
    assert.equal(stable.system, undefined);
    assert.equal(stable.tools, undefined);
    assert.equal(stable.messages.length, 1);

    runMemory({ cwd: host.cwd, operation: 'retain', input: { id: memory.id, content: 'Synthetic updated memory' } });
    await host.session.prompt('/memory refresh');
    assert.equal(host.requests.length, 3, 'slash refresh must not issue a provider request');
    const refreshed = await host.prompt();
    assert.equal(refreshed.thread.type, 'create');
    assert.match(JSON.stringify(refreshed.system), /Synthetic updated memory/);
    assert.doesNotMatch(JSON.stringify(refreshed.system), /Synthetic original memory/);
    await host.session.prompt(`/memory remove project ${memory.id}`);
    const removed = await host.prompt();
    assert.equal(removed.thread.type, 'create');
    assert.doesNotMatch(JSON.stringify(removed.system), /Synthetic original memory|Synthetic updated memory/);
    assert.equal(runMemory({ cwd: host.cwd, operation: 'recall', input: { id: memory.id } }), null);
    assert.ok(host.session.messages.filter(message => message.role === 'system').every(message => !JSON.stringify(message).includes('Synthetic original memory') && !JSON.stringify(message).includes('Synthetic updated memory')), 'transient memory must not be persisted in the transcript');
  });
}

test('Pi threading cache-warming replay leaves the active continuation intact', threadingOptions, async t => {
  const host = await fixture(t);
  await host.prompt();
  const beforeWarm = structuredClone(host.session.messages);
  const replyId = 'synthetic-reply-1';
  const warm = await host.warm();
  assert.equal(warm.thread, undefined);
  assert.equal(warm.max_tokens, 1);
  assert.deepEqual(host.session.messages, beforeWarm, 'warming must not add conversation messages');
  const continued = await host.prompt();
  assert.deepEqual(continued.thread, { type: 'continue', previous_message_id: replyId });
  assert.equal(continued.messages.length, 1);
});

test('Pi threading rejected continuation resends complete injected context', threadingOptions, async t => {
  const host = await fixture(t, false, { globalSettings: { reinjection: { enabled: true, every_n_prompts: 1 } } });
  runMemory({ cwd: host.cwd, operation: 'retain', input: { content: 'Synthetic fallback memory' } });
  await host.prompt();
  host.rejectNextContinuation();
  const retried = await host.prompt();
  assert.deepEqual(host.requests.map(request => request.thread.type), ['create', 'continue', 'create']);
  assert.match(JSON.stringify(retried.system), /Synthetic base prompt/);
  assert.match(JSON.stringify(retried.system), /Synthetic fallback memory/);
  assert.equal(retried.messages.length, 3);
  assert.equal(retried.tools.length, 4);
  const answer = host.session.messages.findLast(message => message.role === 'assistant');
  assert.ok(answer.diagnostics.some(diagnostic => diagnostic.type === 'anthropic_thread_fallback'));
  assert.equal((await host.prompt()).thread.type, 'continue');
});
