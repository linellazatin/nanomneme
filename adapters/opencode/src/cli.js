import { existsSync } from 'node:fs';
import {
  buildMemoryIndex,
  pin,
  pinsPath,
  readPins,
  renderContext,
  unpin,
  writePins,
} from './context.js';
import { databasePath, runMemory } from './store.js';

// Deterministic, model-free management surface for the OpenCode adapter. It reuses the
// shared store/context helpers and never opens a nested model, worker, or direct SQLite
// write. `bin/memory.js` drives it.

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const MAX_OFFSET = 1000;
const PREVIEW_LENGTH = 60;
const STORES = ['project', 'global'];

const USAGE = [
  'Usage: nmnm-opencode <command>',
  '  status                                   configuration and per-store totals',
  '  list [project|global] [limit] [offset] [--source all|opencode]',
  '  search <query> [project|global] [limit] [offset] [--source all|opencode]',
  '  show [project|global] <id>               full record detail',
  '  pin [project|global] <id>                pin a memory (defaults to project)',
  '  unpin [project|global] <id>              unpin a memory',
  '  remove [project|global] <id>             reversible soft removal',
].join('\n');

function paging(values) {
  const remaining = [...values];
  const store = STORES.includes(remaining[0]) ? remaining.shift() : 'both';
  if (remaining.length > 2) return null;
  const [limitText, offsetText] = remaining;
  const limit = limitText === undefined ? DEFAULT_LIST_LIMIT : Number(limitText);
  const offset = offsetText === undefined ? 0 : Number(offsetText);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) return null;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_OFFSET) return null;
  return { store, limit, offset };
}

function sourceOption(values) {
  const remaining = [];
  let source = 'all';
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== '--source') {
      remaining.push(values[index]);
      continue;
    }
    const value = values[++index];
    if (!['all', 'opencode'].includes(value) || source !== 'all') return null;
    source = value;
  }
  return { source, values: remaining };
}

function idTarget(values) {
  if (values.length === 1) return { store: undefined, id: values[0] };
  if (values.length === 2 && STORES.includes(values[0])) return { store: values[0], id: values[1] };
  return null;
}

export function parseArgs(argv) {
  const [command = 'status', ...values] = argv;
  if (command === 'status') {
    return values.length ? { error: USAGE } : { command: 'status' };
  }
  if (command === 'list') {
    const option = sourceOption(values);
    const page = option && paging(option.values);
    return page ? { command: 'list', ...page, source: option.source } : { error: USAGE };
  }
  if (command === 'search') {
    const option = sourceOption(values);
    if (!option?.values.length) return { error: USAGE };
    const [query, ...rest] = option.values;
    const page = paging(rest);
    return page ? { command: 'search', query, ...page, source: option.source } : { error: USAGE };
  }
  if (['show', 'pin', 'unpin', 'remove'].includes(command)) {
    const target = idTarget(values);
    return target ? { command, ...target } : { error: USAGE };
  }
  return { error: USAGE };
}

