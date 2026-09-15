import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { databasePath, runMemory } from '../src/store.js';
import { TOOL_DEFINITIONS, handleTool } from '../src/operations.js';

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), name));
}

function call(name, params, ctx, options) {
  return JSON.parse(handleTool(name, params, ctx, options).text);
}

test('TOOL_DEFINITIONS exposes the nanomneme 4Rs in order', () => {
  assert.deepEqual(TOOL_DEFINITIONS.map((tool) => tool.name), ['retain_memory', 'recall_memory', 'retrieve_memory', 'remove_memory']);
});

test('handlers retain, recall, retrieve, and soft-remove through the core', () => {
  const cwd = temporaryDirectory('nmnm-opencode-ops-');
  try {
    const retained = call('retain_memory', { content: 'Stored from OpenCode', tags: ['opencode'] }, { cwd });
    const recalled = call('recall_memory', { id: retained.id, store: 'project' }, { cwd });
    const nullMetadata = call('retain_memory', { content: 'Null metadata', metadata: null }, { cwd });
    const retrieved = call('retrieve_memory', { query: 'Stored', store: 'project' }, { cwd });
    const removed = call('remove_memory', { id: retained.id, store: 'project' }, { cwd });
    const restored = call('retain_memory', { id: retained.id }, { cwd });

    assert.equal(recalled.content, 'Stored from OpenCode');
    assert.equal(retained.metadata.source, 'opencode');
    assert.equal(nullMetadata.metadata.source, 'opencode');
    assert.equal(retrieved.items[0].id, retained.id);
    assert.equal(removed.mode, 'soft');
    assert.equal(restored.id, retained.id);
    assert.equal(call('recall_memory', { id: retained.id, store: 'project' }, { cwd }).content, 'Stored from OpenCode');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('opencode retain uses the global store when scope is global', () => {
  const cwd = temporaryDirectory('nmnm-opencode-ops-global-');
  const home = temporaryDirectory('nmnm-opencode-home-');
  try {
    const retained = call('retain_memory', { content: 'Global by scope', scope: 'global' }, { cwd, home, platform: 'darwin' });

    assert.equal(retained.scope, 'global');
    assert.equal(call('recall_memory', { id: retained.id, store: 'global' }, { cwd, home, platform: 'darwin' }).content, 'Global by scope');
    assert.equal(existsSync(databasePath({ cwd, store: 'project' })), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('opencode retain patches preserve an existing source', () => {
  const cwd = temporaryDirectory('nmnm-opencode-ops-source-');
  try {
    const original = runMemory({ cwd, store: 'project', operation: 'retain', input: { content: 'From Pi', metadata: { source: 'pi' } } });
    const patched = call('retain_memory', { id: original.id, content: 'Patched by OpenCode' }, { cwd });

    assert.equal(patched.metadata.source, 'pi');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('mutation handlers notify the adapter, while reads do not', () => {
  const cwd = temporaryDirectory('nmnm-opencode-ops-mutations-');
  try {
    const mutations = [];
    const options = { onMutation: (reason) => mutations.push(reason) };
    const retained = call('retain_memory', { content: 'Refresh after mutation' }, { cwd }, options);
    call('recall_memory', { id: retained.id }, { cwd }, options);
    call('retrieve_memory', {}, { cwd }, options);
    assert.deepEqual(mutations, ['retain']);
    call('remove_memory', { id: retained.id }, { cwd }, options);
    assert.deepEqual(mutations, ['retain', 'remove']);
    call('remove_memory', { id: '00000000-0000-4000-8000-000000000001' }, { cwd }, options);
    assert.deepEqual(mutations, ['retain', 'remove']);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('read and remove handlers leave a missing selected store absent', () => {
  const cwd = temporaryDirectory('nmnm-opencode-ops-missing-');
  try {
    const id = '00000000-0000-4000-8000-000000000001';
    const path = databasePath({ cwd, store: 'project' });

    assert.equal(call('recall_memory', { id, store: 'project' }, { cwd }), null);
    assert.equal(existsSync(path), false);
    assert.deepEqual(call('retrieve_memory', { store: 'project' }, { cwd }), { total: 0, items: [] });
    assert.equal(existsSync(path), false);
    assert.equal(call('remove_memory', { id, store: 'project' }, { cwd }), null);
    assert.equal(existsSync(path), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('handleTool rejects an unknown tool name', () => {
  assert.throws(() => handleTool('forget_memory', {}, { cwd: '/tmp' }), /unknown nanomneme tool/);
});