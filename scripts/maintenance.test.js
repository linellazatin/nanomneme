import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildLogger } from './build-logger.js';
import { runMaintenance } from './maintenance.js';
import { updateExternalLogslines } from './external-logslines.js';

test('generator detects missing/stale/current outputs and writes only stale targets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmnm-build-test-'));
  try {
    const output = join(dir, 'runtime.js');
    const targets = [{ name: 'test', entry: join(dir, 'entry.js'), output }];
    const buildImpl = async () => ({ outputFiles: [{ text: 'new output' }] });
    assert.equal((await buildLogger({ check: true, targets, buildImpl }))[0].status, 'stale');
    writeFileSync(output, 'old output');
    assert.equal((await buildLogger({ check: true, targets, buildImpl }))[0].status, 'stale');
    assert.equal(readFileSync(output, 'utf8'), 'old output');
    assert.equal((await buildLogger({ targets, buildImpl }))[0].written, true);
    assert.equal(readFileSync(output, 'utf8'), 'new output');
    assert.equal((await buildLogger({ targets, buildImpl }))[0].written, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('build and filesystem failures prevent writing any outputs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmnm-build-failure-'));
  try {
    const output = join(dir, 'runtime.js'); writeFileSync(output, 'old');
    const targets = [{ name: 'first', output }, { name: 'second', output: dir }];
    const results = await buildLogger({ targets, buildImpl: async () => ({ outputFiles: [{ text: 'new' }] }) });
    assert.equal(results[1].status, 'failed');
    assert.equal(readFileSync(output, 'utf8'), 'old');
    const failed = await buildLogger({ targets, buildImpl: async () => { throw new Error('build failed'); } });
    assert.ok(failed.every(result => result.status === 'failed'));
    assert.equal(readFileSync(output, 'utf8'), 'old');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('maintenance validates current bundles by default and explicitly skips with --fast', async () => {
  const messages = []; let validations = 0;
  const dependencies = { buildLogger: async () => [{ name: 'shared', status: 'current' }], checkLoggingPackages: () => { validations++; }, report: message => messages.push(message) };
  await runMaintenance(['logslines:build'], dependencies);
  assert.equal(validations, 1); assert.ok(messages.includes('up-to-date'));
  assert.ok(messages.includes('validated'));
  await runMaintenance(['logslines:build', '--fast'], dependencies);
  assert.equal(validations, 1); assert.ok(messages.includes('validation skipped (--fast)'));
});

test('maintenance regenerates stale bundles, rechecks, and propagates failures', async () => {
  const calls = []; const messages = [];
  await runMaintenance(['logslines:build'], {
    buildLogger: async options => { calls.push(options.check); return [{ name: 'shared', status: calls.length === 1 ? 'stale' : 'current' }]; },
    checkLoggingPackages: () => calls.push('validate'), report: message => messages.push(message),
  });
  assert.deepEqual(calls, [true, false, true, 'validate']); assert.ok(messages.includes('updated'));
  let builds = 0;
  await assert.rejects(runMaintenance(['logslines:build'], {
    buildLogger: async () => { builds++; return [{ name: 'shared', status: 'failed', error: new Error('broken') }]; }, report: () => {},
  }), /broken/);
  assert.equal(builds, 1);
  for (const failedStage of [2, 3]) {
    let stage = 0; let validated = false;
    await assert.rejects(runMaintenance(['logslines:build'], {
      buildLogger: async () => { stage++; return [{ name: 'shared', status: stage === failedStage ? 'failed' : 'stale', error: new Error('stage failed') }]; },
      checkLoggingPackages: () => { validated = true; }, report: () => {},
    }), /stage failed/);
    assert.equal(validated, false);
  }
  await assert.rejects(runMaintenance(['logslines:build'], {
    buildLogger: async () => [{ name: 'shared', status: 'stale' }], report: () => {},
  }), /remain stale/);
  await assert.rejects(runMaintenance(['logslines:build'], {
    buildLogger: async () => [{ status: 'current' }], checkLoggingPackages: () => { throw new Error('package failed'); }, report: () => {},
  }), /package failed/);
  await assert.rejects(runMaintenance(['logslines:build', '--unknown']), /Unknown/);
});

test('maintenance launcher works outside the checkout', () => {
  execFileSync(process.execPath, [new URL('./build-logger.js', import.meta.url).pathname, '--check'], { cwd: tmpdir(), encoding: 'utf8' });
  const output = execFileSync(process.execPath, [new URL('./maintenance.js', import.meta.url).pathname, 'logslines:build', '--fast'], { cwd: tmpdir(), encoding: 'utf8' });
  assert.match(output, /up-to-date/); assert.match(output, /validation skipped/);
});

test('generator CLI distinguishes stale, current, and failed without writing on checks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmnm-build-cli-'));
  const root = fileURLToPath(new URL('..', import.meta.url));
  try {
    for (const path of ['scripts', 'packages/nmnm-core/src', 'packages/nmnm-ui/src']) mkdirSync(join(dir, path), { recursive: true });
    for (const path of ['scripts/build-logger.js', 'packages/nmnm-ui/src/ui-logger.js', 'shared/logger', 'external/logslines']) cpSync(join(root, path), join(dir, path), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
    const run = args => spawnSync(process.execPath, [join(dir, 'scripts/build-logger.js'), ...args], { cwd: tmpdir(), encoding: 'utf8' });
    assert.equal(run(['--check']).status, 2);
    assert.equal(run([]).status, 0);
    assert.equal(run(['--check']).status, 0);
    const output = join(dir, 'packages/nmnm-core/src/logging-runtime.generated.js');
    const before = readFileSync(output, 'utf8');
    rmSync(join(dir, 'shared/logger/index.js'));
    assert.equal(run(['--check']).status, 1);
    assert.equal(run([]).status, 1);
    assert.equal(readFileSync(output, 'utf8'), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('upstream coordinator updates snapshot and shared pin, then builds/tests/validates once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-release-update-'));
  const tag = 'v1.2.3'; const calls = []; const messages = [];
  const files = { LICENSE: 'MIT License\n', 'src/logger.js': 'export const logger = true;\n', 'src/sinks/stderr.js': 'export const sink = true;\n', 'spec/v1/schema.json': '{"$id":"logslines/v1","type":"object"}\n' };
  const fetchImpl = async url => url.includes('/releases/tags/')
    ? new Response(JSON.stringify({ tag_name: tag, html_url: `https://github.com/linellazatin/logslines/releases/tag/${tag}` }), { headers: { 'content-type': 'application/json' } })
    : new Response(files[Object.keys(files).find(path => url.endsWith('/' + path))], { headers: { 'content-type': 'text/plain' } });
  try {
    const dependencies = {
      root, report: message => messages.push(message),
      updateExternalLogslines: options => updateExternalLogslines({ ...options, fetchImpl }),
      buildLogger: async ({ check }) => { calls.push(check ? 'check' : 'build'); return [{ name: 'shared', status: calls.length === 1 ? 'stale' : 'current' }]; },
      runRepositoryTests: () => calls.push('test'), checkLoggingPackages: () => calls.push('packages'),
    };
    await runMaintenance(['logslines:update', tag], dependencies);
    const fixture = readFileSync(join(root, 'shared/fixtures/logslines-release.json'), 'utf8');
    assert.equal(fixture, readFileSync(join(root, 'external/logslines/PROVENANCE.json'), 'utf8'));
    assert.equal(JSON.parse(fixture).tag, tag);
    assert.deepEqual(calls, ['check', 'build', 'check', 'test', 'packages']);
    calls.length = 0;
    dependencies.buildLogger = async () => { calls.push('check'); return [{ status: 'current' }]; };
    await runMaintenance(['logslines:update', tag], dependencies);
    assert.equal(readFileSync(join(root, 'shared/fixtures/logslines-release.json'), 'utf8'), fixture);
    assert.deepEqual(calls, ['check', 'test', 'packages']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('upstream coordinator rejects invalid arguments before mutation and stops on fetch failure', async () => {
  let updates = 0;
  const dependencies = { updateExternalLogslines: async () => { updates++; throw new Error('offline'); }, report: () => {} };
  for (const args of [[], ['latest'], ['v1.2.3', '--fast'], ['v1.2.3', 'v2.0.0']]) {
    await assert.rejects(runMaintenance(['logslines:update', ...args], dependencies), /exact release tag/);
  }
  assert.equal(updates, 0);
  await assert.rejects(runMaintenance(['logslines:update', 'v1.2.3'], dependencies), /offline/);
  assert.equal(updates, 1);
});

test('upstream validation failures retain updated files and identify review paths', async () => {
  for (const stage of ['build', 'test', 'packages']) {
    const messages = []; const calls = [];
    await assert.rejects(runMaintenance(['logslines:update', 'v1.2.3'], {
      updateExternalLogslines: async () => { calls.push('update'); return { tag: 'v1.2.3' }; },
      checkPinnedLogslines: () => {},
      buildLogger: async () => { if (stage === 'build') throw new Error('validation failed'); return [{ status: 'current' }]; },
      runRepositoryTests: () => { calls.push('test'); if (stage === 'test') throw new Error('validation failed'); },
      checkLoggingPackages: () => { calls.push('packages'); throw new Error('validation failed'); },
      report: message => messages.push(message),
    }), /validation failed/);
    assert.ok(messages.some(message => message.includes('shared/fixtures/logslines-release.json') && message.includes('retained')));
    if (stage !== 'packages') assert.equal(calls.includes('packages'), false);
  }
  const messages = [];
  await assert.rejects(runMaintenance(['logslines:update', 'v1.2.3'], {
    updateExternalLogslines: async () => { throw Object.assign(new Error('fixture replacement failed'), { snapshotUpdated: true }); },
    report: message => messages.push(message),
  }), /fixture replacement failed/);
  assert.ok(messages.some(message => message.includes('retained')));
});
