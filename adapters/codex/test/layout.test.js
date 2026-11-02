import test from 'node:test';
import assert from 'node:assert/strict';
import semver from 'semver';
import { existsSync, readFileSync } from 'node:fs';

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('Codex ships direct MCP and context entrypoints without plugin registration or development clients', () => {
  const root = new URL('../', import.meta.url);
  const pkg = json(new URL('../package.json', import.meta.url));

  assert.equal(pkg.name, '@openlines/nmnm-codex');
  assert(semver.satisfies(json(new URL('../../../packages/nmnm-core/package.json', import.meta.url)).version, pkg.dependencies['@openlines/nmnm-core']));
  assert.deepEqual([...pkg.bundleDependencies].sort(), Object.keys(pkg.dependencies).sort());
  for (const path of ['.codex-plugin/plugin.json', '.mcp.json', 'plugin.json', 'hooks/hooks.json', 'hooks/session-start.js', 'scripts/runner.js', 'skills/memory/runner.js', 'src/runner.js']) assert.equal(existsSync(new URL(path, root)), false, path);
  assert.equal(existsSync(new URL('../../../.agents/plugins/marketplace.json', import.meta.url)), false);
  for (const path of ['mcp/launch.js', 'mcp/server.js', 'hooks/context.js', 'src/config.js']) assert.ok(existsSync(new URL(path, root)), path);
  assert.ok(pkg.files.includes('mcp') && pkg.files.includes('hooks'));
  assert.equal(pkg.files.includes('.mcp.json'), false);
  assert.equal(pkg.files.includes('.codex-plugin'), false);
  assert.ok(semver.satisfies('3.3.1', pkg.dependencies['jsonc-parser']));
  assert.equal(pkg.dependencies['@modelcontextprotocol/client'], undefined);
  assert.equal(pkg.files.includes('test'), false);
});
