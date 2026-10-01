import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lockfile = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const provenance = JSON.parse(readFileSync(new URL('../external/logslines/PROVENANCE.json', import.meta.url), 'utf8'));
const generatedRuntime = readFileSync(new URL('../packages/nmnm-core/src/logging-runtime.generated.js', import.meta.url), 'utf8');
const expectedHashes = {
  LICENSE: '31443a7d985a9cb205b44071db835fd6e65f2609425fa22d694b86b364f99575',
  'src/logger.js': '25794c90147009a477e2562da581c3042e5d24d23eb57b475698df0c9c42cbaf',
  'src/sinks/stderr.js': 'b7d83da57a8c9b6fe509493a5fa00b27457c36d9402234203ef7636ccc1066f2',
  'spec/v1/schema.json': 'c195002fee665ddda2fce633535a507f38c475471e0a17b90290275edacc9791',
};

test('Logslines is an external v0.1.0 source snapshot, not an npm dependency', () => {
  assert.match(packageJson.scripts.test, /scripts\/\*\.test\.js/);
  assert.equal(Object.hasOwn(packageJson.devDependencies, '@openlines/logslines'), false);
  assert.equal(JSON.stringify(lockfile).includes('file:../logslines'), false);
  assert.equal(Object.hasOwn(lockfile.packages, '../logslines'), false);
  assert.deepEqual(provenance, {
    repository: 'https://github.com/linellazatin/logslines',
    tag: 'v0.1.0',
    release_url: 'https://github.com/linellazatin/logslines/releases/tag/v0.1.0',
    files: ['LICENSE', 'src/logger.js', 'src/sinks/stderr.js', 'spec/v1/schema.json'],
    sha256: expectedHashes,
  });
  for (const [path, expectedHash] of Object.entries(expectedHashes)) {
    const source = readFileSync(new URL(`../external/logslines/${path}`, import.meta.url));
    assert.equal(createHash('sha256').update(source).digest('hex'), expectedHash, `${path} must match the pinned Logslines v0.1.0 snapshot`);
  }
  assert.doesNotMatch(generatedRuntime, /@openlines\/logslines|\.\.\/\.\.\/external\/logslines/);
  assert.match(generatedRuntime, /Logslines v0\.1\.0[\s\S]*MIT License/);
});
