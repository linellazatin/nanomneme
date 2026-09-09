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

function scriptedUi({ selections = [], inputs = [], confirmations = [] } = {}) {
  const notices = [];
  const selectCalls = [];
  const confirmCalls = [];
  return {
    notices,
    selectCalls,
    confirmCalls,
    ui: {
      notify: (message) => notices.push(message),
      select: async (title, options) => {
        selectCalls.push({ title, options });
        const next = selections.shift();
        return typeof next === 'function' ? next(options, title) : next;
      },
      input: async () => inputs.shift(),
      confirm: async (title, message) => {
        confirmCalls.push({ title, message });
        return confirmations.shift() ?? false;
      },
    },
  };
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
    assert.match(notices.at(-1), /Periodic reinjection      every 5 prompts/);
    await handlers.get('session_start')({}, ctx);
    assert.match((await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx)).systemPrompt, /Cadence memory/);
    for (let prompt = 0; prompt < 4; prompt += 1) {
      assert.equal(await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx), undefined);
    }
    assert.match((await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx)).systemPrompt, /Cadence memory/);
    await commands.get('memory').handler('status', ctx);
    assert.match(notices.at(-1), /Prompts since injection   0/);
    assert.match(notices.at(-1), /Last                      cadence at /);
    assert.match(notices.at(-1), /Periodic reinjection      every 5 prompts/);
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
    assert.match(notices.at(-1), /Injection pending         yes/);
    assert.match(notices.at(-1), /Prompts since injection   1/);
    writeFileSync(config, '{ "reinjection": { "enabled": true, "every_n_prompts": 1 } }\n');
    assert.match((await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx)).systemPrompt, /Cadence retry memory/);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory status reports the full next-injection character count without exposing content', async () => {
  const project = temporaryDirectory('nmnm-pi-session-status-project-');
  const home = temporaryDirectory('nmnm-pi-session-status-home-');
  try {
    const handlers = new Map();
    const commands = new Map();
    const notices = [];
    const agentDir = join(home, 'pi-agent');
    mkdirSync(join(project, '.nanomneme'), { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(settingsPath({ cwd: project, agentDir, store: 'project' }), '{ "autoretention": { "enabled": true, "always_ask": ["Ask before retaining status details"] } }\n');
    const retained = runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Status-only secret memory content' } });
    registerPiMemory({
      on: (event, handler) => handlers.set(event, handler),
      registerCommand: (name, command) => commands.set(name, command),
    }, { home, agentDir, platform: 'darwin' });
    const ctx = { cwd: project, ui: { notify: (message) => notices.push(message) } };
    const expectedPayload = [
      `Nanomneme memory index:\n- [project] ${retained.id} Status-only secret memory content\n`,
      '## Nanomneme autoretention\nAutoretention is enabled. Use retain_memory only when retaining a memory. Never automatically retain rules take precedence over all other rules.\nAsk the user before retaining:\n- Ask before retaining status details',
    ].join('\n\n');

    await handlers.get('session_start')({}, ctx);
    await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx);
    await commands.get('memory').handler('status', ctx);

    assert.match(notices.at(-1), new RegExp([
      '^Nanomneme status',
      'Injection pending         no',
      'Periodic reinjection      disabled',
      'Prompts since injection   0',
      `Last                      session_start at .+ · 1 entry · ${expectedPayload.length} characters · autoretention enabled`,
      'Pins                      project: 0 · global: 0',
      `Index                     budget: 2000 · current: ${expectedPayload.length} · unresolved: 0`,
      'Error                     none$',
    ].join('\\n')));
    assert.doesNotMatch(notices.at(-1), /Status-only secret memory content/);

    await commands.get('memory').handler('refresh', ctx);
    await handlers.get('before_agent_start')({ systemPrompt: 'Base prompt' }, ctx);
    await commands.get('memory').handler('status', ctx);
    assert.match(notices.at(-1), /Last                      refresh at /);
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

    assert.match(notices.at(-1), /Injection pending         yes/);
    assert.match(notices.at(-1), /Error                     Pi memory settings contain invalid JSONC at /);
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
    assert.match(notices.at(-1), /Index                     budget: 321 · current: \d+ · unresolved: 0/);
    await commands.get('memory').handler(`unpin global ${globalMemory.id}`, ctx);
    assert.deepEqual(readPins(pinsPath({ cwd: project, home, store: 'global' })), []);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory with no action and memory browse open the native dialog browser', async () => {
  const project = temporaryDirectory('nmnm-pi-browser-entry-project-');
  const home = temporaryDirectory('nmnm-pi-browser-entry-home-');
  try {
    const commands = new Map();
    const first = scriptedUi({ selections: [undefined] });
    const second = scriptedUi({ selections: [undefined] });
    registerPiMemory({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) }, { home, platform: 'darwin' });

    await commands.get('memory').handler('', { cwd: project, hasUI: true, ui: first.ui });
    await commands.get('memory').handler('browse', { cwd: project, hasUI: true, ui: second.ui });

    assert.equal(first.selectCalls.length, 1);
    assert.equal(second.selectCalls.length, 1);
    assert.match(first.selectCalls[0].title, /Nanomneme memories/);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory browser refuses non-UI mode without opening a dialog', async () => {
  const project = temporaryDirectory('nmnm-pi-browser-no-ui-project-');
  const home = temporaryDirectory('nmnm-pi-browser-no-ui-home-');
  try {
    const commands = new Map();
    const notices = [];
    registerPiMemory({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) }, { home, platform: 'darwin' });

    await commands.get('memory').handler('browse', {
      cwd: project,
      hasUI: false,
      ui: { notify: (message) => notices.push(message) },
    });

    assert.match(notices[0], /interactive memory browser is unavailable/i);
    assert.equal(existsSync(databasePath({ cwd: project, store: 'project' })), false);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('both memory browser entry points show status before the top quick actions', async () => {
  const project = temporaryDirectory('nmnm-pi-browser-actions-project-');
  const home = temporaryDirectory('nmnm-pi-browser-actions-home-');
  try {
    const commands = new Map();
    for (let index = 0; index < 12; index += 1) {
      runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: `Quick action browser memory ${index}` } });
    }
    const first = scriptedUi({ selections: [undefined] });
    const second = scriptedUi({ selections: [undefined] });
    registerPiMemory({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) }, { home, platform: 'darwin' });

    await commands.get('memory').handler('', { cwd: project, hasUI: true, ui: first.ui });
    await commands.get('memory').handler('browse', { cwd: project, hasUI: true, ui: second.ui });

    for (const scripted of [first, second]) {
      assert.match(scripted.notices.at(-1), /^Nanomneme status\n/);
      assert.deepEqual(scripted.selectCalls[0].options.slice(0, 2), ['Search', 'Store: both']);
      assert.equal(scripted.selectCalls[0].options.includes('Status'), false);
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory browser shows record details in the native action dialog', async () => {
  const project = temporaryDirectory('nmnm-pi-browser-status-return-project-');
  const home = temporaryDirectory('nmnm-pi-browser-status-return-home-');
  try {
    const commands = new Map();
    const retained = runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Browser detail should not persist above the browser' } });
    const scripted = scriptedUi({
      selections: [(options) => options.find((option) => option.includes(retained.id)), 'Back', undefined],
    });
    registerPiMemory({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) }, { home, platform: 'darwin' });

    await commands.get('memory').handler('browse', { cwd: project, hasUI: true, ui: scripted.ui });

    assert.match(scripted.selectCalls[1].title, /Browser detail should not persist above the browser/);
    assert.equal(scripted.notices.some((message) => message.includes('Browser detail should not persist above the browser')), false);
    assert.equal(scripted.notices.length, 1);
    assert.match(scripted.notices.at(-1), /^Nanomneme status\n/);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory browser searches both stores and opens the selected record', async () => {
  const project = temporaryDirectory('nmnm-pi-browser-search-project-');
  const home = temporaryDirectory('nmnm-pi-browser-search-home-');
  try {
    const commands = new Map();
    const retained = runMemory({
      cwd: project,
      store: 'project',
      operation: 'retain',
      input: { content: 'Needle browser memory', namespace: 'browser-test', tags: ['searchable'] },
    });
    const unrelatedProject = runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Unrelated project browser memory' } });
    const globalMatch = runMemory({ cwd: project, home, platform: 'darwin', store: 'global', operation: 'retain', input: { content: 'Global needle browser memory' } });
    const unrelatedGlobal = runMemory({ cwd: project, home, platform: 'darwin', store: 'global', operation: 'retain', input: { content: 'Unrelated global browser memory' } });
    const scripted = scriptedUi({
      selections: [
        'Search',
        (options) => options.find((option) => option.includes(retained.id)),
        'Back',
        undefined,
      ],
      inputs: ['Needle'],
    });
    registerPiMemory({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) }, { home, platform: 'darwin' });

    await commands.get('memory').handler('', { cwd: project, hasUI: true, ui: scripted.ui });

    const searchPage = scripted.selectCalls.find(({ title }) => title.includes('search: Needle'));
    assert.ok(searchPage.options.some((option) => option.includes(retained.id)));
    assert.ok(searchPage.options.some((option) => option.includes(globalMatch.id)));
    assert.ok(searchPage.options.every((option) => !option.includes(unrelatedProject.id)));
    assert.ok(searchPage.options.every((option) => !option.includes(unrelatedGlobal.id)));
    const detailDialog = scripted.selectCalls.find(({ title }) => title.includes('Needle browser memory'));
    assert.ok(detailDialog);
    assert.match(detailDialog.title, /browser-test/);
    assert.match(detailDialog.title, /searchable/);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory browser switches to the selected store', async () => {
  const project = temporaryDirectory('nmnm-pi-browser-store-project-');
  const home = temporaryDirectory('nmnm-pi-browser-store-home-');
  try {
    const commands = new Map();
    const projectMemory = runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Project browser memory' } });
    const globalMemory = runMemory({ cwd: project, home, platform: 'darwin', store: 'global', operation: 'retain', input: { content: 'Global browser memory' } });
    const scripted = scriptedUi({
      selections: [
        'Store: both',
        'Global',
        (options) => options.find((option) => option.includes(globalMemory.id)),
        'Back',
        undefined,
      ],
    });
    registerPiMemory({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) }, { home, platform: 'darwin' });

    await commands.get('memory').handler('browse', { cwd: project, hasUI: true, ui: scripted.ui });

    const globalPage = scripted.selectCalls.find(({ title }) => title.includes('[global]') && title.includes('showing'));
    assert.ok(globalPage);
    assert.ok(globalPage.options.some((option) => option.includes(globalMemory.id)));
    assert.ok(globalPage.options.every((option) => !option.includes(projectMemory.id)));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory browser moves between 20-row pages', async () => {
  const project = temporaryDirectory('nmnm-pi-browser-page-project-');
  const home = temporaryDirectory('nmnm-pi-browser-page-home-');
  try {
    const commands = new Map();
    for (let index = 0; index < 21; index += 1) {
      runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: `Paged browser memory ${index}` } });
    }
    const scripted = scriptedUi({ selections: ['Next page', 'Previous page', undefined] });
    registerPiMemory({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) }, { home, platform: 'darwin' });

    await commands.get('memory').handler('browse', { cwd: project, hasUI: true, ui: scripted.ui });

    assert.match(scripted.selectCalls[0].title, /showing 20 of 21/);
    assert.ok(scripted.selectCalls[0].options.includes('Next page'));
    assert.match(scripted.selectCalls[1].title, /showing 1 of 21/);
    assert.ok(scripted.selectCalls[1].options.includes('Previous page'));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory browser pins and unpins the exact selected store', async () => {
  const project = temporaryDirectory('nmnm-pi-browser-pin-project-');
  const home = temporaryDirectory('nmnm-pi-browser-pin-home-');
  try {
    const commands = new Map();
    const retained = runMemory({ cwd: project, home, platform: 'darwin', store: 'global', operation: 'retain', input: { content: 'Global browser pin' } });
    const chooseMemory = (options) => options.find((option) => option.includes(retained.id));
    const scripted = scriptedUi({ selections: [chooseMemory, 'Pin', chooseMemory, 'Unpin', undefined] });
    registerPiMemory({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) }, { home, platform: 'darwin' });

    await commands.get('memory').handler('browse', { cwd: project, hasUI: true, ui: scripted.ui });

    assert.deepEqual(readPins(pinsPath({ cwd: project, home, store: 'global' })), []);
    assert.ok(scripted.notices.some((message) => message.includes(`pinned [global] ${retained.id}`)));
    assert.ok(scripted.notices.some((message) => message.includes(`unpinned [global] ${retained.id}`)));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory browser cancellation leaves the selected memory active', async () => {
  const project = temporaryDirectory('nmnm-pi-browser-cancel-project-');
  const home = temporaryDirectory('nmnm-pi-browser-cancel-home-');
  try {
    const commands = new Map();
    const retained = runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Do not remove browser memory' } });
    const scripted = scriptedUi({
      selections: [(options) => options.find((option) => option.includes(retained.id)), 'Remove', undefined],
      confirmations: [false],
    });
    registerPiMemory({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) }, { home, platform: 'darwin' });

    await commands.get('memory').handler('', { cwd: project, hasUI: true, ui: scripted.ui });

    assert.equal(scripted.confirmCalls.length, 1);
    assert.equal(runMemory({ cwd: project, store: 'project', operation: 'recall', input: { id: retained.id } }).content, 'Do not remove browser memory');
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory browser confirms soft removal and preserves its pin', async () => {
  const project = temporaryDirectory('nmnm-pi-browser-remove-project-');
  const home = temporaryDirectory('nmnm-pi-browser-remove-home-');
  try {
    const commands = new Map();
    const retained = runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Confirmed browser removal' } });
    const pinFile = pinsPath({ cwd: project, home, store: 'project' });
    writePins(pinFile, [retained.id]);
    const scripted = scriptedUi({
      selections: [(options) => options.find((option) => option.includes(retained.id)), 'Remove', undefined],
      confirmations: [true],
    });
    registerPiMemory({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) }, { home, platform: 'darwin' });

    await commands.get('memory').handler('browse', { cwd: project, hasUI: true, ui: scripted.ui });

    assert.equal(runMemory({ cwd: project, store: 'project', operation: 'recall', input: { id: retained.id } }), null);
    assert.deepEqual(readPins(pinFile), [retained.id]);
    assert.ok(scripted.notices.some((message) => /pin remains configured.*unresolved/i.test(message)));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('memory browser refuses to mutate a record that became inactive', async () => {
  const project = temporaryDirectory('nmnm-pi-browser-stale-project-');
  const home = temporaryDirectory('nmnm-pi-browser-stale-home-');
  try {
    const commands = new Map();
    const retained = runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Disappearing browser memory' } });
    const scripted = scriptedUi({
      selections: [
        (options) => options.find((option) => option.includes(retained.id)),
        () => {
          runMemory({ cwd: project, store: 'project', operation: 'remove', input: { id: retained.id, mode: 'soft' } });
          return 'Pin';
        },
        undefined,
      ],
    });
    registerPiMemory({ on: () => {}, registerCommand: (name, command) => commands.set(name, command) }, { home, platform: 'darwin' });

    await commands.get('memory').handler('browse', { cwd: project, hasUI: true, ui: scripted.ui });

    assert.deepEqual(readPins(pinsPath({ cwd: project, home, store: 'project' })), []);
    assert.ok(scripted.notices.some((message) => /no longer active/.test(message)));
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
