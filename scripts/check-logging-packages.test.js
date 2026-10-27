import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLoggingContents } from './check-logging-packages.js';
import * as checks from './check-logging-packages.js';
import { readFileSync } from 'node:fs';

test('npm pack accepts array and name-keyed output and selects the expected package', () => {
  const core = { name: '@openlines/nmnm-core', version: '0.3.2', filename: 'core.tgz', files: [{ path: 'package.json' }, { path: 'src/index.js' }] };
  for (const output of [[core], { [core.name]: core }]) {
    assert.deepEqual(checks.parseNpmPackOutput(JSON.stringify(output), [core]), [core]);
  }
  const other = { ...core, name: 'other', filename: 'other.tgz' };
  assert.deepEqual(checks.parseNpmPackOutput(JSON.stringify({ other, [core.name]: core }), [core, other]), [other, core]);
});

test('npm pack rejects invalid metadata and unsafe file entries before use', () => {
  const core = { name: '@openlines/nmnm-core', version: '0.3.2', filename: 'core.tgz', files: [{ path: 'package.json' }] };
  for (const output of ['broken', 'null', '42', '{}', '[]', JSON.stringify([null])]) {
    assert.throws(() => checks.parseNpmPackOutput(output, [core]), /npm pack/i);
  }
  for (const patch of [{ name: 'wrong' }, { version: '0.3.1' }, { filename: '../core.tgz' }, { files: undefined }, { files: [] }, { files: [null] }, { files: [{ path: 1 }] }, { files: [{ path: '' }] }, { files: [{ path: '../outside' }] }, { files: [{ path: '/outside' }] }, { files: [{ path: 'C:\\outside' }] }, { files: [{ path: 'src/index.js' }] }]) {
    assert.throws(() => checks.parseNpmPackOutput(JSON.stringify([{ ...core, ...patch }]), [core]), /npm pack/i);
  }
  assert.throws(() => checks.parseNpmPackOutput(JSON.stringify([core, core]), [core]), /npm pack/i);
});

test('checked-in Claude cache lock contains only external registry dependencies', () => {
  const manifest = JSON.parse(readFileSync(new URL('../adapters/claude/package.json', import.meta.url)));
  const lock = JSON.parse(readFileSync(new URL('../adapters/claude/package-lock.json', import.meta.url)));
  checks.assertClaudeLock(manifest, lock);
  assert.equal(manifest.dependencies['@openlines/nmnm-core'], undefined);
  assert.equal(lock.packages['node_modules/@openlines/nmnm-core'], undefined);
});

test('Claude cache lock rejects manifest drift and unfrozen non-registry dependencies', () => {
  assert.equal(typeof checks.assertClaudeLock, 'function');
  const manifest = { name: '@openlines/nmnm-claude', version: '0.2.2', dependencies: { 'jsonc-parser': '^3.3.0' } };
  const entry = { version: '3.3.1', resolved: 'https://registry.npmjs.org/jsonc-parser/-/jsonc-parser-3.3.1.tgz', integrity: 'sha512-' + Buffer.alloc(64).toString('base64') };
  const lock = { lockfileVersion: 3, packages: { '': manifest, 'node_modules/jsonc-parser': entry } };
  assert.doesNotThrow(() => checks.assertClaudeLock(manifest, lock));
  assert.throws(() => checks.assertClaudeLock({ ...manifest, dependencies: { ...manifest.dependencies, '@openlines/nmnm-core': '^0.3.2' } }, lock), /generated core runtime/);
  const registryCore = structuredClone(lock);
  registryCore.packages['node_modules/@openlines/nmnm-core'] = entry;
  assert.throws(() => checks.assertClaudeLock(manifest, registryCore), /exclude registry core/);
  const stale = structuredClone(lock);
  stale.packages['node_modules/jsonc-parser'].version = '0.2.0';
  assert.throws(() => checks.assertClaudeLock(manifest, stale), /does not satisfy/);
  assert.throws(() => checks.assertClaudeLock({ ...manifest, overrides: {} }, lock), /overrides/);
  for (const patch of [{ resolved: 'file:../core' }, { resolved: 'http://registry.npmjs.org/core.tgz' }, { link: true }, { version: '^3.3.0' }, { integrity: undefined }]) {
    const invalid = structuredClone(lock);
    Object.assign(invalid.packages['node_modules/jsonc-parser'], patch);
    assert.throws(() => checks.assertClaudeLock(manifest, invalid), /registry|version|integrity|link/i);
  }
  const drift = structuredClone(lock);
  drift.packages[''].dependencies['jsonc-parser'] = '3.3.0';
  assert.throws(() => checks.assertClaudeLock(manifest, drift), /dependencies/);
  const missing = structuredClone(lock);
  delete missing.packages['node_modules/jsonc-parser'];
  assert.throws(() => checks.assertClaudeLock(manifest, missing), /missing/i);
});

test('package checks exclude the shared release fixture from every distribution', () => {
  for (const kind of ['core', 'ui', 'cli', 'pi', 'claude', 'opencode', 'codex']) {
    assert.throws(() => assertLoggingContents(kind, ['shared/fixtures/logslines-release.json']), /release fixture/);
  }
});

test('thin consumer packages require their binding, with core supplied as a dependency', () => {
  for (const kind of ['cli', 'pi', 'opencode']) {
    assert.doesNotThrow(() => assertLoggingContents(kind, ['src/logslines.js']));
    assert.throws(() => assertLoggingContents(kind, []), /src\/logslines.js/);
  }
});

test('Claude package requires generated core and self-contained logging', () => {
  const files = ['src/logslines.js', 'src/core-runtime.generated.js', 'src/logging-runtime.generated.js'];
  assert.doesNotThrow(() => assertLoggingContents('claude', files));
  for (const runtime of files) assert.throws(() => assertLoggingContents('claude', files.filter(file => file !== runtime)), /missing/);
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
