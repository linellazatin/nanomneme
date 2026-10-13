#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// This command changes node_modules, not manifests or locks. Use a disposable checkout.
const root = fileURLToPath(new URL('..', import.meta.url));
const [range, ...extra] = process.argv.slice(2);
if (!['0.87.0', '~0.87.0', '~0.99.0', '~1.2.0'].includes(range) || extra.length) {
  throw new Error('Usage: node scripts/check-pi-compatibility.js <0.87.0|~0.87.0|~0.99.0|~1.2.0>');
}
const npmJson = args => JSON.parse(execFileSync('npm', args, { cwd: root, encoding: 'utf8' }));
const versions = npmJson(['view', `@earendil-works/pi-coding-agent@${range}`, 'version', '--json']);
const version = Array.isArray(versions) ? versions.at(-1) : versions;
const dependencies = npmJson(['view', `@earendil-works/pi-coding-agent@${version}`, 'dependencies', '--json']);
// Pin TUI to the selected host release, and use that host's TypeBox contract.
// Workspace wildcard peers must not retain the newer development-host surface.
execFileSync('npm', ['install', '--no-save', '--package-lock=false', '--ignore-scripts', '--no-audit', '--no-fund',
  `@earendil-works/pi-coding-agent@${version}`, `@earendil-works/pi-tui@${version}`,
  `@earendil-works/pi-ai@${version}`, `typebox@${dependencies.typebox}`],
{ cwd: root, stdio: 'inherit' });
for (const name of ['@earendil-works/pi-coding-agent', '@earendil-works/pi-tui', '@earendil-works/pi-ai', 'typebox']) {
  const installed = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'));
  console.log(`Pi compatibility ${range}: ${name} ${installed.version}`);
  if (name !== 'typebox' && installed.version !== version) throw new Error(`Unexpected ${name} resolution`);
}
const tests = readdirSync(join(root, 'adapters/pi/test')).filter(name => name.endsWith('.test.js'))
  .map(name => join(root, 'adapters/pi/test', name));
execFileSync(process.execPath, ['--test', '--test-skip-pattern=^development host version ', ...tests],
  { cwd: root, stdio: 'inherit' });
