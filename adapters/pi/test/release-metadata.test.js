import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('release metadata identifies the hardening release', () => {
  const root = json(new URL('../../../package.json', import.meta.url));
  const adapter = json(new URL('../package.json', import.meta.url));
  const core = json(new URL('../../../packages/nmnm-core/package.json', import.meta.url));
  const cli = json(new URL('../../../packages/nmnm-cli/package.json', import.meta.url));
  const claude = json(new URL('../../claude/package.json', import.meta.url));
  const opencode = json(new URL('../../opencode/package.json', import.meta.url));
  assert.equal(root.version, '0.3.4');
  assert.equal(core.version, '0.1.1');
  assert.equal(cli.version, '0.1.1');
  assert.equal(adapter.version, '0.2.1');
  assert.equal(claude.version, '0.1.3');
  assert.equal(opencode.version, '0.1.1');
  for (const pkg of [cli, adapter, claude, opencode]) {
    assert.equal(pkg.dependencies['@openlines/nmnm-core'], '0.1.1', `${pkg.name} must pin @openlines/nmnm-core 0.1.1`);
  }
  assert.equal(root.engines.node, '>=22.19.0');
  assert.equal(adapter.engines.node, '>=22.19.0');
  assert.equal(root.devDependencies['@earendil-works/pi-coding-agent'], '0.87.0');
  assert.deepEqual(adapter.peerDependencies, {
    '@earendil-works/pi-tui': '*',
    typebox: '*',
  });
});
