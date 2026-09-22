import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from 'typebox';
import { MAX_TOOL_RESULT_BYTES } from '../src/response.js';
import { databasePath, runMemory } from '../src/store.js';
import { registerPiTools } from '../src/tools.js';

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), name));
}

function registeredTools(options) {
  const tools = [];
  registerPiTools({ registerTool: (tool) => tools.push(tool) }, Type, options);
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
