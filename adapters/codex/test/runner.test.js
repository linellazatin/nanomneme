import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from '@openlines/nmnm-core';

import { databasePath, handleRequest } from '../src/runner.js';

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), name));
}

test('runner retains Codex-provenanced records and retrieves them from the selected store', () => {
  const project = temporaryDirectory('nmnm-codex-runner-project-');
  const home = temporaryDirectory('nmnm-codex-runner-home-');
  try {
    const retained = handleRequest({
      operation: 'retain',
      store: 'project',
      input: { content: 'Codex project memory', metadata: { ticket: 'NMNM-1' } },
    }, { cwd: project, home, platform: 'darwin' });

    assert.equal(retained.metadata.source, 'codex');
    assert.equal(retained.metadata.ticket, 'NMNM-1');

    const retrieved = handleRequest({
      operation: 'retrieve',
      store: 'project',
      input: { query: 'Codex' },
    }, { cwd: project, home, platform: 'darwin' });

    assert.equal(retrieved.total, 1);
    assert.equal(retrieved.items[0].id, retained.id);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('runner preserves existing provenance when retaining an ID-based patch', () => {
  const project = temporaryDirectory('nmnm-codex-runner-project-');
  try {
    const store = open(databasePath({ cwd: project }));
    const original = store.retain({ content: 'Shared memory', metadata: { source: 'pi', origin: 'shared' } });
    store.close();

    const patched = handleRequest({
      operation: 'retain',
      input: { id: original.id, content: 'Updated shared memory', metadata: { source: 'spoofed' } },
    }, { cwd: project, platform: 'darwin' });

    assert.equal(patched.content, 'Updated shared memory');
    assert.deepEqual(patched.metadata, { source: 'pi', origin: 'shared' });
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('runner selects the standard global store and assigns its default global scope', () => {
  const project = temporaryDirectory('nmnm-codex-runner-project-');
  const home = temporaryDirectory('nmnm-codex-runner-home-');
  try {
    const retained = handleRequest({
      operation: 'retain',
      store: 'global',
      input: { content: 'Codex global memory' },
    }, { cwd: project, home, platform: 'linux' });

    assert.equal(retained.scope, 'global');
    assert.equal(databasePath({ cwd: project, home, platform: 'linux', store: 'global' }), join(home, '.local', 'share', 'nanomneme', 'memory.db'));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('runner reads missing stores without creating them and no-op removal is soft-only', () => {
  const project = temporaryDirectory('nmnm-codex-runner-project-');
  const home = temporaryDirectory('nmnm-codex-runner-home-');
  try {
    const missingPath = databasePath({ cwd: project, home, platform: 'darwin' });
    assert.equal(handleRequest({ operation: 'recall', input: { id: '00000000-0000-4000-8000-000000000000' } }, { cwd: project, home, platform: 'darwin' }), null);
    assert.deepEqual(handleRequest({ operation: 'retrieve', input: {} }, { cwd: project, home, platform: 'darwin' }), { total: 0, items: [] });
    assert.equal(handleRequest({ operation: 'remove', input: { id: '00000000-0000-4000-8000-000000000000' } }, { cwd: project, home, platform: 'darwin' }), null);
    assert.equal(existsSync(missingPath), false);

    const retained = handleRequest({ operation: 'retain', input: { content: 'Soft remove only' } }, { cwd: project, home, platform: 'darwin' });
    const removed = handleRequest({ operation: 'remove', input: { id: retained.id, mode: 'purge' } }, { cwd: project, home, platform: 'darwin' });
    assert.equal(removed.mode, 'soft');
    assert.equal(handleRequest({ operation: 'recall', input: { id: retained.id } }, { cwd: project, home, platform: 'darwin' }), null);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
