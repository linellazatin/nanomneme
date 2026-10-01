#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function assertLoggingContents(kind, files) {
  const required = kind === 'core' ? ['src/logging.js', 'src/logging-runtime.generated.js', 'src/index.js']
    : ['node_modules/@openlines/nmnm-core/src/logging.js', 'node_modules/@openlines/nmnm-core/src/logging-runtime.generated.js'];
  for (const path of required) assert(files.includes(path), `missing ${path}`);
  if (kind === 'codex') assert(files.some(path => path.includes('node_modules/jsonc-parser/') && path.endsWith('package.json')), 'missing bundled jsonc-parser');
}

export function checkLoggingPackages() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const temporary = mkdtempSync(join(tmpdir(), 'nmnm-logging-packages-'));
  const npm = (args, cwd) => execFileSync('npm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOME: temporary } });
  const install = ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'];
  try {
    const packages = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary,
      ...['core', 'cli', 'pi', 'claude', 'opencode'].flatMap(name => ['--workspace', `@openlines/nmnm-${name}`])], root));
    const core = packages.find(pkg => pkg.name === '@openlines/nmnm-core');
    assertLoggingContents('core', core.files.map(file => file.path));
    const coreTar = join(temporary, core.filename);
    const consumer = join(temporary, 'consumer'); mkdirSync(consumer);
    writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
    npm([...install, ...packages.map(pkg => join(temporary, pkg.filename))], consumer);
    writeFileSync(join(consumer, 'verify.mjs'), `
      import assert from 'node:assert/strict';
      import { createMemoryLogger } from '@openlines/nmnm-core/logging';
      import { getPiLogger } from './node_modules/@openlines/nmnm-pi/src/logger.js';
      import { getMemoryLogger as claude } from './node_modules/@openlines/nmnm-claude/src/logger.js';
      import { getMemoryLogger as opencode } from './node_modules/@openlines/nmnm-opencode/src/logger.js';
      for (const logger of [createMemoryLogger(), getPiLogger(), claude(), opencode()]) assert.equal(logger.run({operation:'retain'}, () => 7), 7);
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
    execFileSync(process.execPath, ['--input-type=module', '-e', "import { getMemoryLogger } from './node_modules/@openlines/nmnm-codex/src/logger.js'; if (getMemoryLogger().run({operation:'retain'}, () => 7) !== 7) throw Error('logger');"], { cwd: pluginConsumer, env: { ...process.env, HOME: temporary }, stdio: 'pipe' });
    return packages.map(pkg => pkg.name).concat(plugin.name);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(`Standalone logging packages verified: ${checkLoggingPackages().join(', ')}`); }
  catch (error) { console.error(error.message); if (error.stderr) console.error(error.stderr.toString()); process.exitCode = 1; }
}
