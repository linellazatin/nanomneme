import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-pi-compatibility.js', import.meta.url));

test('Pi compatibility runner rejects unsupported selectors before installing dependencies', () => {
  for (const args of [[], ['latest'], ['~1.3.0'], ['0.87.0', 'extra']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage: node scripts\/check-pi-compatibility\.js/);
  }
});
