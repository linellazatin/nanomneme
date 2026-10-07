import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { checkPinnedLogslines } from '../scripts/external-logslines.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lockfile = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const provenance = JSON.parse(readFileSync(new URL('../external/logslines/PROVENANCE.json', import.meta.url), 'utf8'));
const generatedRuntime = readFileSync(new URL('../packages/nmnm-core/src/logging-runtime.generated.js', import.meta.url), 'utf8');
const pin = JSON.parse(readFileSync(new URL('../shared/fixtures/logslines-release.json', import.meta.url), 'utf8'));
const uiRuntime = readFileSync(new URL('../packages/nmnm-ui/src/ui-logging-runtime.generated.js', import.meta.url), 'utf8');

test('Logslines matches its independent release fixture, not an npm dependency', () => {
  assert.match(packageJson.scripts.test, /scripts\/\*\.test\.js/);
  assert.equal(Object.hasOwn(packageJson.devDependencies, '@openlines/logslines'), false);
  assert.equal(JSON.stringify(lockfile).includes('file:../logslines'), false);
  assert.equal(Object.hasOwn(lockfile.packages, '../logslines'), false);
  assert.deepEqual(provenance, pin);
  checkPinnedLogslines();
  for (const [path, expectedHash] of Object.entries(pin.sha256)) {
    const source = readFileSync(new URL(`../external/logslines/${path}`, import.meta.url));
    assert.equal(createHash('sha256').update(source).digest('hex'), expectedHash, `${path} must match the pinned Logslines ${pin.tag} snapshot`);
  }
  assert.doesNotMatch(generatedRuntime, /@openlines\/logslines|\.\.\/\.\.\/external\/logslines/);
  for (const runtime of [generatedRuntime, uiRuntime]) {
    assert.ok(runtime.includes(`Logslines ${pin.tag}\n`));
    assert.ok(runtime.includes('MIT License'));
  }
});
