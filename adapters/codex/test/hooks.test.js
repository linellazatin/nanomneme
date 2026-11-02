import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('native prompt cadence reloads configuration, isolates sessions and advances through context failures', async t => {
  const { handleHook } = await import('../src/hooks.js');
  const home = mkdtempSync(join(tmpdir(), 'nmnm-codex-hooks-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const cwd = join(home, 'project'); mkdirSync(cwd);
  const stateRoot = join(home, 'state');
  const options = { home, env: { CODEX_HOME: home }, stateRoot };
  const payload = { cwd, session_id: 'session-a', hook_event_name: 'UserPromptSubmit' };
  const put = value => writeFileSync(join(home, 'nmnm.jsonc'), JSON.stringify(value));
  const full = { injection_budget: 3000, reinjection: { enabled: true, every_n_prompts: 2 }, autoretention: { enabled: true, always_persist: ['HOOK_RULE'] } };
  assert.deepEqual(handleHook(payload, options), {});
  assert.equal(existsSync(stateRoot), false, 'disabled reinjection must not touch session state');
  put(full);
  assert.match(handleHook({ ...payload, hook_event_name: 'SessionStart' }, options).hookSpecificOutput.additionalContext, /HOOK_RULE/);
  assert.equal(existsSync(stateRoot), false);
  assert.deepEqual(handleHook(payload, options), {});
  assert.deepEqual(handleHook({ ...payload, session_id: 'session-b' }, options), {});
  assert.match(handleHook(payload, options).hookSpecificOutput.additionalContext, /HOOK_RULE/);
  put({ ...full, injection_budget: 10 });
  assert.deepEqual(handleHook(payload, options), {});
  assert.deepEqual(handleHook(payload, options), {}, 'context failure advances prompt 4');
  put(full);
  assert.deepEqual(handleHook(payload, options), {}, 'prompt 5 must not inject after failure');
  assert.match(handleHook(payload, options).hookSpecificOutput.additionalContext, /HOOK_RULE/);
  writeFileSync(join(home, 'nmnm.jsonc'), '{broken');
  assert.deepEqual(handleHook(payload, options), {});
  put(full);
  assert.deepEqual(handleHook(payload, options), {}, 'invalid settings did not advance state');
  assert.match(handleHook(payload, options).hookSpecificOutput.additionalContext, /HOOK_RULE/);
  assert.deepEqual(handleHook({ ...payload, hook_event_name: 'SessionEnd' }, options), {});
  assert.equal(readdirSync(stateRoot).filter(name => name.endsWith('.json')).length, 1);
  assert.deepEqual(handleHook(payload, options), {}, 'ended session starts a fresh cadence');
  assert.equal(existsSync(join(cwd, '.nanomneme')), false);
});

test('hook executable uses validated payload cwd, stays fail-open and never persists prompts', t => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-codex-hook-wire-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const entry = fileURLToPath(new URL('../hooks/context.js', import.meta.url));
  const cwd = join(home, 'project'); mkdirSync(cwd);
  writeFileSync(join(home, 'nmnm.jsonc'), '{"autoretention":{"enabled":true,"always_persist":["WIRE_RULE"]}}');
  const run = input => spawnSync(process.execPath, [entry], { cwd: home, env: { HOME: home, CODEX_HOME: home, NMNM_PROJECT_DIR: home }, input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', timeout: 5000 });
  const result = run({ hook_event_name: 'SessionStart', cwd, session_id: 'wire', prompt: 'PRIVATE_PROMPT' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /WIRE_RULE/);
  for (const payload of ['{broken', { hook_event_name: 'SessionStart', session_id: 'x' }, { hook_event_name: 'SessionStart', cwd: '.', session_id: 'x' }, { hook_event_name: 'SessionStart', cwd, session_id: '' }, 'x'.repeat(1048577)]) {
    const bad = run(payload);
    assert.equal(bad.status, 0, bad.stderr);
    assert.equal(bad.stdout, '');
    assert.equal(bad.stderr.includes('PRIVATE_PROMPT'), false);
  }
});

test('cadence persists only private bookkeeping, deduplicates host turns and isolates workspaces', async t => {
  const { handleHook } = await import('../src/hooks.js');
  const home = mkdtempSync(join(tmpdir(), 'nmnm-codex-state-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const stateRoot = join(home, 'state'), cwd = join(home, 'one'), other = join(home, 'two');
  mkdirSync(cwd); mkdirSync(other);
  writeFileSync(join(home, 'nmnm.jsonc'), '{"reinjection":{"enabled":true,"every_n_prompts":2}}');
  const options = { home, stateRoot, env: { CODEX_HOME: home } };
  const payload = { hook_event_name: 'UserPromptSubmit', cwd, session_id: '../same-session', turn_id: 'turn-one', prompt: 'PRIVATE_PROMPT' };
  handleHook(payload, options);
  handleHook(payload, options);
  const path = join(stateRoot, readdirSync(stateRoot)[0]);
  assert.deepEqual(JSON.parse(readFileSync(path)), { prompt_count: 1, turn_id: 'turn-one' });
  assert.match(path.split('/').at(-1), /^[a-f0-9]{64}\.json$/);
  if (process.platform !== 'win32') {
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(stateRoot).mode & 0o777, 0o700);
  }
  handleHook({ ...payload, cwd: other }, options);
  assert.equal(readdirSync(stateRoot).length, 2);
  writeFileSync(path+'.lock', 'held');
  assert.deepEqual(handleHook({ ...payload, turn_id: 'turn-two' }, options), {});
  assert.equal(JSON.parse(readFileSync(path)).prompt_count, 1);
  rmSync(path+'.lock');
  handleHook({ ...payload, turn_id: 'turn-two' }, options);
  assert.equal(JSON.parse(readFileSync(path)).prompt_count, 2);
});
