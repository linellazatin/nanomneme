import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { prepareCodexDependencies } from './check-logging-packages.js';
import { runMaintenance } from './maintenance.js';
import { execFileSync } from 'node:child_process';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-codex-update-'));
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value)); };
  put('package.json', { type: 'module' });
  put('packages/nmnm-core/package.json', { name: '@openlines/nmnm-core', version: '1.0.0', dependencies: { 'jsonc-parser': '3.3.1' } });
  put('packages/nmnm-core/src/index.js', 'current core');
  put('packages/nmnm-core/src/logging-runtime.generated.js', 'current runtime');
  put('node_modules/jsonc-parser/package.json', { name: 'jsonc-parser', version: '3.3.1' });
  put('node_modules/jsonc-parser/lib/main.js', 'current parser');
  put('package-lock.json', { packages: { 'node_modules/jsonc-parser': { name: 'jsonc-parser', version: '3.3.1' } } });
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

test('preparation copies and verifies the complete runtime closure without shipping the development client', () => {
  const f = fixture();
  try {
    f.put('adapters/codex/package.json', { version: '0.2.2', dependencies: { '@openlines/nmnm-core': '1.0.0', '@modelcontextprotocol/server': '^2.4.0' }, devDependencies: { '@modelcontextprotocol/client': '^2.4.0' } });
    f.put('node_modules/@modelcontextprotocol/server/package.json', { name: '@modelcontextprotocol/server', version: '2.4.0', dependencies: { '@modelcontextprotocol/core': '2.4.0' } });
    f.put('node_modules/@modelcontextprotocol/server/index.js', 'server');
    f.put('node_modules/@modelcontextprotocol/core/package.json', { name: '@modelcontextprotocol/core', version: '2.4.0' });
    f.put('node_modules/@modelcontextprotocol/core/index.js', 'protocol core');
    f.put('node_modules/@modelcontextprotocol/client/package.json', { name: '@modelcontextprotocol/client', version: '2.4.0' });
    f.put('package-lock.json', { packages: Object.fromEntries([['jsonc-parser', '3.3.1'], ['@modelcontextprotocol/server', '2.4.0'], ['@modelcontextprotocol/core', '2.4.0']].map(([name, version]) => [`node_modules/${name}`, { version }])) });
    prepareCodexDependencies(f);
    const sdk = join(f.root, 'adapters/codex/node_modules/@modelcontextprotocol/core/index.js');
    assert.equal(readFileSync(sdk, 'utf8'), 'protocol core');
    assert.equal(existsSync(join(f.root, 'adapters/codex/node_modules/@modelcontextprotocol/client')), false);
    f.put('node_modules/@modelcontextprotocol/core/index.js', 'same-version update');
    assert.equal(prepareCodexDependencies(f), 'updated');
    assert.equal(readFileSync(sdk, 'utf8'), 'same-version update');
    f.put('node_modules/@modelcontextprotocol/core/package.json', { name: '@modelcontextprotocol/core', version: '2.3.0' });
    assert.throws(() => prepareCodexDependencies(f), /version|differs/);
    assert.equal(readFileSync(sdk, 'utf8'), 'same-version update');
  } finally { f.cleanup(); }
});

test('preparation consumes raw npm pack output in both supported shapes', () => {
  for (const keyed of [false, true]) {
    const f = fixture();
    try {
      const core = { name: '@openlines/nmnm-core', version: '1.0.0', filename: 'core.tgz', files: f.packCoreFiles().map(path => ({ path })) };
      const options = { root: f.root, runNpmPack: () => JSON.stringify(keyed ? { [core.name]: core } : [core]) };
      assert.equal(prepareCodexDependencies(options), 'updated');
      assert.equal(prepareCodexDependencies(options), 'current');
      assert.equal(readFileSync(join(f.root, 'adapters/codex/node_modules/@openlines/nmnm-core/src/index.js'), 'utf8'), 'current core');
      assert.throws(() => prepareCodexDependencies({ ...options, runNpmPack: () => JSON.stringify({ unrelated: { ...core, name: 'wrong' } }) }), /npm pack/i);
      assert.equal(readFileSync(join(f.root, 'adapters/codex/node_modules/@openlines/nmnm-core/src/index.js'), 'utf8'), 'current core');
    } finally { f.cleanup(); }
  }
});

