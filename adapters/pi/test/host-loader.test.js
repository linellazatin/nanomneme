import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

import { discoverAndLoadExtensions } from '@earendil-works/pi-coding-agent';

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), name));
}

test('Pi 0.99 loads only the nanomneme adapter and its declared surface', async () => {
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

test('Pi host registry executes adapter tools, lifecycle injection, and Logslines', async () => {
  const root = temporaryDirectory('nmnm-pi-host-live-');
  const home = join(root, 'home');
  const cwd = join(root, 'project');
  const agentDir = join(home, 'agent');
  const logPath = join(home, '.local', 'share', 'nanomneme', 'logs', 'nmnm-pi.jsonl');
  const previousHome = process.env.HOME;
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.HOME = home;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    mkdirSync(cwd, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'nmnm.jsonc'), '{ "logging": { "enabled": true } }\n');
    const result = await discoverAndLoadExtensions([resolve('adapters/pi/extensions/index.js')], cwd, agentDir);
    assert.deepEqual(result.errors, []);
    const [extension] = result.extensions;
    const ctx = {
      cwd,
      isProjectTrusted: () => true,
      sessionManager: { getSessionId: () => 'host-loader-session' },
      ui: { notify: () => {} },
    };
    for (const handler of extension.handlers.get('session_start')) handler({}, ctx);
    const retained = JSON.parse((await extension.tools.get('retain_memory').definition.execute('host-loader-call', {
      content: 'Host-loader memory',
    }, undefined, undefined, ctx)).content[0].text);
    const injected = await extension.handlers.get('before_agent_start')[0]({ systemPrompt: 'Base prompt' }, ctx);

    assert.match(injected.systemPrompt, /Host-loader memory/);
    assert.equal(existsSync(logPath), true);
    const [record] = readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual([record.operation, record.status, record.event, record.context.session_id], [
      'retain', 'ok', 'memory.retained', 'host-loader-session',
    ]);
    assert.equal(JSON.stringify(record).includes(retained.id), false);
    assert.equal(JSON.stringify(record).includes('Host-loader memory'), false);
  } finally {
    process.env.HOME = previousHome;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(root, { recursive: true, force: true });
  }
});
