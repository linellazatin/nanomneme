import { existsSync } from 'node:fs';
import { databasePath, runMemory } from './store.js';

function response(result) {
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    details: result ?? {},
  };
}

function store(Type) {
  return Type.Optional(Type.Union([Type.Literal('project'), Type.Literal('global')]));
}

function input(params, fields) {
  return Object.fromEntries(fields.filter((field) => params[field] !== undefined).map((field) => [field, params[field]]));
}

function hasStore(ctx, store) {
  return existsSync(databasePath({ cwd: ctx.cwd, store }));
}

export function registerPiTools(pi, Type) {
  pi.registerTool({
    name: 'retain_memory',
    label: 'Retain Memory',
    description: 'Create or explicitly patch a nanomneme memory.',
    parameters: Type.Object({
      content: Type.Optional(Type.String()), id: Type.Optional(Type.String()), store: store(Type),
      kind: Type.Optional(Type.String()), scope: Type.Optional(Type.String()), namespace: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())), importance: Type.Optional(Type.Number()), confidence: Type.Optional(Type.Number()),
      expires_at: Type.Optional(Type.Union([Type.String(), Type.Null()])), metadata: Type.Optional(Type.Any()),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      return response(runMemory({ cwd: ctx.cwd, store: params.store, operation: 'retain', input: input(params, ['content', 'id', 'kind', 'scope', 'namespace', 'tags', 'importance', 'confidence', 'expires_at', 'metadata']) }));
    },
  });
  pi.registerTool({
    name: 'recall_memory',
    label: 'Recall Memory',
    description: 'Read one active nanomneme memory by ID.',
    parameters: Type.Object({ id: Type.String(), store: store(Type) }),
    async execute(_id, params, _signal, _update, ctx) {
      if (!hasStore(ctx, params.store)) return response(null);
      return response(runMemory({ cwd: ctx.cwd, store: params.store, operation: 'recall', input: { id: params.id }, create: false, readOnly: true }));
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
      if (!hasStore(ctx, params.store)) return response({ total: 0, items: [] });
      return response(runMemory({ cwd: ctx.cwd, store: params.store, operation: 'retrieve', input: input(params, ['query', 'kind', 'scope', 'namespace', 'tags', 'expires', 'importance', 'confidence', 'order_by', 'limit', 'offset']), create: false, readOnly: true }));
    },
  });
  pi.registerTool({
    name: 'remove_memory',
    label: 'Remove Memory',
    description: 'Soft-remove or explicitly purge a nanomneme memory by ID.',
    parameters: Type.Object({ id: Type.String(), store: store(Type), purge: Type.Optional(Type.Boolean()) }),
    async execute(_id, params, _signal, _update, ctx) {
      if (!hasStore(ctx, params.store)) return response(null);
      return response(runMemory({ cwd: ctx.cwd, store: params.store, operation: 'remove', input: { id: params.id, mode: params.purge ? 'purge' : 'soft' }, create: false }));
    },
  });
}
