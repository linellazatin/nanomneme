import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLoggingContents } from './check-logging-packages.js';

test('package checks reject missing runtime and Codex bundled parser', () => {
  assert.throws(() => assertLoggingContents('core', ['src/logging.js']), /logging-runtime/);
  assert.doesNotThrow(() => assertLoggingContents('core', ['src/logging.js', 'src/logging-runtime.generated.js', 'src/index.js']));
  assert.throws(() => assertLoggingContents('codex', ['node_modules/@openlines/nmnm-core/src/logging.js', 'node_modules/@openlines/nmnm-core/src/logging-runtime.generated.js']), /jsonc-parser/);
});

test('UI package requires runtime files and excludes repository-relative build inputs', () => {
  const files = ['src/launcher.js', 'src/server.js', 'src/logslines.js', 'src/ui-logging-runtime.generated.js'];
  assert.doesNotThrow(() => assertLoggingContents('ui', files));
  assert.throws(() => assertLoggingContents('ui', files.slice(0, -1)), /missing src\/ui-logging-runtime/);
  for (const source of ['src/ui-logger.js', 'build/ui-logger.js']) {
    assert.throws(() => assertLoggingContents('ui', [...files, source]), /build-only logger source/);
  }
});
