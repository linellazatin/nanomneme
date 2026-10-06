#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

export function checkLoggingPackages({ prepareCodex = false } = {}) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const temporary = mkdtempSync(join(tmpdir(), 'nmnm-logging-packages-'));
  const npm = (args, cwd) => execFileSync('npm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOME: temporary } });
  const install = ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'];
  try {
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
      const source = join(root, 'adapters/codex');
      const manifest = JSON.parse(readFileSync(join(source, '.codex-plugin/plugin.json'), 'utf8'));
      const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
      assert.equal(manifest.version, pkg.version, 'Codex plugin manifest version differs from package version');
      cpSync(join(codex, 'node_modules'), join(source, 'node_modules'), {
        recursive: true, dereference: true, filter: path => basename(path) !== '.package-lock.json',
      });
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
