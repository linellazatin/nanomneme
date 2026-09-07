import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMemoryIndex, pin, pinsPath, readPins, readSettings, settingsPath, unpin, writePins } from '../src/context.js';
import { runMemory } from '../src/store.js';

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), name));
}

test('keeps JSONC settings and JSON pins in their requested project and global locations', () => {
  const project = temporaryDirectory('nmnm-pi-context-project-');
  const home = temporaryDirectory('nmnm-pi-context-home-');
  try {
    const agentDir = join(home, 'pi-agent');
    const projectSettings = settingsPath({ cwd: project, agentDir, store: 'project' });
    const globalSettings = settingsPath({ cwd: project, agentDir, store: 'global' });
    const projectPins = pinsPath({ cwd: project, home, store: 'project' });
    const globalPins = pinsPath({ cwd: project, home, store: 'global' });

    mkdirSync(join(project, '.nanomneme'), { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(projectSettings, '// project settings\n{ "injection_budget": 300, }\n');
    writeFileSync(globalSettings, '{ "injection_budget": 500 }\n');
    writePins(projectPins, ['project-id']);
    writePins(globalPins, ['global-id']);

    assert.deepEqual(readSettings(projectSettings), { injection_budget: 300 });
    assert.deepEqual(readSettings(globalSettings), { injection_budget: 500 });
    assert.deepEqual(readPins(projectPins), ['project-id']);
    assert.deepEqual(readPins(globalPins), ['global-id']);
    assert.equal(projectSettings, join(project, '.nanomneme', 'nmnm.jsonc'));
    assert.equal(globalSettings, join(agentDir, 'nmnm.jsonc'));
    assert.equal(projectPins, join(project, '.nanomneme', 'nmnm-pi.json'));
    assert.equal(globalPins, join(home, '.local', 'share', 'nanomneme', 'nmnm-pi.json'));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('pins deduplicate and unpin removes only the requested ID', () => {
  const pinned = pin(pin([], 'one'), 'one');
  assert.deepEqual(pinned, ['one']);
  assert.deepEqual(unpin(pinned, 'one'), []);
});

test('buildMemoryIndex treats missing stores as empty without creating databases', () => {
  const project = temporaryDirectory('nmnm-pi-context-project-');
  const home = temporaryDirectory('nmnm-pi-context-home-');
  try {
    const index = buildMemoryIndex({ cwd: project, home, platform: 'darwin' });

    assert.equal(index.total, 0);
    assert.equal(existsSync(join(project, '.nanomneme', 'memory.db')), false);
    assert.equal(existsSync(join(home, '.local', 'share', 'nanomneme', 'memory.db')), false);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('buildMemoryIndex prioritizes pins, falls back to recent records, reports unresolved pins, and obeys its budget', () => {
  const project = temporaryDirectory('nmnm-pi-context-project-');
  const home = temporaryDirectory('nmnm-pi-context-home-');
  try {
    const projectPin = runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Pinned project memory' } });
    const projectRecent = runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Recent project memory' } });
    const globalPin = runMemory({
      cwd: project,
      home,
      platform: 'darwin',
      store: 'global',
      operation: 'retain',
      input: { content: 'Pinned global memory' },
    });
    const agentDir = join(home, 'pi-agent');
    mkdirSync(join(project, '.nanomneme'), { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(settingsPath({ cwd: project, agentDir, store: 'project' }), '{ "injection_budget": 1000 }\n');
    writeFileSync(settingsPath({ cwd: project, agentDir, store: 'global' }), '{ "injection_budget": 1000 }\n');
    writePins(pinsPath({ cwd: project, home, store: 'project' }), [projectPin.id, '00000000-0000-4000-8000-000000000000']);
    writePins(pinsPath({ cwd: project, home, store: 'global' }), [globalPin.id]);

    const index = buildMemoryIndex({ cwd: project, home, agentDir, platform: 'darwin' });
    const bounded = buildMemoryIndex({ cwd: project, home, agentDir, platform: 'darwin', budget: 160 });

    assert.ok(index.content.indexOf(projectPin.id) < index.content.indexOf(projectRecent.id));
    assert.ok(index.content.indexOf(globalPin.id) < index.content.indexOf(projectRecent.id));
    assert.equal(index.unresolved, 1);
    assert.ok(bounded.content.length <= 160);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
