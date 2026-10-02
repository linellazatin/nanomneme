import { getMemoryLogger } from './logger.js';
import { existsSync } from 'node:fs';
import { databasePath, runMemory } from './store.js';

// Fields each tool forwards to nmnm-core, mirroring the Pi/Claude adapter tool surface.
const RETAIN_FIELDS = ['content', 'id', 'kind', 'scope', 'namespace', 'tags', 'importance', 'confidence', 'expires_at', 'metadata'];
const RETRIEVE_FIELDS = ['query', 'kind', 'scope', 'namespace', 'tags', 'expires', 'importance', 'confidence', 'order_by', 'limit', 'offset'];

export const TOOL_DEFINITIONS = [
  { name: 'retain_memory', label: 'Retain Memory', description: 'Create or explicitly patch a nanomneme memory.', fields: RETAIN_FIELDS },
  { name: 'recall_memory', label: 'Recall Memory', description: 'Read one active nanomneme memory by ID.', fields: ['id'] },
  { name: 'retrieve_memory', label: 'Retrieve Memory', description: 'Search or list active nanomneme memories.', fields: RETRIEVE_FIELDS },
  { name: 'remove_memory', label: 'Remove Memory', description: 'Soft-remove a nanomneme memory by ID.', fields: ['id'] },
];

function response(result) {
  return {
    text: JSON.stringify(result),
    details: result ?? {},
  };
}

function input(params, fields) {
  return Object.fromEntries(fields.filter((field) => params[field] !== undefined).map((field) => [field, params[field]]));
}

function hasStore(ctx, store) {
  return existsSync(databasePath({ cwd: ctx.cwd, home: ctx.home, platform: ctx.platform, store }));
}

function retainInput(params) {
  const result = input(params, RETAIN_FIELDS);
  if (params.id == null && (params.metadata == null || (params.metadata && typeof params.metadata === 'object' && !Array.isArray(params.metadata)))) {
    result.metadata = { ...params.metadata, source: 'opencode' };
  }
  return result;
}

export function handleTool(name, params = {}, ctx = {}, options = {}) {
  const operations = { retain_memory: 'retain', recall_memory: 'recall', retrieve_memory: 'retrieve', remove_memory: 'remove' };
  const operation = Object.hasOwn(operations, name) ? operations[name] : undefined;
  if (!operation) throw new TypeError(`unknown nanomneme tool: ${name}`);
  const logger = options.logger ?? getMemoryLogger(ctx);
  const base = { cwd: ctx.cwd, home: ctx.home, platform: ctx.platform, store: params.store };
  const result = logger.run({ operation, session_id: options.session_id ?? null }, () => {
    if (operation === 'retain') return runMemory({ cwd: ctx.cwd, home: ctx.home, platform: ctx.platform, store: params.scope === 'global' ? 'global' : 'project', operation, input: retainInput(params) });
    if (!hasStore(ctx, params.store)) return operation === 'retrieve' ? { total: 0, items: [] } : null;
    if (operation === 'retrieve') return runMemory({ ...base, operation, input: input(params, RETRIEVE_FIELDS), create: false, readOnly: true });
    return runMemory({ ...base, operation, input: operation === 'remove' ? { id: params.id, mode: 'soft' } : { id: params.id }, create: false, readOnly: operation !== 'remove' });
  });
  if (operation === 'retain' || (operation === 'remove' && result)) options.onMutation?.(operation);
  return response(result);
}
