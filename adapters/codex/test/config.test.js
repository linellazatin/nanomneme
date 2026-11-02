import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

test('native JSONC settings merge project scalars and complete user/project rule sets', async t => {
  const { resolveSettings } = await import('../src/config.js');
  const home = mkdtempSync(join(tmpdir(), 'nmnm-codex-config-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const cwd = join(home, 'project'), codex = join(home, 'custom-codex');
  const options = { cwd, home, env: { CODEX_HOME: codex } };
  assert.deepEqual(resolveSettings(options), { injection_budget: 2000, reinjection: { enabled: false, every_n_prompts: 5 }, autoretention: { enabled: false, always_persist: [], never_persist: [], always_ask: [] } });
  assert.equal(existsSync(cwd), false);
  function put(path, content) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
  put(join(codex, 'nmnm.jsonc'), '// complete native shape\n'+JSON.stringify({ injection_budget: 10000, reinjection: { enabled: true, every_n_prompts: 5 }, logging: { enabled: true }, autoretention: { enabled: true, always_persist: ['decisions', 'decisions'], never_persist: ['secrets'], always_ask: ['personal'] } }));
  put(join(cwd, '.nanomneme/nmnm.jsonc'), '{"injection_budget":1200,"reinjection":{"every_n_prompts":2},"autoretention":{"always_persist":["decisions","conventions"],},}');
  assert.deepEqual(resolveSettings(options), { injection_budget: 1200, reinjection: { enabled: true, every_n_prompts: 2 }, autoretention: { enabled: true, always_persist: ['decisions', 'conventions'], never_persist: ['secrets'], always_ask: ['personal'] } });
  put(join(cwd, '.nanomneme/nmnm.jsonc'), '{"autoretention":{"enabled":false},"reinjection":{"enabled":false},"logging":{"enabled":"invalid"}}');
  const disabled = resolveSettings(options);
  assert.equal(disabled.autoretention.enabled, false);
  assert.equal(disabled.reinjection.enabled, false);
  assert.equal(disabled.injection_budget, 10000);
});

test('malformed native settings reject before context/store effects, with bounded file input', async t => {
  const { resolveSettings } = await import('../src/config.js');
  const home = mkdtempSync(join(tmpdir(), 'nmnm-codex-invalid-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const options = { home, cwd: join(home, 'project'), env: { CODEX_HOME: home } };
  for (const content of ['{broken', '[]', 'null', '{"injection_budget":-1}', '{"injection_budget":1.2}', '{"reinjection":true}', '{"reinjection":{"enabled":1}}', '{"reinjection":{"every_n_prompts":0}}', '{"autoretention":[]}', '{"autoretention":{"enabled":"yes"}}', '{"autoretention":{"always_ask":[""]}}', '{"autoretention":{"never_persist":"secret"}}', ' '.repeat(262145)]) {
    writeFileSync(join(home, 'nmnm.jsonc'), content);
    assert.throws(() => resolveSettings(options), /settings|injection_budget|reinjection|autoretention/);
    assert.equal(existsSync(options.cwd), false);
  }
});
