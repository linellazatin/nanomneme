import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { Key, matchesKey, truncateToWidth } from '@earendil-works/pi-tui';
import { Type } from 'typebox';

const require = createRequire(import.meta.url);

const { version: piTuiVersion } = require('@earendil-works/pi-tui/package.json');

// Floor the adapter's loader-provided host dependency at the current Pi host
// release. Bump this together with the Pi host version so the lockfile cannot
// silently fall back to an older `@earendil-works/pi-tui` baseline.
const MIN_PI_TUI = [0, 87, 0];

function versionParts(version) {
  return version.split('.').map((part) => Number.parseInt(part, 10));
}

function atLeast(version, minimum) {
  const parts = versionParts(version);
  for (let index = 0; index < minimum.length; index += 1) {
    const candidate = parts[index] ?? 0;
    if (candidate > minimum[index]) return true;
    if (candidate < minimum[index]) return false;
  }
  return true;
}

test('loader-provided host packages satisfy the adapter surface', () => {
  assert.ok(
    atLeast(piTuiVersion, MIN_PI_TUI),
    `@earendil-works/pi-tui ${piTuiVersion} is older than the minimum host baseline ${MIN_PI_TUI.join('.')}`,
  );

  // `src/session.js` links only these pi-tui exports.
  assert.equal(typeof matchesKey, 'function');
  assert.equal(typeof truncateToWidth, 'function');
  for (const key of ['up', 'down', 'left', 'right', 'enter', 'escape']) {
    assert.ok(Key[key] !== undefined, `Key.${key} is missing`);
  }
  assert.equal(matchesKey('\x1b[C', Key.right), true);
  assert.equal(matchesKey('j', Key.right), false);
  assert.equal(truncateToWidth('abc', 10), 'abc');
  assert.match(truncateToWidth('abcdef', 3), /\.\.\./);

  // `src/tools.js` links only these typebox constructors.
  for (const name of ['Object', 'String', 'Number', 'Array', 'Optional', 'Union', 'Literal', 'Null', 'Any']) {
    assert.equal(typeof Type[name], 'function', `Type.${name} is missing`);
  }
});