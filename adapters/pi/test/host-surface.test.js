import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { matchesKey, truncateToWidth } from '@earendil-works/pi-tui';
import { Type } from 'typebox';

const require = createRequire(import.meta.url);

const { version: piTuiVersion } = require('@earendil-works/pi-tui/package.json');

// Accept stable patches in ~1.2.0 for the development host only.
// The published compatibility floor remains Pi >=0.87.0.
const PI_TUI_TEST_HOST = /^1\.2\.(0|[1-9]\d*)(?:\+[0-9A-Za-z.-]+)?$/;

test('development host range accepts stable 1.2 patches without changing the compatibility floor', () => {
  for (const version of ['1.2.0', '1.2.1', '1.2.99', '1.2.1+build.1']) {
    assert.match(version, PI_TUI_TEST_HOST);
  }
  for (const version of ['0.87.0', '1.1.9', '1.3.0', '2.0.0', '1.2.1-rc.1', '1.2.01']) {
    assert.doesNotMatch(version, PI_TUI_TEST_HOST);
  }
});

test('development host version satisfies ~1.2.0', () => {
  assert.match(piTuiVersion, PI_TUI_TEST_HOST, 'Pi TUI test host must satisfy ~1.2.0');
});

test('loader-provided host packages satisfy the adapter surface', () => {
  // `src/session.js` links only these pi-tui exports.
  assert.equal(typeof matchesKey, 'function');
  assert.equal(typeof truncateToWidth, 'function');
  assert.equal(matchesKey('\x1b[C', 'right'), true);
  assert.equal(matchesKey('j', 'right'), false);
  assert.equal(truncateToWidth('abc', 10), 'abc');
  assert.match(truncateToWidth('abcdef', 3), /\.\.\./);

  // `src/tools.js` links only these typebox constructors.
  for (const name of ['Object', 'String', 'Number', 'Array', 'Optional', 'Union', 'Literal', 'Null']) {
    assert.equal(typeof Type[name], 'function', `Type.${name} is missing`);
  }
});
