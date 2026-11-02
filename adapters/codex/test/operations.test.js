import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from '@openlines/nmnm-core';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-mcp-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { cwd: root, home: root, env: { CODEX_HOME: join(root, 'codex') }, platform: 'linux' };
}
const decode = response => JSON.parse(response.content[0].text);

test('launch context requires an absolute existing project and never defaults to cwd', async t => {
  const { resolveLaunchContext } = await import('../src/launch.js');
  const ctx = fixture(t);
  for (const value of [undefined, '', '.', join(ctx.cwd, 'missing')]) {
    assert.throws(() => resolveLaunchContext({ ...ctx, env: { NMNM_PROJECT_DIR: value } }), /NMNM_PROJECT_DIR/);
  }
  assert.equal(resolveLaunchContext({ ...ctx, env: { NMNM_PROJECT_DIR: ctx.cwd } }).cwd, realpathSync(ctx.cwd));
  assert.equal(existsSync(join(ctx.cwd, '.nanomneme')), false);
});

test('4Rs read without creation, search selected stores, and soft-remove only', async t => {
  const { createMemoryOperations } = await import('../src/operations.js');
  const ctx = fixture(t), call = createMemoryOperations(ctx);
  const absent = '00000000-0000-4000-8000-000000000000';
  for (const name of ['recall_memory', 'remove_memory']) assert.equal(decode(call(name, { id: absent })).status, 'not_found');
  assert.deepEqual(decode(call('retrieve_memory', {})), { status: 'empty', store: 'project', total: 0, offset: 0, next_offset: null, pagination_limited: false, items: [] });
  assert.equal(existsSync(join(ctx.cwd, '.nanomneme')), false);
  const { id } = decode(call('retain_memory', { content: 'Unique SQLite choice', kind: 'decision', tags: ['db'], importance: 0.8 }));
  assert.equal(decode(call('recall_memory', { id })).record.content, 'Unique SQLite choice');
  const found = decode(call('retrieve_memory', { query: 'SQLite', tags: ['db'], importance: { gte: 0.7 } }));
  assert.equal(found.total, 1); assert.equal(found.items[0].id, id);
  assert.equal(found.items[0].preview, 'Unique SQLite choice');
  assert.equal(decode(call('retrieve_memory', { store: 'global' })).total, 0);
  assert.equal(call('remove_memory', { id, mode: 'purge' }).isError, true);
  assert.equal(decode(call('remove_memory', { id })).status, 'ok');
  assert.equal(decode(call('recall_memory', { id })).status, 'not_found');
  assert.equal(decode(call('remove_memory', { id })).status, 'not_found');
  const db = open(join(ctx.cwd, '.nanomneme/memory.db'), { readOnly: true, create: false });
  try { assert.equal(db.export().find(r => r.id === id).removed_at !== null, true); } finally { db.close(); }
});

test('retain creates selected-store Codex provenance and patches preserve existing metadata', async t => {
  const { createMemoryOperations } = await import('../src/operations.js');
  const ctx = fixture(t);
  const call = createMemoryOperations(ctx);
  const result = decode(call('retain_memory', { content: 'Project decision', metadata: { source: 'spoof', ticket: 'a' } }));
  assert.equal(result.status, 'ok');
  assert.equal(result.store, 'project');
  const db = open(join(ctx.cwd, '.nanomneme/memory.db'), { create: false });
  t.after(() => db.close());
  assert.deepEqual(db.recall({ id: result.id }).metadata, { source: 'codex', ticket: 'a' });
  const original = db.retain({ content: 'Other host', metadata: { source: 'pi', origin: 'fixture' } });
  assert.equal(decode(call('retain_memory', { id: original.id, content: 'Updated' })).status, 'ok');
  assert.deepEqual(db.recall({ id: original.id }).metadata, original.metadata);
  const global = decode(call('retain_memory', { content: 'Global choice', store: 'global' }));
  const globalDb = open(join(ctx.home, '.local/share/nanomneme/memory.db'), { readOnly: true, create: false });
  t.after(() => globalDb.close());
  assert.equal(globalDb.recall({ id: global.id }).scope, 'global');
  const rejected = call('retain_memory', { content: 'Wrong', store: 'global', scope: 'project' });
  assert.equal(rejected.isError, true);
  assert.equal(decode(rejected).error.code, 'invalid_input');
});

