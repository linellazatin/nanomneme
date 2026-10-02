import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProjectLogger } from '../sink.js';

const service = { namespace: 'openlines', name: 'nanomneme', component: 'nmnm-pi', version: '0.3.0' };
const input = {
  context: { session_id: 'test-session' }, level: 'info', event: 'memory.retained',
  message: 'Memory retention completed', operation: 'retain', status: 'ok',
  duration_ms: 1, attributes: {}, error: null,
};

function temporaryHome() {
  return mkdtempSync(join(tmpdir(), 'nmnm-shared-logger-'));
}

test('defaults off without calling clock or sink or creating a directory', () => {
  const home = temporaryHome();
  try {
    const logger = createProjectLogger({ service, home, now: () => { throw new Error('clock called'); }, sink: () => { throw new Error('sink called'); } });
    assert.equal(logger.emit(input), false);
    assert.equal(existsSync(join(home, '.local')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('enabled logger creates a service-named JSONL file on first emission and appends', () => {
  const home = temporaryHome();
  const path = join(home, '.local', 'share', 'nanomneme', 'logs', 'nmnm-pi.jsonl');
  try {
    const logger = createProjectLogger({ service, enabled: true, home, now: () => new Date('2026-09-27T04:30:00.000Z') });
    assert.equal(existsSync(path), false);
    assert.equal(logger.emit(input), true);
    assert.equal(logger.emit({ ...input, event: 'memory.recalled', operation: 'recall' }), true);
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map((line) => JSON.parse(line).event), ['memory.retained', 'memory.recalled']);
    assert.deepEqual(JSON.parse(lines[0]), {
      schema: 'logslines/v1', timestamp: '2026-09-27T04:30:00.000Z',
      level: 'info', event: 'memory.retained', message: 'Memory retention completed',
      service, context: { session_id: 'test-session' }, operation: 'retain', status: 'ok',
      duration_ms: 1, attributes: {}, error: null,
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('creates an owner-only logs directory and file without changing parent permissions', { skip: process.platform === 'win32' }, () => {
  const home = temporaryHome();
  const dataDirectory = join(home, '.local', 'share', 'nanomneme');
  const directory = join(dataDirectory, 'logs');
  const path = join(directory, 'nmnm-pi.jsonl');
  try {
    const logger = createProjectLogger({ service, enabled: true, home });
    assert.equal(logger.emit(input), true);

    assert.equal(statSync(dataDirectory).mode & 0o777, 0o777 & ~process.umask());
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('tightens the logs directory and existing JSONL files before appending', { skip: process.platform === 'win32' }, () => {
  const home = temporaryHome();
  const directory = join(home, '.local', 'share', 'nanomneme', 'logs');
  const currentLog = join(directory, 'nmnm-pi.jsonl');
  const olderLog = join(directory, 'older-component.jsonl');
  const unrelatedFile = join(directory, 'notes.txt');
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(currentLog, 'old current log\n');
    writeFileSync(olderLog, 'old component log\n');
    writeFileSync(unrelatedFile, 'not a log\n');
    chmodSync(directory, 0o755);
    chmodSync(currentLog, 0o644);
    chmodSync(olderLog, 0o644);
    chmodSync(unrelatedFile, 0o644);

    const logger = createProjectLogger({ service, enabled: true, home });
    assert.equal(logger.emit(input), true);

    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(statSync(currentLog).mode & 0o777, 0o600);
    assert.equal(statSync(olderLog).mode & 0o777, 0o600);
    assert.equal(statSync(unrelatedFile).mode & 0o777, 0o644);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('concurrent processes append complete JSONL records to one component log', async () => {
  const home = temporaryHome();
  const path = join(home, '.local', 'share', 'nanomneme', 'logs', 'nmnm-pi.jsonl');
  const workers = 16;
  const program = `
    import { createProjectLogger } from ${JSON.stringify(new URL('../sink.js', import.meta.url).href)};
    const logger = createProjectLogger({
      service: ${JSON.stringify(service)},
      enabled: true,
      home: process.env.NMNM_TEST_HOME,
    });
    const record = ${JSON.stringify(input)};
    record.context.session_id = process.env.NMNM_TEST_SESSION;
    process.exitCode = logger.emit(record) ? 0 : 1;
  `;
  const run = (session) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', program], {
      env: { ...process.env, NMNM_TEST_HOME: home, NMNM_TEST_SESSION: session },
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`writer exited ${code}`)));
  });
  try {
    await Promise.all(Array.from({ length: workers }, (_, index) => run(`writer-${index}`)));
    const records = readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(records.length, workers);
    assert.deepEqual(new Set(records.map((record) => record.context.session_id)), new Set(Array.from({ length: workers }, (_, index) => `writer-${index}`)));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('enabled logger supports injected sink and clock without file output', () => {
  const home = temporaryHome();
  const records = [];
  try {
    const logger = createProjectLogger({ service, enabled: true, home, sink: (record) => records.push(record), now: () => new Date('2026-09-27T04:30:00.000Z') });
    assert.equal(logger.emit(input), true);
    assert.equal(records[0].timestamp, '2026-09-27T04:30:00.000Z');
    assert.equal(existsSync(join(home, '.local')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('invalid service identity cannot write outside the logs directory', () => {
  const home = temporaryHome();
  try {
    assert.equal(createProjectLogger({ enabled: true, home }).emit(input), false);
    const logger = createProjectLogger({ service: { ...service, component: '../escape' }, enabled: true, home });
    assert.equal(logger.emit(input), false);
    assert.equal(existsSync(join(home, '.local')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('unwritable target and throwing sink fail without stderr fallback', () => {
  const home = temporaryHome();
  try {
    writeFileSync(join(home, '.local'), 'not a directory');
    assert.equal(createProjectLogger({ service, enabled: true, home }).emit(input), false);
    assert.equal(createProjectLogger({ service, enabled: true, home, sink: () => { throw new Error('private sink failure'); } }).emit(input), false);
    assert.equal(existsSync(join(home, '.local', 'share')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('shared logger consumes the external source while core ships a self-contained runtime', () => {
  const sharedSource = readFileSync(new URL('../sink.js', import.meta.url), 'utf8');
  const generatedSource = readFileSync(new URL('../../../packages/nmnm-core/src/logging-runtime.generated.js', import.meta.url), 'utf8');
  assert.match(sharedSource, /from '\.\.\/\.\.\/external\/logslines\/src\/logger\.js'/);
  assert.doesNotMatch(sharedSource, /@openlines\/logslines/);
  assert.doesNotMatch(generatedSource, /@openlines\/logslines|\.\.\/\.\.\/external\/logslines/);
});
