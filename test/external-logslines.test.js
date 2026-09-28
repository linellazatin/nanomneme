import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lockfile = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const provenance = JSON.parse(readFileSync(new URL('../external/logslines/PROVENANCE.json', import.meta.url), 'utf8'));
const generatedRuntime = readFileSync(new URL('../adapters/pi/src/logger-runtime.generated.js', import.meta.url), 'utf8');

test('Logslines is an external v0.1.0 source snapshot, not an npm dependency', () => {
  assert.match(packageJson.scripts.test, /scripts\/\*\.test\.js/);
  assert.equal(Object.hasOwn(packageJson.devDependencies, '@openlines/logslines'), false);
  assert.equal(JSON.stringify(lockfile).includes('file:../logslines'), false);
  assert.equal(Object.hasOwn(lockfile.packages, '../logslines'), false);
  assert.deepEqual(provenance, {
    repository: 'https://github.com/linellazatin/logslines',
    tag: 'v0.1.0',
    release_url: 'https://github.com/linellazatin/logslines/releases/tag/v0.1.0',
    files: ['LICENSE', 'src/logger.js', 'src/sinks/stderr.js'],
  });
  assert.doesNotMatch(generatedRuntime, /@openlines\/logslines|\.\.\/\.\.\/external\/logslines/);
  assert.match(generatedRuntime, /Logslines v0\.1\.0[\s\S]*MIT License/);
});