test('codex:prepare works before registration, is repeatable, and never invokes Codex', async () => {
  const f = fixture(); const messages = [];
  try {
    const dependencies = {
      root: f.root, buildLogger: async () => [{ status: 'current' }],
      prepareCodexDependencies: () => prepareCodexDependencies(f), report: message => messages.push(message),
      runCodex: () => { throw new Error('must not invoke Codex'); },
      checkLoggingPackages: () => { throw new Error('validation is separate'); },
    };
    await runMaintenance(['codex:prepare'], dependencies);
    assert.equal(readFileSync(join(f.root, 'adapters/codex/node_modules/@openlines/nmnm-core/src/index.js'), 'utf8'), 'current core');
    await runMaintenance(['codex:prepare'], dependencies);
    assert.ok(messages.includes('Codex dependencies: updated'));
    assert.ok(messages.includes('Codex dependencies: up-to-date'));
    await assert.rejects(runMaintenance(['codex:prepare', '--fast'], dependencies), /accepts no options/);
    await assert.rejects(runMaintenance(['codex:prepare'], { ...dependencies, prepareCodexDependencies: () => { throw new Error('preparation failed'); } }), /preparation failed/);
  } finally { f.cleanup(); }
});

test('codex:prepare rebuilds stale runtimes before preparing and stops on build failure', async () => {
  const calls = [];
  const dependencies = {
    buildLogger: async ({ check }) => { calls.push(check ? 'check' : 'build'); return [{ status: calls.length === 1 ? 'stale' : 'current' }]; },
    prepareCodexDependencies: () => { calls.push('prepare'); return 'updated'; }, report: () => {},
  };
  await runMaintenance(['codex:prepare'], dependencies);
  assert.deepEqual(calls, ['check', 'build', 'check', 'prepare']);
  calls.length = 0;
  await assert.rejects(runMaintenance(['codex:prepare'], {
    ...dependencies, buildLogger: async () => [{ name: 'core', status: 'failed', error: new Error('build failed') }],
  }), /build failed/);
  assert.deepEqual(calls, []);
});

test('preparation rejects linked parents and mismatched parser before replacing dependencies', () => {
  const f = fixture();
  try {
    f.put('outside/keep', 'preserve');
    symlinkSync(join(f.root, 'outside'), join(f.root, 'adapters/codex/node_modules'), 'dir');
    assert.throws(() => prepareCodexDependencies(f), /linked dependency parent/);
    assert.equal(readFileSync(join(f.root, 'outside/keep'), 'utf8'), 'preserve');
    rmSync(join(f.root, 'adapters/codex/node_modules'));
    f.put('node_modules/jsonc-parser/package.json', { name: 'jsonc-parser', version: '0.0.0' });
    assert.throws(() => prepareCodexDependencies(f), /jsonc-parser differs/);
    assert.equal(existsSync(join(f.root, 'adapters/codex/node_modules')), false);
  } finally { f.cleanup(); }
});

