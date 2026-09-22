import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('release metadata identifies the Pi trust-aware release', () => {
  const root = json(new URL('../../../package.json', import.meta.url));
  const adapter = json(new URL('../package.json', import.meta.url));
  assert.equal(root.version, '0.3.3');
  assert.equal(adapter.version, '0.2.0');
  assert.equal(root.engines.node, '>=22.19.0');
  assert.equal(adapter.engines.node, '>=22.19.0');
  assert.equal(root.devDependencies['@earendil-works/pi-coding-agent'], '0.87.0');
  assert.deepEqual(adapter.peerDependencies, {
    '@earendil-works/pi-tui': '*',
    typebox: '*',
  });
});
