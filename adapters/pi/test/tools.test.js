import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from 'typebox';
import { MAX_TOOL_RESULT_BYTES } from '../src/response.js';
import { createPiLogger } from './logger-helper.js';
import { registerPiMemory } from '../src/session.js';
import { databasePath, runMemory } from '../src/store.js';
import { registerPiTools } from '../src/tools.js';

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), name));
}

function registeredTools(options = {}) {
  const tools = [];
  registerPiTools({ registerTool: (tool) => tools.push(tool) }, Type, {
    logger: createPiLogger({ sink: () => true }),
    ...options,
  });
  return new Map(tools.map((tool) => [tool.name, tool]));
}

async function executeRaw(tool, params, cwd, { trusted = true } = {}) {
  return tool.execute('call', params, undefined, undefined, {
    cwd,
    isProjectTrusted: () => trusted,
  });
}

async function execute(tool, params, cwd, options) {
  const output = await executeRaw(tool, params, cwd, options);
  return JSON.parse(output.content[0].text);
}

test('registerPiTools exposes the nanomneme 4Rs', () => {
  const tools = registeredTools();
  assert.deepEqual([...tools.keys()], ['retain_memory', 'recall_memory', 'retrieve_memory', 'remove_memory']);
  assert.equal(Object.hasOwn(tools.get('retain_memory').parameters.properties, 'store'), false);
});

