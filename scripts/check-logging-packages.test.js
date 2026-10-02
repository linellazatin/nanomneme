import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLoggingContents } from './check-logging-packages.js';

test('package checks reject missing runtime and Codex bundled parser', () => {
  assert.throws(() => assertLoggingContents('core', ['src/logging.js']), /logging-runtime/);
  assert.doesNotThrow(() => assertLoggingContents('core', ['src/logging.js', 'src/logging-runtime.generated.js', 'src/index.js']));
  assert.throws(() => assertLoggingContents('codex', ['node_modules/@openlines/nmnm-core/src/logging.js', 'node_modules/@openlines/nmnm-core/src/logging-runtime.generated.js']), /jsonc-parser/);
});
