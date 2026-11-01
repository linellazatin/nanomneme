#!/usr/bin/env node
import assert from 'node:assert/strict';
import semver from 'semver';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const packageName = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/;
const ownPackage = path => path === 'node_modules' || path.startsWith('node_modules/');

function installedPackage(name, from, boundary, lock) {
  assert(packageName.test(name), 'Invalid runtime dependency name');
  const locations = createRequire(join(from, 'package.json')).resolve.paths(name) ?? [];
  for (const directory of locations) {
    const source = join(directory, name);
    if (!source.startsWith(boundary + sep)) continue;
    const entry = lock?.packages?.[relative(boundary, source).split(sep).join('/')];
    if (lock && !entry) continue;
    if (!existsSync(join(source, 'package.json'))) continue;
    for (let parent = source; parent !== boundary; parent = dirname(parent)) assert(!lstatSync(parent).isSymbolicLink(), `Linked runtime dependency: ${name}`);
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
    assert.equal(manifest.name, name, `Runtime dependency name differs: ${name}`);
    if (entry) assert.equal(manifest.version, entry.version, `Installed ${name} differs from locked version`);
    return { source, manifest };
  }
  throw new Error(`Missing runtime dependency: ${name}`);
}

// Resolve only declared production dependencies; package exports need not expose package.json.
export function readCodexRuntime(root) {
  root = resolve(root);
  const files = {}, visited = new Set();
  const visit = (manifest, from) => {
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      const spec = installedPackage(name, from, root);
      assert(semver.satisfies(spec.manifest.version, range), `Runtime dependency version differs: ${name}`);
      if (visited.has(spec.source)) continue;
      visited.add(spec.source);
      const tree = readPackageTree(spec.source, { exclude: ownPackage });
      assert(tree, `Expected physical runtime dependency: ${name}`);
      const prefix = relative(root, spec.source).split(sep).join('/');
      for (const [path, hash] of Object.entries(tree)) files[`${prefix}/${path}`] = hash;
      visit(spec.manifest, spec.source);
    }
  };
  visit(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')), root);
  return files;
}

function safePackagePath(path) {
  return typeof path === 'string' && path.length > 0 && !isAbsolute(path)
    && !/[\\\u0000:]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..');
}

export function parseNpmPackOutput(output, expectedPackages) {
  let parsed;
  try { parsed = JSON.parse(output); } catch { throw new Error('Invalid npm pack JSON output'); }
  assert(parsed !== null && typeof parsed === 'object', 'Unexpected npm pack JSON output');
  const packages = Array.isArray(parsed) ? parsed : Object.values(parsed);
  assert(packages.length > 0, 'npm pack returned no packages');
  const names = new Set();
  for (const pkg of packages) {
    assert(pkg && typeof pkg === 'object' && typeof pkg.name === 'string' && pkg.name.length > 0, 'Invalid npm pack package metadata');
    assert(!names.has(pkg.name), `Duplicate npm pack package: ${pkg.name}`);
    names.add(pkg.name);
    const expected = expectedPackages.find(item => item.name === pkg.name);
    assert(expected && pkg.version === expected.version, `Unexpected npm pack package/version: ${pkg.name}@${pkg.version}`);
    assert(safePackagePath(pkg.filename) && !pkg.filename.includes('/') && pkg.filename.endsWith('.tgz'), 'Invalid npm pack filename');
    assert(Array.isArray(pkg.files) && pkg.files.length > 0, `Invalid npm pack files: ${pkg.name}`);
    const paths = pkg.files.map(file => {
      assert(file && typeof file === 'object' && safePackagePath(file.path), `Invalid npm pack file path: ${pkg.name}`);
      return file.path;
    });
    assert(paths.includes('package.json') && new Set(paths).size === paths.length, `Invalid npm pack file list: ${pkg.name}`);
  }
  assert(expectedPackages.every(pkg => names.has(pkg.name)), 'npm pack is missing expected package metadata');
  return packages;
}

// A null tree means missing content or a link, not a physical dependency copy.
export function readPackageTree(root, { exclude = () => false } = {}) {
  const files = {};
  const visit = relative => {
    if (exclude(relative)) return;
    const path = join(root, relative); const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw Object.assign(new Error(`Expected physical files: ${path}`), { code: 'NMNM_LINK' });
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) visit(relative ? `${relative}/${name}` : name);
    else if (stat.isFile()) files[relative] = digest(path);
    else throw new Error(`Unsupported package file: ${path}`);
  };
  try { visit(''); return files; }
  catch (error) { if (['ENOENT', 'ENOTDIR', 'NMNM_LINK'].includes(error.code)) return null; throw error; }
}

