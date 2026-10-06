import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('release metadata aligns the 0.8.0 UI release and every consumer', () => {
  const root = json(new URL('../package.json', import.meta.url));
  const lock = json(new URL('../package-lock.json', import.meta.url));
  const pi = json(new URL('../adapters/pi/package.json', import.meta.url));
  const core = json(new URL('../packages/nmnm-core/package.json', import.meta.url));
  const cli = json(new URL('../packages/nmnm-cli/package.json', import.meta.url));
  const ui = json(new URL('../packages/nmnm-ui/package.json', import.meta.url));
  const claude = json(new URL('../adapters/claude/package.json', import.meta.url));
  const codex = json(new URL('../adapters/codex/package.json', import.meta.url));
  const opencode = json(new URL('../adapters/opencode/package.json', import.meta.url));
  assert.equal(root.version, '0.8.0');
  assert.equal(lock.version, root.version);
  assert.equal(lock.packages['adapters/codex'].name, '@openlines/nmnm-codex');
  assert.equal(lock.packages['node_modules/@openlines/nmnm-codex'].resolved, 'adapters/codex');
  assert.equal(core.version, '0.3.0');
  assert.equal(cli.version, '0.4.0');
  assert.equal(ui.name, '@openlines/nmnm-ui');
  assert.equal(ui.version, '0.1.0');
  assert.notEqual(ui.private, true);
  assert.equal(cli.dependencies['@openlines/nmnm-ui'], ui.version);
  assert.equal(cli.engines.node, ui.engines.node);
  assert.equal(ui.exports, './src/launcher.js');
  assert.equal(ui.engines.node, root.engines.node);
  assert.equal(lock.packages['node_modules/@openlines/nmnm-ui'].resolved, 'packages/nmnm-ui');
  assert.equal(pi.version, '0.4.1');
  assert.equal(claude.name, '@openlines/nmnm-claude');
  assert.equal(claude.version, '0.2.1');
  assert.equal(codex.version, '0.2.1');
  assert.equal(opencode.version, '0.2.1');
  for (const [path, pkg] of [['', root], ['packages/nmnm-core', core], ['packages/nmnm-cli', cli], ['packages/nmnm-ui', ui],
    ['adapters/pi', pi], ['adapters/claude', claude], ['adapters/codex', codex], ['adapters/opencode', opencode]]) {
    assert.equal(lock.packages[path].version, pkg.version, `${path || 'root'} lockfile version`);
    assert.deepEqual(lock.packages[path].engines, pkg.engines, `${path || 'root'} lockfile engines`);
  }
  for (const pkg of [cli, ui, pi, claude, codex, opencode]) {
    assert.equal(pkg.dependencies['@openlines/nmnm-core'], core.version, `${pkg.name} must pin the current core`);
  }
  for (const path of ['packages/nmnm-cli', 'packages/nmnm-ui', 'adapters/pi', 'adapters/claude', 'adapters/codex', 'adapters/opencode']) {
    assert.equal(lock.packages[path].dependencies['@openlines/nmnm-core'], core.version, `${path} lockfile core pin`);
  }
  assert.equal(json(new URL('../adapters/claude/.claude-plugin/plugin.json', import.meta.url)).version, claude.version);
  assert.equal(json(new URL('../adapters/codex/.codex-plugin/plugin.json', import.meta.url)).version, codex.version);
  assert.equal(root.engines.node, '>=22.19.0');
  assert.equal(pi.engines.node, '>=22.19.0');
  assert.equal(root.devDependencies['@earendil-works/pi-coding-agent'], '>=0.87.0');
  assert.equal(lock.packages['node_modules/@earendil-works/pi-coding-agent'].version, '1.0.0');
  assert.deepEqual(pi.peerDependencies, {
    '@earendil-works/pi-tui': '*',
    typebox: '*',
  });
  assert.equal(root.devDependencies['@openlines/logslines'], undefined);
  assert.equal(lock.packages['../logslines'], undefined);
  assert.equal(root.devDependencies.esbuild, '0.28.2');
  assert.equal(pi.dependencies['@openlines/logslines'], undefined);
  assert.equal(pi.dependencies['@openlines/nmnm-logger'], undefined);
  assert.equal(lock.packages['packages/logger'], undefined);
});

test('Codex prototype remains marketplace-local and is not released to npm', () => {
  const codex = json(new URL('../adapters/codex/package.json', import.meta.url));
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

  assert.equal(codex.private, true);
  assert.equal(codex.publishConfig, undefined);
  assert.match(ci, /node scripts\/check-logging-packages\.js/);
  assert.doesNotMatch(release, /@openlines\/nmnm-codex/);
  assert.doesNotMatch(readme, /npmjs\.com\/package\/%40openlines%2Fnmnm-codex/);
});
