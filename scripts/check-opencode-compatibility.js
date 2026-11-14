#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const [generation, version, host, ...extra] = process.argv.slice(2);
if (extra.length || !host || !isAbsolute(host)
    || !({ v1: ['1.19.0'], v2: ['2.0.29', '2.3.0'] })[generation]?.includes(version)) {
  throw new Error('Usage: node scripts/check-opencode-compatibility.js <v1|v2> <reviewed-version> <absolute-native-host>');
}
// CI compatibility is deliberately credential-free, even in a configured local shell.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith('NMNM_OPENCODE_') && !key.startsWith('AWS_')
  && !key.startsWith('OPENCODE_') && key !== 'NMNM_ADAPTER_ROOT'));
const actual = execFileSync(host, ['--version'], { env, encoding: 'utf8', timeout: 15000 }).trim();
if (actual !== version && actual !== `opencode v${version}`) throw new Error(`Expected OpenCode ${version}, received ${actual}`);
env[generation === 'v1' ? 'NMNM_OPENCODE_V1' : 'NMNM_OPENCODE_V2'] = host;
const native = join(root, 'adapters/opencode/test', generation === 'v1' ? 'browser-rpc-v1-host.test.js' : 'browser-rpc-host.test.js');
const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', native],
  { cwd: root, env, encoding: 'utf8', timeout: 90000 });
process.stdout.write(output);
if (!new RegExp(`^# Subtest: native V${generation.slice(1)} host `, 'm').test(output)
    || !/^# tests 1$/m.test(output) || !/^# pass 1$/m.test(output) || !/^# skipped 0$/m.test(output)) {
  throw new Error('Required native OpenCode coverage was skipped or empty');
}
const tests = readdirSync(join(root, 'adapters/opencode/test'))
  .filter(name => name.endsWith('.test.js') && !/^browser-rpc-(?:v1-)?host\.test\.js$/.test(name))
  .map(name => join(root, 'adapters/opencode/test', name));
execFileSync(process.execPath, ['--test', ...tests], { cwd: root, env, stdio: 'inherit', timeout: 120000 });
execFileSync('python', [join(root, 'adapters/opencode/test/terminal_browser.py'), '--host', host, '--generation', generation,
  ...(generation === 'v2' ? ['--connected'] : [])], { cwd: root, env, stdio: 'inherit', timeout: 180000 });
console.log(`OpenCode ${generation} ${version}: native, adapter, and rendered terminal checks passed`);