function preview(content) {
  const text = content.replace(/\s+/g, ' ').trim();
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}...` : text;
}

function statusLine(label, value) {
  return `${`${label}:`.padEnd(24)}${value}`;
}

function existingStoreMemory({ ctx, store, operation, input, readOnly = true }) {
  if (!existsSync(databasePath({ cwd: ctx.cwd, home: ctx.home, platform: ctx.platform, store }))) return null;
  return runMemory({ cwd: ctx.cwd, home: ctx.home, platform: ctx.platform, store, operation, input, create: false, readOnly });
}

function listedStore({ ctx, store, limit, offset, query, source }) {
  return existingStoreMemory({ ctx, store, operation: 'retrieve', input: { query, limit, offset, source: source === 'all' ? undefined : source } }) ?? { total: 0, items: [] };
}

// Compose a bounded project-then-global page across both stores, preserving BM25 order
// within each store without comparing scores between databases.
function listResult({ ctx, store, limit, offset, query, source }) {
  if (store !== 'both') {
    const result = listedStore({ ctx, store, limit, offset, query, source });
    return { total: result.total, items: result.items.map((memory) => ({ store, memory })) };
  }
  const project = listedStore({ ctx, store: 'project', limit: 1, offset: 0, query, source });
  const global = listedStore({ ctx, store: 'global', limit: 1, offset: 0, query, source });
  const items = [];
  if (offset < project.total) {
    const projectPage = listedStore({ ctx, store: 'project', limit, offset, query, source });
    items.push(...projectPage.items.map((memory) => ({ store: 'project', memory })));
    if (items.length < limit) {
      const globalPage = listedStore({ ctx, store: 'global', limit: limit - items.length, offset: 0, query, source });
      items.push(...globalPage.items.map((memory) => ({ store: 'global', memory })));
    }
  } else {
    const globalPage = listedStore({ ctx, store: 'global', limit, offset: offset - project.total, query, source });
    items.push(...globalPage.items.map((memory) => ({ store: 'global', memory })));
  }
  return { total: project.total + global.total, items };
}

function pinSets(ctx) {
  return {
    project: new Set(readPins(pinsPath({ cwd: ctx.cwd, home: ctx.home, store: 'project' }))),
    global: new Set(readPins(pinsPath({ cwd: ctx.cwd, home: ctx.home, store: 'global' }))),
  };
}

function formatList({ store, request, result, pins }) {
  const header = [
    `Nanomneme memories [${store}]`,
    `showing ${result.items.length} of ${result.total}`,
    request.query ? `search: ${request.query}` : undefined,
    request.source === 'all' ? undefined : `source: ${request.source}`,
  ].filter(Boolean).join(' · ');
  const rows = result.items.map(({ store: memoryStore, memory }) =>
    `- [${memoryStore}] ${memory.id}${pins[memoryStore].has(memory.id) ? ' *' : ''} ${preview(memory.content)}`);
  return [`${header}; * pinned`, ...rows].join('\n');
}

function formatShow(store, memory, pinned) {
  return [
    `Nanomneme [${store}] ${memory.id}${pinned ? ' · pinned' : ''}`,
    '',
    memory.content,
    '',
    `Kind       ${memory.kind}`,
    `Scope      ${memory.scope}`,
    `Namespace  ${memory.namespace ?? '(none)'}`,
    `Tags       ${memory.tags.length ? memory.tags.join(', ') : '(none)'}`,
    `Importance ${memory.importance}`,
    `Confidence ${memory.confidence}`,
    `Created    ${memory.created_at}`,
    `Updated    ${memory.updated_at}`,
    `Expires    ${memory.expires_at ?? '(never)'}`,
    `Removed    ${memory.removed_at ?? '(active)'}`,
    `Metadata   ${JSON.stringify(memory.metadata)}`,
  ].join('\n');
}

export function status(ctx) {
  const index = buildMemoryIndex({ cwd: ctx.cwd, home: ctx.home, globalDir: ctx.globalDir, platform: ctx.platform });
  const current = renderContext(index).length;
  const pins = pinSets(ctx);
  const totals = Object.fromEntries(STORES.map((store) =>
    [store, (existingStoreMemory({ ctx, store, operation: 'retrieve', input: { limit: 1, offset: 0 } }) ?? { total: 0 }).total]));
  return [
    'Nanomneme status',
    statusLine('Injection budget', `${index.budget} • ${current} • ur: ${index.unresolved}`),
    statusLine('Periodic reinjection', index.reinjection.enabled ? `every ${index.reinjection.every_n_prompts} prompts` : 'disabled'),
    statusLine('Autoretention', index.autoretention ? 'enabled' : 'disabled'),
    statusLine('Pins', `project: ${pins.project.size} • global: ${pins.global.size}`),
    statusLine('Memories', `project: ${totals.project} • global: ${totals.global}`),
  ].join('\n');
}

function resolveStore(ctx, requested, id) {
  if (requested) return existingStoreMemory({ ctx, store: requested, operation: 'recall', input: { id } }) ? requested : null;
  const matches = STORES.filter((store) => existingStoreMemory({ ctx, store, operation: 'recall', input: { id } }));
  return matches.length === 1 ? matches[0] : { ambiguous: matches.length > 1 };
}

export function runCli({ argv = [], cwd, home, globalDir, platform } = {}) {
  const ctx = { cwd, home, globalDir, platform };
  const parsed = parseArgs(argv);
  if (parsed.error) return { text: parsed.error, ok: false };

  if (parsed.command === 'status') return { text: status(ctx), ok: true };

  if (parsed.command === 'list' || parsed.command === 'search') {
    const request = { store: parsed.store, limit: parsed.limit, offset: parsed.offset, query: parsed.query, source: parsed.source };
    const result = listResult({ ctx, ...request });
    return { text: formatList({ store: parsed.store, request, result, pins: pinSets(ctx) }), ok: true };
  }

  const resolved = resolveStore(ctx, parsed.store, parsed.id);
  if (resolved === null) return { text: `Nanomneme memory not found: ${parsed.id}`, ok: false };
  if (typeof resolved === 'object') {
    return { text: `Nanomneme memory ID is ambiguous; add project or global: ${parsed.id}`, ok: false };
  }
  const store = resolved;

  if (parsed.command === 'show') {
    const memory = existingStoreMemory({ ctx, store, operation: 'recall', input: { id: parsed.id } });
    const pinned = pinSets(ctx)[store].has(parsed.id);
    return { text: formatShow(store, memory, pinned), ok: true };
  }

  if (parsed.command === 'pin' || parsed.command === 'unpin') {
    const path = pinsPath({ cwd: ctx.cwd, home: ctx.home, store });
    const pins = readPins(path);
    writePins(path, parsed.command === 'pin' ? pin(pins, parsed.id) : unpin(pins, parsed.id));
    return { text: `Nanomneme ${parsed.command}ned [${store}] ${parsed.id}.`, ok: true };
  }

  // remove
  existingStoreMemory({ ctx, store, operation: 'remove', input: { id: parsed.id, mode: 'soft' }, readOnly: false });
  return { text: `Nanomneme removed [${store}] ${parsed.id}. Soft removal is reversible; purge stays CLI-only. Any matching pin remains configured until unpin.`, ok: true };
}