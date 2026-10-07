import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { open } from '@openlines/nmnm-core';
import { startServer } from '../src/server.js';
import { getUILogger } from '../src/logslines.js';
import { launchWorkbench } from '../src/launcher.js';

function config(home, value) {
  const directory = join(home, '.local/share/nanomneme'); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'config.jsonc'), value);
}
function records(home) {
  const path = join(home, '.local/share/nanomneme/logs/nmnm-ui.jsonl');
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse) : [];
}
const enabled = '// shared settings\n{ "logging": { "enabled": true, }, }';

test('UI mutations and general errors emit once, while reads and no-op saves stay quiet', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-ui-log-'));
  config(home, enabled);
  const path = join(home, 'memory.db'); const db = open(path);
  let memory = db.retain({ content: 'PRIVATE_PAYLOAD', metadata: { secret: 'PRIVATE_METADATA' } }); db.close();
  const app = await startServer({ home, cwd: home });
  const api = async (route, body) => {
    const response = await fetch(app.origin + '/api/' + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-nmnm-token': app.token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  try {
    const store = (await api('stores', { path })).data.id;
    await api('browse'); await api('stores'); await api(`memories?stores=${store}`); await api(`memory?store=${store}&id=${memory.id}`);
    assert.equal(records(home).length, 0);
    const action = { store, id: memory.id, updated_at: memory.updated_at, action: 'edit', patch: { content: 'PRIVATE_CHANGED' } };
    assert.equal((await api('mutate', action)).status, 403);
    await api('editing', { store, enabled: true });
    assert.equal((await api('mutate', { ...action, patch: {} })).status, 200);
    assert.equal(records(home).length, 1);
    assert.equal((await api('mutate', { ...action, patch: { scope: 'global' } })).status, 400);
    memory = (await api('mutate', action)).data;
    assert.equal((await api('mutate', action)).status, 409);
    memory = (await api('mutate', { store, id: memory.id, updated_at: memory.updated_at, action: 'edit', patch: { expires_at: '2100-01-01T00:00:00.000Z' } })).data;
    memory = (await api('mutate', { store, id: memory.id, updated_at: memory.updated_at, action: 'remove' })).data;
    const current = (await api(`memory?store=${store}&id=${memory.id}`)).data;
    memory = (await api('mutate', { store, id: memory.id, updated_at: current.updated_at, action: 'restore' })).data;
    assert.equal((await api('mutate', { store, id: memory.id, updated_at: memory.updated_at, action: 'purge' })).status, 200);
    assert.equal((await api('mutate', { store, id: memory.id, updated_at: memory.updated_at, action: 'remove' })).status, 404);
    assert.equal((await api('mutate', { ...action })).status, 404);
    assert.equal((await api(`memory?store=${store}&id=${memory.id}`)).status, 404);
    assert.equal((await fetch(app.origin + '/api/stores')).status, 401);
    assert.equal((await api('error', { message: 'Browser rendering failed' })).status, 200);
    const output = records(home);
    assert.deepEqual(output.map(r => [r.operation, r.status]), [
      ['retain', 'blocked'], ['retain', 'failed'], ['retain', 'ok'], ['retain', 'blocked'], ['retain', 'ok'],
      ['remove', 'ok'], ['retain', 'ok'], ['remove', 'ok'], ['remove', 'not_found'], ['retain', 'failed'],
      ['ui_error', 'failed'], ['ui_error', 'failed'], ['ui_error', 'failed'],
    ]);
    const ajv = new Ajv(); addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(new URL('../../../external/logslines/spec/v1/schema.json', import.meta.url))));
    for (const row of output) {
      assert.equal(validate(row), true, JSON.stringify(validate.errors));
      assert.equal(row.service.component, 'nmnm-ui'); assert.equal(row.service.version, '0.1.1');
      assert.equal(row.context.session_id, null); assert.deepEqual(row.attributes, {});
    }
    const serialized = JSON.stringify(output);
    for (const privateValue of ['PRIVATE_PAYLOAD', 'PRIVATE_METADATA', 'PRIVATE_CHANGED', app.token, memory.id, path]) assert.equal(serialized.includes(privateValue), false);
    if (process.platform !== 'win32') assert.equal(statSync(join(home, '.local/share/nanomneme/logs/nmnm-ui.jsonl')).mode & 0o777, 0o600);
  } finally { await app.close(); rmSync(home, { recursive: true, force: true }); }
});

test('UI logging config is opt-in, fails closed, refreshes per action, and tolerates sink failure', () => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-ui-config-'));
  const logger = getUILogger({ home }); const error = new TypeError('Invalid score');
  try {
    for (const value of [null, '{', '{"logging":{"enabled":false}}', '{"logging":{"enabled":"yes"}}']) {
      if (value !== null) config(home, value);
      assert.equal(logger.run('retain', () => 7), 7); logger.error(new Error('General failure'));
      assert.equal(records(home).length, 0);
    }
    config(home, enabled);
    assert.equal(logger.run('retain', () => 8), 8);
    assert.throws(() => logger.run('retain', () => { throw error; }), e => e === error);
    logger.error(error); assert.equal(records(home).length, 2);
    config(home, '{"logging":{"enabled":false}}'); logger.error(new Error('Disabled again'));
    assert.equal(records(home).length, 2);
    config(home, enabled);
    rmSync(join(home, '.local/share/nanomneme/logs'), { recursive: true });
    writeFileSync(join(home, '.local/share/nanomneme/logs'), 'not a directory');
    assert.equal(logger.run('remove', () => 9), 9);
    logger.error(new Error('Sink cannot write'));
    assert.throws(() => logger.run('retain', () => { throw error; }), e => e === error);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('UI launcher failures and authenticated malformed requests emit general diagnostics', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-ui-error-')); config(home, enabled);
  let app;
  try {
    await assert.rejects(launchWorkbench(['--bad'], { home }), /Usage/);
    app = await startServer({ home });
    await assert.rejects(launchWorkbench(['--port', new URL(app.origin).port, '-na'], { home }), /EADDRINUSE/);
    const response = await fetch(app.origin + '/api/mutate', { method: 'POST', headers: { 'x-nmnm-token': app.token, 'content-type': 'application/json' }, body: '{' });
    assert.equal(response.status, 400);
    assert.deepEqual(records(home).map(r => r.event), ['ui.error', 'ui.error', 'ui.error']);
  } finally { await app?.close(); rmSync(home, { recursive: true, force: true }); }
});
