import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

import { discoverAndLoadExtensions } from '@earendil-works/pi-coding-agent';

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), name));
}

test('Pi 0.87 loads only the nanomneme adapter and its declared surface', async () => {
  const cwd = temporaryDirectory('nmnm-pi-loader-cwd-');
  const agentDir = temporaryDirectory('nmnm-pi-loader-agent-');
  try {
    const result = await discoverAndLoadExtensions(
      [resolve('adapters/pi/extensions/index.js')],
      cwd,
      agentDir,
    );

    assert.deepEqual(result.errors, []);
    assert.equal(result.extensions.length, 1);
    const [extension] = result.extensions;
    assert.equal(extension.resolvedPath, resolve('adapters/pi/extensions/index.js'));
    assert.deepEqual([...extension.handlers.keys()], ['session_start', 'session_compact', 'before_agent_start']);
    assert.deepEqual([...extension.tools.keys()], ['retain_memory', 'recall_memory', 'retrieve_memory', 'remove_memory']);
    assert.deepEqual([...extension.commands.keys()], ['memory']);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
  }
});
