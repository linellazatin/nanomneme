import { existsSync } from 'node:fs';
import { databasePath, runMemory } from './store.js';

// Fields each tool forwards to nmnm-core, mirroring the Pi adapter tool surface.
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
    content: [{ type: 'text', text: JSON.stringify(result) }],
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
    result.metadata = { ...params.metadata, source: 'claude-code' };
  }
  return result;
}

export function handleTool(name, params = {}, ctx = {}, options = {}) {
  const base = { cwd: ctx.cwd, home: ctx.home, platform: ctx.platform, store: params.store };
  switch (name) {
    case 'retain_memory': {
      const result = runMemory({ ...base, operation: 'retain', input: retainInput(params) });
      options.onMutation?.('retain');
      return response(result);
    }
    case 'recall_memory': {
      if (!hasStore(ctx, params.store)) return response(null);
      return response(runMemory({ ...base, operation: 'recall', input: { id: params.id }, create: false, readOnly: true }));
    }
    case 'retrieve_memory': {
      if (!hasStore(ctx, params.store)) return response({ total: 0, items: [] });
      return response(runMemory({ ...base, operation: 'retrieve', input: input(params, RETRIEVE_FIELDS), create: false, readOnly: true }));
    }
    case 'remove_memory': {
      if (!hasStore(ctx, params.store)) return response(null);
      const result = runMemory({ ...base, operation: 'remove', input: { id: params.id, mode: 'soft' }, create: false });
      if (result) options.onMutation?.('remove');
      return response(result);
    }
    default:
      throw new TypeError(`unknown nanomneme tool: ${name}`);
  }
}
