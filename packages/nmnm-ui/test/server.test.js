import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { open } from '../../nmnm-core/src/index.js';
import { startServer } from '../src/server.js';

test('read-only targeting, lifecycle, provenance, stale edits, and HTTP boundaries', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmnm-ui-'));
  const path = join(dir, 'memory.db');
  mkdirSync(join(dir, 'nested'));
  const db = open(path);
  const memory = db.retain({ content: '<script>alert(1)</script> Review Me', metadata: { source: 'pi', extra: true } });
  db.retain({ content: 'Expired', expires_at: '2000-01-01T00:00:00.000Z' });
  const removed = db.retain({ content: 'Removed Review' }); db.remove({ id: removed.id }); db.close();
  const server = await startServer({ cwd: dir, home: dir });
  const api = async (route, body, headers = {}) => {
    const response = await fetch(server.origin + '/api/' + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-nmnm-token': server.token, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  try {
    assert.equal((await fetch(server.origin + '/api/stores')).status, 401);
    assert.equal((await fetch(server.origin + '/api/browse')).status, 401);
    const listing = await api('browse');
    assert.equal(listing.status, 200);
    assert.deepEqual(listing.data.entries.map(entry => [entry.name, entry.directory]), [['nested', true], ['memory.db', false]]);
    assert.equal((await api('browse?path=' + encodeURIComponent(join(dir, 'nested')))).data.entries.length, 0);
    assert.equal((await api('browse?path=' + encodeURIComponent(path))).status, 400);
    assert.equal((await api('browse?path=' + encodeURIComponent(join(dir, 'missing')))).status, 400);
    assert.equal((await api('stores', { path }, { origin: 'https://example.com' })).status, 403);
    assert.equal((await api('stores', { path: join(dir, 'missing.db') })).status, 400);
    const registered = await api('stores', { path }); const store = registered.data.id;
    assert.equal((await api('stores', { path })).data.id, store);
    const list = await api(`memories?stores=${store}&query=review`);
    assert.equal(list.data.total, 1); assert.equal(list.data.items[0].content, memory.content);
    assert.deepEqual(list.data.sources, ['pi']);
    assert.equal((await api(`memories?stores=${store}&source=unknown`)).data.total, 0);
    assert.equal((await api(`memories?stores=${store}&state=expired`)).data.total, 1);
    assert.equal((await api(`memories?stores=${store}&state=removed`)).data.total, 1);
    const action = { store, id: memory.id, updated_at: memory.updated_at, action: 'edit', patch: { content: 'Changed' } };
    assert.equal((await api('mutate', action)).status, 403);
    assert.equal((await api('editing', { store, enabled: true })).status, 200);
    assert.equal((await api('mutate', { ...action, patch: { scope: 'global' } })).status, 400);
    assert.equal((await api('mutate', action)).status, 200);
    assert.equal((await api('mutate', action)).status, 409);
    let detail = (await api(`memory?store=${store}&id=${memory.id}`)).data;
    assert.deepEqual(detail.metadata, { source: 'pi', extra: true });
    assert.equal((await api('mutate', { store, id: memory.id, updated_at: detail.updated_at, action: 'remove' })).status, 200);
    detail = (await api(`memory?store=${store}&id=${memory.id}`)).data;
    assert.equal((await api('mutate', { store, id: memory.id, updated_at: detail.updated_at, action: 'restore' })).status, 200);
    detail = (await api(`memory?store=${store}&id=${memory.id}`)).data;
    assert.equal((await api('mutate', { store, id: memory.id, updated_at: detail.updated_at, action: 'purge' })).status, 200);
    assert.equal((await api(`memory?store=${store}&id=${memory.id}`)).status, 404);
    await api('editing', { store, enabled: false });
    assert.equal((await api('mutate', action)).status, 403);
    assert.equal((await fetch(server.origin + '/src/server.js')).status, 404);
    await api('editing', { store, enabled: true });
    const beforeUnregister = (await api(`memories?stores=${store}&state=expired`)).data.items;
    assert.equal((await fetch(server.origin + '/api/unregister', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ store }) })).status, 401);
    assert.equal((await api('unregister', { store }, { origin: 'https://example.com' })).status, 403);
    assert.equal((await api('unregister', { store })).status, 200);
    assert.deepEqual((await api('stores')).data.stores, []);
    assert.equal((await api('editing', { store, enabled: true })).status, 404);
    assert.equal((await api(`memories?stores=${store}`)).status, 404);
    assert.equal((await api('unregister', { store })).status, 404);
    assert.equal(existsSync(path), true);
    const reopened = (await api('stores', { path })).data;
    assert.notEqual(reopened.id, store);
    assert.equal(reopened.editing, false);
    const afterUnregister = (await api(`memories?stores=${reopened.id}&state=expired`)).data.items;
    assert.deepEqual(afterUnregister.map(({ store, ...row }) => row), beforeUnregister.map(({ store, ...row }) => row));
  } finally { await server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('multi-store identities, pagination, missing paths, incompatible schemas, and byte-preserving reads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmnm-ui-'));
  const firstPath = join(dir, 'first.db'), secondPath = join(dir, 'second.db'), incompatiblePath = join(dir, 'incompatible.db');
  const first = open(firstPath); const memory = first.retain({ content: 'Shared record', tags: ['review'], namespace: 'testing' });
  const second = open(secondPath); second.import(first.export());
  for (let index = 0; index < 55; index++) first.retain({ content: `Record ${index}` });
  first.close(); second.close();
  const bad = open(incompatiblePath); bad.close();
  const raw = new DatabaseSync(incompatiblePath); raw.prepare("UPDATE nmnm_meta SET value = '999' WHERE key = 'schema_version'").run(); raw.close();
  const before = readFileSync(firstPath), incompatibleBefore = readFileSync(incompatiblePath);
  const server = await startServer({ cwd: dir, home: dir });
  const api = async (route, body) => {
    const response = await fetch(server.origin + '/api/' + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-nmnm-token': server.token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  try {
    assert.equal((await api('stores', { path: 'missing.db' })).status, 400); assert.equal(existsSync(join(dir, 'missing.db')), false);
    assert.equal((await api('stores', { path: incompatiblePath })).status, 400);
    assert.deepEqual(readFileSync(incompatiblePath), incompatibleBefore);
    const a = (await api('stores', { path: firstPath })).data.id, b = (await api('stores', { path: secondPath })).data.id;
    const combined = `stores=${a},${b}`;
    const result = (await api(`memories?${combined}&query=Shared&namespace=testing&tag=review`)).data;
    assert.equal(result.total, 2); assert.equal(result.items[0].id, memory.id); assert.equal(result.items[1].id, memory.id); assert.notEqual(result.items[0].store, result.items[1].store);
    const firstPage = (await api(`memories?${combined}`)).data, secondPage = (await api(`memories?${combined}&page=1`)).data;
    assert.equal(firstPage.total, 57); assert.equal(firstPage.items.length, 50); assert.equal(secondPage.items.length, 7);
    assert.equal(new Set([...firstPage.items, ...secondPage.items].map(row => `${row.store}:${row.id}`)).size, 57);
    assert.equal((await api(`memories?${combined}&page=-1`)).status, 400);
    assert.equal((await api('mutate', { store: firstPath })).status, 404);
    assert.deepEqual(readFileSync(firstPath), before);
    const badHostStatus = await new Promise((resolveStatus, reject) => {
      const req = request(server.origin + '/api/stores', { headers: { 'x-nmnm-token': server.token, host: 'example.com' } }, response => { response.resume(); response.on('end', () => resolveStatus(response.statusCode)); });
      req.on('error', reject); req.end();
    });
    assert.equal(badHostStatus, 403);
    assert.equal((await fetch(server.origin + '/api/stores', { method: 'POST', headers: { 'x-nmnm-token': server.token, 'content-type': 'text/plain' }, body: '{}' })).status, 415);
    assert.equal((await fetch(server.origin + '/api/stores', { method: 'POST', headers: { 'x-nmnm-token': server.token, 'content-type': 'application/json' }, body: ' '.repeat(1024 * 1024 + 1) })).status, 413);
  } finally { await server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('launcher flags and foreground signal shutdown', async () => {
  const env = { ...process.env, HOME: tmpdir() };
  const launcher = fileURLToPath(new URL('../bin/nmnm-ui.js', import.meta.url));
  assert.match(execFileSync(process.execPath, [launcher, '--help'], { encoding: 'utf8', env }), /--port/);
  assert.equal(execFileSync(process.execPath, [launcher, '--version'], { encoding: 'utf8', env }).trim(), '0.1.0');
  assert.throws(() => execFileSync(process.execPath, [launcher, '--port', '65536'], { stdio: 'pipe', env }));
  const child = spawn(process.execPath, [launcher, '--no-auto'], { stdio: ['ignore', 'pipe', 'pipe'], env });
  try {
    const [output] = await once(child.stdout, 'data'); assert.match(output.toString(), /http:\/\/127\.0\.0\.1:\d+\/#/);
    const exit = once(child, 'exit'); child.kill('SIGTERM'); const [code] = await exit; assert.equal(code, 0);
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
});

test('registration rejects unrelated SQLite and incomplete Nanomneme lookalikes without mutation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmnm-ui-'));
  const server = await startServer({ home: dir });
  try {
    for (const [name, sql, seedCore] of [
      ['unrelated.db', 'CREATE TABLE unrelated (value TEXT)'],
      ['lookalike.db', "CREATE TABLE nmnm_meta (key TEXT PRIMARY KEY, value TEXT); INSERT INTO nmnm_meta VALUES ('schema_version', '1')"],
      ['wrong-columns.db', 'ALTER TABLE memories RENAME COLUMN content TO body', true],
      ['wrong-fts.db', 'DROP TABLE memories_fts; CREATE TABLE memories_fts (content TEXT)', true],
    ]) {
      const path = join(dir, name); if (seedCore) { const seed = open(path); seed.close(); } const db = new DatabaseSync(path); db.exec(sql); db.close();
      const before = readFileSync(path);
      const response = await fetch(server.origin + '/api/stores', { method: 'POST', headers: { 'x-nmnm-token': server.token, 'content-type': 'application/json' }, body: JSON.stringify({ path }) });
      assert.equal(response.status, 400, name); assert.deepEqual(readFileSync(path), before);
    }
    const response = await fetch(server.origin + '/api/stores', { headers: { 'x-nmnm-token': server.token } });
    assert.equal((await response.json()).stores.length, 0);
    const path = join(dir, 'valid-without-extension'); const valid = open(path); valid.close();
    const register = await fetch(server.origin + '/api/stores', { method: 'POST', headers: { 'x-nmnm-token': server.token, 'content-type': 'application/json' }, body: JSON.stringify({ path }) });
    assert.equal(register.status, 200); const store = (await register.json()).id;
    const changed = new DatabaseSync(path); changed.exec('ALTER TABLE memories RENAME COLUMN content TO body'); changed.close();
    const before = readFileSync(path);
    const enable = await fetch(server.origin + '/api/editing', { method: 'POST', headers: { 'x-nmnm-token': server.token, 'content-type': 'application/json' }, body: JSON.stringify({ store, enabled: true }) });
    assert.equal(enable.status, 400); assert.deepEqual(readFileSync(path), before);
  } finally { await server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('source sentinel is distinct from recorded values and chunked Unicode remains intact', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmnm-ui-'));
  const path = join(dir, 'memory.db'); const db = open(path);
  const known = db.retain({ content: 'Known', metadata: { source: 'unknown' } });
  db.retain({ content: 'Unrecorded' }); db.close();
  const server = await startServer({ home: dir });
  const api = async (route, body) => {
    const response = await fetch(server.origin + '/api/' + route, { method: body ? 'POST' : 'GET', headers: { 'x-nmnm-token': server.token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    assert.equal(response.status, 200); return response.json();
  };
  try {
    const store = (await api('stores', { path })).id;
    assert.equal((await api(`memories?stores=${store}&source=recorded%3Aunknown`)).items[0]?.id, known.id);
    assert.equal((await api(`memories?stores=${store}&source=unknown`)).items[0].content, 'Unrecorded');
    await api('editing', { store, enabled: true });
    const payload = Buffer.from(JSON.stringify({ store, id: known.id, updated_at: known.updated_at, action: 'edit', patch: { content: 'Unicode 🧠 preserved' } }));
    const split = payload.indexOf(Buffer.from('🧠')) + 1;
    const result = await new Promise((resolveResult, reject) => {
      const req = request(server.origin + '/api/mutate', { method: 'POST', headers: { 'x-nmnm-token': server.token, 'content-type': 'application/json' } }, response => {
        let data = ''; response.on('data', chunk => data += chunk); response.on('end', () => resolveResult({ status: response.statusCode, data: JSON.parse(data) }));
      });
      req.on('error', reject); req.write(payload.subarray(0, split)); setTimeout(() => req.end(payload.subarray(split)), 20);
    });
    assert.equal(result.status, 200); assert.equal(result.data.content, 'Unicode 🧠 preserved');
  } finally { await server.close(); rmSync(dir, { recursive: true, force: true }); }
});
