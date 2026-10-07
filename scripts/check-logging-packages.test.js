import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLoggingContents } from './check-logging-packages.js';
import * as checks from './check-logging-packages.js';
import { readFileSync } from 'node:fs';

test('checked-in Claude cache lock matches its manifest and stays on the reviewed registry release', () => {
  const manifest = JSON.parse(readFileSync(new URL('../adapters/claude/package.json', import.meta.url)));
  const lock = JSON.parse(readFileSync(new URL('../adapters/claude/package-lock.json', import.meta.url)));
  checks.assertClaudeLock(manifest, lock);
  assert.equal(manifest.dependencies['@openlines/nmnm-core'], '^0.3.0');
  assert.equal(lock.packages['node_modules/@openlines/nmnm-core'].version, '0.3.0');
});

test('Claude cache lock rejects manifest drift and unfrozen non-registry dependencies', () => {
  assert.equal(typeof checks.assertClaudeLock, 'function');
  const manifest = { name: '@openlines/nmnm-claude', version: '0.2.2', dependencies: { '@openlines/nmnm-core': '^0.3.0' } };
  const entry = { version: '0.3.0', resolved: 'https://registry.npmjs.org/@openlines/nmnm-core/-/nmnm-core-0.3.0.tgz', integrity: 'sha512-' + Buffer.alloc(64).toString('base64') };
  const lock = { lockfileVersion: 3, packages: { '': manifest, 'node_modules/@openlines/nmnm-core': entry } };
  assert.doesNotThrow(() => checks.assertClaudeLock(manifest, lock));
  assert.throws(() => checks.assertClaudeLock({ ...manifest, overrides: {} }, lock), /overrides/);
  for (const patch of [{ resolved: 'file:../core' }, { resolved: 'http://registry.npmjs.org/core.tgz' }, { link: true }, { version: '^0.3.0' }, { integrity: undefined }]) {
    const invalid = structuredClone(lock);
    Object.assign(invalid.packages['node_modules/@openlines/nmnm-core'], patch);
    assert.throws(() => checks.assertClaudeLock(manifest, invalid), /registry|version|integrity|link/i);
  }
  const drift = structuredClone(lock);
  drift.packages[''].dependencies['@openlines/nmnm-core'] = '0.3.1';
  assert.throws(() => checks.assertClaudeLock(manifest, drift), /dependencies/);
  const missing = structuredClone(lock);
  delete missing.packages['node_modules/@openlines/nmnm-core'];
  assert.throws(() => checks.assertClaudeLock(manifest, missing), /missing/i);
});

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
