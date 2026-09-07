import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from 'typebox';
import { databasePath } from '../src/store.js';
import { registerPiTools } from '../src/tools.js';

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), name));
}

function registeredTools() {
  const tools = [];
  registerPiTools({ registerTool: (tool) => tools.push(tool) }, Type);
  return new Map(tools.map((tool) => [tool.name, tool]));
}

async function execute(tool, params, cwd) {
  const output = await tool.execute('call', params, null, null, { cwd });
  return JSON.parse(output.content[0].text);
}

test('registerPiTools exposes the nanomneme 4Rs', () => {
  assert.deepEqual([...registeredTools().keys()], ['retain_memory', 'recall_memory', 'retrieve_memory', 'remove_memory']);
});

test('Pi tools retain, recall, retrieve, and purge through the core', async () => {
  const cwd = temporaryDirectory('nmnm-pi-tools-');
  try {
    const tools = registeredTools();
    const retained = await execute(tools.get('retain_memory'), { content: 'Stored from Pi', store: 'project', tags: ['pi'] }, cwd);
    const recalled = await execute(tools.get('recall_memory'), { id: retained.id, store: 'project' }, cwd);
    const retrieved = await execute(tools.get('retrieve_memory'), { query: 'Stored', store: 'project' }, cwd);
    const removed = await execute(tools.get('remove_memory'), { id: retained.id, store: 'project', purge: true }, cwd);

    assert.equal(recalled.content, 'Stored from Pi');
    assert.equal(retrieved.items[0].id, retained.id);
    assert.equal(removed.mode, 'purge');
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
