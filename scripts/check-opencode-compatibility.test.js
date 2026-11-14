import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-opencode-compatibility.js', import.meta.url));

test('OpenCode compatibility rejects unreviewed hosts and mismatched native versions', () => {
  for (const args of [[], ['v3', '2.3.0', process.execPath], ['v2', 'latest', process.execPath],
    ['v2', '2.3.0', 'relative'], ['v2', '2.3.0', process.execPath, 'extra']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
  }
  const result = spawnSync(process.execPath, [script, 'v2', '2.3.0', process.execPath], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Expected OpenCode 2.3.0/);
});

test('OpenCode gate rejects skipped, empty, missing, and failed native tests', () => {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-opencode-gate-'));
  try {
    for (const directory of ['scripts', 'bin', 'adapters/opencode/test']) mkdirSync(join(root, directory), { recursive: true });
    const runner = join(root, 'scripts/check-opencode-compatibility.js');
    writeFileSync(runner, readFileSync(script));
    const host = join(root, 'bin/opencode');
    writeFileSync(host, '#!/bin/sh\nprintf "2.3.0\\n"\n', { mode: 0o755 });
    // Stub only host discovery and terminal rendering; real Node TAP gates run.
    writeFileSync(join(root, 'bin/python'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const native = join(root, 'adapters/opencode/test/browser-rpc-host.test.js');
    writeFileSync(join(root, 'adapters/opencode/test/local.test.js'), "import test from 'node:test'; test('adapter fixture', () => {});");
    const env = { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`,
      NMNM_OPENCODE_LIVE_MODEL: 'must-not-reach-tests', NMNM_ADAPTER_ROOT: '/untrusted', AWS_PROFILE: 'must-not-reach-tests' };
    delete env.NODE_TEST_CONTEXT;
    for (const [scenario, source] of [
      ['passed', `import test from 'node:test'; import assert from 'node:assert/strict';
        test('native V2 host fixture', () => {
          assert.equal(process.env.NMNM_OPENCODE_V2, ${JSON.stringify(host)});
          for (const key of ['NMNM_OPENCODE_LIVE_MODEL', 'NMNM_ADAPTER_ROOT', 'AWS_PROFILE']) assert.equal(process.env[key], undefined);
        });`],
      ['skipped', "import test from 'node:test'; test('native V2 host fixture', { skip: true }, () => {});"],
      ['empty', ''],
      ['failed', "import test from 'node:test'; test('native fixture', () => { throw new Error('synthetic failure'); });"],
      ['missing', null],
    ]) {
      if (source === null) rmSync(native);
      else writeFileSync(native, source);
      const result = spawnSync(process.execPath, [runner, 'v2', '2.3.0', host], { env, encoding: 'utf8' });
      assert.equal(result.status, scenario === 'passed' ? 0 : 1, `${scenario}: ${result.stderr}`);
      if (['skipped', 'empty'].includes(scenario)) assert.match(result.stderr, /Required native OpenCode coverage was skipped or empty/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
