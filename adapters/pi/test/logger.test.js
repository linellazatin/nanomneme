import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPiLogger } from '../src/logger.js';

const service = {
  namespace: 'openlines',
  name: 'nanomneme',
  component: 'nmnm-pi',
  version: '0.3.0',
};

test('records a successful retention with a host session ID and no payload attributes', () => {
  const records = [];
  const logger = createPiLogger({
    enabled: true,
    sink: (record) => records.push(record),
    now: () => new Date('2026-09-27T04:30:00.000Z'),
  });

  assert.equal(logger.record({
    ctx: { sessionManager: { getSessionId: () => 'host-session-7' } },
    operation: 'retain',
    status: 'ok',
    duration_ms: 2.4,
  }), true);
  assert.deepEqual(records, [{
    schema: 'logslines/v1',
    timestamp: '2026-09-27T04:30:00.000Z',
    level: 'info',
    event: 'memory.retained',
    message: 'Memory retention completed',
    service,
    context: { session_id: 'host-session-7' },
    operation: 'retain',
    status: 'ok',
    duration_ms: 2.4,
    attributes: {},
    error: null,
  }]);
});

test('records empty retrieval without a session ID', () => {
  const records = [];
  const logger = createPiLogger({ enabled: true, sink: (record) => records.push(record) });

  assert.equal(logger.record({ ctx: {}, operation: 'retrieve', status: 'empty', duration_ms: 1 }), true);
  assert.deepEqual(records[0], {
    schema: 'logslines/v1',
    timestamp: records[0].timestamp,
    level: 'info',
    event: 'memory.retrieved',
    message: 'Memory retrieval completed with no results',
    service,
    context: { session_id: null },
    operation: 'retrieve',
    status: 'empty',
    duration_ms: 1,
    attributes: {},
    error: null,
  });
});

test('records failed removal with a generic normalized error', () => {
  const records = [];
  const logger = createPiLogger({ enabled: true, sink: (record) => records.push(record) });

  assert.equal(logger.record({ ctx: {}, operation: 'remove', status: 'failed', duration_ms: 1 }), true);
  assert.deepEqual(records[0].error, {
    kind: 'unknown',
    code: 'remove_failed',
    message: 'Memory removal failed',
    retryable: false,
  });
  assert.equal(records[0].event, 'memory.remove_failed');
  assert.equal(records[0].level, 'error');
});

test('a throwing host session lookup emits a null session ID', () => {
  const records = [];
  const logger = createPiLogger({ enabled: true, sink: (record) => records.push(record) });

  assert.equal(logger.record({
    ctx: { sessionManager: { getSessionId: () => { throw new Error('private host failure'); } } },
    operation: 'recall',
    status: 'not_found',
    duration_ms: 1,
  }), true);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].context, { session_id: null });
  assert.equal(JSON.stringify(records[0]).includes('private host failure'), false);
});

test('only valid global Pi settings opt in to diagnostics', () => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-pi-opt-in-'));
  const agentDir = join(home, 'pi-agent');
  const project = join(home, 'project');
  const file = join(home, '.local', 'share', 'nanomneme', 'logs', 'nmnm-pi.jsonl');
  const fields = { ctx: { cwd: project }, operation: 'retain', status: 'ok', duration_ms: 1 };
  try {
    mkdirSync(join(project, '.nanomneme'), { recursive: true });
    mkdirSync(agentDir);
    writeFileSync(join(project, '.nanomneme', 'nmnm.jsonc'), '{ "logging": { "enabled": true } }\n');
    assert.equal(createPiLogger({ home, agentDir }).record(fields), false);
    assert.equal(existsSync(file), false);

    const globalSettings = join(agentDir, 'nmnm.jsonc');
    writeFileSync(globalSettings, '{ "logging": { "enabled": "true" } }\n');
    assert.equal(createPiLogger({ home, agentDir }).record(fields), false);
    writeFileSync(globalSettings, '{ broken jsonc');
    assert.equal(createPiLogger({ home, agentDir }).record(fields), false);
    assert.equal(existsSync(file), false);

    writeFileSync(globalSettings, '{ "logging": { "enabled": true } }\n');
    assert.equal(createPiLogger({ home, agentDir }).record(fields), true);
    assert.equal(JSON.parse(readFileSync(file, 'utf8').trim()).event, 'memory.retained');
    writeFileSync(globalSettings, '{ "logging": { "enabled": false } }\n');
    assert.equal(createPiLogger({ home, agentDir }).record(fields), false);
    assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('lazy Pi logger samples global settings on first use and again after a new registration', async () => {
  const { getPiLogger } = await import('../src/logger.js');
  const home = mkdtempSync(join(tmpdir(), 'nmnm-pi-lazy-'));
  const agentDir = join(home, 'agent');
  const path = join(agentDir, 'nmnm.jsonc');
  const fields = { ctx: {}, operation: 'retain', status: 'ok', duration_ms: 1 };
  try {
    mkdirSync(agentDir);
    const first = getPiLogger({ home, agentDir });
    writeFileSync(path, '{ "logging": { "enabled": true } }');
    assert.equal(first.record(fields), true);
    writeFileSync(path, '{ "logging": { "enabled": false } }');
    assert.equal(first.record(fields), true);
    const reloaded = getPiLogger({ home, agentDir });
    assert.equal(reloaded.record(fields), false);
    assert.equal(readFileSync(join(home, '.local', 'share', 'nanomneme', 'logs', 'nmnm-pi.jsonl'), 'utf8').trim().split('\n').length, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('appends default records to the Pi adapter global Nanomneme log file', () => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-pi-logger-'));
  const path = join(home, '.local', 'share', 'nanomneme', 'logs', 'nmnm-pi.jsonl');
  const logger = createPiLogger({
    home,
    enabled: true,
    now: () => new Date('2026-09-27T04:30:00.000Z'),
  });

  try {
    assert.equal(logger.record({ ctx: {}, operation: 'retain', status: 'ok', duration_ms: 1 }), true);
    assert.equal(logger.record({ ctx: {}, operation: 'remove', status: 'not_found', duration_ms: 2 }), true);

    assert.equal(existsSync(path), true);
    assert.deepEqual(readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse).map((record) => ({
      operation: record.operation,
      status: record.status,
      event: record.event,
    })), [
      { operation: 'retain', status: 'ok', event: 'memory.retained' },
      { operation: 'remove', status: 'not_found', event: 'memory.remove_not_found' },
    ]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
