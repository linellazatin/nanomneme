import test from 'node:test';
import assert from 'node:assert/strict';
import { open } from 'nmnm-core';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    const first = await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx);
    const second = await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx);
    await commands.get('memory').handler('refresh', ctx);
    const refreshed = await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx);
    await handlers.get('session_compact')({}, ctx);
    const compacted = await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx);
    const afterCompaction = await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx);
    const ordinary = [];
    for (let prompt = 0; prompt < 5; prompt += 1) {
      ordinary.push(await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx));
    }

    assert.equal(first.message, undefined);
    assert.match(first.systemPrompt, /^Base prompt\n\nNanomneme memory index:/);
    assert.match(first.systemPrompt, /Session index memory/);
    assert.equal(second, undefined);
    assert.match(refreshed.systemPrompt, /^Base prompt\n\nNanomneme memory index:/);
    assert.match(compacted.systemPrompt, /^Base prompt\n\nNanomneme memory index:/);
    assert.equal(afterCompaction, undefined);
    assert.deepEqual(ordinary, [undefined, undefined, undefined, undefined, undefined]);
    assert.match(notices[0], /refresh/);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('injects opt-in cadence context on the fifth eligible prompt only', async () => {
  const project = temporaryDirectory('nmnm-pi-session-cadence-project-');
  const home = temporaryDirectory('nmnm-pi-session-cadence-home-');
  try {
    const handlers = new Map();
    const commands = new Map();
    const notices = [];
    const agentDir = join(home, 'pi-agent');
    mkdirSync(join(project, '.nanomneme'), { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(settingsPath({ cwd: project, agentDir, store: 'project' }), '{ "reinjection": { "enabled": true, "every_n_prompts": 5 } }\n');
    runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Cadence memory' } });
    registerPiMemory({
      on: (event, handler) => handlers.set(event, handler),
      registerCommand: (name, command) => commands.set(name, command),
    }, { home, agentDir, platform: 'darwin' });
    const ctx = { cwd: project, ui: { notify: (message) => notices.push(message) } };

    await commands.get('memory').handler('status', ctx);
    assert.match(notices.at(-1), /Periodic   reinjection: every 5 prompts/);
    await handlers.get('session_start')({}, ctx);
    assert.match((await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx)).systemPrompt, /Cadence memory/);
    for (let prompt = 0; prompt < 4; prompt += 1) {
      assert.equal(await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx), undefined);
    }
    assert.match((await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx)).systemPrompt, /Cadence memory/);
    await commands.get('memory').handler('status', ctx);
    assert.match(notices.at(-1), /Prompts    since injection: 0/);
    assert.match(notices.at(-1), /Last       cadence at /);
    assert.match(notices.at(-1), /Periodic   reinjection: every 5 prompts/);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('keeps a failed cadence injection pending without resetting its prompt count', async () => {
  const project = temporaryDirectory('nmnm-pi-session-cadence-error-project-');
  const home = temporaryDirectory('nmnm-pi-session-cadence-error-home-');
  try {
    const handlers = new Map();
    const commands = new Map();
    const notices = [];
    const agentDir = join(home, 'pi-agent');
    mkdirSync(join(project, '.nanomneme'), { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    const config = settingsPath({ cwd: project, agentDir, store: 'project' });
    writeFileSync(config, '{ "reinjection": { "enabled": true, "every_n_prompts": 1 } }\n');
    runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Cadence retry memory' } });
    registerPiMemory({
      on: (event, handler) => handlers.set(event, handler),
      registerCommand: (name, command) => commands.set(name, command),
    }, { home, agentDir, platform: 'darwin' });
    const ctx = { cwd: project, ui: { notify: (message) => notices.push(message) } };

    await handlers.get('session_start')({}, ctx);
    await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx);
    writeFileSync(config, '{ invalid jsonc');
    assert.equal(await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx), undefined);
    await commands.get('memory').handler('status', ctx);
    assert.match(notices.at(-1), /Injection  pending: yes/);
    assert.match(notices.at(-1), /Prompts    since injection: 1/);
    writeFileSync(config, '{ "reinjection": { "enabled": true, "every_n_prompts": 1 } }\n');
    assert.match((await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx)).systemPrompt, /Cadence retry memory/);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory status reports the latest injection lifecycle without exposing content', async () => {
  const project = temporaryDirectory('nmnm-pi-session-status-project-');
  const home = temporaryDirectory('nmnm-pi-session-status-home-');
  try {
    const handlers = new Map();
    const commands = new Map();
    const notices = [];
    runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Status-only secret memory content' } });
    registerPiMemory({
      on: (event, handler) => handlers.set(event, handler),
      registerCommand: (name, command) => commands.set(name, command),
    }, { home, platform: 'darwin' });
    const ctx = { cwd: project, ui: { notify: (message) => notices.push(message) } };

    await handlers.get('session_start')({}, ctx);
    await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx);
    await commands.get('memory').handler('status', ctx);

    assert.match(notices.at(-1), /^Nanomneme status\nInjection  pending: no\nPrompts    since injection: 0/);
    assert.match(notices.at(-1), /Last       session_start at /);
    assert.match(notices.at(-1), /1 entry · \d+ characters · autoretention disabled/);
    assert.match(notices.at(-1), /Pins       project: 0 · global: 0/);
    assert.match(notices.at(-1), /Index      budget: 2000 · unresolved: 0/);
    assert.match(notices.at(-1), /Periodic   reinjection: disabled/);
    assert.match(notices.at(-1), /Error      none$/);
    assert.doesNotMatch(notices.at(-1), /Status-only secret memory content/);

    await commands.get('memory').handler('refresh', ctx);
    await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx);
    await commands.get('memory').handler('status', ctx);
    assert.match(notices.at(-1), /Last       refresh at /);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory status reports an injection error without creating a store', async () => {
  const project = temporaryDirectory('nmnm-pi-session-status-error-project-');
  const home = temporaryDirectory('nmnm-pi-session-status-error-home-');
  try {
    const handlers = new Map();
    const commands = new Map();
    const notices = [];
    const agentDir = join(home, 'pi-agent');
    mkdirSync(join(project, '.nanomneme'), { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(settingsPath({ cwd: project, agentDir, store: 'project' }), '{ invalid jsonc');
    registerPiMemory({
      on: (event, handler) => handlers.set(event, handler),
      registerCommand: (name, command) => commands.set(name, command),
    }, { home, agentDir, platform: 'darwin' });
    const ctx = { cwd: project, ui: { notify: (message) => notices.push(message) } };

    await handlers.get('session_start')({}, ctx);
    await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx);
    await commands.get('memory').handler('status', ctx);

    assert.match(notices.at(-1), /Injection  pending: yes/);
    assert.match(notices.at(-1), /Error      Pi memory settings contain invalid JSONC at /);
    assert.equal(existsSync(settingsPath({ cwd: project, agentDir, store: 'global' })), false);
    assert.equal(existsSync(pinsPath({ cwd: project, home, store: 'project' })), false);
    assert.equal(existsSync(pinsPath({ cwd: project, home, store: 'global' })), false);
    assert.equal(existsSync(databasePath({ cwd: project, store: 'project' })), false);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('validates configuration at session start and retries injection after it is repaired', async () => {
  const project = temporaryDirectory('nmnm-pi-session-config-project-');
  const home = temporaryDirectory('nmnm-pi-session-config-home-');
  try {
    const handlers = new Map();
    const notices = [];
    const agentDir = join(home, 'pi-agent');
    runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Recovered configuration memory' } });
    mkdirSync(join(project, '.nanomneme'), { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    const configPath = settingsPath({ cwd: project, agentDir, store: 'project' });
    writeFileSync(configPath, '{ invalid jsonc');
    registerPiMemory({
      on: (event, handler) => handlers.set(event, handler),
      registerCommand: () => {},
    }, { home, agentDir, platform: 'darwin' });
    const ctx = { cwd: project, ui: { notify: (message) => notices.push(message) } };

    await handlers.get('session_start')({}, ctx);
    const failed = await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx);
    writeFileSync(configPath, '{ "injection_budget": 2000 }\n');
    const recovered = await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx);

    assert.match(notices[0], /configuration unavailable/);
    assert.equal(failed, undefined);
    assert.match(recovered.systemPrompt, /Recovered configuration memory/);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('injects enabled autoretention rules without a persistent message', async () => {
  const project = temporaryDirectory('nmnm-pi-autoretention-project-');
  const home = temporaryDirectory('nmnm-pi-autoretention-home-');
  try {
    const handlers = new Map();
    const agentDir = join(home, 'pi-agent');
    mkdirSync(join(project, '.nanomneme'), { recursive: true });
    writeFileSync(settingsPath({ cwd: project, agentDir, store: 'project' }), JSON.stringify({
      autoretention: { enabled: true, always_persist: ['Record durable project decisions'] },
    }));
    registerPiMemory({ on: (event, handler) => handlers.set(event, handler), registerCommand: () => {} }, { home, agentDir, platform: 'darwin' });
    const ctx = { cwd: project, ui: { notify: () => {} } };

    await handlers.get('session_start')({}, ctx);
    const result = await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx);

    assert.equal(result.message, undefined);
    assert.match(result.systemPrompt, /## Nanomneme autoretention/);
    assert.match(result.systemPrompt, /Use retain_memory only when retaining a memory/);
    assert.match(result.systemPrompt, /Record durable project decisions/);
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
    assert.match(notices.at(-1), /Index      budget: 321 · unresolved: 0/);
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
