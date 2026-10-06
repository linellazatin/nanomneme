#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { buildLogger } from './build-logger.js';
import { checkLoggingPackages } from './check-logging-packages.js';

function assertBuildSucceeded(results) {
  const failed = results.find(result => result.status === 'failed');
  if (failed) throw new Error(`${failed.name} logger build failed: ${failed.error.message}`, { cause: failed.error });
}

export async function runMaintenance(args, dependencies = {}) {
  const build = dependencies.buildLogger ?? buildLogger;
  const validate = dependencies.checkLoggingPackages ?? checkLoggingPackages;
  const report = dependencies.report ?? console.log;
  const [command, ...flags] = args;
  if (command !== 'logslines:build') throw new Error('Unknown command. Usage: node scripts/maintenance.js logslines:build [--fast]');
  if (flags.some(flag => flag !== '--fast') || flags.length > 1) throw new Error('Unknown options. Usage: logslines:build [--fast]');
  const results = await build({ check: true });
  assertBuildSucceeded(results);
  if (results.some(result => result.status === 'stale')) {
    assertBuildSucceeded(await build({ check: false }));
    const verified = await build({ check: true });
    assertBuildSucceeded(verified);
    if (verified.some(result => result.status !== 'current')) throw new Error('Logger bundles remain stale after generation');
    report('updated');
  } else report('up-to-date');
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
