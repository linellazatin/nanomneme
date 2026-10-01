import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { open } from '@openlines/nmnm-core';
import { createMemoryLogger } from '../../../shared/logger/index.js';
import { executeCli } from '../bin/nmnm.js';

test('CLI logs complete commands once and preserves export and failure output', () => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-cli-logs-'));
  const base = join(home, '.local/share/nanomneme');
  const log = join(base, 'logs/nmnm-cli.jsonl');
  const cli = fileURLToPath(new URL('../bin/nmnm.js', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: home, env: { ...process.env, HOME: home }, encoding: 'utf8' });
  try {
    assert.equal(run('retrieve', '--both', '--json').status, 0);
    assert.equal(existsSync(log), false);
    mkdirSync(base, { recursive: true }); writeFileSync(join(base, 'config.jsonc'), '{"logging":{"enabled":true}}');
    run('--help'); run('--version'); run('unknown');
    assert.equal(existsSync(log), false);
    const retained = run('retain', 'PRIVATE sentinel', '--json');
    assert.equal(retained.status, 0, retained.stderr);
    const id = JSON.parse(retained.stdout).id;
    run('recall', id, '--json'); run('retrieve', '--both', '--json');
    const exported = run('export');
    assert.equal(JSON.parse(exported.stdout.split('\n')[0])._format, 'nanomneme');
    run('export', '--out', home); // cannot replace a directory
    run('retain'); // eligible argument failure
    run('verify', '--json'); run('repair', '--rebuild-fts', '--json');
    assert.equal(run('retain', '-v').status, 0);
    assert.equal(run('retain', '--version').status, 1);
    const records = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(records.map(r => [r.operation, r.status]), [['retain','ok'],['recall','ok'],['retrieve','ok'],['export','ok'],['export','failed'],['retain','failed'],['verify','ok'],['repair','ok'],['retain','ok'],['retain','failed']]);
    assert.equal(JSON.stringify(records).includes('PRIVATE'), false);
    assert.equal(JSON.stringify(records).includes(id), false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('stdout failure is a failed export outcome and preserves the original write error', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-cli-write-failure-'));
  const path = join(home, 'memory.db');
  const store = open(path); store.close();
  const original = Object.assign(new Error('PRIVATE stdout error'), { code: 'EPIPE' });
  const stdout = new Writable({ write(_chunk, _encoding, callback) { callback(original); } });
  const records = [];
  const logger = createMemoryLogger({ service: { namespace: 'openlines', name: 'nanomneme', component: 'nmnm-cli', version: 'test' } }, { resolveEnabled: () => true, sink: r => records.push(r) });
  try {
    await assert.rejects(executeCli(['export', '--db', path], { stdout, logger }), error => error === original);
    assert.deepEqual(records.map(r => [r.operation, r.status]), [['export', 'failed']]);
    assert.equal(JSON.stringify(records).includes(original.message), false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
