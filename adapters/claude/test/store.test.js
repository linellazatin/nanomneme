import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { databasePath, runMemory } from '../src/store.js';

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), name));
}

test('runMemory delegates retain and recall to a project database', () => {
  const project = temporaryDirectory('nmnm-claude-project-');
  try {
    const retained = runMemory({
      cwd: project,
      store: 'project',
      operation: 'retain',
      input: { content: 'Claude adapter memory' },
    });
    const recalled = runMemory({
      cwd: project,
      store: 'project',
      operation: 'recall',
      input: { id: retained.id },
    });

    assert.equal(recalled.content, 'Claude adapter memory');
    assert.equal(databasePath({ cwd: project, store: 'project' }), join(project, '.nanomneme', 'memory.db'));
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('runMemory gives global retained records the global scope by default', () => {
  const project = temporaryDirectory('nmnm-claude-project-');
  const home = temporaryDirectory('nmnm-claude-home-');
  try {
    const retained = runMemory({
      cwd: project,
      home,
      platform: 'darwin',
      store: 'global',
      operation: 'retain',
      input: { content: 'Global Claude adapter memory' },
    });

    assert.equal(retained.scope, 'global');
    assert.equal(databasePath({ cwd: project, home, platform: 'darwin', store: 'global' }), join(home, '.local', 'share', 'nanomneme', 'memory.db'));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('databasePath rejects unsupported global platforms', () => {
  assert.throws(
    () => databasePath({ cwd: '/project', home: '/home/user', platform: 'win32', store: 'global' }),
    { message: '--global is supported only on Linux and macOS; use --db' },
  );
});
