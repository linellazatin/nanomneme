import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLoggingEnabled } from '../config.js';

test('global default, explicit adapter override, and fail-closed JSONC', () => {
  const cases = [
    [undefined, undefined, false], ['{}', '{}', false],
    ['{"logging":{"enabled":true}}', undefined, true],
    ['{"logging":{"enabled":true}}', '{"logging":{}}', true],
    ['{"logging":{"enabled":true}}', '{"logging":{"enabled":false}}', false],
    ['{"logging":{"enabled":false}}', '{"logging":{"enabled":true}}', true],
    ['{/* comment */ "other":null,"logging":{"enabled":true,},}', '{}', true],
    ['bad', '{"logging":{"enabled":true}}', false],
    ['{"logging":{"enabled":true}}', 'bad', false],
    ['{"logging":{"enabled":true}}', '{"logging":null}', false],
    ['{"logging":{"enabled":true}}', '{"logging":{"enabled":"true"}}', false],
    ['[]', '{"logging":{"enabled":true}}', false],
  ];
  for (const [global, adapter, expected] of cases) {
    const readFile = (path) => {
      const value = path === '/adapter' ? adapter : global;
      if (value === undefined) throw Object.assign(new Error(), { code: 'ENOENT' });
      return value;
    };
    assert.equal(resolveLoggingEnabled({ home: '/isolated', adapterConfigPath: '/adapter', readFile }), expected);
  }
  assert.equal(resolveLoggingEnabled({ home: '/isolated', readFile: () => { throw new Error('denied'); } }), false);
});
