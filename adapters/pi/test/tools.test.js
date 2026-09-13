import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from 'typebox';
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

async function execute(tool, params, cwd) {
  const output = await tool.execute('call', params, null, null, { cwd });
  return JSON.parse(output.content[0].text);
}

test('registerPiTools exposes the nanomneme 4Rs', () => {
  assert.deepEqual([...registeredTools().keys()], ['retain_memory', 'recall_memory', 'retrieve_memory', 'remove_memory']);
});

test('Pi tools retain, recall, retrieve, and soft-remove through the core', async () => {
  const cwd = temporaryDirectory('nmnm-pi-tools-');
  try {
    const tools = registeredTools();
    const remove = tools.get('remove_memory');
    assert.deepEqual(Object.keys(remove.parameters.properties), ['id', 'store']);

    const retained = await execute(tools.get('retain_memory'), { content: 'Stored from Pi', store: 'project', tags: ['pi'] }, cwd);
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
