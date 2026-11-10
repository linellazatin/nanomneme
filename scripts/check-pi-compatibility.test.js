import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-pi-compatibility.js', import.meta.url));

test('Pi compatibility runner rejects unsupported selectors before installing dependencies', () => {
  for (const args of [[], ['latest'], ['~1.3.0'], ['0.87.0', 'extra']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage: node scripts\/check-pi-compatibility\.js/);
  }
});

test('required Pi threading coverage rejects skipped, empty, missing, or failing suites', () => {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-pi-threading-gate-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'bin'));
    mkdirSync(join(root, 'adapters/pi/test'), { recursive: true });
    writeFileSync(join(root, 'scripts/check-pi-compatibility.js'), readFileSync(script));
    // Stub registry/install commands only. The real runner and Node TAP checks execute.
    writeFileSync(join(root, 'bin/npm'), `#!/usr/bin/env node
if (process.argv[2] === 'view') console.log(JSON.stringify(process.argv[4] === 'version' ? '1.5.1' : { typebox: '1.3.27' }));
else if (process.argv[2] !== 'install') process.exit(1);
`, { mode: 0o755 });
    for (const name of ['@earendil-works/pi-coding-agent', '@earendil-works/pi-tui', '@earendil-works/pi-ai', 'typebox']) {
      const directory = join(root, 'node_modules', name);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: name === 'typebox' ? '1.3.27' : '1.5.1' }));
    }
    const threading = join(root, 'adapters/pi/test/host-threading.test.js');
    const env = { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, NMNM_PI_REQUIRE_THREADING_TESTS: '1' };
    // This subprocess must start its own test runner, not inherit Node's child-test mode.
    delete env.NODE_TEST_CONTEXT;
    for (const [scenario, source] of [
      ['passed', "import test from 'node:test'; test('Pi threading probe', () => {});"],
      ['skipped', "import test from 'node:test'; test('Pi threading probe', { skip: true }, () => {});"],
      ['empty', ''],
      ['missing', null],
      ['failed', "import test from 'node:test'; test('Pi threading probe', () => { throw new Error('synthetic failure'); });"],
    ]) {
      if (source === null) rmSync(threading);
      else writeFileSync(threading, source);
      const result = spawnSync(process.execPath, [join(root, 'scripts/check-pi-compatibility.js'), '~1.5.0'], {
        encoding: 'utf8',
        env,
      });
      assert.equal(result.status, scenario === 'passed' ? 0 : 1, `${scenario}: ${result.stderr}`);
      if (['skipped', 'empty'].includes(scenario)) assert.match(result.stderr, /Required Pi threading coverage was skipped or empty/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
