import test from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMemoryIndex, opencodeGlobalDir, pin, pinsPath, readPins, readSettings, settingsPath, unpin, writePins } from '../src/context.js';
import { runMemory } from '../src/store.js';
import * as context from '../src/context.js';

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), name));
}

test('renderContext puts complete guidance before index rows and omits empty indexes', () => {
  const index = { total: 1, content: 'Nanomneme memory index:\nrow\n', autoretention: 'Complete guidance' };
  assert.equal(context.renderContext(index), 'Complete guidance\n\nNanomneme memory index:\nrow');
  assert.equal(context.renderContext({ ...index, total: 0 }), 'Complete guidance');
  assert.equal(context.renderContext({ ...index, autoretention: undefined }), 'Nanomneme memory index:\nrow');
  assert.equal(context.renderContext({ total: 0 }), '');
});

test('rendered OpenCode context preserves complete guidance at exact budget boundaries', () => {
  const cwd = temporaryDirectory('nmnm-opencode-render-budget-');
  const home = temporaryDirectory('nmnm-opencode-render-budget-home-');
  const globalDir = join(home, 'opencode-data');
  const env = { cwd, home, globalDir, platform: 'darwin' };
  try {
    runMemory({ cwd, store: 'project', operation: 'retain', input: { content: 'Budgeted index row' } });
    writeFileSync(settingsPath({ ...env, store: 'project' }), '{"autoretention":{"enabled":true,"always_ask":["Keep this complete rule."]}}');
    const full = buildMemoryIndex(env);
    const guidance = full.autoretention;
    for (const budget of [guidance.length, guidance.length + 2, guidance.length + 2 + full.content.length]) {
      const rendered = context.renderContext(buildMemoryIndex({ ...env, budget }));
      assert.ok(rendered.startsWith(guidance));
      assert.ok(rendered.length <= budget);
    }
    assert.equal(context.renderContext(buildMemoryIndex({ ...env, budget: guidance.length })), guidance);
    assert.throws(() => buildMemoryIndex({ ...env, budget: guidance.length - 1 }), /exceeds the injection budget/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('keeps JSONC settings and JSON pins in their requested project and global locations', () => {
  const project = temporaryDirectory('nmnm-opencode-context-project-');
  const home = temporaryDirectory('nmnm-opencode-context-home-');
  try {
    const globalDir = join(home, 'opencode-data');
    const projectSettings = settingsPath({ cwd: project, globalDir, store: 'project' });
    const globalSettings = settingsPath({ cwd: project, globalDir, store: 'global' });
    const projectPins = pinsPath({ cwd: project, home, store: 'project' });
    const globalPins = pinsPath({ cwd: project, home, store: 'global' });

    mkdirSync(join(project, '.nanomneme'), { recursive: true });
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(projectSettings, '// project settings\n{ "injection_budget": 300, }\n');
    writeFileSync(globalSettings, '{ "injection_budget": 500 }\n');
    writePins(projectPins, ['project-id']);
    writePins(globalPins, ['global-id']);

    assert.deepEqual(readSettings(projectSettings), { injection_budget: 300 });
    assert.deepEqual(readSettings(globalSettings), { injection_budget: 500 });
    assert.deepEqual(readPins(projectPins), ['project-id']);
    assert.deepEqual(readPins(globalPins), ['global-id']);
    assert.equal(projectSettings, join(project, '.nanomneme', 'nmnm.jsonc'));
    assert.equal(globalSettings, join(globalDir, 'nmnm.jsonc'));
    assert.equal(projectPins, join(project, '.nanomneme', 'nmnm-opencode.json'));
    assert.equal(globalPins, join(home, '.local', 'share', 'nanomneme', 'nmnm-opencode.json'));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('opencodeGlobalDir prefers XDG_CONFIG_HOME and falls back to ~/.config/opencode', () => {
  assert.equal(opencodeGlobalDir({ home: '/home/u', env: {} }), join('/home/u', '.config', 'opencode'));
  assert.equal(opencodeGlobalDir({ home: '/home/u', env: { XDG_CONFIG_HOME: '/data/xdg' } }), join('/data/xdg', 'opencode'));
});

test('buildMemoryIndex resolves opt-in reinjection settings and validates their values', () => {
  const project = temporaryDirectory('nmnm-opencode-reinjection-project-');
  const home = temporaryDirectory('nmnm-opencode-reinjection-home-');
  try {
    const globalDir = join(home, 'opencode-data');
    mkdirSync(join(project, '.nanomneme'), { recursive: true });
    mkdirSync(globalDir, { recursive: true });
    const projectPath = settingsPath({ cwd: project, globalDir, store: 'project' });
    writeFileSync(settingsPath({ cwd: project, globalDir, store: 'global' }), '{ "reinjection": { "enabled": true, "every_n_prompts": 9 } }\n');
    writeFileSync(projectPath, '{ "reinjection": { "every_n_prompts": 5 } }\n');

    assert.deepEqual(buildMemoryIndex({ cwd: project, home, globalDir, platform: 'darwin' }).reinjection, { enabled: true, every_n_prompts: 5 });
    assert.deepEqual(readSettings(projectPath), { reinjection: { every_n_prompts: 5 } });
    writeFileSync(projectPath, '{ "reinjection": { "enabled": "true" } }\n');
    assert.throws(() => readSettings(projectPath), /reinjection enabled must be a boolean/);
    writeFileSync(projectPath, '{ "reinjection": { "every_n_prompts": 0 } }\n');
    assert.throws(() => readSettings(projectPath), /every_n_prompts must be a positive safe integer/);
    writeFileSync(projectPath, '{}\n');
    writeFileSync(settingsPath({ cwd: project, globalDir, store: 'global' }), '{}\n');
    assert.deepEqual(buildMemoryIndex({ cwd: project, home, globalDir, platform: 'darwin' }).reinjection, { enabled: false, every_n_prompts: 5 });
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('buildMemoryIndex merges enabled autoretention rules and validates their settings', () => {
  const project = temporaryDirectory('nmnm-opencode-autoretention-project-');
  const home = temporaryDirectory('nmnm-opencode-autoretention-home-');
  try {
    const globalDir = join(home, 'opencode-data');
    mkdirSync(join(project, '.nanomneme'), { recursive: true });
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(settingsPath({ cwd: project, globalDir, store: 'global' }), JSON.stringify({
      autoretention: {
        enabled: true,
        always_persist: ['Global durable fact', 'Shared fact'],
        never_persist: ['Global secret'],
        always_ask: ['Global preference'],
      },
    }));
    writeFileSync(settingsPath({ cwd: project, globalDir, store: 'project' }), JSON.stringify({
      autoretention: {
        enabled: true,
        always_persist: ['Shared fact', 'Project durable fact'],
        never_persist: ['Project secret'],
        always_ask: ['Project preference'],
      },
    }));

    const enabled = buildMemoryIndex({ cwd: project, home, globalDir, platform: 'darwin' });
    assert.match(enabled.autoretention, /Use retain_memory only when retaining a memory/);
    assert.match(enabled.autoretention, /Never automatically retain:\n- Global secret\n- Project secret/);
    assert.match(enabled.autoretention, /Ask the user before retaining:\n- Global preference\n- Project preference/);
    assert.match(enabled.autoretention, /Automatically retain when applicable:\n- Global durable fact\n- Shared fact\n- Project durable fact/);

    const projectPath = settingsPath({ cwd: project, globalDir, store: 'project' });
    writeFileSync(projectPath, '{ "autoretention": { "enabled": false } }\n');
    assert.equal(buildMemoryIndex({ cwd: project, home, globalDir, platform: 'darwin' }).autoretention, undefined);
    writeFileSync(projectPath, '{ "autoretention": [] }\n');
    assert.throws(() => readSettings(projectPath), /autoretention must be an object/);
    writeFileSync(projectPath, '{ "autoretention": { "always_persist": ["", 1] } }\n');
    assert.throws(() => readSettings(projectPath), /autoretention always_persist must be an array of non-empty strings/);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('buildMemoryIndex rejects autoretention guidance that exceeds its total budget', () => {
  const project = temporaryDirectory('nmnm-opencode-autoretention-oversize-project-');
  const home = temporaryDirectory('nmnm-opencode-autoretention-oversize-home-');
  try {
    const globalDir = join(home, 'opencode-data');
    mkdirSync(join(project, '.nanomneme'), { recursive: true });
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(settingsPath({ cwd: project, globalDir, store: 'project' }), JSON.stringify({
      injection_budget: 20,
      autoretention: { enabled: true, never_persist: ['Never retain secrets.'] },
    }));

    assert.throws(
      () => buildMemoryIndex({ cwd: project, home, globalDir, platform: 'darwin' }),
      /autoretention guidance exceeds the injection budget/,
    );
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
  const project = temporaryDirectory('nmnm-opencode-context-project-');
  const home = temporaryDirectory('nmnm-opencode-context-home-');
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
  const project = temporaryDirectory('nmnm-opencode-context-project-');
  const home = temporaryDirectory('nmnm-opencode-context-home-');
  try {
    const projectPin = runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Pinned project memory' } });
    const projectRecent = runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Recent project memory', metadata: { source: 'opencode' } } });
    const globalPin = runMemory({
      cwd: project,
      home,
      platform: 'darwin',
      store: 'global',
      operation: 'retain',
      input: { content: 'Pinned global memory' },
    });
    const globalDir = join(home, 'opencode-data');
    mkdirSync(join(project, '.nanomneme'), { recursive: true });
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(settingsPath({ cwd: project, globalDir, store: 'project' }), '{ "injection_budget": 1000 }\n');
    writeFileSync(settingsPath({ cwd: project, globalDir, store: 'global' }), '{ "injection_budget": 1000 }\n');
    writePins(pinsPath({ cwd: project, home, store: 'project' }), [projectPin.id, '00000000-0000-4000-8000-000000000000']);
    writePins(pinsPath({ cwd: project, home, store: 'global' }), [globalPin.id]);

    const index = buildMemoryIndex({ cwd: project, home, globalDir, platform: 'darwin' });
    const bounded = buildMemoryIndex({ cwd: project, home, globalDir, platform: 'darwin', budget: 160 });

    assert.ok(index.content.indexOf(projectPin.id) < index.content.indexOf(projectRecent.id));
    assert.ok(index.content.indexOf(globalPin.id) < index.content.indexOf(projectRecent.id));
    assert.match(index.content, new RegExp(`\\[opencode\\].*${projectRecent.id}`));
    assert.equal(index.unresolved, 1);
    assert.ok(bounded.content.length <= 160);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('pin writes reject an owned lock without replacing pins or reclaiming it', () => {
  const root = temporaryDirectory('nmnm-pin-lock-');
  const path = join(root, 'pins.json');
  try {
    writePins(path, ['original']);
    writeFileSync(`${path}.lock`, '{"pid":0}');
    assert.throws(() => writePins(path, ['replacement']), /pins are being updated/);
    assert.deepEqual(readPins(path), ['original']);
    assert.equal(existsSync(`${path}.lock`), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('pin mutations read under the lock and release it after failure', () => {
  const root = temporaryDirectory('nmnm-pin-update-');
  const path = join(root, 'pins.json');
  try {
    assert.equal(typeof context.updatePins, 'function');
    context.updatePins(path, pins => pin(pins, 'one'));
    context.updatePins(path, pins => {
      assert.throws(() => context.updatePins(path, current => pin(current, 'competitor')), /pins are being updated/);
      assert.deepEqual(readPins(path), ['one']);
      return pin(pins, 'two');
    });
    assert.deepEqual(readPins(path), ['one', 'two']);
    assert.throws(() => context.updatePins(path, () => { throw new Error('aborted'); }), /aborted/);
    assert.equal(existsSync(`${path}.lock`), false);
    assert.deepEqual(readPins(path), ['one', 'two']);
    context.updatePins(path, pins => unpin(pins, 'one'));
    assert.deepEqual(readPins(path), ['two']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('a competing pin process fails safely and retry preserves both updates', () => {
  const root = temporaryDirectory('nmnm-pin-process-');
  const path = join(root, 'pins.json');
  const moduleUrl = new URL('../src/context.js', import.meta.url).href;
  const code = `import { updatePins, pin } from ${JSON.stringify(moduleUrl)};
    updatePins(process.argv[1], pins => pin(pins, 'other-process'));`;
  const compete = () => spawnSync(process.execPath, ['--input-type=module', '-e', code, path], { encoding: 'utf8' });
  try {
    context.updatePins(path, pins => {
      const child = compete();
      assert.equal(child.status, 1);
      assert.match(child.stderr, /pins are being updated/);
      return pin(pins, 'owner');
    });
    const retry = compete();
    assert.equal(retry.status, 0, retry.stderr);
    assert.deepEqual(readPins(path), ['owner', 'other-process']);
    assert.equal(existsSync(`${path}.lock`), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
