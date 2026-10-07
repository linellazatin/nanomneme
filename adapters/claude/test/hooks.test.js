import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMemoryIndex, pinsPath, settingsPath } from '../src/context.js';
import { statePath } from '../src/session-state.js';
import { runMemory } from '../src/store.js';
import { hookOutput, reinjectionContext, renderContext, sessionStartOutput } from '../src/hooks.js';

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), name));
}

test('renderContext puts complete guidance before index rows and omits empty indexes', () => {
  const index = { total: 1, content: 'Nanomneme memory index:\nrow\n', autoretention: 'Complete guidance' };
  assert.equal(renderContext(index), 'Complete guidance\n\nNanomneme memory index:\nrow');
  assert.equal(renderContext({ ...index, total: 0 }), 'Complete guidance');
  assert.equal(renderContext({ ...index, autoretention: undefined }), 'Nanomneme memory index:\nrow');
  assert.equal(renderContext({ total: 0 }), '');
});

test('rendered Claude context preserves complete guidance at exact budget boundaries', () => {
  const cwd = temporaryDirectory('nmnm-claude-render-budget-');
  const home = temporaryDirectory('nmnm-claude-render-budget-home-');
  const globalDir = join(home, 'claude-data');
  const env = { cwd, home, globalDir, platform: 'darwin' };
  try {
    runMemory({ cwd, store: 'project', operation: 'retain', input: { content: 'Budgeted index row' } });
    writeFileSync(settingsPath({ ...env, store: 'project' }), '{"autoretention":{"enabled":true,"always_ask":["Keep this complete rule."]}}');
    const full = buildMemoryIndex(env);
    const guidance = full.autoretention;
    for (const budget of [guidance.length, guidance.length + 2, guidance.length + 2 + full.content.length]) {
      const rendered = renderContext(buildMemoryIndex({ ...env, budget }));
      assert.ok(rendered.startsWith(guidance));
      assert.ok(rendered.length <= budget);
    }
    assert.equal(renderContext(buildMemoryIndex({ ...env, budget: guidance.length })), guidance);
    assert.throws(() => buildMemoryIndex({ ...env, budget: guidance.length - 1 }), /exceeds the injection budget/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('hookOutput omits empty context and wraps non-empty context for the named event', () => {
  assert.deepEqual(hookOutput('SessionStart', ''), {});
  assert.deepEqual(hookOutput('UserPromptSubmit', 'ctx'), {
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'ctx' },
  });
});

test('sessionStartOutput injects the bounded index and autoretention as SessionStart context', () => {
  const project = temporaryDirectory('nmnm-claude-hook-project-');
  const home = temporaryDirectory('nmnm-claude-hook-home-');
  try {
    const globalDir = join(home, 'claude-data');
    mkdirSync(join(project, '.nanomneme'), { recursive: true });
    mkdirSync(globalDir, { recursive: true });
    const memory = runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Injected fact' } });
    writeFileSync(settingsPath({ cwd: project, globalDir, store: 'project' }), JSON.stringify({
      autoretention: { enabled: true, always_persist: ['Keep decisions.'] },
    }));

    const output = sessionStartOutput({ cwd: project, home, globalDir, platform: 'darwin' });
    assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(output.hookSpecificOutput.additionalContext, new RegExp(memory.id));
    assert.match(output.hookSpecificOutput.additionalContext, /Nanomneme autoretention/);
    assert.ok(output.hookSpecificOutput.additionalContext.startsWith('## Nanomneme autoretention'));
    assert.ok(output.hookSpecificOutput.additionalContext.length <= 2000);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('sessionStartOutput emits nothing when there is no memory and no autoretention', () => {
  const project = temporaryDirectory('nmnm-claude-hook-empty-');
  const home = temporaryDirectory('nmnm-claude-hook-empty-home-');
  try {
    assert.deepEqual(sessionStartOutput({ cwd: project, home, platform: 'darwin' }), {});
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('reinjectionContext stays off unless enabled, then fires on the configured cadence', () => {
  const project = temporaryDirectory('nmnm-claude-reinject-');
  const home = temporaryDirectory('nmnm-claude-reinject-home-');
  try {
    const globalDir = join(home, 'claude-data');
    mkdirSync(join(project, '.nanomneme'), { recursive: true });
    mkdirSync(globalDir, { recursive: true });
    runMemory({ cwd: project, store: 'project', operation: 'retain', input: { content: 'Reinjected fact' } });
    const env = { cwd: project, home, globalDir, platform: 'darwin' };

    // Disabled by default: never fires or advances the prompt count.
    const disabled = reinjectionContext(env, { prompt_count: 0 });
    assert.deepEqual(disabled.output, {});
    assert.equal(disabled.state.prompt_count, 0);

    // Enabled with a cadence of 2: fires only on the 2nd eligible prompt.
    writeFileSync(settingsPath({ cwd: project, globalDir, store: 'project' }), JSON.stringify({
      reinjection: { enabled: true, every_n_prompts: 2 },
    }));
    const first = reinjectionContext(env, { prompt_count: 0 });
    assert.deepEqual(first.output, {});
    assert.equal(first.state.prompt_count, 1);
    const second = reinjectionContext(env, first.state);
    assert.equal(second.output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.equal(second.state.prompt_count, 2);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('reinjectionContext skips memory reads until an enabled cadence and advances through context failures', () => {
  const cwd = temporaryDirectory('nmnm-claude-reinject-gate-');
  const home = temporaryDirectory('nmnm-claude-reinject-gate-home-');
  const globalDir = join(home, 'claude-data');
  const env = { cwd, home, globalDir, platform: 'darwin' };
  try {
    mkdirSync(join(cwd, '.nanomneme'));
    mkdirSync(globalDir);
    writeFileSync(pinsPath({ cwd, store: 'project' }), 'invalid pins');
    const state = { prompt_count: 4, last_injection: 3 };
    assert.deepEqual(reinjectionContext(env, state), { output: {}, state });
    writeFileSync(settingsPath({ ...env, store: 'global' }), JSON.stringify({ reinjection: { enabled: true, every_n_prompts: 2 } }));
    const first = reinjectionContext(env, state);
    assert.deepEqual(first, { output: {}, state: { ...state, prompt_count: 5 } });
    const failed = reinjectionContext(env, first.state);
    assert.deepEqual(failed, { output: {}, state: { ...state, prompt_count: 6 } });
    writeFileSync(settingsPath({ ...env, store: 'project' }), JSON.stringify({ reinjection: { enabled: false } }));
    assert.deepEqual(reinjectionContext(env, failed.state), failed);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('enabled reinjection recovers unusable prompt counters instead of stalling its cadence', () => {
  const cwd = temporaryDirectory('nmnm-claude-counter-hook-');
  const home = temporaryDirectory('nmnm-claude-counter-hook-home-');
  const globalDir = join(home, 'claude-data');
  try {
    mkdirSync(join(cwd, '.nanomneme'));
    mkdirSync(globalDir);
    writeFileSync(settingsPath({ cwd, globalDir, store: 'project' }), '{"reinjection":{"enabled":true,"every_n_prompts":2}}');
    for (const prompt_count of ['bad', -1, 1.5, Number.MAX_SAFE_INTEGER, null]) {
      assert.equal(reinjectionContext({ cwd, home, globalDir }, { prompt_count }).state.prompt_count, 1);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

function runPromptHook(env, sessionId, guard = '') {
  const args = guard ? ['--import', `data:text/javascript,${encodeURIComponent(guard)}`] : [];
  return spawnSync(process.execPath, [...args, new URL('../hooks/prompt-submit.js', import.meta.url).pathname], {
    cwd: env.cwd,
    input: JSON.stringify({ cwd: env.cwd, session_id: sessionId }),
    encoding: 'utf8',
    env: { ...process.env, HOME: env.home, CLAUDE_PLUGIN_DATA: env.globalDir, TMPDIR: env.cwd },
  });
}

test('disabled prompt hook never accesses memory or session-state files, including existing state', () => {
  const cwd = temporaryDirectory('nmnm-claude-disabled-hook-');
  const home = temporaryDirectory('nmnm-claude-disabled-hook-home-');
  const globalDir = join(home, 'claude-data');
  const sessionId = randomUUID();
  const stateDir = join(cwd, 'nmnm-claude');
  const path = statePath(sessionId, stateDir);
  try {
    mkdirSync(join(cwd, '.nanomneme'));
    mkdirSync(globalDir);
    writeFileSync(settingsPath({ cwd, globalDir, store: 'project' }), '{"reinjection":{"enabled":false}}');
    const blocked = [stateDir, pinsPath({ cwd, store: 'project' }), join(cwd, '.nanomneme', 'memory.db'), join(home, '.local', 'share', 'nanomneme')];
    const guard = `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
      const blocked = ${JSON.stringify(blocked)};
      for (const name of ['existsSync', 'readFileSync', 'writeFileSync', 'mkdirSync']) {
        const original = fs[name];
        fs[name] = function(path, ...args) {
          if (blocked.some(prefix => String(path).startsWith(prefix))) { process.exitCode = 9; throw new Error('Unexpected disabled-hook IO'); }
          return original.call(this, path, ...args);
        };
      }
      syncBuiltinESMExports();`;
    for (const existing of [false, true]) {
      if (existing) { mkdirSync(stateDir); writeFileSync(path, '{"prompt_count":7,"last_injection":5}'); }
      const result = runPromptHook({ cwd, home, globalDir }, sessionId, guard);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '');
      if (existing) assert.equal(readFileSync(path, 'utf8'), '{"prompt_count":7,"last_injection":5}');
      else assert.equal(existsSync(stateDir), false);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('prompt hook persists enabled cadence, fails open, and recovers after bad pins are repaired', () => {
  const cwd = temporaryDirectory('nmnm-claude-cadence-hook-');
  const home = temporaryDirectory('nmnm-claude-cadence-hook-home-');
  const globalDir = join(home, 'claude-data');
  const sessionId = randomUUID();
  const env = { cwd, home, globalDir };
  const path = statePath(sessionId, join(cwd, 'nmnm-claude'));
  try {
    mkdirSync(join(cwd, '.nanomneme'));
    mkdirSync(globalDir);
    writeFileSync(settingsPath({ ...env, store: 'project' }), '{"reinjection":{"enabled":true,"every_n_prompts":2}}');
    writeFileSync(pinsPath({ cwd, store: 'project' }), 'invalid pins');
    for (const count of [1, 2]) {
      const result = runPromptHook(env, sessionId);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '');
      assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { prompt_count: count });
    }
    writeFileSync(pinsPath({ cwd, store: 'project' }), '[]');
    runMemory({ cwd, store: 'project', operation: 'retain', input: { content: 'Recovered hook memory' } });
    const third = runPromptHook(env, sessionId);
    assert.equal(third.status, 0, third.stderr);
    assert.equal(third.stdout, '');
    const fourth = runPromptHook(env, sessionId);
    assert.equal(fourth.status, 0, fourth.stderr);
    assert.match(JSON.parse(fourth.stdout).hookSpecificOutput.additionalContext, /Recovered hook memory/);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { prompt_count: 4, last_injection: 4 });
    writeFileSync(settingsPath({ ...env, store: 'project' }), '{ invalid settings');
    const invalidSettings = runPromptHook(env, sessionId);
    assert.equal(invalidSettings.status, 0, invalidSettings.stderr);
    assert.equal(invalidSettings.stdout, '');
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { prompt_count: 4, last_injection: 4 });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
