import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('Codex package uses the legacy compatibility manifest for hook registration', () => {
  const root = new URL('../', import.meta.url);
  const pkg = json(new URL('../package.json', import.meta.url));
  const rootManifest = json(new URL('../plugin.json', import.meta.url));
  const compatibility = json(new URL('../.codex-plugin/plugin.json', import.meta.url));
  const hooks = json(new URL('../hooks/hooks.json', import.meta.url));

  assert.equal(pkg.name, '@openlines/nmnm-codex');
  assert.equal(pkg.version, '0.1.0');
  assert.equal(pkg.dependencies['@openlines/nmnm-core'], '0.1.1');
  assert.deepEqual(pkg.bundleDependencies, ['@openlines/nmnm-core']);
  assert.deepEqual(rootManifest, { name: 'nmnm-codex' });
  assert.equal(compatibility.name, 'nmnm-codex');
  assert.equal(compatibility.hooks, './hooks/hooks.json');
  assert.match(hooks.hooks.SessionStart[0].hooks[0].command, /\$\{PLUGIN_ROOT\}\/hooks\/session-start\.js/);
  assert.equal(existsSync(new URL('./skills/memory/runner.js', root)), true);
});
