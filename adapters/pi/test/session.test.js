import test from 'node:test';
import assert from 'node:assert/strict';
import { open } from 'nmnm-core';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pinsPath, readPins, settingsPath, writePins } from '../src/context.js';
import { registerPiMemory } from '../src/session.js';
import { databasePath, runMemory } from '../src/store.js';

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), name));
}

test('injects a compact index once and refresh makes it pending again', async () => {
  const project = temporaryDirectory('nmnm-pi-session-project-');
  const home = temporaryDirectory('nmnm-pi-session-home-');
  try {
    runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Session index memory' } });
    const handlers = new Map();
    const commands = new Map();
    const notices = [];
    registerPiMemory({
      on: (event, handler) => handlers.set(event, handler),
      registerCommand: (name, command) => commands.set(name, command),
    }, { home, platform: 'darwin' });
    const ctx = { cwd: project, ui: { notify: (message) => notices.push(message) } };

    await handlers.get('session_start')({}, ctx);
    const first = await handlers.get('before_agent_start')({}, ctx);
    const second = await handlers.get('before_agent_start')({}, ctx);
    await commands.get('memory').handler('refresh', ctx);
    const refreshed = await handlers.get('before_agent_start')({}, ctx);

    assert.equal(first.message.customType, 'nanomneme-memory-index');
    assert.equal(first.message.display, false);
    assert.equal(second, undefined);
    assert.equal(refreshed.message.customType, 'nanomneme-memory-index');
    assert.match(notices[0], /refresh/);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory pin validates the selected store before writing a pin', async () => {
  const project = temporaryDirectory('nmnm-pi-session-project-');
  const home = temporaryDirectory('nmnm-pi-session-home-');
  try {
    const commands = new Map();
    const notices = [];
    const agentDir = join(home, 'pi-agent');
    const projectMemory = runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Project pin target' } });
    const globalMemory = runMemory({ cwd: project, home, platform: 'darwin', store: 'global', operation: 'retain', input: { content: 'Global pin target' } });
    mkdirSync(join(project, '.nanomneme'), { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(settingsPath({ cwd: project, agentDir, store: 'project' }), '{ "injection_budget": 321 }\n');
    registerPiMemory({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) }, { home, agentDir, platform: 'darwin' });
    const ctx = { cwd: project, ui: { notify: (message) => notices.push(message) } };

    await commands.get('memory').handler(`pin ${globalMemory.id}`, ctx);
    assert.deepEqual(readPins(pinsPath({ cwd: project, home, store: 'project' })), []);
    assert.match(notices.at(-1), /use \/memory pin global/);
    await commands.get('memory').handler(`pin ${projectMemory.id}`, ctx);
    assert.deepEqual(readPins(pinsPath({ cwd: project, home, store: 'project' })), [projectMemory.id]);
    await commands.get('memory').handler(`pin global ${globalMemory.id}`, ctx);
    assert.deepEqual(readPins(pinsPath({ cwd: project, home, store: 'global' })), [globalMemory.id]);
    await commands.get('memory').handler('pin 00000000-0000-4000-8000-000000000001', ctx);
    assert.match(notices.at(-1), /not found \[project\]/);
    await commands.get('memory').handler('status', ctx);
    assert.match(notices.at(-1), /budget 321/);
    await commands.get('memory').handler(`unpin global ${globalMemory.id}`, ctx);
    assert.deepEqual(readPins(pinsPath({ cwd: project, home, store: 'global' })), []);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory list shows a compact selected-store page without model involvement', async () => {
  const project = temporaryDirectory('nmnm-pi-session-project-');
  const home = temporaryDirectory('nmnm-pi-session-home-');
  try {
    const commands = new Map();
    const notices = [];
    const first = runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'First listed memory' } });
    const second = runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Second listed memory' } });
    runMemory({ cwd: project, home, platform: 'darwin', store: 'global', operation: 'retain', input: { content: 'Global listed memory' } });
    registerPiMemory({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) }, { home, platform: 'darwin' });
    const ctx = { cwd: project, ui: { notify: (message) => notices.push(message) } };

    await commands.get('memory').handler('list project 1 1', ctx);

    assert.match(notices.at(-1), /^Nanomneme \[project\]: showing 1 of 2; \* pinned\n/);
    assert.match(notices.at(-1), new RegExp(`${first.id}|${second.id}`));
    assert.equal(notices.at(-1).split('\n').filter((line) => line.startsWith('- ')).length, 1);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory list combines project entries before global entries by default', async () => {
  const project = temporaryDirectory('nmnm-pi-session-project-');
  const home = temporaryDirectory('nmnm-pi-session-home-');
  try {
    const commands = new Map();
    const notices = [];
    const projectMemory = runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Project default list memory' } });
    const globalMemory = runMemory({ cwd: project, home, platform: 'darwin', store: 'global', operation: 'retain', input: { content: 'Global default list memory' } });
    registerPiMemory({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) }, { home, platform: 'darwin' });
    const ctx = { cwd: project, ui: { notify: (message) => notices.push(message) } };

    await commands.get('memory').handler('list', ctx);

    const message = notices.at(-1);
    assert.match(message, /^Nanomneme \[both\]: showing 2 of 2; \* pinned\n/);
    assert.match(message, new RegExp(`- \\[project\\] ${projectMemory.id}`));
    assert.match(message, new RegExp(`- \\[global\\] ${globalMemory.id}`));
    assert.ok(message.indexOf(projectMemory.id) < message.indexOf(globalMemory.id));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory list marks exact store pins and truncates previews at 60 characters', async () => {
  const project = temporaryDirectory('nmnm-pi-session-project-');
  const home = temporaryDirectory('nmnm-pi-session-home-');
  try {
    const commands = new Map();
    const notices = [];
    const projectMemory = runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'a'.repeat(61) } });
    const globalMemory = runMemory({ cwd: project, home, platform: 'darwin', store: 'global', operation: 'retain', input: { content: 'Global unpinned memory' } });
    writePins(pinsPath({ cwd: project, home, store: 'project' }), [projectMemory.id]);
    registerPiMemory({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) }, { home, platform: 'darwin' });
    const ctx = { cwd: project, ui: { notify: (message) => notices.push(message) } };

    await commands.get('memory').handler('list', ctx);

    const message = notices.at(-1);
    assert.match(message, /^Nanomneme \[both\]: showing 2 of 2; \* pinned\n/);
    assert.match(message, new RegExp(`- \\[project\\] ${projectMemory.id} \\* ${'a'.repeat(60)}\\.\\.\\.`));
    assert.match(message, new RegExp(`- \\[global\\] ${globalMemory.id} Global unpinned memory`));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory list rejects an offset beyond the core limit with usage', async () => {
  const project = temporaryDirectory('nmnm-pi-session-project-');
  const home = temporaryDirectory('nmnm-pi-session-home-');
  try {
    const commands = new Map();
    const notices = [];
    runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Offset validation memory' } });
    registerPiMemory({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) }, { home, platform: 'darwin' });
    const ctx = { cwd: project, ui: { notify: (message) => notices.push(message) } };

    await commands.get('memory').handler('list 20 1001', ctx);

    assert.match(notices.at(-1), /^Usage:/);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory remove soft-removes an entry and retains a matching durable pin', async () => {
  const project = temporaryDirectory('nmnm-pi-session-project-');
  const home = temporaryDirectory('nmnm-pi-session-home-');
  try {
    const commands = new Map();
    const notices = [];
    const retained = runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Remove through slash command' } });
    const pinFile = pinsPath({ cwd: project, home, store: 'project' });
    writePins(pinFile, [retained.id]);
    registerPiMemory({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) }, { home, platform: 'darwin' });
    const ctx = { cwd: project, ui: { notify: (message) => notices.push(message) } };

    await commands.get('memory').handler(`remove ${retained.id}`, ctx);

    assert.equal(runMemory({ cwd: project, store: 'project', operation: 'recall', input: { id: retained.id } }), null);
    assert.deepEqual(readPins(pinFile), [retained.id]);
    assert.match(notices.at(-1), new RegExp(`removed \\[project\\] ${retained.id}`));
    assert.match(notices.at(-1), /pin remains configured/);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory remove resolves an unqualified ID when exactly one store contains it', async () => {
  const project = temporaryDirectory('nmnm-pi-session-project-');
  const home = temporaryDirectory('nmnm-pi-session-home-');
  try {
    const commands = new Map();
    const notices = [];
    const retained = runMemory({ cwd: project, home, platform: 'darwin', store: 'global', operation: 'retain', input: { content: 'Unqualified global removal' } });
    registerPiMemory({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) }, { home, platform: 'darwin' });
    const ctx = { cwd: project, ui: { notify: (message) => notices.push(message) } };

    await commands.get('memory').handler(`remove ${retained.id}`, ctx);

    assert.equal(runMemory({ cwd: project, home, platform: 'darwin', store: 'global', operation: 'recall', input: { id: retained.id } }), null);
    assert.match(notices.at(-1), new RegExp(`removed \\[global\\] ${retained.id}`));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory remove refuses an unqualified ID present in both stores', async () => {
  const project = temporaryDirectory('nmnm-pi-session-project-');
  const home = temporaryDirectory('nmnm-pi-session-home-');
  try {
    const commands = new Map();
    const notices = [];
    const projectMemory = runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Project duplicate ID' } });
    const id = projectMemory.id;
    const globalStore = open(databasePath({ cwd: project, home, platform: 'darwin', store: 'global' }));
    try {
      globalStore.import([{ ...projectMemory, content: 'Global duplicate ID', scope: 'global' }]);
    } finally {
      globalStore.close();
    }
    registerPiMemory({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) }, { home, platform: 'darwin' });
    const ctx = { cwd: project, ui: { notify: (message) => notices.push(message) } };

    await commands.get('memory').handler(`remove ${id}`, ctx);

    assert.equal(runMemory({ cwd: project, store: 'project', operation: 'recall', input: { id } }).content, 'Project duplicate ID');
    assert.equal(runMemory({ cwd: project, home, platform: 'darwin', store: 'global', operation: 'recall', input: { id } }).content, 'Global duplicate ID');
    assert.match(notices.at(-1), /ambiguous/);
    assert.match(notices.at(-1), /remove project/);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
