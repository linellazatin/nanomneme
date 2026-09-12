import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { settingsPath } from '../src/context.js';
import { runMemory } from '../src/store.js';
import { hookOutput, reinjectionContext, sessionStartOutput } from '../src/hooks.js';

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), name));
}

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

    // Disabled by default: never fires, but still advances the prompt count.
    const disabled = reinjectionContext(env, { prompt_count: 0 });
    assert.deepEqual(disabled.output, {});
    assert.equal(disabled.state.prompt_count, 1);

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
