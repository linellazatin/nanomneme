import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildMemoryIndex } from '../src/context.js';
import { handleRequest } from '../src/runner.js';
import { sessionStartOutput } from '../src/hooks.js';

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), name));
}

test('session context is bounded and orders project records before global records', () => {
  const project = temporaryDirectory('nmnm-codex-context-project-');
  const home = temporaryDirectory('nmnm-codex-context-home-');
  try {
    handleRequest({ operation: 'retain', input: { content: 'Project memory content that is deliberately long enough to test trimming.' } }, { cwd: project, home, platform: 'darwin' });
    handleRequest({ operation: 'retain', store: 'global', input: { content: 'Global memory content that is deliberately long enough to test trimming.' } }, { cwd: project, home, platform: 'darwin' });

    const index = buildMemoryIndex({ cwd: project, home, platform: 'darwin', budget: 500 });
    assert.equal(index.total, 2);
    assert.ok(index.content.length <= 500);
    assert.ok(index.content.indexOf('Project memory') < index.content.indexOf('Global memory'));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('session hook emits no output for empty stores and fails safely on index errors', () => {
  const project = temporaryDirectory('nmnm-codex-hook-project-');
  const home = temporaryDirectory('nmnm-codex-hook-home-');
  try {
    assert.deepEqual(sessionStartOutput({ cwd: project, home, platform: 'darwin' }), {});
    assert.deepEqual(sessionStartOutput({ cwd: project, home, platform: 'win32' }), {});
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