test('retrieval pagination and lossless Unicode JSON recall stay bounded for legacy records', async t => {
  const { createMemoryOperations } = await import('../src/operations.js');
  const ctx = fixture(t), call = createMemoryOperations(ctx);
  const initial = decode(call('retain_memory', { content: 'seed' }));
  const db = open(join(ctx.cwd, '.nanomneme/memory.db'), { create: false });
  const content = ('😀"\\\u0001').repeat(5000);
  const legacy = db.retain({ content, metadata: { huge: 'x'.repeat(15000) } });
  db.retain({ content: 'third' }); db.close();
  const first = decode(call('retrieve_memory', { limit: 2, order_by: 'id' }));
  assert.equal(first.total, 3); assert.equal(first.next_offset, 2);
  const second = decode(call('retrieve_memory', { limit: 2, offset: first.next_offset, order_by: 'id' }));
  assert.equal(second.items.length, 1); assert.equal(second.next_offset, null);
  assert.equal(new Set([...first.items, ...second.items].map(x => x.id)).size, 3);
  let offset = 0, json = '';
  do {
    const raw = call('recall_memory', { id: legacy.id, content_offset: offset });
    assert.ok(Buffer.byteLength(JSON.stringify(raw)) <= 65536);
    const page = decode(raw);
    assert.equal(page.updated_at, legacy.updated_at);
    assert.ok(Array.from(page.record_json).length <= 4096);
    json += page.record_json; offset = page.next_offset;
  } while (offset !== null);
  assert.deepEqual(JSON.parse(json), legacy);
  assert.equal(call('recall_memory', { id: initial.id, content_offset: 999999 }).isError, true);
});

test('invalid arguments never create a store, including absent-store reads and patches', async t => {
  const { createMemoryOperations } = await import('../src/operations.js');
  const ctx = fixture(t), call = createMemoryOperations(ctx), id = '00000000-0000-4000-8000-000000000000';
  for (const [name, args] of [
    ['retain_memory', {}], ['retain_memory', { content: ' ' }], ['retain_memory', { content: '\ud800' }],
    ['retain_memory', { content: 'x', scope: 'global' }], ['retain_memory', { content: 'x', importance: 2 }],
    ['retain_memory', { id }], ['retain_memory', { id, content: 'x', metadata: {} }],
    ['retain_memory', { id, content: 'missing patch target' }], ['retain_memory', { content: 'x'.repeat(16385) }],
    ['retain_memory', { content: 'x', metadata: { large: 'x'.repeat(8192) } }],
    ['retain_memory', { content: 'x', metadata: { x: 'x'.repeat(8182) } }],
    ['retain_memory', { content: 'x', expires_at: '2026-02-30T00:00:00.000Z' }],
    ['recall_memory', { id: 'invalid' }], ['retrieve_memory', { limit: 21 }],
    ['retrieve_memory', { importance: {} }], ['retrieve_memory', { order_by: 'relevance' }],
    ['remove_memory', { id, mode: 'purge' }], ['retrieve_memory', { session_id: 'spoof' }],
  ]) {
    assert.equal(call(name, args).isError, true, JSON.stringify([name, args]).slice(0, 100));
    assert.equal(existsSync(join(ctx.cwd, '.nanomneme')), false);
  }
});

test('expiry, removed-record patches, selectors and concurrent workspaces follow core semantics', async t => {
  const { createMemoryOperations } = await import('../src/operations.js');
  const first = fixture(t), second = fixture(t);
  const call = createMemoryOperations(first), other = createMemoryOperations(second);
  const expired = decode(call('retain_memory', { content: 'Old decision', expires_at: '2000-01-01T00:00:00.000Z' }));
  assert.equal(decode(call('recall_memory', { id: expired.id })).status, 'not_found');
  assert.equal(decode(call('retrieve_memory', { expires: 'expired', source: 'codex' })).total, 1);
  assert.equal(decode(call('retain_memory', { id: expired.id, expires_at: null })).status, 'ok');
  assert.equal(decode(call('recall_memory', { id: expired.id })).record.expires_at, null);
  call('remove_memory', { id: expired.id });
  assert.equal(decode(call('retain_memory', { id: expired.id, content: 'Restored' })).status, 'ok');
  assert.equal(decode(call('recall_memory', { id: expired.id })).record.content, 'Restored');
  assert.equal(decode(other('recall_memory', { id: expired.id })).status, 'not_found');
  const secondId = decode(other('retain_memory', { content: 'Other workspace' })).id;
  assert.equal(decode(call('recall_memory', { id: secondId })).status, 'not_found');
  assert.equal(decode(call('retrieve_memory', { query: '!!!' })).total, 0);
});

test('pagination stops explicitly at the core offset ceiling', async t => {
  const { createMemoryOperations } = await import('../src/operations.js');
  const ctx = fixture(t), call = createMemoryOperations(ctx);
  call('retain_memory', { content: 'seed' });
  const db = open(join(ctx.cwd, '.nanomneme/memory.db'), { create: false });
  try { for (let n = 0; n < 1025; n++) db.retain({ content: `record ${n}` }); } finally { db.close(); }
  const page = decode(call('retrieve_memory', { offset: 1000, limit: 20 }));
  assert.equal(page.total, 1026); assert.equal(page.items.length, 20);
  assert.equal(page.next_offset, null); assert.equal(page.pagination_limited, true);
});
