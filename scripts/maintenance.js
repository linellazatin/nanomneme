#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { updateExternalLogslines, checkPinnedLogslines } from './external-logslines.js';
import { buildLogger } from './build-logger.js';
import { checkLoggingPackages } from './check-logging-packages.js';

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
  if (command !== 'logslines:build') throw new Error('Unknown command. Usage: node scripts/maintenance.js <logslines:build [--fast]|logslines:update vX.Y.Z>');
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
