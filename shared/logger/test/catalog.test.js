import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { OUTCOMES, classifyOutcome } from '../catalog.js';
import { createMemoryLogger } from '../index.js';

test('every closed catalog tuple emits exactly its declared conforming event', () => {
  const ajv = new Ajv(); addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(new URL('../../../external/logslines/spec/v1/schema.json', import.meta.url))));
  const service = { namespace: 'openlines', name: 'nanomneme', component: 'nmnm-core', version: 'test' };
  const records = [];
  const logger = createMemoryLogger({ service }, { resolveEnabled: () => true, sink: r => records.push(r) });
  for (const [operation, statuses] of Object.entries(OUTCOMES)) {
    for (const [status, [level, event, message]] of Object.entries(statuses)) {
      const before = records.length;
      logger.run({ operation }, observation => { observation.setStatus(status); return { content: 'PRIVATE' }; });
      assert.equal(records.length, before + 1, `${operation}/${status}`);
      const record = records.at(-1);
      assert.deepEqual([record.level, record.event, record.message, record.status], [level, event, message, status]);
      assert.equal(validate(record), true, JSON.stringify(validate.errors));
    }
  }
  assert.equal(classifyOutcome('constructor', null), null);
  assert.equal(classifyOutcome('retain', null, { status: 'constructor' }), null);
  assert.equal(JSON.stringify(records).includes('PRIVATE'), false);
});

test('classifyOutcome records thrown error details verbatim', () => {
  assert.deepEqual(classifyOutcome('retain', undefined, { thrown: true, error: new TypeError('content must be a non-empty string') }).error,
    { kind: 'validation', code: 'retain_failed', message: 'content must be a non-empty string', retryable: false, cause_kind: 'TypeError' });
  assert.equal(classifyOutcome('retain', undefined, { thrown: true, error: Object.assign(new Error('EISDIR: illegal operation on a directory, read'), { code: 'EISDIR' }) }).error.kind, 'filesystem');
  assert.equal(classifyOutcome('retain', undefined, { thrown: true, error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) }).error.kind, 'timeout');
  assert.equal(classifyOutcome('retain', undefined, { thrown: true, error: 'boom' }).error.message, 'boom');
  const hostile = { get message() { throw new Error('x'); } };
  assert.deepEqual(classifyOutcome('retain', undefined, { thrown: true, error: hostile }).error,
    { kind: 'unknown', code: 'retain_failed', message: 'Memory retention failed', retryable: false });
  assert.deepEqual(classifyOutcome('retain', undefined, { thrown: true }).error,
    { kind: 'unknown', code: 'retain_failed', message: 'Memory retention failed', retryable: false });
  assert.deepEqual(classifyOutcome('verify', { ok: false }, { status: 'failed' }).error,
    { kind: 'unknown', code: 'verify_integrity_failed', message: 'Memory verify failed', retryable: false });
});
