import { existsSync } from 'node:fs';

import { toolResponse } from './response.js';
import { databasePath, runMemory } from './store.js';

function store(Type) {
  return Type.Optional(Type.Union([Type.Literal('project'), Type.Literal('global')]));
}

function input(params, fields) {
  return Object.fromEntries(fields.filter((field) => params[field] !== undefined).map((field) => [field, params[field]]));
}

function hasStore(ctx, store) {
  return existsSync(databasePath({ cwd: ctx.cwd, store }));
}

function retainInput(params) {
  const result = input(params, ['content', 'id', 'kind', 'scope', 'namespace', 'tags', 'importance', 'confidence', 'expires_at', 'metadata']);
  if (params.id == null && (params.metadata == null || (params.metadata && typeof params.metadata === 'object' && !Array.isArray(params.metadata)))) {
    result.metadata = { ...params.metadata, source: 'pi' };
  }
  return result;
}

function retainStore(params) {
  return params.scope === 'global' ? 'global' : 'project';
}

function requireTrustedProject(ctx, store) {
  if (store !== 'project') return;
  if (typeof ctx?.isProjectTrusted !== 'function') {
    throw new Error('Nanomneme project memory requires a trusted project; use global scope/store while this project is untrusted.');
  }
  let trusted;
  try {
    trusted = ctx.isProjectTrusted();
  } catch {
    trusted = false;
  }
  if (trusted === true) return;
  throw new Error('Nanomneme project memory requires a trusted project; use global scope/store while this project is untrusted.');
}

export function registerPiTools(pi, Type, options = {}) {
  pi.registerTool({
    name: 'retain_memory',
    label: 'Retain Memory',
    description: 'Create or explicitly patch a nanomneme memory.',
    parameters: Type.Object({
      content: Type.Optional(Type.String()), id: Type.Optional(Type.String()),
      kind: Type.Optional(Type.String()), scope: Type.Optional(Type.String()), namespace: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())), importance: Type.Optional(Type.Number()), confidence: Type.Optional(Type.Number()),
      expires_at: Type.Optional(Type.Union([Type.String(), Type.Null()])), metadata: Type.Optional(Type.Any()),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const selectedStore = retainStore(params);
      requireTrustedProject(ctx, selectedStore);
      const result = runMemory({ cwd: ctx.cwd, store: selectedStore, operation: 'retain', input: retainInput(params) });
      options.onMutation?.('retain');
      return toolResponse(result);
    },
  });
  pi.registerTool({
    name: 'recall_memory',
    label: 'Recall Memory',
    description: 'Read one active nanomneme memory by ID.',
    parameters: Type.Object({ id: Type.String(), store: store(Type) }),
    async execute(_id, params, _signal, _update, ctx) {
      const selectedStore = params.store ?? 'project';
      requireTrustedProject(ctx, selectedStore);
      if (!hasStore(ctx, selectedStore)) return toolResponse(null);
      return toolResponse(runMemory({ cwd: ctx.cwd, store: selectedStore, operation: 'recall', input: { id: params.id }, create: false, readOnly: true }));
    },
  });
  pi.registerTool({
    name: 'retrieve_memory',
    label: 'Retrieve Memory',
    description: 'Search or list active nanomneme memories.',
    parameters: Type.Object({
      query: Type.Optional(Type.String()), store: store(Type), kind: Type.Optional(Type.String()), scope: Type.Optional(Type.String()),
      namespace: Type.Optional(Type.String()), tags: Type.Optional(Type.Array(Type.String())), expires: Type.Optional(Type.String()),
      importance: Type.Optional(Type.Any()), confidence: Type.Optional(Type.Any()), order_by: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()), offset: Type.Optional(Type.Number()),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const selectedStore = params.store ?? 'project';
      requireTrustedProject(ctx, selectedStore);
      if (!hasStore(ctx, selectedStore)) return toolResponse({ total: 0, items: [] });
      return toolResponse(runMemory({ cwd: ctx.cwd, store: selectedStore, operation: 'retrieve', input: input(params, ['query', 'kind', 'scope', 'namespace', 'tags', 'expires', 'importance', 'confidence', 'order_by', 'limit', 'offset']), create: false, readOnly: true }));
    },
  });
  pi.registerTool({
    name: 'remove_memory',
    label: 'Remove Memory',
    description: 'Soft-remove a nanomneme memory by ID.',
    parameters: Type.Object({ id: Type.String(), store: store(Type) }),
    async execute(_id, params, _signal, _update, ctx) {
      const selectedStore = params.store ?? 'project';
      requireTrustedProject(ctx, selectedStore);
      if (!hasStore(ctx, selectedStore)) return toolResponse(null);
      const result = runMemory({ cwd: ctx.cwd, store: selectedStore, operation: 'remove', input: { id: params.id, mode: 'soft' }, create: false });
      if (result) options.onMutation?.('remove');
      return toolResponse(result);
    },
  });
}