test('preparation preserves nested runtime conflicts when replacing a parent package', () => {
  const f = fixture();
  try {
    f.put('adapters/codex/package.json', { version: '0.2.2', dependencies: { '@openlines/nmnm-core': '1.0.0', extra: '1.0.0' } });
    f.put('node_modules/extra/package.json', { name: 'extra', version: '1.0.0', dependencies: { 'jsonc-parser': '2.0.0' } });
    f.put('node_modules/extra/index.js', 'extra');
    f.put('node_modules/extra/node_modules/jsonc-parser/package.json', { name: 'jsonc-parser', version: '2.0.0' });
    f.put('node_modules/extra/node_modules/jsonc-parser/index.js', 'nested');
    f.put('package-lock.json', { packages: { 'node_modules/jsonc-parser': { version: '3.3.1' }, 'node_modules/extra': { version: '1.0.0' }, 'node_modules/extra/node_modules/jsonc-parser': { version: '2.0.0' } } });
    prepareCodexDependencies(f);
    const nested = join(f.root, 'adapters/codex/node_modules/extra/node_modules/jsonc-parser/index.js');
    assert.equal(readFileSync(nested, 'utf8'), 'nested');
    f.put('node_modules/extra/index.js', 'changed parent');
    prepareCodexDependencies(f);
    assert.equal(readFileSync(nested, 'utf8'), 'nested');
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
    assert.ok(h.messages.includes('updated')); assert.ok(h.messages.includes('reload-required: restart Codex with an explicit NMNM_PROJECT_DIR binding'));
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

test('Codex refresh fingerprints all runtime dependencies and removes obsolete interface files', async () => {
  const f = fixture(); const h = harness(f);
  try {
    f.put('adapters/codex/package.json', { version: '0.2.2', dependencies: { '@openlines/nmnm-core': '1.0.0', extra: '1.0.0' } });
    f.put('node_modules/extra/package.json', { name: 'extra', version: '1.0.0' });
    f.put('node_modules/extra/index.js', 'current SDK');
    f.put('package-lock.json', { packages: { 'node_modules/jsonc-parser': { version: '3.3.1' }, 'node_modules/extra': { version: '1.0.0' } } });
    await runMaintenance(['codex:update'], h.dependencies);
    writeFileSync(join(h.cache, 'node_modules/extra/index.js'), 'stale SDK');
    await runMaintenance(['codex:update'], h.dependencies);
    assert.equal(readFileSync(join(h.cache, 'node_modules/extra/index.js'), 'utf8'), 'current SDK');
    rmSync(join(f.root, 'adapters/codex/scripts/runner.js'));
    await runMaintenance(['codex:update'], h.dependencies);
    assert.equal(existsSync(join(h.cache, 'scripts/runner.js')), false);
  } finally { f.cleanup(); }
});

test('obsolete dependency cleanup rejects linked parents without touching outside content', () => {
  const f = fixture();
  try {
    prepareCodexDependencies(f);
    f.put('outside/old/keep', 'preserve');
    symlinkSync(join(f.root, 'outside'), join(f.root, 'adapters/codex/node_modules/@obsolete'), 'dir');
    f.put('adapters/codex/node_modules/.nmnm-codex-deps.json', ['@openlines/nmnm-core', 'jsonc-parser', '@obsolete/old']);
    assert.throws(() => prepareCodexDependencies(f), /linked/i);
    assert.equal(readFileSync(join(f.root, 'outside/old/keep'), 'utf8'), 'preserve');
  } finally { f.cleanup(); }
});

test('preparation refuses a linked ownership file without overwriting its target', () => {
  const f = fixture();
  try {
    prepareCodexDependencies(f);
    const state = join(f.root, 'adapters/codex/node_modules/.nmnm-codex-deps.json');
    f.put('outside/state.json', []);
    rmSync(state); symlinkSync(join(f.root, 'outside/state.json'), state);
    f.put('packages/nmnm-core/src/index.js', 'changed core');
    assert.throws(() => prepareCodexDependencies(f), /linked/i);
    assert.equal(readFileSync(join(f.root, 'outside/state.json'), 'utf8'), '[]');
  } finally { f.cleanup(); }
});

test('preparation removes only previous managed dependencies and rejects unsafe state paths', () => {
  const f = fixture();
  try {
    prepareCodexDependencies(f);
    f.put('adapters/codex/node_modules/retired/index.js', 'old managed dependency');
    f.put('adapters/codex/node_modules/unrelated/keep', 'keep');
    f.put('adapters/codex/node_modules/.nmnm-codex-deps.json', ['@openlines/nmnm-core', 'jsonc-parser', 'retired']);
    prepareCodexDependencies(f);
    assert.equal(existsSync(join(f.root, 'adapters/codex/node_modules/retired')), false);
    assert.equal(readFileSync(join(f.root, 'adapters/codex/node_modules/unrelated/keep'), 'utf8'), 'keep');
    f.put('adapters/codex/node_modules/.nmnm-codex-deps.json', ['../../outside']);
    assert.throws(() => prepareCodexDependencies(f), /Invalid managed/);
  } finally { f.cleanup(); }
});

test('preparation rejects linked packaged core files before overwriting prepared dependencies', () => {
  const f = fixture();
  try {
    prepareCodexDependencies(f);
    f.put('outside/index.js', 'outside');
    rmSync(join(f.root, 'packages/nmnm-core/src/index.js'));
    symlinkSync(join(f.root, 'outside/index.js'), join(f.root, 'packages/nmnm-core/src/index.js'));
    assert.throws(() => prepareCodexDependencies(f), /physical|link|Staged dependency differs/i);
    assert.equal(readFileSync(join(f.root, 'adapters/codex/node_modules/@openlines/nmnm-core/src/index.js'), 'utf8'), 'current core');
  } finally { f.cleanup(); }
});

test('prepared artifact dependencies must match package identity as well as version', () => {
  const f = fixture();
  try {
    prepareCodexDependencies(f);
    const preparedModules = join(f.root, 'validated/node_modules');
    cpSync(join(f.root, 'adapters/codex/node_modules'), preparedModules, { recursive: true });
    f.put('validated/node_modules/jsonc-parser/package.json', { name: 'wrong-package', version: '3.3.1' });
    assert.throws(() => prepareCodexDependencies({ ...f, preparedModules }), /name|identity/);
    assert.equal(JSON.parse(readFileSync(join(f.root, 'adapters/codex/node_modules/jsonc-parser/package.json'))).name, 'jsonc-parser');
  } finally { f.cleanup(); }
});

test('standalone artifact preparation copies locked checkout dependencies into a disposable destination only', () => {
  const f = fixture();
  try {
    const destination = join(f.root, 'standalone');
    mkdirSync(destination);
    prepareCodexDependencies({ ...f, destination });
    assert.equal(readFileSync(join(destination, 'node_modules/@openlines/nmnm-core/src/index.js'), 'utf8'), 'current core');
    assert.equal(existsSync(join(f.root, 'adapters/codex/node_modules')), false);
    assert.equal(prepareCodexDependencies({ ...f, destination }), 'current');
  } finally { f.cleanup(); }
});

test('nested cyclic runtime dependencies reuse their nearest installed ancestor', () => {
  const f = fixture();
  try {
    f.put('adapters/codex/package.json', { version: '0.2.2', dependencies: { '@openlines/nmnm-core': '1.0.0', a: '1.0.0', b: '1.0.0', holder: '1.0.0' } });
    const entries = { 'node_modules/jsonc-parser': { version: '3.3.1' } };
    for (const [path, name, version, dependencies] of [
      ['node_modules/a','a','1.0.0',{}], ['node_modules/b','b','1.0.0',{}],
      ['node_modules/holder','holder','1.0.0',{a:'2.0.0',b:'2.0.0'}],
      ['node_modules/holder/node_modules/a','a','2.0.0',{b:'2.0.0'}],
      ['node_modules/holder/node_modules/b','b','2.0.0',{a:'2.0.0'}],
    ]) { f.put(`${path}/package.json`, { name, version, dependencies }); entries[path] = { version }; }
    f.put('package-lock.json', { packages: entries });
    const code = `import {prepareCodexDependencies} from ${JSON.stringify(new URL('./check-logging-packages.js', import.meta.url).href)}; prepareCodexDependencies({root:${JSON.stringify(f.root)},packCoreFiles:()=>${JSON.stringify(f.packCoreFiles())}});`;
    execFileSync(process.execPath, ['--input-type=module', '-e', code], { timeout: 3000, stdio: 'pipe' });
    assert.equal(prepareCodexDependencies(f), 'current');
    const names = JSON.parse(readFileSync(join(f.root, 'adapters/codex/node_modules/.nmnm-codex-deps.json')));
    assert.equal(names.length, 7);
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
