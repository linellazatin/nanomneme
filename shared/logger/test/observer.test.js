import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createMemoryLogger } from '../index.js';

const service = { namespace: 'openlines', name: 'nanomneme', component: 'nmnm-pi', version: 'test' };
function setup(deps = {}) {
  const records = [];
  let tick = 0;
  const logger = createMemoryLogger({ service }, { resolveEnabled: () => true, monotonicNow: () => tick++, sink: (r) => records.push(r), ...deps });
  return { logger, records };
}

test('observes synchronous results, original failures, and asynchronous settlement exactly once', async () => {
  const { logger, records } = setup();
  const value = { total: 0, items: [] };
  assert.strictEqual(logger.run({ operation: 'retrieve' }, () => value), value);
  assert.equal(records[0].status, 'empty');
  const original = new Error('private failure');
  assert.throws(() => logger.run({ operation: 'retain' }, () => { throw original; }), e => e === original);
  assert.equal(records[1].status, 'failed');
  assert.equal(JSON.stringify(records).includes(original.message), false);
  let resolve;
  const originalPromise = new Promise(r => { resolve = r; });
  const pending = logger.run({ operation: 'retain' }, () => originalPromise);
  assert.strictEqual(pending, originalPromise);
  assert.equal(records.length, 2);
  resolve(value);
  assert.strictEqual(await pending, value);
  await assert.rejects(logger.run({ operation: 'remove' }, () => Promise.reject(original)), e => e === original);
  assert.equal(records.length, 4);
  assert.throws(() => logger.run({ operation: 'retain' }, o => { o.setStatus('blocked'); throw original; }), e => e === original);
  assert.equal(records.at(-1).status, 'blocked');
  assert.throws(() => logger.run({ operation: 'retain' }, o => { o.setStatus('ok'); throw original; }), e => e === original);
  assert.equal(records.at(-1).status, 'failed');
});

test('diagnostic failure and invalid input never prevent or repeat the action', () => {
  for (const deps of [{ resolveEnabled: () => false }, { resolveEnabled: () => { throw Error(); } }, { monotonicNow: () => { throw Error(); } }, { now: () => { throw Error(); } }, { sink: () => { throw Error(); } }]) {
    const { logger } = setup(deps);
    let calls = 0;
    const value = {};
    assert.strictEqual(logger.run({ operation: 'retain' }, () => { calls++; return value; }), value);
    assert.equal(calls, 1);
  }
  const { logger, records } = setup();
  for (const input of [null, {}, { operation: 'unknown' }, { get operation() { throw Error(); } }, { operation: 'retain', session_id: {} }]) {
    let calls = 0;
    assert.equal(logger.run(input, () => ++calls), 1);
    assert.equal(calls, 1);
  }
  logger.run({ operation: 'retain' }, o => { o.setStatus('invalid'); return {}; });
  assert.throws(() => logger.run({ operation: 'retain' }, o => { o.setStatus('invalid'); throw Error(); }));
  assert.equal(records.length, 0);
});

test('catalog outputs conform and private results remain absent', () => {
  const ajv = new Ajv(); addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(new URL('../../../external/logslines/spec/v1/schema.json', import.meta.url))));
  const { logger, records } = setup();
  const cases = [['retain', { content: 'PRIVATE', id: 'PRIVATE' }, 'ok'], ['recall', null, 'not_found'], ['remove', null, 'not_found'], ['retrieve', { total: 0 }, 'empty'], ['verify', { ok: false, issues: ['PRIVATE'] }, 'failed'], ['repair', { verification: { ok: false } }, 'failed'], ['export', [], 'ok'], ['import', { imported: 0 }, 'ok']];
  for (const [operation, result, status] of cases) {
    logger.run({ operation }, () => result);
    assert.equal(records.at(-1).status, status);
  }
  for (const r of records) { assert.equal(validate(r), true, JSON.stringify(validate.errors)); assert.deepEqual(r.attributes, {}); assert.equal(r.duration_ms, 1); }
  assert.equal(JSON.stringify(records).includes('PRIVATE'), false);
});

test('a thenable cannot emit more than one terminal record', () => {
  const { logger, records } = setup();
  const value = { then(resolve) { resolve({}); resolve({}); } };
  assert.strictEqual(logger.run({ operation: 'retain' }, () => value), value);
  assert.equal(records.length, 1);
});
