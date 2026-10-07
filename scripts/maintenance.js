#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { updateExternalLogslines, checkPinnedLogslines } from './external-logslines.js';
import { buildLogger } from './build-logger.js';
import { checkLoggingPackages, prepareCodexDependencies, readPackageTree } from './check-logging-packages.js';

function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  try { return realpathSync(left) === realpathSync(right); } catch { return resolve(left) === resolve(right); }
}

function pluginContents(root) {
  for (const parent of [join(root, 'node_modules'), join(root, 'node_modules/@openlines')]) {
    try { if (lstatSync(parent).isSymbolicLink()) return null; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const files = readPackageTree(root, { exclude: path => path.split('/').some(part => ['node_modules', '.git', '.package-lock.json'].includes(part)) });
  if (!files) return null;
  for (const dependency of ['@openlines/nmnm-core', 'jsonc-parser']) {
    const tree = readPackageTree(join(root, 'node_modules', dependency));
    if (!tree) return null;
    for (const [path, hash] of Object.entries(tree)) files[`node_modules/${dependency}/${path}`] = hash;
  }
  return files;
}

async function refreshCodex(root, dependencies, build, report) {
  const env = dependencies.env ?? process.env;
  const execute = dependencies.runCodex ?? (args => execFileSync('codex', args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const json = async args => {
    const output = await execute(args);
    try { return JSON.parse(output); } catch { throw new Error('Unsupported Codex CLI output: expected JSON'); }
  };
  const marketplaces = (await json(['plugin', 'marketplace', 'list', '--json'])).marketplaces;
  if (!Array.isArray(marketplaces)) throw new Error('Unsupported Codex marketplace list');
  const marketplace = marketplaces.find(item => item.name === 'nanomneme-local');
  if (!marketplace) throw new Error(`Local marketplace is missing; register it first: codex plugin marketplace add ${JSON.stringify(root)}`);
  if (marketplace.marketplaceSource?.sourceType !== 'local' || !samePath(marketplace.root, root) || !samePath(marketplace.marketplaceSource.source, root)) throw new Error('nanomneme-local points elsewhere; correct the marketplace registration before refreshing');
  const installedPlugin = async () => {
    const installed = (await json(['plugin', 'list', '--marketplace', 'nanomneme-local', '--json'])).installed;
    if (!Array.isArray(installed)) throw new Error('Unsupported Codex plugin list');
    const plugin = installed.find(item => item.name === 'nmnm-codex' && item.marketplaceName === 'nanomneme-local');
    if (!plugin?.installed) throw new Error('Plugin is missing; install it first: codex plugin add nmnm-codex@nanomneme-local --json');
    if (typeof plugin.enabled !== 'boolean' || typeof plugin.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(plugin.version)) throw new Error('Unsupported Codex plugin metadata');
    if (plugin.source?.source !== 'local' || !samePath(plugin.source.path, join(root, 'adapters/codex'))) throw new Error('Installed plugin source does not match this checkout');
    return plugin;
  };
  const before = await installedPlugin();
  if (!before.enabled) throw new Error('Plugin is disabled; left unchanged to preserve enablement. Refresh manually or enable it before using codex:update');
  await refreshLogger(build, message => report(`Logger bundles: ${message}`));
  const preparation = await (dependencies.prepareCodexDependencies ?? prepareCodexDependencies)({ root });
  report(`Codex dependencies: ${preparation === 'updated' ? 'updated' : 'up-to-date'}`);
  const adapter = join(root, 'adapters/codex');
  const expected = pluginContents(adapter);
  if (!expected) throw new Error('Prepared Codex plugin contains missing or linked files');
  const pkg = JSON.parse(readFileSync(join(adapter, 'package.json'), 'utf8'));
  const home = resolve(env.CODEX_HOME || join(env.HOME || homedir(), '.codex'));
  const cache = plugin => join(home, 'plugins/cache/nanomneme-local/nmnm-codex', plugin.version);
  if (before.version === pkg.version && isDeepStrictEqual(pluginContents(cache(before)), expected)) { report('up-to-date'); return; }
  await json(['plugin', 'add', 'nmnm-codex@nanomneme-local', '--json']);
  report('reload-required: start a new Codex session and review hook trust prompts');
  const after = await installedPlugin();
  if (after.enabled !== before.enabled) throw new Error('Codex refresh changed plugin enablement unexpectedly');
  if (after.version !== pkg.version || !isDeepStrictEqual(pluginContents(cache(after)), expected)) throw new Error('Codex cache verification failed after refresh');
  report('updated');
}

function assertBuildSucceeded(results) {
  const failed = results.find(result => result.status === 'failed');
  if (failed) throw new Error(`${failed.name} logger build failed: ${failed.error.message}`, { cause: failed.error });
}

async function refreshLogger(build, report) {
  const results = await build({ check: true });
  assertBuildSucceeded(results);
  if (results.some(result => result.status === 'stale')) {
    assertBuildSucceeded(await build({ check: false }));
    const verified = await build({ check: true });
    assertBuildSucceeded(verified);
    if (verified.some(result => result.status !== 'current')) throw new Error('Logger bundles remain stale after generation');
    report('updated');
  } else report('up-to-date');
}

export async function runMaintenance(args, dependencies = {}) {
  const build = dependencies.buildLogger ?? buildLogger;
  const validate = dependencies.checkLoggingPackages ?? checkLoggingPackages;
  const report = dependencies.report ?? console.log;
  const root = dependencies.root ?? fileURLToPath(new URL('..', import.meta.url));
  const [command, ...flags] = args;
  if (command === 'validate') {
    if (flags.length) throw new Error('validate accepts no options');
    report('validating generated runtimes and repository tests');
    await (dependencies.runRepositoryTests ?? (() => execFileSync('npm', ['test'], { cwd: root, stdio: 'inherit' })))();
    report('auditing shipped dependencies (npm registry access required)');
    await (dependencies.auditProduction ?? (() => execFileSync('npm', ['audit', '--audit-level=high', '--omit=dev'], { cwd: root, stdio: 'inherit' })))();
    report('validating standalone packages (npm registry access may be required)');
    await validate();
    report('validated');
    return;
  }
  if (command === 'codex:update') {
    if (flags.length) throw new Error('codex:update accepts no options');
    await refreshCodex(root, dependencies, build, report);
    return;
  }
  if (command === 'logslines:update') {
    if (flags.length !== 1 || !/^v\d+\.\d+\.\d+$/.test(flags[0])) throw new Error('logslines:update requires one exact release tag: v<major>.<minor>.<patch>');
    let updated = false;
    try {
      await (dependencies.updateExternalLogslines ?? updateExternalLogslines)({
        tag: flags[0], destination: join(root, 'external/logslines'), fixturePath: join(root, 'shared/fixtures/logslines-release.json'),
      });
      updated = true;
      (dependencies.checkPinnedLogslines ?? checkPinnedLogslines)({
        destination: join(root, 'external/logslines'), fixturePath: join(root, 'shared/fixtures/logslines-release.json'),
      });
      report(`updated Logslines snapshot and release fixture: ${flags[0]}`);
      await refreshLogger(build, report);
      report('validating repository tests');
      await (dependencies.runRepositoryTests ?? (() => execFileSync('npm', ['test'], { cwd: root, stdio: 'inherit' })))();
      report('validating standalone packages (npm registry access may be required)');
      await validate();
      report('validated');
    } catch (error) {
      if (updated || error.snapshotUpdated) report('Update files retained for review: external/logslines/, shared/fixtures/logslines-release.json, packages/nmnm-core/src/logging-runtime.generated.js, packages/nmnm-ui/src/ui-logging-runtime.generated.js. The coordinated update failed; these paths may be partially updated.');
      throw error;
    }
    return;
  }
  if (command !== 'logslines:build') throw new Error('Unknown command. Usage: node scripts/maintenance.js <logslines:build [--fast]|logslines:update vX.Y.Z|codex:update|validate>');
  if (flags.some(flag => flag !== '--fast') || flags.length > 1) throw new Error('Unknown options. Usage: logslines:build [--fast]');
  await refreshLogger(build, report);
  if (flags.includes('--fast')) report('validation skipped (--fast)');
  else {
    report('validating standalone packages (npm registry access may be required)');
    await validate();
    report('validated');
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try { await runMaintenance(process.argv.slice(2)); }
  catch (error) {
    console.error(`failed: ${error.message}`);
    if (error.stderr) console.error(error.stderr.toString());
    process.exitCode = 1;
  }
}
