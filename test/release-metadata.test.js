import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('release metadata identifies the hardening release', () => {
  const root = json(new URL('../package.json', import.meta.url));
  const lock = json(new URL('../package-lock.json', import.meta.url));
  const pi = json(new URL('../adapters/pi/package.json', import.meta.url));
  const core = json(new URL('../packages/nmnm-core/package.json', import.meta.url));
  const cli = json(new URL('../packages/nmnm-cli/package.json', import.meta.url));
  const claude = json(new URL('../adapters/claude/package.json', import.meta.url));
  const codex = json(new URL('../adapters/codex/package.json', import.meta.url));
  const opencode = json(new URL('../adapters/opencode/package.json', import.meta.url));
  assert.equal(root.version, '0.4.0');
  assert.equal(lock.version, '0.4.0');
  assert.equal(lock.packages['adapters/codex'].name, '@openlines/nmnm-codex');
  assert.equal(lock.packages['node_modules/@openlines/nmnm-codex'].resolved, 'adapters/codex');
  assert.equal(core.version, '0.1.1');
  assert.equal(cli.version, '0.1.1');
  assert.equal(pi.version, '0.2.1');
  assert.equal(claude.name, '@openlines/nmnm-claude');
  assert.equal(claude.version, '0.1.2');
  assert.equal(codex.version, '0.1.0');
  assert.equal(opencode.version, '0.1.1');
  for (const pkg of [cli, pi, claude, codex, opencode]) {
    assert.equal(pkg.dependencies['@openlines/nmnm-core'], '0.1.1', `${pkg.name} must pin @openlines/nmnm-core 0.1.1`);
  }
  assert.equal(root.engines.node, '>=22.19.0');
  assert.equal(pi.engines.node, '>=22.19.0');
  assert.equal(root.devDependencies['@earendil-works/pi-coding-agent'], '>=0.87.0');
  assert.equal(lock.packages['node_modules/@earendil-works/pi-coding-agent'].version, '0.87.1');
  assert.deepEqual(pi.peerDependencies, {
    '@earendil-works/pi-tui': '*',
    typebox: '*',
  });
});

test('Codex prototype remains marketplace-local and is not released to npm', () => {
  const codex = json(new URL('../adapters/codex/package.json', import.meta.url));
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

  assert.equal(codex.private, true);
  assert.equal(codex.publishConfig, undefined);
  assert.match(ci, /npm pack --dry-run[^\n]*--workspace @openlines\/nmnm-codex/);
  assert.doesNotMatch(release, /@openlines\/nmnm-codex/);
  assert.doesNotMatch(readme, /npmjs\.com\/package\/%40openlines%2Fnmnm-codex/);
});
