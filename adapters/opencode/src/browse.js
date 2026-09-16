import { existsSync } from 'node:fs';
import { pin, pinsPath, readPins, unpin, writePins } from './context.js';
import { databasePath, runMemory } from './store.js';
import { status } from './cli.js';

// Node-side structured data for the OpenCode TUI browser. Mirrors cli.js semantics exactly
// (combined project-then-global paging, all|opencode source filter, exact-store pins, soft-only
// removal, and the same status text) but returns objects instead of text. Reached from the Bun
// TUI plugin only through src/bridge.js, so no SQLite/pin logic leaks into the Bun host.

const DEFAULT_LIMIT = 20;

function supportsGlobalStore(ctx) {
  return ctx.platform === 'darwin' || ctx.platform === 'linux';
}

function read(ctx, store, operation, input, { readOnly = true } = {}) {
  if (store === 'global' && !supportsGlobalStore(ctx)) return null;
  const path = databasePath({ cwd: ctx.cwd, home: ctx.home, platform: ctx.platform, store });
  if (operation !== 'remove' && !existsSync(path)) return null;
  return runMemory({ cwd: ctx.cwd, home: ctx.home, platform: ctx.platform, store, operation, input, create: false, readOnly });
}

function pinnedIds(ctx, store) {
  return readPins(pinsPath({ cwd: ctx.cwd, home: ctx.home, store }));
}

function decorate(ctx, store, memory) {
  return {
    store,
    id: memory.id,
    content: memory.content,
    kind: memory.kind,
    scope: memory.scope,
    namespace: memory.namespace ?? null,
    tags: memory.tags ?? [],
    importance: memory.importance,
    confidence: memory.confidence,
    created_at: memory.created_at,
    updated_at: memory.updated_at,
    expires_at: memory.expires_at ?? null,
    removed_at: memory.removed_at ?? null,
    source: memory.metadata?.source ?? null,
    metadata: memory.metadata && typeof memory.metadata === 'object' ? memory.metadata : {},
    pinned: pinnedIds(ctx, store).includes(memory.id),
  };
}

// One retrieve call for a store, treating an absent/unsupported store as empty.
function page(ctx, store, { source, query, limit, offset }) {
  const result = read(ctx, store, 'retrieve', {
    query, limit, offset, source: source === 'all' ? undefined : source,
  });
  return result ?? { total: 0, items: [] };
}

export function browsePage({ ctx, store = 'both', source = 'all', query, limit = DEFAULT_LIMIT, offset = 0 }) {
  if (store !== 'both') {
    const result = page(ctx, store, { source, query, limit, offset });
    return { store, total: result.total, items: result.items.map((memory) => decorate(ctx, store, memory)) };
  }
  const projectProbe = page(ctx, 'project', { source, query, limit: 1, offset: 0 });
  const globalProbe = page(ctx, 'global', { source, query, limit: 1, offset: 0 });
  const items = [];
  if (offset < projectProbe.total) {
    const projectPage = page(ctx, 'project', { source, query, limit, offset });
    items.push(...projectPage.items.map((memory) => decorate(ctx, 'project', memory)));
    if (items.length < limit) {
      const globalPage = page(ctx, 'global', { source, query, limit: limit - items.length, offset: 0 });
      items.push(...globalPage.items.map((memory) => decorate(ctx, 'global', memory)));
    }
  } else {
    const globalPage = page(ctx, 'global', { source, query, limit, offset: offset - projectProbe.total });
    items.push(...globalPage.items.map((memory) => decorate(ctx, 'global', memory)));
  }
  return { store: 'both', total: projectProbe.total + globalProbe.total, items };
}

export function detail({ ctx, store, id }) {
  const memory = read(ctx, store, 'recall', { id });
  if (!memory) return { memory: null };
  return { record: decorate(ctx, store, memory) };
}

export function mutate({ ctx, store, id, on, mutation }) {
  if (mutation === 'pin' || mutation === 'unpin') {
    if (!read(ctx, store, 'recall', { id })) return { error: `Nanomneme memory not found: ${id}` };
    const path = pinsPath({ cwd: ctx.cwd, home: ctx.home, store });
    const pins = readPins(path);
    writePins(path, mutation === 'pin' ? pin(pins, id) : unpin(pins, id));
    return { pinned: readPins(path).includes(id) };
  }
  if (mutation === 'remove') {
    if (!read(ctx, store, 'recall', { id })) return { error: `Nanomneme memory not found: ${id}` };
    read(ctx, store, 'remove', { id, mode: 'soft' }, { readOnly: false });
    return { removed: true, pinned: readPins(pinsPath({ cwd: ctx.cwd, home: ctx.home, store })).includes(id) };
  }
  return { error: `unknown browse mutation: ${mutation}` };
}

export function statusText({ ctx }) {
  return { status: status(ctx) };
}