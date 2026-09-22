import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleTool } from '../src/operations.js';
import { runMemory } from '../src/store.js';
import { browsePage, detail, mutate, statusText } from '../src/browse.js';

function context(t) {
  const home = mkdtempSync(join(tmpdir(), 'nmnm-opencode-browse-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return { cwd: home, home, platform: 'darwin', globalDir: join(home, 'config-opencode') };
}

function retain(ctx, params) {
  return JSON.parse(handleTool('retain_memory', params, ctx).text);
}

function retainForeign(ctx, content) {
  return runMemory({ cwd: ctx.cwd, home: ctx.home, platform: ctx.platform, store: 'project', operation: 'retain', input: { content, metadata: { source: 'claude-code' } } });
}

test('browse returns active project-then-global memories with store and pin metadata', (t) => {
  const ctx = context(t);
  retain(ctx, { content: 'alpha project', tags: ['a'] });
  const global = retain(ctx, { content: 'beta global', scope: 'global' });
  const page = browsePage({ ctx, store: 'both', source: 'all', limit: 20, offset: 0 });
  assert.equal(page.total, 2);
  assert.deepEqual(page.items.map((item) => item.store), ['project', 'global']);
  assert.equal(page.items[1].pinned, false);
  mutate({ ctx, store: 'global', id: global.id, on: true, mutation: 'pin' });
  const updated = browsePage({ ctx, store: 'both' });
  assert.deepEqual(updated.items.map((item) => item.pinned), [false, true]);
});

test('browse filters harness source and paginates across combined stores', (t) => {
  const ctx = context(t);
  retain(ctx, { content: 'opencode memory' });
  retainForeign(ctx, 'foreign memory');
  const sourceFiltered = browsePage({ ctx, store: 'project', source: 'opencode' });
  assert.equal(sourceFiltered.total, 1);
  assert.deepEqual(sourceFiltered.items.map((item) => item.content), ['opencode memory']);
  assert.equal(browsePage({ ctx, store: 'project', source: 'all' }).total, 2);
  for (let index = 0; index < 25; index += 1) retain(ctx, { content: `bulk ${index}` });
  const first = browsePage({ ctx, store: 'project', limit: 20, offset: 0 });
  const second = browsePage({ ctx, store: 'project', limit: 20, offset: 20 });
  assert.equal(first.total, 27);
  assert.equal(first.items.length, 20);
  assert.equal(second.total, 27);
  assert.equal(second.items.length, 7);
  const ids = new Set([...first.items, ...second.items].map((item) => item.id));
  assert.equal(ids.size, 27);
  assert.deepEqual(browsePage({ ctx, store: 'both', limit: 5, offset: 24 }).items.length, 3);
});

test('detail and soft removal preserve the browser record semantics', (t) => {
  const ctx = context(t);
  const memory = retain(ctx, { content: 'remove me', kind: 'decision' });
  assert.deepEqual(detail({ ctx, store: 'project', id: memory.id }).record.id, memory.id);
  assert.equal(detail({ ctx, store: 'global', id: memory.id }).memory, null);
  const removed = mutate({ ctx, store: 'project', id: memory.id, mutation: 'remove' });
  assert.deepEqual(removed, { removed: true, pinned: false });
  assert.equal(detail({ ctx, store: 'project', id: memory.id }).memory, null);
  assert.equal(browsePage({ ctx, store: 'project' }).total, 0);
});

test('pin and unpin mutate only the selected physical store', (t) => {
  const ctx = context(t);
  const memory = retain(ctx, { content: 'pin me' });
  const global = retain(ctx, { content: 'global one', scope: 'global' });
  assert.equal(mutate({ ctx, store: 'project', id: memory.id, on: true, mutation: 'pin' }).pinned, true);
  assert.equal(browsePage({ ctx, store: 'global' }).items[0].pinned, false);
  assert.equal(detail({ ctx, store: 'project', id: memory.id }).record.pinned, true);
  assert.equal(mutate({ ctx, store: 'project', id: memory.id, on: false, mutation: 'unpin' }).pinned, false);
  assert.equal(detail({ ctx, store: 'global', id: global.id }).record.pinned, false);
  assert.deepEqual(mutate({ ctx, store: 'project', id: '00000000-0000-4000-8000-000000000001', on: true, mutation: 'pin' }), { error: 'Nanomneme memory not found: 00000000-0000-4000-8000-000000000001' });
});

test('status reports configuration and per-store counts without creating stores', (t) => {
  const ctx = context(t);
  retain(ctx, { content: 'status memory' });
  const { status } = statusText({ ctx });
  assert.match(status, /^Nanomneme status$/m);
  assert.match(status, /Memories:\s+project: 1 • global: 0/);
});