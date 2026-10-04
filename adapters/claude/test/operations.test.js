import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { databasePath, runMemory } from '../src/store.js';
import { TOOL_DEFINITIONS, handleTool } from '../src/operations.js';

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), name));
}

function call(name, params, ctx, options) {
  return JSON.parse(handleTool(name, params, ctx, options).content[0].text);
}

test('TOOL_DEFINITIONS exposes the nanomneme 4Rs in order', () => {
  assert.deepEqual(TOOL_DEFINITIONS.map((tool) => tool.name), ['retain_memory', 'recall_memory', 'retrieve_memory', 'remove_memory']);
});

test('handlers retain, recall, retrieve, and soft-remove through the core', () => {
  const cwd = temporaryDirectory('nmnm-claude-ops-');
  try {
    const retained = call('retain_memory', { content: 'Stored from Claude', tags: ['claude'] }, { cwd });
    const recalled = call('recall_memory', { id: retained.id, store: 'project' }, { cwd });
    const nullMetadata = call('retain_memory', { content: 'Null metadata', metadata: null }, { cwd });
    const retrieved = call('retrieve_memory', { query: 'Stored', store: 'project' }, { cwd });
    const removed = call('remove_memory', { id: retained.id, store: 'project' }, { cwd });
    const restored = call('retain_memory', { id: retained.id }, { cwd });

    assert.equal(recalled.content, 'Stored from Claude');
    assert.equal(retained.metadata.source, 'claude-code');
    assert.equal(nullMetadata.metadata.source, 'claude-code');
    assert.equal(retrieved.items[0].id, retained.id);
    assert.equal(removed.mode, 'soft');
    assert.equal(restored.id, retained.id);
    assert.equal(call('recall_memory', { id: retained.id, store: 'project' }, { cwd }).content, 'Stored from Claude');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('Claude tools preserve hardened Unicode search and reject invalid input without mutations', () => {
  const cwd = temporaryDirectory('nmnm-claude-ops-hardening-');
  const home = temporaryDirectory('nmnm-claude-ops-hardening-home-');
  try {
    const ctx = { cwd, home, platform: 'darwin' };
    const mutations = [];
    const options = { onMutation: (reason) => mutations.push(reason) };
    const retained = call('retain_memory', { content: '東京 alpha beta 😀' }, ctx, options);
    assert.equal(retained.metadata.source, 'claude-code');
    for (const query of ['東京', '東*', 'alpha AND beta', 'NEAR(alpha beta, 0)']) {
      assert.deepEqual(call('retrieve_memory', { query }, ctx, options).items.map((item) => item.id), [retained.id]);
    }
    assert.equal(call('retrieve_memory', { query: '!!!' }, ctx, options).total, 0);
    for (const content of ['bad\ud800', 'bad\udc00']) {
      assert.throws(() => call('retain_memory', { id: retained.id, content }, ctx, options), /content must contain well-formed Unicode/);
    }
    assert.throws(() => call('retain_memory', { id: retained.id, metadata: [] }, ctx, options), /metadata must be a JSON object/);
    for (const field of ['importance', 'confidence']) {
      for (const operator of ['constructor', 'toString', '__proto__']) {
        assert.throws(() => call('retrieve_memory', { [field]: { [operator]: 0.5 } }, ctx, options), /range has unsupported operator/);
      }
    }
    assert.equal(call('recall_memory', { id: retained.id }, ctx, options).content, '東京 alpha beta 😀');
    assert.equal(call('retain_memory', { content: 'Null metadata stays retained', metadata: null }, ctx, options).metadata.source, 'claude-code');
    assert.deepEqual(mutations, ['retain', 'retain']);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('Claude retain patches normalize null metadata to an empty object', () => {
  const cwd = temporaryDirectory('nmnm-claude-ops-nullmeta-');
  const home = temporaryDirectory('nmnm-claude-ops-nullmeta-home-');
  try {
    const ctx = { cwd, home, platform: 'darwin' };
    const retained = call('retain_memory', { content: 'Labeled source' }, ctx);
    const patched = call('retain_memory', { id: retained.id, metadata: null }, ctx);
    assert.deepEqual(patched.metadata, {});
    assert.equal(patched.content, 'Labeled source');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('Claude first retain publishes private complete project and global stores', { skip: process.platform === 'win32' }, () => {
  const project = temporaryDirectory('nmnm-claude-ops-private-');
  const home = temporaryDirectory('nmnm-claude-ops-private-home-');
  try {
    const ctx = { cwd: project, home, platform: 'darwin' };
    for (const scope of ['project', 'global']) {
      const record = call('retain_memory', { content: 'Private Claude store', scope }, ctx);
      const directory = scope === 'project' ? join(project, '.nanomneme') : join(home, '.local', 'share', 'nanomneme');
      assert.equal(statSync(directory).mode & 0o777, 0o700);
      assert.equal(statSync(join(directory, 'memory.db')).mode & 0o777, 0o600);
      assert.deepEqual(readdirSync(directory), ['memory.db']);
      assert.deepEqual(call('recall_memory', { id: record.id, store: scope }, ctx), record);
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('Claude patches and restores advance timestamps across reopened stores under frozen and backward clocks', (t) => {
  const cwd = temporaryDirectory('nmnm-claude-ops-clock-');
  const home = temporaryDirectory('nmnm-claude-ops-clock-home-');
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-04T00:00:00.000Z') });
  try {
    const ctx = { cwd, home, platform: 'darwin' };
    const retained = call('retain_memory', { content: 'Clock test', tags: ['original'] }, ctx);
    const patched = call('retain_memory', { id: retained.id, content: 'Clock patch' }, ctx);
    t.mock.timers.setTime(Date.parse('2026-10-03T00:00:00.000Z'));
    call('remove_memory', { id: retained.id, store: 'project' }, ctx);
    const restored = call('retain_memory', { id: retained.id }, ctx);
    assert.equal(patched.created_at, retained.created_at);
    assert.equal(restored.created_at, retained.created_at);
    assert.ok(patched.updated_at > retained.updated_at);
    assert.ok(restored.updated_at > patched.updated_at);
    assert.equal(restored.content, 'Clock patch');
    assert.deepEqual(restored.tags, ['original']);
    assert.equal(restored.metadata.source, 'claude-code');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('Claude retain uses the global store when scope is global', () => {
  const cwd = temporaryDirectory('nmnm-claude-ops-global-');
  const home = temporaryDirectory('nmnm-claude-home-');
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

test('Claude retain patches preserve an existing source', () => {
  const cwd = temporaryDirectory('nmnm-claude-ops-source-');
  try {
    const original = runMemory({ cwd, store: 'project', operation: 'retain', input: { content: 'From Pi', metadata: { source: 'pi' } } });
    const patched = call('retain_memory', { id: original.id, content: 'Patched by Claude' }, { cwd });

    assert.equal(patched.metadata.source, 'pi');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('mutation handlers notify the adapter, while reads do not', () => {
  const cwd = temporaryDirectory('nmnm-claude-ops-mutations-');
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
  const cwd = temporaryDirectory('nmnm-claude-ops-missing-');
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
