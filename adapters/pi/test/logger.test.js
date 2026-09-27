import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  const logger = createPiLogger({ sink: (record) => records.push(record) });

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
  const logger = createPiLogger({ sink: (record) => records.push(record) });

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

test('appends default records to the Pi adapter global Nanomneme log file', () => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-pi-logger-'));
  const path = join(home, '.local', 'share', 'nanomneme', 'logs', 'nmnm-pi.jsonl');
  const logger = createPiLogger({
    home,
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
