import test from 'node:test';
import assert from 'node:assert/strict';
import semver from 'semver';
import { existsSync, readFileSync } from 'node:fs';

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('Codex package registers only MCP and excludes obsolete interfaces and development clients', () => {
  const root = new URL('../', import.meta.url);
  const pkg = json(new URL('../package.json', import.meta.url));
  const compatibility = json(new URL('../.codex-plugin/plugin.json', import.meta.url));
  assert.equal(compatibility.mcpServers, './.mcp.json');
  const mcp = json(new URL('../.mcp.json', import.meta.url));

  assert.equal(pkg.name, '@openlines/nmnm-codex');
  assert.equal(pkg.version, compatibility.version);
  assert(semver.satisfies(json(new URL('../../../packages/nmnm-core/package.json', import.meta.url)).version, pkg.dependencies['@openlines/nmnm-core']));
  assert.deepEqual([...pkg.bundleDependencies].sort(), Object.keys(pkg.dependencies).sort());
  assert.equal(compatibility.name, 'nmnm-codex');
  assert.equal(compatibility.hooks, undefined);
  assert.deepEqual(mcp.mcpServers.nanomneme, { command: 'node', args: ['mcp/server.js'], cwd: '.', env_vars: ['NMNM_PROJECT_DIR', 'CODEX_HOME', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID'] });
  for (const path of ['plugin.json', 'hooks/hooks.json', 'hooks/session-start.js', 'scripts/runner.js', 'skills/memory/runner.js', 'src/runner.js', 'src/context.js', 'src/hooks.js']) assert.equal(existsSync(new URL(path, root)), false, path);
  assert.ok(pkg.files.includes('.mcp.json') && pkg.files.includes('mcp'));
  assert.equal(pkg.dependencies['@modelcontextprotocol/client'], undefined);
  assert.equal(pkg.files.includes('test'), false);
});
