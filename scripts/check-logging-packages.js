#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
const managedDependencies = ['@openlines/nmnm-core', 'jsonc-parser'];
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');

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

export function prepareCodexDependencies({ root = defaultRoot, preparedModules, packCoreFiles } = {}) {
  const adapter = join(root, 'adapters/codex');
  const pkg = JSON.parse(readFileSync(join(adapter, 'package.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(adapter, '.codex-plugin/plugin.json'), 'utf8'));
  const core = join(root, 'packages/nmnm-core');
  const corePkg = JSON.parse(readFileSync(join(core, 'package.json'), 'utf8'));
  assert.equal(manifest.version, pkg.version, 'Codex plugin manifest version differs from package version');
  assert.equal(pkg.dependencies['@openlines/nmnm-core'], corePkg.version, 'Codex core dependency differs from checkout version');
  let specs;
  if (preparedModules) {
    specs = managedDependencies.map(path => ({ path, source: join(preparedModules, path) }));
  } else {
    const paths = packCoreFiles ? packCoreFiles() : JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: core, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0].files.map(file => file.path);
    assert(paths.includes('package.json'), 'Core package contents are unavailable');
    for (const path of paths) assert(!isAbsolute(path) && resolve(core, path).startsWith(core + sep), 'Invalid core package path');
    const parser = dirname(createRequire(join(root, 'package.json')).resolve('jsonc-parser/package.json'));
    assert.equal(JSON.parse(readFileSync(join(parser, 'package.json'), 'utf8')).version, corePkg.dependencies['jsonc-parser'], 'Installed jsonc-parser differs from core dependency; reinstall repository dependencies');
    specs = [{ path: managedDependencies[0], source: core, paths }, { path: managedDependencies[1], source: parser }];
  }
  for (const spec of specs) {
    const expectedVersion = spec.path === managedDependencies[0] ? corePkg.version : corePkg.dependencies['jsonc-parser'];
    assert.equal(JSON.parse(readFileSync(join(spec.source, 'package.json'), 'utf8')).version, expectedVersion, `Prepared dependency version differs: ${spec.path}`);
    spec.expected = spec.paths ? Object.fromEntries(spec.paths.map(path => [path, digest(join(spec.source, path))])) : readPackageTree(spec.source);
    assert(spec.expected, `Prepared dependency must contain physical files: ${spec.path}`);
  }
  const modules = join(adapter, 'node_modules');
  for (const parent of [modules, join(modules, '@openlines')]) {
    try { assert(!lstatSync(parent).isSymbolicLink(), `Refusing linked dependency parent: ${parent}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const stale = specs.filter(spec => !isDeepStrictEqual(spec.expected, readPackageTree(join(modules, spec.path))));
  if (!stale.length) return 'current';
  mkdirSync(modules, { recursive: true });
  const temporary = mkdtempSync(join(modules, '.nmnm-prepare-'));
  try {
    for (const spec of stale) {
      const staged = join(temporary, spec.path);
      for (const path of Object.keys(spec.expected)) {
        const target = join(staged, path); mkdirSync(dirname(target), { recursive: true }); cpSync(join(spec.source, path), target);
      }
      assert.deepEqual(readPackageTree(staged), spec.expected, `Staged dependency differs: ${spec.path}`);
    }
    for (const spec of stale) {
      const destination = join(modules, spec.path);
      mkdirSync(dirname(destination), { recursive: true });
      rmSync(destination, { recursive: true, force: true });
      renameSync(join(temporary, spec.path), destination);
      assert.deepEqual(readPackageTree(destination), spec.expected, `Prepared dependency differs: ${spec.path}`);
    }
    return 'updated';
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

export function assertLoggingContents(kind, files) {
  assert.ok(!files.some(path => path.split('/').at(-1) === 'logslines-release.json'), `${kind} package must exclude the repository release fixture`);
  const required = kind === 'core' ? ['src/logslines.js', 'src/logging-runtime.generated.js', 'src/index.js']
    : kind === 'ui' ? ['src/launcher.js', 'src/server.js', 'src/logslines.js', 'src/ui-logging-runtime.generated.js']
    : kind === 'codex' ? ['node_modules/@openlines/nmnm-core/src/logslines.js', 'node_modules/@openlines/nmnm-core/src/logging-runtime.generated.js']
    : ['src/logslines.js'];
  for (const path of required) assert(files.includes(path), `missing ${path}`);
  if (kind === 'ui') assert(!files.includes('src/ui-logger.js') && !files.includes('build/ui-logger.js'), 'UI package includes build-only logger source');
  if (kind === 'codex') assert(files.some(path => path.includes('node_modules/jsonc-parser/') && path.endsWith('package.json')), 'missing bundled jsonc-parser');
}

export function assertClaudeLock(manifest, lock) {
  assert(manifest.overrides === undefined, 'Claude automatic npm installation does not support overrides');
  assert([2, 3].includes(lock.lockfileVersion), 'Claude requires npm lockfile version 2 or 3');
  const root = lock.packages?.[''];
  assert.equal(root?.name, manifest.name, 'Claude lockfile name differs from manifest');
  assert.equal(root?.version, manifest.version, 'Claude lockfile version differs from manifest');
  assert.deepEqual(root?.dependencies, manifest.dependencies, 'Claude lockfile dependencies differ from manifest');
  for (const name of Object.keys(manifest.dependencies)) assert(lock.packages[`node_modules/${name}`], `Claude lockfile is missing ${name}`);
  for (const [path, pkg] of Object.entries(lock.packages)) {
    if (!path) continue;
    assert(!pkg.link, `Claude lockfile contains a link: ${path}`);
    assert(/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(pkg.version ?? ''), `Claude lockfile lacks an exact version: ${path}`);
    assert(typeof pkg.resolved === 'string' && pkg.resolved.startsWith('https://registry.npmjs.org/'), `Claude lockfile requires an HTTPS npm registry URL: ${path}`);
    assert(/^sha512-[A-Za-z0-9+/]{86}==$/.test(pkg.integrity ?? ''), `Claude lockfile lacks SHA-512 integrity: ${path}`);
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
  const tests = readdirSync(join(plugin, 'test')).filter(path => path.endsWith('.test.js')).map(path => `test/${path}`);
  execFileSync(process.execPath, ['--test', ...tests], { cwd: plugin, env: { ...process.env, HOME: temporary }, stdio: 'pipe' });
  writeFileSync(join(plugin, 'verify.mjs'), `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { execFileSync } from 'node:child_process';
    import { join } from 'node:path';
    import { Client } from '@modelcontextprotocol/sdk/client/index.js';
    import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
    const core = JSON.parse(readFileSync('node_modules/@openlines/nmnm-core/package.json', 'utf8'));
    assert.equal(core.version, ${JSON.stringify(lock.packages['node_modules/@openlines/nmnm-core'].version)});
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
      const retained = await call('retain_memory', { content: 'Frozen cache sentinel' });
      assert.equal((await call('recall_memory', { id: retained.id })).content, retained.content);
      assert.equal((await call('retrieve_memory', { query: 'sentinel' })).items[0].id, retained.id);
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
  const temporary = mkdtempSync(join(tmpdir(), 'nmnm-logging-packages-'));
  const npm = (args, cwd) => execFileSync('npm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOME: temporary } });
  const install = ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'];
  try {
    checkClaudeCache(root, temporary, npm);
    const packages = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary,
      ...['core', 'ui', 'cli', 'pi', 'claude', 'opencode'].flatMap(name => ['--workspace', `@openlines/nmnm-${name}`])], root));
    const core = packages.find(pkg => pkg.name === '@openlines/nmnm-core');
    for (const pkg of packages) assertLoggingContents(pkg.name.replace('@openlines/nmnm-', ''), pkg.files.map(file => file.path));
    const coreTar = join(temporary, core.filename);
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

    // Pack the private plugin after installing its core tarball, not a workspace symlink.
    const codex = join(temporary, 'codex');
    cpSync(join(root, 'adapters/codex'), codex, { recursive: true, filter: path => basename(path) !== 'node_modules' });
    npm([...install, coreTar], codex);
    const [plugin] = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], codex));
    assertLoggingContents('codex', plugin.files.map(file => file.path));
    const pluginConsumer = join(temporary, 'plugin-consumer'); mkdirSync(pluginConsumer);
    writeFileSync(join(pluginConsumer, 'package.json'), '{"private":true,"type":"module"}\n');
    npm([...install, join(temporary, plugin.filename)], pluginConsumer);
    execFileSync(process.execPath, ['--input-type=module', '-e', `import assert from 'node:assert/strict';
      import {readFileSync} from 'node:fs';
      import {join} from 'node:path';
      import {getMemoryLogger} from './node_modules/@openlines/nmnm-codex/src/logslines.js';
      const logger=getMemoryLogger({home:process.env.HOME, env:{CODEX_HOME:join(process.env.HOME,'codex')}});
      assert.equal(logger.run({operation:'retain'},()=>7),7);
      const failure=new Error('Packaged failure');
      assert.throws(()=>logger.run({operation:'remove'},()=>{throw failure}),error=>error===failure);
      const records=readFileSync(join(process.env.HOME,'.local/share/nanomneme/logs/nmnm-codex.jsonl'),'utf8').trim().split('\\n').map(JSON.parse);
      assert.deepEqual(records.map(record=>[record.operation,record.status]),[['retain','ok'],['remove','failed']]);`], { cwd: pluginConsumer, env: { ...process.env, HOME: temporary }, stdio: 'pipe' });
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
  catch (error) { console.error(error.message); if (error.stderr) console.error(error.stderr.toString()); process.exitCode = 1; }
}
