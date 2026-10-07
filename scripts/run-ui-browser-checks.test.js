import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = join(root, 'scripts/run-ui-browser-checks.sh');
const expected = [
  'chromium packages/nmnm-ui/test/browser.py',
  'chromium packages/nmnm-ui/test/browser_regressions.py',
  'firefox packages/nmnm-ui/test/browser.py',
  'firefox packages/nmnm-ui/test/browser_regressions.py',
  'webkit packages/nmnm-ui/test/browser.py',
  'webkit packages/nmnm-ui/test/browser_regressions.py',
];

function run(failure = '') {
  const dir = mkdtempSync(join(tmpdir(), 'nmnm-ui-runner-'));
  const calls = join(dir, 'calls');
  try {
    // Replace only the external Python command; exercise the real gate's sequencing and exit status.
    writeFileSync(join(dir, 'python3'), '#!/bin/sh\nprintf "%s %s\\n" "$NMNM_UI_BROWSER" "$1" >> "$CALLS"\nif [ "$NMNM_UI_BROWSER $1" = "$FAILURE" ]; then exit 7; fi\n', { mode: 0o700 });
    const result = spawnSync('bash', [script], { cwd: root, encoding: 'utf8', env: {
      ...process.env, PATH: dir + ':' + process.env.PATH, CALLS: calls, FAILURE: failure,
    } });
    return { ...result, calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [] };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('UI gate runs both suites in every engine and succeeds only when all pass', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, expected);
});

test('a workflow-suite failure blocks the gate without skipping other engines or regressions', () => {
  const result = run('chromium packages/nmnm-ui/test/browser.py');
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(result.calls, expected);
});

test('a regression-suite failure blocks the gate even when later engines pass', () => {
  const result = run('firefox packages/nmnm-ui/test/browser_regressions.py');
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(result.calls, expected);
});
