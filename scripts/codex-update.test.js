import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { prepareCodexDependencies } from './check-logging-packages.js';
import { runMaintenance } from './maintenance.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-codex-update-'));
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value)); };
  put('package.json', { type: 'module' });
  put('packages/nmnm-core/package.json', { name: '@openlines/nmnm-core', version: '1.0.0', dependencies: { 'jsonc-parser': '3.3.1' } });
  put('packages/nmnm-core/src/index.js', 'current core');
  put('packages/nmnm-core/src/logging-runtime.generated.js', 'current runtime');
  put('node_modules/jsonc-parser/package.json', { name: 'jsonc-parser', version: '3.3.1' });
  put('node_modules/jsonc-parser/lib/main.js', 'current parser');
  put('adapters/codex/package.json', { version: '0.2.2', dependencies: { '@openlines/nmnm-core': '1.0.0' } });
  put('adapters/codex/.codex-plugin/plugin.json', { name: 'nmnm-codex', version: '0.2.2' });
  put('adapters/codex/scripts/runner.js', 'current runner');
  const packCoreFiles = () => ['package.json', 'src/index.js', 'src/logging-runtime.generated.js'];
  return { root, put, packCoreFiles, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('preparation is content-aware, replaces obsolete managed files, and preserves unrelated dependencies', () => {
  const f = fixture();
  try {
    f.put('adapters/codex/node_modules/unrelated/keep', 'keep');
    assert.equal(prepareCodexDependencies(f), 'updated');
    assert.equal(prepareCodexDependencies(f), 'current');
    f.put('adapters/codex/node_modules/@openlines/nmnm-core/obsolete.js', 'obsolete');
    f.put('packages/nmnm-core/src/index.js', 'same-version change');
    assert.equal(prepareCodexDependencies(f), 'updated');
    assert.equal(existsSync(join(f.root, 'adapters/codex/node_modules/@openlines/nmnm-core/obsolete.js')), false);
    assert.equal(readFileSync(join(f.root, 'adapters/codex/node_modules/unrelated/keep'), 'utf8'), 'keep');
    const target = join(f.root, 'adapters/codex/node_modules/jsonc-parser');
    rmSync(target, { recursive: true }); symlinkSync(join(f.root, 'node_modules/jsonc-parser'), target, 'dir');
    assert.equal(prepareCodexDependencies(f), 'updated');
    assert.equal(prepareCodexDependencies(f), 'current');
    f.put('adapters/codex/.codex-plugin/plugin.json', { version: '0.0.0' });
    assert.throws(() => prepareCodexDependencies(f), /manifest/);
  } finally { f.cleanup(); }
});

test('preparation rejects linked parents and mismatched parser before replacing dependencies', () => {
  const f = fixture();
  try {
    f.put('outside/keep', 'preserve');
    symlinkSync(join(f.root, 'outside'), join(f.root, 'adapters/codex/node_modules'), 'dir');
    assert.throws(() => prepareCodexDependencies(f), /linked dependency parent/);
    assert.equal(readFileSync(join(f.root, 'outside/keep'), 'utf8'), 'preserve');
    rmSync(join(f.root, 'adapters/codex/node_modules'));
    f.put('node_modules/jsonc-parser/package.json', { version: '0.0.0' });
    assert.throws(() => prepareCodexDependencies(f), /jsonc-parser differs/);
    assert.equal(existsSync(join(f.root, 'adapters/codex/node_modules')), false);
  } finally { f.cleanup(); }
});

function harness(f) {
  const env = { ...process.env, CODEX_HOME: join(f.root, 'custom-codex-home') };
  const cache = join(env.CODEX_HOME, 'plugins/cache/nanomneme-local/nmnm-codex/0.2.2');
  const plugin = { name: 'nmnm-codex', marketplaceName: 'nanomneme-local', version: '0.2.2', installed: true, enabled: true, source: { source: 'local', path: join(f.root, 'adapters/codex') } };
  const marketplace = { name: 'nanomneme-local', root: f.root, marketplaceSource: { sourceType: 'local', source: f.root } };
  const calls = []; const messages = [];
  const dependencies = {
    root: f.root, env, report: message => messages.push(message),
    buildLogger: async () => { calls.push('build-check'); return [{ status: 'current' }]; },
    prepareCodexDependencies: () => { calls.push('prepare'); return prepareCodexDependencies(f); },
    runCodex: args => {
      calls.push(args.join(' '));
      if (args[1] === 'marketplace') return JSON.stringify({ marketplaces: [marketplace] });
      if (args[1] === 'list') return JSON.stringify({ installed: [plugin] });
      if (args[1] === 'add') { rmSync(cache, { recursive: true, force: true }); cpSync(join(f.root, 'adapters/codex'), cache, { recursive: true }); return '{}'; }
      throw new Error('unexpected command');
    },
  };
  return { dependencies, calls, messages, cache, plugin, marketplace };
}

test('Codex refresh verifies a custom-home cache and catches same-version changes', async () => {
  const f = fixture(); const h = harness(f);
  try {
    await runMaintenance(['codex:update'], h.dependencies);
    assert.ok(h.messages.includes('updated')); assert.ok(h.messages.includes('reload-required: start a new Codex session and review hook trust prompts'));
    assert.ok(h.calls.indexOf('prepare') < h.calls.indexOf('plugin add nmnm-codex@nanomneme-local --json'));
    h.calls.length = 0; h.messages.length = 0;
    await runMaintenance(['codex:update'], h.dependencies);
    assert.equal(h.calls.some(call => call.startsWith('plugin add')), false); assert.ok(h.messages.includes('up-to-date'));
    f.put('adapters/codex/scripts/runner.js', 'changed runner');
    await runMaintenance(['codex:update'], h.dependencies);
    assert.equal(readFileSync(join(h.cache, 'scripts/runner.js'), 'utf8'), 'changed runner');
    writeFileSync(join(h.cache, 'node_modules/@openlines/nmnm-core/src/index.js'), 'stale cached core');
    await runMaintenance(['codex:update'], h.dependencies);
    assert.equal(readFileSync(join(h.cache, 'node_modules/@openlines/nmnm-core/src/index.js'), 'utf8'), 'current core');
  } finally { f.cleanup(); }
});

test('Codex refresh stops before preparation on missing/wrong/disabled installation or malformed CLI output', async () => {
  for (const scenario of ['missing-marketplace', 'wrong-marketplace', 'missing-plugin', 'disabled', 'malformed']) {
    const f = fixture(); const h = harness(f);
    try {
      const run = h.dependencies.runCodex;
      h.dependencies.runCodex = args => {
        if (scenario === 'malformed') return '{';
        if (args[1] === 'marketplace' && scenario === 'missing-marketplace') return '{"marketplaces":[]}';
        if (args[1] === 'list' && scenario === 'missing-plugin') return '{"installed":[]}';
        return run(args);
      };
      if (scenario === 'wrong-marketplace') h.marketplace.root = tmpdir();
      if (scenario === 'disabled') h.plugin.enabled = false;
      await assert.rejects(runMaintenance(['codex:update'], h.dependencies));
      assert.equal(h.calls.includes('prepare'), false); assert.equal(h.calls.includes('build-check'), false);
    } finally { f.cleanup(); }
  }
});

test('Codex refresh propagates install failures and rejects stale post-install cache', async () => {
  for (const installFailure of [true, false]) {
    const f = fixture(); const h = harness(f);
    try {
      const run = h.dependencies.runCodex;
      h.dependencies.runCodex = args => args[1] === 'add' ? (installFailure ? (() => { throw new Error('install failed'); })() : '{}') : run(args);
      await assert.rejects(runMaintenance(['codex:update'], h.dependencies), installFailure ? /install failed/ : /cache/);
    } finally { f.cleanup(); }
  }
});