export function prepareCodexDependencies({ root = defaultRoot, destination, preparedModules, packCoreFiles, runNpmPack = (args, options) => execFileSync('npm', args, options) } = {}) {
  root = resolve(root);
  const adapter = join(root, 'adapters/codex');
  const pkg = JSON.parse(readFileSync(join(adapter, 'package.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(adapter, '.codex-plugin/plugin.json'), 'utf8'));
  const core = join(root, 'packages/nmnm-core');
  const corePkg = JSON.parse(readFileSync(join(core, 'package.json'), 'utf8'));
  assert.equal(manifest.version, pkg.version, 'Codex plugin manifest version differs from package version');
  assert(semver.satisfies(corePkg.version, pkg.dependencies['@openlines/nmnm-core']), 'Codex core dependency does not accept checkout version');
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const specs = [], placements = new Map();
  const collect = (name, range, from, parentPath = '') => {
    const checkoutCore = name === '@openlines/nmnm-core';
    const spec = checkoutCore ? { source: core, manifest: corePkg }
      : installedPackage(name, from, root, lock);
    assert(semver.satisfies(spec.manifest.version, range), `Installed ${name} differs from dependency range`);
    // Match Node's nearest-ancestor lookup before introducing another nested copy.
    let nearest;
    for (let parent = parentPath; parent; parent = parent.includes('/node_modules/') ? parent.slice(0, parent.lastIndexOf('/node_modules/')) : '') {
      nearest = placements.get(`${parent}/node_modules/${name}`);
      if (nearest) break;
    }
    nearest ??= placements.get(name);
    if (nearest?.source === spec.source) return;
    let path = name;
    if (nearest) path = `${parentPath}/node_modules/${name}`;
    if (placements.has(path)) return;
    spec.path = path;
    placements.set(path, spec); specs.push(spec);
  };
  for (const [name, range] of Object.entries(pkg.dependencies)) collect(name, range, adapter);
  for (let index = 0; index < specs.length; index++) {
    const spec = specs[index];
    for (const [child, range] of Object.entries(spec.manifest.dependencies ?? {})) collect(child, range, spec.source, spec.path);
  }
  if (!preparedModules) {
    const paths = packCoreFiles ? packCoreFiles() : parseNpmPackOutput(runNpmPack(['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: core, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), [corePkg])[0].files.map(file => file.path);
    assert(paths.includes('package.json'), 'Core package contents are unavailable');
    for (const path of paths) assert(safePackagePath(path) && resolve(core, path).startsWith(core + sep), 'Invalid core package path');
    specs.find(spec => spec.manifest.name === '@openlines/nmnm-core').paths = paths;
  }
  for (const spec of specs) {
    if (preparedModules) spec.source = join(preparedModules, spec.path);
    const preparedManifest = JSON.parse(readFileSync(join(spec.source, 'package.json'), 'utf8'));
    assert.equal(preparedManifest.name, spec.manifest.name, `Prepared dependency name differs: ${spec.path}`);
    assert.equal(preparedManifest.version, spec.manifest.version, `Prepared dependency version differs: ${spec.path}`);
    spec.expected = spec.paths ? Object.fromEntries(spec.paths.map(path => [path, digest(join(spec.source, path))])) : readPackageTree(spec.source, { exclude: ownPackage });
    assert(spec.expected, `Prepared dependency must contain physical files: ${spec.path}`);
  }
  const modules = join(destination ?? adapter, 'node_modules');
  for (const parent of new Set(specs.flatMap(spec => {
    const parents = []; for (let path = dirname(join(modules, spec.path)); path.startsWith(modules); path = dirname(path)) parents.push(path); return parents;
  }))) {
    try { assert(!lstatSync(parent).isSymbolicLink(), `Refusing linked dependency parent: ${parent}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const statePath = join(modules, '.nmnm-codex-deps.json');
  let previous = [];
  try { assert(!lstatSync(statePath).isSymbolicLink(), 'Refusing linked Codex dependency ownership file'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existsSync(statePath)) previous = JSON.parse(readFileSync(statePath, 'utf8'));
  assert(Array.isArray(previous) && previous.every(path => typeof path === 'string' && path.split('/node_modules/').every(name => packageName.test(name))), 'Invalid managed Codex dependency list');
  for (const path of previous) {
    for (let parent = dirname(join(modules, path)); parent.startsWith(modules); parent = dirname(parent)) {
      try { assert(!lstatSync(parent).isSymbolicLink(), `Refusing linked dependency parent: ${parent}`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  const obsolete = previous.filter(path => !placements.has(path));
  const stale = [];
  for (const spec of specs) if (stale.some(parent => spec.path.startsWith(parent.path + '/node_modules/')) || !isDeepStrictEqual(spec.expected, readPackageTree(join(modules, spec.path), { exclude: ownPackage }))) stale.push(spec);
  if (!stale.length && !obsolete.length && existsSync(statePath)) return 'current';
  mkdirSync(modules, { recursive: true });
  const temporary = mkdtempSync(join(modules, '.nmnm-prepare-'));
  try {
    for (const spec of stale) {
      const staged = join(temporary, String(specs.indexOf(spec)));
      for (const path of Object.keys(spec.expected)) {
        const target = join(staged, path); mkdirSync(dirname(target), { recursive: true }); cpSync(join(spec.source, path), target);
      }
      assert.deepEqual(readPackageTree(staged, { exclude: ownPackage }), spec.expected, `Staged dependency differs: ${spec.path}`);
    }
    for (const spec of stale) {
      const destination = join(modules, spec.path);
      mkdirSync(dirname(destination), { recursive: true });
      rmSync(destination, { recursive: true, force: true });
      renameSync(join(temporary, String(specs.indexOf(spec))), destination);
      assert.deepEqual(readPackageTree(destination, { exclude: ownPackage }), spec.expected, `Prepared dependency differs: ${spec.path}`);
    }
    for (const path of obsolete) rmSync(join(modules, path), { recursive: true, force: true });
    writeFileSync(statePath, JSON.stringify(specs.map(spec => spec.path)) + '\n');
    return 'updated';
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

export function assertLoggingContents(kind, files) {
  assert.ok(!files.some(path => path.split('/').at(-1) === 'logslines-release.json'), `${kind} package must exclude the repository release fixture`);
  const required = kind === 'core' ? ['src/logslines.js', 'src/logging-runtime.generated.js', 'src/index.js']
    : kind === 'ui' ? ['src/launcher.js', 'src/server.js', 'src/logslines.js', 'src/ui-logging-runtime.generated.js']
    : kind === 'claude' ? ['src/logslines.js', 'src/core-runtime.generated.js', 'src/logging-runtime.generated.js']
    : kind === 'codex' ? ['node_modules/@openlines/nmnm-core/src/logslines.js', 'node_modules/@openlines/nmnm-core/src/logging-runtime.generated.js']
    : ['src/logslines.js'];
  for (const path of required) assert(files.includes(path), `missing ${path}`);
  if (kind === 'ui') assert(!files.includes('src/ui-logger.js') && !files.includes('build/ui-logger.js'), 'UI package includes build-only logger source');
  if (kind === 'codex') {
    assert(files.some(path => path.includes('node_modules/jsonc-parser/') && path.endsWith('package.json')), 'missing bundled jsonc-parser');
    for (const path of ['mcp/server.js', '.mcp.json', '.codex-plugin/plugin.json', 'node_modules/@modelcontextprotocol/server/package.json', 'node_modules/@modelcontextprotocol/core/package.json', 'node_modules/zod/package.json']) assert(files.includes(path), `missing ${path}`);
    assert(!files.some(path => /^(?:hooks\/|scripts\/|test\/|plugin\.json$|src\/(?:runner|context|hooks)\.js$|skills\/memory\/runner\.js$)/.test(path)), 'Codex package contains obsolete or development files');
    assert(!files.some(path => path.includes('node_modules/@modelcontextprotocol/client/')), 'Codex package contains development MCP client');
  }
}

export function assertClaudeLock(manifest, lock) {
  assert(!manifest.dependencies?.['@openlines/nmnm-core'], 'Claude must use its generated core runtime, not a registry core dependency');
  assert(manifest.overrides === undefined, 'Claude automatic npm installation does not support overrides');
  assert([2, 3].includes(lock.lockfileVersion), 'Claude requires npm lockfile version 2 or 3');
  const root = lock.packages?.[''];
  assert.equal(root?.name, manifest.name, 'Claude lockfile name differs from manifest');
  assert.equal(root?.version, manifest.version, 'Claude lockfile version differs from manifest');
  assert.deepEqual(root?.dependencies, manifest.dependencies, 'Claude lockfile dependencies differ from manifest');
  for (const name of Object.keys(manifest.dependencies)) assert(lock.packages[`node_modules/${name}`], `Claude lockfile is missing ${name}`);
  for (const [path, pkg] of Object.entries(lock.packages)) {
    if (!path) continue;
    assert(!path.endsWith('node_modules/@openlines/nmnm-core'), 'Claude lockfile must exclude registry core');
    assert(!pkg.link, `Claude lockfile contains a link: ${path}`);
    assert(/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(pkg.version ?? ''), `Claude lockfile lacks an exact version: ${path}`);
    assert(typeof pkg.resolved === 'string' && pkg.resolved.startsWith('https://registry.npmjs.org/'), `Claude lockfile requires an HTTPS npm registry URL: ${path}`);
    assert(/^sha512-[A-Za-z0-9+/]{86}==$/.test(pkg.integrity ?? ''), `Claude lockfile lacks SHA-512 integrity: ${path}`);
  }
  for (const [name, range] of Object.entries(manifest.dependencies)) {
    assert(semver.satisfies(lock.packages[`node_modules/${name}`].version, range), `Claude locked ${name} does not satisfy ${range}; refresh the external dependency lock`);
  }
}

function checkClaudeCache(root, temporary, npm) {
  const source = join(root, 'adapters/claude');
  const lockBytes = readFileSync(join(source, 'package-lock.json'));
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  const lock = JSON.parse(lockBytes);
  assertClaudeLock(manifest, lock);
  const plugin = join(temporary, 'claude-cache');
  cpSync(source, plugin, { recursive: true, filter: path => basename(path) !== 'node_modules' });
  const installation = join(temporary, 'claude-install');
  mkdirSync(installation);
  cpSync(join(source, 'package.json'), join(installation, 'package.json'));
  writeFileSync(join(installation, 'package-lock.json'), lockBytes);
  npm(['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(temporary, 'claude-npm-cache')], installation);
  assert(readFileSync(join(installation, 'package-lock.json')).equals(lockBytes), 'Claude frozen install changed the lockfile');
  npm(['audit', '--audit-level=high', '--omit=dev', '--cache', join(temporary, 'claude-npm-cache')], installation);
  renameSync(join(installation, 'node_modules'), join(plugin, 'node_modules'));
  assert(!existsSync(join(plugin, 'node_modules/@openlines/nmnm-core')), 'Claude copied install unexpectedly resolves registry core');
  for (const runtime of ['core-runtime.generated.js', 'logging-runtime.generated.js']) {
    assert.equal(digest(join(plugin, 'src', runtime)), digest(join(source, 'src', runtime)), `Claude copied runtime differs: ${runtime}`);
  }
  // Run the complete core contract against the deployed bundle, not the source package.
  const coreContract = join(temporary, 'claude-core-contract');
  mkdirSync(join(coreContract, 'src'), { recursive: true });
  mkdirSync(join(coreContract, 'test'));
  writeFileSync(join(coreContract, 'package.json'), '{"type":"module"}\n');
  cpSync(join(plugin, 'src/core-runtime.generated.js'), join(coreContract, 'src/index.js'));
  cpSync(join(root, 'packages/nmnm-core/test/core.test.js'), join(coreContract, 'test/core.test.js'));
  execFileSync(process.execPath, ['--test', 'test/core.test.js'], { cwd: coreContract, env: { ...process.env, HOME: temporary }, stdio: 'pipe' });
  const tests = readdirSync(join(plugin, 'test')).filter(path => path.endsWith('.test.js')).map(path => `test/${path}`);
  execFileSync(process.execPath, ['--test', ...tests], { cwd: plugin, env: { ...process.env, HOME: temporary }, stdio: 'pipe' });
  writeFileSync(join(plugin, 'verify.mjs'), `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { execFileSync } from 'node:child_process';
    import { join } from 'node:path';
    import { Client } from '@modelcontextprotocol/sdk/client/index.js';
    import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
    const runtime = readFileSync('src/core-runtime.generated.js', 'utf8');
    assert(runtime.includes(${JSON.stringify('@openlines/nmnm-core@' + JSON.parse(readFileSync(join(root, 'packages/nmnm-core/package.json'), 'utf8')).version)}));
    const client = new Client({ name: 'nmnm-cache-check', version: '1.0.0' });
    const project = join(process.env.HOME, 'claude-project');
    const transport = new StdioClientTransport({ command: process.execPath, args: ['mcp/server.js'], cwd: process.cwd(),
      env: { HOME: process.env.HOME, NMNM_PROJECT_DIR: project, CLAUDE_PLUGIN_DATA: join(process.env.HOME, 'claude-data') }, stderr: 'pipe' });
    transport.stderr.on('data', () => {});
    try {
      await client.connect(transport);
      assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['retain_memory', 'recall_memory', 'retrieve_memory', 'remove_memory']);
      const call = async (name, args) => {
        const result = await client.callTool({ name, arguments: args });
        assert(!result.isError, JSON.stringify(result));
        return JSON.parse(result.content[0].text);
      };
      const retained = await call('retain_memory', { content: 'Frozen cache sentinel 東京', metadata: { nested: { checked: true } }, tags: ['copied'], importance: 0.8 });
      const recalled = await call('recall_memory', { id: retained.id });
      assert.equal(recalled.content, retained.content);
      assert.deepEqual(recalled.metadata.nested, { checked: true });
      assert.equal(recalled.metadata.source, 'claude-code');
      assert.deepEqual(recalled.tags, ['copied']);
      assert.equal((await call('retrieve_memory', { query: 'sentinel', tags: ['copied'], importance: { gte: 0.7 } })).items[0].id, retained.id);
      const env = { ...process.env, NMNM_PROJECT_DIR: project, CLAUDE_PLUGIN_DATA: join(process.env.HOME, 'claude-data') };
      assert.match(execFileSync(process.execPath, ['bin/memory.js', 'show', retained.id], { env, encoding: 'utf8' }), /Frozen cache sentinel/);
      assert.equal((await call('remove_memory', { id: retained.id })).mode, 'soft');
      assert.equal(await call('recall_memory', { id: retained.id }), null);
    } finally { await client.close(); await transport.close(); }
  `);
  execFileSync(process.execPath, ['verify.mjs'], { cwd: plugin, env: { ...process.env, HOME: temporary }, stdio: 'pipe', timeout: 60000 });
}

export function checkLoggingPackages({ prepareCodex = false } = {}) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  execFileSync(process.execPath, [join(root, 'scripts/build-logger.js'), '--check'], { cwd: root, stdio: 'pipe' });
  const temporary = mkdtempSync(join(tmpdir(), 'nmnm-logging-packages-'));
  const npm = (args, cwd) => execFileSync('npm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOME: temporary } });
  const install = ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'];
  try {
    checkClaudeCache(root, temporary, npm);
    const manifests = ['packages/nmnm-core', 'packages/nmnm-ui', 'packages/nmnm-cli', 'adapters/pi', 'adapters/claude', 'adapters/opencode']
      .map(path => JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf8')));
    const packages = parseNpmPackOutput(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary,
      ...manifests.flatMap(pkg => ['--workspace', pkg.name])], root), manifests);
    const core = packages.find(pkg => pkg.name === '@openlines/nmnm-core');
    for (const pkg of packages) assertLoggingContents(pkg.name.replace('@openlines/nmnm-', ''), pkg.files.map(file => file.path));
    const consumer = join(temporary, 'consumer'); mkdirSync(consumer);
    writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
    npm([...install, ...packages.map(pkg => join(temporary, pkg.filename))], consumer);
    writeFileSync(join(consumer, 'verify.mjs'), `
      import assert from 'node:assert/strict';
      import { spawn, execFileSync } from 'node:child_process';
      import { once } from 'node:events';
      import { realpathSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
      import { join } from 'node:path';
      import { getUILogger } from './node_modules/@openlines/nmnm-ui/src/logslines.js';
      import { launchWorkbench } from '@openlines/nmnm-ui';
      import { createMemoryLogger } from '@openlines/nmnm-core/logging';
      import { getPiLogger } from './node_modules/@openlines/nmnm-pi/src/logslines.js';
      import { getMemoryLogger as claude } from './node_modules/@openlines/nmnm-claude/src/logslines.js';
      import { getMemoryLogger as opencode } from './node_modules/@openlines/nmnm-opencode/src/logslines.js';
      for (const logger of [createMemoryLogger(), getPiLogger(), claude(), opencode()]) assert.equal(logger.run({operation:'retain'}, () => 7), 7);
      assert.equal(typeof launchWorkbench, 'function');
      const settings = join(process.env.HOME, '.local/share/nanomneme');
      mkdirSync(settings, {recursive:true});
      writeFileSync(join(settings, 'config.jsonc'), JSON.stringify({logging:{enabled:true}}));
      const logRecords = component => readFileSync(join(settings, 'logs', component + '.jsonl'), 'utf8').trim().split('\\n').map(JSON.parse);
      const home = process.env.HOME;
      const installedLoggers = [
        ['nmnm-core', createMemoryLogger({home, service:{namespace:'openlines', name:'nanomneme', component:'nmnm-core', version:${JSON.stringify(core.version)}}})],
        ['nmnm-pi', getPiLogger({home, agentDir:join(home, 'pi')})],
        ['nmnm-claude', claude({home, globalDir:join(home, 'claude')})],
        ['nmnm-opencode', opencode({home, globalDir:join(home, 'opencode')})],
      ];
      for (const [component, logger] of installedLoggers) {
        assert.equal(logger.run({operation:'retain'}, () => 7), 7);
        const failure = new Error('Packaged failure');
        assert.throws(() => logger.run({operation:'remove'}, () => {throw failure}), error => error === failure);
        assert.deepEqual(logRecords(component).map(record => [record.operation, record.status]), [['retain','ok'], ['remove','failed']]);
      }
      const uiLogger = getUILogger();
      assert.equal(uiLogger.run('retain', () => 7), 7);
      uiLogger.error(new Error('Packaged UI error'));
      const records = () => readFileSync(join(settings, 'logs/nmnm-ui.jsonl'), 'utf8').trim().split('\\n').map(JSON.parse);
      assert.deepEqual(records().map(record => record.event), ['memory.retained', 'ui.error']);
      const cli = realpathSync('node_modules/.bin/nmnm');
      for (const flag of ['--version', '-v']) assert.equal(execFileSync(process.execPath, [cli, flag], {encoding:'utf8'}), ${JSON.stringify(['cli', 'core', 'ui'].map(name => `${name} ${packages.find(pkg => pkg.name === '@openlines/nmnm-' + name).version}\n`).join(''))});
      assert.match(execFileSync(process.execPath, [cli, 'ui', '--help'], {encoding:'utf8'}), /Usage: nmnm ui/);
      execFileSync(process.execPath, [cli, 'retain', 'Packaged private memory', '--db', join(home, 'cli.db'), '--scope', 'project'], {encoding:'utf8'});
      assert.throws(() => execFileSync(process.execPath, [cli, 'retain'], {stdio:'pipe'}));
      assert.deepEqual(logRecords('nmnm-cli').map(record => [record.operation, record.status]), [['retain','ok'], ['retain','failed']]);
      assert.equal(JSON.stringify(logRecords('nmnm-cli')).includes('Packaged private memory'), false);
      const child = spawn(process.execPath, [cli, 'ui', '--port', '0', '-na'], {stdio:['ignore','pipe','pipe']});
      try {
        const [output] = await once(child.stdout, 'data');
        const url = output.toString().split('Open ')[1].split('\\n')[0];
        const origin = url.split('#')[0];
        assert.equal((await fetch(origin)).status, 200);
        assert.equal((await fetch(origin + 'app.js')).status, 200);
        assert.equal((await fetch(origin + 'api/unknown', {headers:{'x-nmnm-token':url.split('#')[1]}})).status, 404);
        assert.equal(records().at(-1).event, 'ui.error');
        assert.equal(records().length, 3);
        const exit = once(child, 'exit'); child.kill('SIGTERM'); assert.equal((await exit)[0], 0);
      } finally { if (child.exitCode === null) { const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit; } }
    `);
    execFileSync(process.execPath, ['verify.mjs'], { cwd: consumer, env: { ...process.env, HOME: temporary }, stdio: 'pipe' });

    // Pack exactly the checkout's locked production tree, without registry re-resolution.
    const codex = join(temporary, 'codex');
    cpSync(join(root, 'adapters/codex'), codex, { recursive: true, filter: path => basename(path) !== 'node_modules' });
    prepareCodexDependencies({ root, destination: codex });
    const [plugin] = parseNpmPackOutput(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], codex), [JSON.parse(readFileSync(join(codex, 'package.json'), 'utf8'))]);
    assertLoggingContents('codex', plugin.files.map(file => file.path));
    const pluginConsumer = join(temporary, 'plugin-consumer'); mkdirSync(pluginConsumer);
    writeFileSync(join(pluginConsumer, 'package.json'), '{"private":true,"type":"module"}\n');
    npm([...install, join(temporary, plugin.filename)], pluginConsumer);
    const installed = join(pluginConsumer, 'node_modules/@openlines/nmnm-codex');
    const copiedCache = join(temporary, 'copied-codex-cache');
    cpSync(installed, copiedCache, { recursive: true });
    assert.deepEqual(readCodexRuntime(installed), readCodexRuntime(copiedCache), 'Copied Codex runtime differs');
    // The verifier client lives outside both deployed artifacts; neither ships it.
    writeFileSync(join(consumer, 'verify-codex.mjs'), `
      import assert from 'node:assert/strict';
      import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
      import { join } from 'node:path';
      import { Client } from '@modelcontextprotocol/sdk/client/index.js';
      import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
      const artifact = process.argv[2];
      const home = process.argv[3]; mkdirSync(home, {recursive:true});
      const project = join(home,'project'); mkdirSync(project);
      const settings = join(home,'.local/share/nanomneme'); mkdirSync(settings,{recursive:true});
      const log = join(settings,'logs/nmnm-codex.jsonl');
      const config = join(settings,'config.jsonc');
      const count = () => existsSync(log) ? readFileSync(log,'utf8').trim().split('\\n').length : 0;
      for (const mode of ['off','on','failed-sink']) {
        writeFileSync(config,JSON.stringify({logging:{enabled:mode!=='off'}}));
        if (mode==='failed-sink') { rmSync(join(settings,'logs'),{recursive:true,force:true}); writeFileSync(join(settings,'logs'),'blocked'); }
        const client = new Client({name:'codex-artifact-check',version:'1.0.0'});
        const transport = new StdioClientTransport({command:process.execPath,args:['mcp/server.js'],cwd:artifact,
          env:{HOME:home,NMNM_PROJECT_DIR:project,CODEX_HOME:join(home,'codex')},stderr:'pipe'});
        transport.stderr.on('data',()=>{});
        try {
          await client.connect(transport);
          assert.equal((await client.listTools()).tools.length,4);
          const before = mode==='failed-sink' ? 0 : count();
          const call = async (name,args) => { const r=await client.callTool({name,arguments:args}); assert(!r.isError,JSON.stringify(r)); return JSON.parse(r.content[0].text); };
          const created=await call('retain_memory',{content:'Artifact sentinel 東京'});
          assert.equal((await call('recall_memory',{id:created.id})).record.metadata.source,'codex');
          assert.equal((await call('retrieve_memory',{query:'sentinel'})).items[0].id,created.id);
          await call('retain_memory',{id:created.id,content:'Patched artifact'});
          assert.equal((await call('recall_memory',{id:created.id})).record.content,'Patched artifact');
          await call('remove_memory',{id:created.id});
          assert.equal((await call('recall_memory',{id:created.id})).status,'not_found');
          if(mode==='on') assert.equal(count()-before,7);
          if(mode==='off') assert.equal(count(),before);
        } finally { await client.close(); await transport.close(); }
      }
    `);
    for (const [index, artifact] of [installed, copiedCache].entries()) {
      assertLoggingContents('codex', Object.keys(readPackageTree(artifact)));
      execFileSync(process.execPath, ['verify-codex.mjs', artifact, join(temporary, `codex-home-${index}`)], { cwd: consumer, env: { ...process.env, HOME: temporary }, stdio: 'pipe', timeout: 60000 });
    }
    if (prepareCodex) {
      prepareCodexDependencies({ root, preparedModules: join(codex, 'node_modules') });
    }
    return packages.map(pkg => pkg.name).concat(plugin.name);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const prepareCodex = process.argv.includes('--prepare-codex');
    console.log(`Standalone logging packages verified: ${checkLoggingPackages({ prepareCodex }).join(', ')}`);
    if (prepareCodex) console.log('Codex local plugin dependencies prepared in adapters/codex/node_modules; reinstall through its marketplace.');
  }
  catch (error) { console.error(error.message); if (error.stdout) console.error(error.stdout.toString()); if (error.stderr) console.error(error.stderr.toString()); process.exitCode = 1; }
}