test('Pi tools retain, recall, retrieve, and soft-remove through the core', async () => {
  const cwd = temporaryDirectory('nmnm-pi-tools-');
  try {
    const tools = registeredTools();
    const remove = tools.get('remove_memory');
    assert.deepEqual(Object.keys(remove.parameters.properties), ['id', 'store']);

    const retained = await execute(tools.get('retain_memory'), { content: 'Stored from Pi', tags: ['pi'] }, cwd);
    const recalled = await execute(tools.get('recall_memory'), { id: retained.id, store: 'project' }, cwd);
    const nullMetadata = await execute(tools.get('retain_memory'), { content: 'Null metadata', metadata: null }, cwd);
    const retrieved = await execute(tools.get('retrieve_memory'), { query: 'Stored', store: 'project' }, cwd);
    const removed = await execute(remove, { id: retained.id, store: 'project' }, cwd);
    const restored = await execute(tools.get('retain_memory'), { id: retained.id }, cwd);

    assert.equal(recalled.content, 'Stored from Pi');
    assert.equal(retained.metadata.source, 'pi');
    assert.equal(nullMetadata.metadata.source, 'pi');
    assert.equal(retrieved.items[0].id, retained.id);
    assert.equal(removed.mode, 'soft');
    assert.equal(restored.id, retained.id);
    assert.equal((await execute(tools.get('recall_memory'), { id: retained.id, store: 'project' }, cwd)).content, 'Stored from Pi');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('Pi retain uses the global store when scope is global', async () => {
  const cwd = temporaryDirectory('nmnm-pi-tools-global-');
  const home = process.env.HOME;
  process.env.HOME = cwd;
  try {
    const tools = registeredTools();
    const retained = await execute(tools.get('retain_memory'), { content: 'Global by scope', scope: 'global' }, cwd);

    assert.equal(retained.scope, 'global');
    assert.equal((await execute(tools.get('recall_memory'), { id: retained.id, store: 'global' }, cwd)).content, 'Global by scope');
    assert.equal(existsSync(databasePath({ cwd, store: 'project' })), false);
  } finally {
    process.env.HOME = home;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('Pi retain patches preserve an existing source', async () => {
  const cwd = temporaryDirectory('nmnm-pi-tools-source-');
  try {
    const tools = registeredTools();
    const original = runMemory({ cwd, store: 'project', operation: 'retain', input: { content: 'From Claude', metadata: { source: 'claude-code' } } });
    const patched = await execute(tools.get('retain_memory'), { id: original.id, content: 'Patched by Pi' }, cwd);

    assert.equal(patched.metadata.source, 'claude-code');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('Pi mutation tools notify the adapter, while reads do not', async () => {
  const cwd = temporaryDirectory('nmnm-pi-tools-mutations-');
  try {
    const mutations = [];
    const tools = registeredTools({ onMutation: (reason) => mutations.push(reason) });
    const retained = await execute(tools.get('retain_memory'), { content: 'Refresh after mutation' }, cwd);
    await execute(tools.get('recall_memory'), { id: retained.id }, cwd);
    await execute(tools.get('retrieve_memory'), {}, cwd);
    assert.deepEqual(mutations, ['retain']);
    await execute(tools.get('remove_memory'), { id: retained.id }, cwd);
    assert.deepEqual(mutations, ['retain', 'remove']);
    await execute(tools.get('remove_memory'), { id: '00000000-0000-4000-8000-000000000001' }, cwd);
    assert.deepEqual(mutations, ['retain', 'remove']);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('session and tools share one lazy logger without session records; fresh registration applies settings', async () => {
  const cwd = temporaryDirectory('nmnm-pi-shared-project-');
  const home = temporaryDirectory('nmnm-pi-shared-home-');
  const agentDir = join(home, 'pi-agent');
  const file = join(home, '.local', 'share', 'nanomneme', 'logs', 'nmnm-pi.jsonl');
  const ctx = { cwd, isProjectTrusted: () => true, ui: { notify: () => {} } };
  const register = () => {
    const tools = new Map();
    const events = new Map();
    const commands = new Map();
    const pi = {
      registerTool: (tool) => tools.set(tool.name, tool),
      registerCommand: (name, command) => commands.set(name, command),
      on: (name, handler) => events.set(name, handler),
    };
    const memory = registerPiMemory(pi, { home, agentDir });
    registerPiTools(pi, Type, { logger: memory.logger, onMutation: memory.refresh });
    return { tools, events, commands };
  };
  try {
    mkdirSync(agentDir);
    writeFileSync(join(agentDir, 'nmnm.jsonc'), '{ "logging": { "enabled": true } }');
    const first = register();
    first.events.get('session_start')({}, ctx);
    await first.commands.get('memory').handler('status', ctx);
    assert.equal(existsSync(file), false);
    const retained = await execute(first.tools.get('retain_memory'), { content: 'One model tool outcome' }, cwd);
    assert.equal(retained.content, 'One model tool outcome');
    assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 1);

    writeFileSync(join(agentDir, 'nmnm.jsonc'), '{ "logging": { "enabled": false } }');
    const reloaded = register();
    reloaded.events.get('session_start')({}, ctx);
    assert.equal((await execute(reloaded.tools.get('retain_memory'), { content: 'No diagnostic after reload' }, cwd)).content, 'No diagnostic after reload');
    assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('registered Pi tools require global opt-in before writing diagnostics', async () => {
  const cwd = temporaryDirectory('nmnm-pi-opt-in-project-');
  const home = temporaryDirectory('nmnm-pi-opt-in-home-');
  const agentDir = join(home, 'pi-agent');
  const file = join(home, '.local', 'share', 'nanomneme', 'logs', 'nmnm-pi.jsonl');
  try {
    mkdirSync(agentDir);
    const disabled = registeredTools({ logger: createPiLogger({ home, agentDir }) });
    const first = await execute(disabled.get('retain_memory'), { content: 'No logging without opt-in' }, cwd);
    assert.equal(first.content, 'No logging without opt-in');
    assert.equal(existsSync(file), false);

    writeFileSync(join(agentDir, 'nmnm.jsonc'), '{ "logging": { "enabled": true } }\n');
    const enabled = registeredTools({ logger: createPiLogger({ home, agentDir }) });
    const second = await execute(enabled.get('retain_memory'), { content: 'Opted-in private content' }, cwd);
    assert.equal(second.content, 'Opted-in private content');
    const row = JSON.parse(readFileSync(file, 'utf8').trim());
    assert.deepEqual([row.operation, row.status, row.event], ['retain', 'ok', 'memory.retained']);
    assert.equal(JSON.stringify(row).includes(second.id), false);
    assert.equal(JSON.stringify(row).includes('Opted-in private content'), false);

    writeFileSync(join(agentDir, 'nmnm.jsonc'), '{ "logging": { "enabled": 1 } }\n');
    const invalid = registeredTools({ logger: createPiLogger({ home, agentDir }) });
    assert.equal((await execute(invalid.get('retain_memory'), { content: 'Invalid config still retains' }, cwd)).content, 'Invalid config still retains');
    assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('Pi tools emit privacy-bounded outcomes for the 4Rs', async () => {
  const cwd = temporaryDirectory('nmnm-pi-tools-logs-');
  const records = [];
  const logger = createPiLogger({
    enabled: true,
    sink: (record) => records.push(record),
    now: () => new Date('2026-09-27T04:30:00.000Z'),
  });
  const ctx = {
    cwd,
    isProjectTrusted: () => true,
    sessionManager: { getSessionId: () => 'host-session-7' },
  };
  try {
    const tools = registeredTools({ logger });
    const retained = JSON.parse((await tools.get('retain_memory').execute('call', {
      content: 'private template memory',
      tags: ['private'],
    }, undefined, undefined, ctx)).content[0].text);
    await tools.get('recall_memory').execute('call', { id: retained.id }, undefined, undefined, ctx);
    await tools.get('retrieve_memory').execute('call', { query: 'private template' }, undefined, undefined, ctx);
    await tools.get('remove_memory').execute('call', { id: retained.id }, undefined, undefined, ctx);
    await tools.get('recall_memory').execute('call', { id: retained.id }, undefined, undefined, ctx);

    assert.deepEqual(records.map((record) => [record.operation, record.status, record.event]), [
      ['retain', 'ok', 'memory.retained'],
      ['recall', 'ok', 'memory.recalled'],
      ['retrieve', 'ok', 'memory.retrieved'],
      ['remove', 'ok', 'memory.removed'],
      ['recall', 'not_found', 'memory.recall_not_found'],
    ]);
    assert.deepEqual(records.map((record) => record.context.session_id), [
      'host-session-7', 'host-session-7', 'host-session-7', 'host-session-7', 'host-session-7',
    ]);
    assert.equal(JSON.stringify(records).includes('private template memory'), false);
    assert.equal(JSON.stringify(records).includes('private template'), false);
    assert.equal(JSON.stringify(records).includes(retained.id), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('Pi project tools log blocked outcomes', async () => {
  const cwd = temporaryDirectory('nmnm-pi-tools-blocked-logs-');
  const records = [];
  const logger = createPiLogger({ enabled: true, sink: (record) => records.push(record) });
  const ctx = {
    cwd,
    isProjectTrusted: () => false,
    sessionManager: { getSessionId: () => 'host-session-8' },
  };
  try {
    const tools = registeredTools({ logger });
    await assert.rejects(tools.get('retain_memory').execute('call', { content: 'blocked' }, undefined, undefined, ctx));
    await assert.rejects(tools.get('recall_memory').execute('call', { id: '00000000-0000-4000-8000-000000000001' }, undefined, undefined, ctx));
    await assert.rejects(tools.get('retrieve_memory').execute('call', {}, undefined, undefined, ctx));
    await assert.rejects(tools.get('remove_memory').execute('call', { id: '00000000-0000-4000-8000-000000000001' }, undefined, undefined, ctx));

    assert.deepEqual(records.map((record) => [record.operation, record.status, record.event, record.context.session_id]), [
      ['retain', 'blocked', 'memory.retain_blocked', 'host-session-8'],
      ['recall', 'blocked', 'memory.recall_blocked', 'host-session-8'],
      ['retrieve', 'blocked', 'memory.retrieve_blocked', 'host-session-8'],
      ['remove', 'blocked', 'memory.remove_blocked', 'host-session-8'],
    ]);
    assert.deepEqual(records.map((record) => [record.duration_ms, record.error]), [
      [null, null], [null, null], [null, null], [null, null],
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('Pi tools log core failure details without changing the thrown error', async () => {
  const cwd = temporaryDirectory('nmnm-pi-tools-failed-logs-');
  const records = [];
  const logger = createPiLogger({ enabled: true, sink: (record) => records.push(record) });
  const ctx = {
    cwd,
    isProjectTrusted: () => true,
    sessionManager: { getSessionId: () => 'host-session-9' },
  };
  try {
    const tools = registeredTools({ logger });
    await assert.rejects(
      tools.get('retain_memory').execute('call', { content: '' }, undefined, undefined, ctx),
      /content must be a non-empty string/i,
    );

    assert.deepEqual(records.map((record) => ({
      operation: record.operation,
      status: record.status,
      event: record.event,
      context: record.context,
      duration_ms: typeof record.duration_ms,
      error: record.error,
    })), [{
      operation: 'retain',
      status: 'failed',
      event: 'memory.retain_failed',
      context: { session_id: 'host-session-9' },
      duration_ms: 'number',
      error: {
        kind: 'validation',
        code: 'retain_failed',
        message: 'content must be a non-empty string',
        retryable: false,
        cause_kind: 'TypeError',
      },
    }]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a throwing diagnostic sink does not change successful or failed tool operations', async () => {
  const cwd = temporaryDirectory('nmnm-pi-tools-sink-failure-');
  const logger = createPiLogger({ enabled: true, sink: () => { throw new Error('private sink failure'); } });
  const tools = registeredTools({ logger });
  const ctx = { cwd, isProjectTrusted: () => true };
  try {
    const retained = JSON.parse((await tools.get('retain_memory').execute('call', {
      content: 'Sink failure must not block retention',
    }, undefined, undefined, ctx)).content[0].text);
    const recalled = await tools.get('recall_memory').execute('call', { id: retained.id }, undefined, undefined, ctx);
    assert.equal(JSON.parse(recalled.content[0].text).id, retained.id);
    await assert.rejects(
      tools.get('retain_memory').execute('call', { content: '' }, undefined, undefined, ctx),
      /content must be a non-empty string/i,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('Pi tools return bounded valid JSON for oversized memory results', async () => {
  const cwd = temporaryDirectory('nmnm-pi-tools-bounded-');
  try {
    const tools = registeredTools();
    const content = 'large memory '.repeat(5000);
    const retained = await executeRaw(tools.get('retain_memory'), { content }, cwd);
    const retainedResult = JSON.parse(retained.content[0].text);
    assert.equal(retainedResult.truncated, true);
    assert.ok(Buffer.byteLength(retained.content[0].text, 'utf8') <= MAX_TOOL_RESULT_BYTES);
    assert.equal(Object.hasOwn(retained.details, 'result'), false);

    const id = retainedResult.memory.id;
    for (const output of [
      await executeRaw(tools.get('recall_memory'), { id }, cwd),
      await executeRaw(tools.get('retrieve_memory'), {}, cwd),
    ]) {
      assert.equal(JSON.parse(output.content[0].text).truncated, true);
      assert.ok(Buffer.byteLength(output.content[0].text, 'utf8') <= MAX_TOOL_RESULT_BYTES);
      assert.equal(Object.hasOwn(output.details, 'result'), false);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('Pi project tools reject untrusted or missing trust contexts while global tools remain available', async () => {
  const cwd = temporaryDirectory('nmnm-pi-tools-untrusted-');
  const previousHome = process.env.HOME;
  process.env.HOME = cwd;
  try {
    const tools = registeredTools();
    const id = '00000000-0000-4000-8000-000000000001';
    const denied = { trusted: false };

    await assert.rejects(execute(tools.get('retain_memory'), { content: 'blocked' }, cwd, denied), /trusted project.*global/i);
    await assert.rejects(execute(tools.get('recall_memory'), { id }, cwd, denied), /trusted project.*global/i);
    await assert.rejects(execute(tools.get('retrieve_memory'), {}, cwd, denied), /trusted project.*global/i);
    await assert.rejects(execute(tools.get('remove_memory'), { id }, cwd, denied), /trusted project.*global/i);
    await assert.rejects(
      tools.get('retrieve_memory').execute('call', {}, undefined, undefined, { cwd }),
      /trusted project.*global/i,
    );

    const retained = await execute(tools.get('retain_memory'), { content: 'Allowed global memory', scope: 'global' }, cwd, denied);
    assert.equal((await execute(tools.get('recall_memory'), { id: retained.id, store: 'global' }, cwd, denied)).content, 'Allowed global memory');
    assert.equal((await execute(tools.get('retrieve_memory'), { store: 'global' }, cwd, denied)).total, 1);
    assert.equal((await execute(tools.get('remove_memory'), { id: retained.id, store: 'global' }, cwd, denied)).mode, 'soft');
  } finally {
    process.env.HOME = previousHome;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('Pi project tools reject a throwing trust probe with the standard explanation', async () => {
  const cwd = temporaryDirectory('nmnm-pi-tools-throwing-trust-');
  try {
    const tools = registeredTools();
    const ctx = {
      cwd,
      isProjectTrusted: () => { throw new Error('trust unavailable'); },
    };
    await assert.rejects(
      tools.get('retain_memory').execute('call', { content: 'blocked' }, undefined, undefined, ctx),
      /trusted project.*global/i,
    );
    await assert.rejects(
      tools.get('recall_memory').execute('call', { id: '00000000-0000-4000-8000-000000000001', store: 'project' }, undefined, undefined, ctx),
      /trusted project.*global/i,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('Pi read and remove tools leave a missing selected store absent', async () => {
  const cwd = temporaryDirectory('nmnm-pi-tools-missing-');
  try {
    const tools = registeredTools();
    const id = '00000000-0000-4000-8000-000000000001';
    const path = databasePath({ cwd, store: 'project' });

    assert.equal(await execute(tools.get('recall_memory'), { id, store: 'project' }, cwd), null);
    assert.equal(existsSync(path), false);
    assert.deepEqual(await execute(tools.get('retrieve_memory'), { store: 'project' }, cwd), { total: 0, items: [] });
    assert.equal(existsSync(path), false);
    assert.equal(await execute(tools.get('remove_memory'), { id, store: 'project' }, cwd), null);
    assert.equal(existsSync(path), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
