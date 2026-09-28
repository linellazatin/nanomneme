import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProjectLogger } from '../index.js';

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

test('unsafe service component cannot write outside the logs directory', () => {
  const home = temporaryHome();
  try {
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

test('shared logger consumes the external source while Pi ships a self-contained runtime', () => {
  const sharedSource = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const generatedSource = readFileSync(new URL('../../../adapters/pi/src/logger-runtime.generated.js', import.meta.url), 'utf8');
  assert.match(sharedSource, /from '\.\.\/\.\.\/external\/logslines\/src\/logger\.js'/);
  assert.doesNotMatch(sharedSource, /@openlines\/logslines/);
  assert.doesNotMatch(generatedSource, /@openlines\/logslines|\.\.\/\.\.\/external\/logslines/);
});
