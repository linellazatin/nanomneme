import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLoggingContents } from './check-logging-packages.js';

test('package checks exclude the shared release fixture from every distribution', () => {
  for (const kind of ['core', 'ui', 'cli', 'pi', 'claude', 'opencode', 'codex']) {
    assert.throws(() => assertLoggingContents(kind, ['shared/fixtures/logslines-release.json']), /release fixture/);
  }
});

test('thin consumer packages require their binding, with core supplied as a dependency', () => {
  for (const kind of ['cli', 'pi', 'claude', 'opencode']) {
    assert.doesNotThrow(() => assertLoggingContents(kind, ['src/logslines.js']));
    assert.throws(() => assertLoggingContents(kind, []), /src\/logslines.js/);
  }
});

test('package checks reject missing runtime and Codex bundled parser', () => {
  assert.throws(() => assertLoggingContents('core', ['src/logslines.js']), /logging-runtime/);
  assert.doesNotThrow(() => assertLoggingContents('core', ['src/logslines.js', 'src/logging-runtime.generated.js', 'src/index.js']));
  assert.throws(() => assertLoggingContents('codex', ['node_modules/@openlines/nmnm-core/src/logslines.js', 'node_modules/@openlines/nmnm-core/src/logging-runtime.generated.js']), /jsonc-parser/);
});

test('UI package requires runtime files and excludes repository-relative build inputs', () => {
  const files = ['src/launcher.js', 'src/server.js', 'src/logslines.js', 'src/ui-logging-runtime.generated.js'];
  assert.doesNotThrow(() => assertLoggingContents('ui', files));
  assert.throws(() => assertLoggingContents('ui', files.slice(0, -1)), /missing src\/ui-logging-runtime/);
  for (const source of ['src/ui-logger.js', 'build/ui-logger.js']) {
    assert.throws(() => assertLoggingContents('ui', [...files, source]), /build-only logger source/);
  }
});
