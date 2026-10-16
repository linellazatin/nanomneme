import { existsSync } from 'node:fs';

import { getPiLogger, piSessionId } from './logslines.js';
import { toolResponse } from './response.js';
import { databasePath, runMemory } from './store.js';

function store(Type) {
  return Type.Optional(Type.Union([Type.Literal('project'), Type.Literal('global')]));
}

function scoreFilter(Type) {
  const score = () => Type.Number({ minimum: 0, maximum: 1 });
  return Type.Optional(Type.Union([
    score(),
    Type.Object({ gt: Type.Optional(score()), gte: Type.Optional(score()), lt: Type.Optional(score()), lte: Type.Optional(score()) }, { minProperties: 1, additionalProperties: false }),
    Type.Null(),
  ]));
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
  if (params.scope === undefined) return 'project';
  const scope = typeof params.scope === 'string' ? params.scope.trim() : undefined;
  if (scope !== 'project' && scope !== 'global') throw new TypeError('scope must be project or global');
  return scope;
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
  const logger = options.logger ?? getPiLogger();
  const observe = (ctx, operation, selectStore, execute) => logger.run({ operation, session_id: piSessionId(ctx) }, observation => {
    const selectedStore = selectStore();
    try { requireTrustedProject(ctx, selectedStore); }
    catch (error) { observation.setStatus('blocked'); throw error; }
    return execute(selectedStore);
  });
  pi.registerTool({
    name: 'retain_memory',
    label: 'Retain Memory',
    description: 'Create a nanomneme memory with nonempty content and omit id. To patch or restore an existing memory, supply its returned id and original scope. Omit unnecessary optional fields; defaults apply on creation and omitted fields are preserved on patches. Minimal create: {"content":"Use SQLite for storage."}.',
    parameters: Type.Object({
      content: Type.Optional(Type.String({ minLength: 1, description: 'Memory text; must contain non-whitespace, well-formed Unicode. Required for creation; optional for patches.' })),
      id: Type.Optional(Type.String({ pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', description: 'Existing nanomneme UUID from the same scope. Omit for creation; never invent an ID. An ID-only call restores a removed record.' })),
      kind: Type.Optional(Type.Union(['note', 'decision', 'preference', 'fact', 'instruction'].map(value => Type.Literal(value)), { description: 'Memory category; defaults to note on creation.' })),
      scope: Type.Optional(Type.Union([Type.Literal('project'), Type.Literal('global')], { description: 'Destination store: project by default (requires project trust), or global for cross-project memory. For patches, match the original store; this does not move records.' })),
      namespace: Type.Optional(Type.String({ pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$', description: 'Lowercase kebab-case slug, e.g. my-project; defaults to default on creation.' })),
      tags: Type.Optional(Type.Array(Type.String({ pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$' }), { description: 'Lowercase kebab-case slugs, e.g. ["sqlite", "node-22"]. Replaces all tags on patches; defaults to [] on creation.' })),
      importance: Type.Optional(Type.Number({ minimum: 0, maximum: 1, description: 'Importance from 0 to 1 inclusive, not a percentage; defaults to 0.5 on creation.' })),
      confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1, description: 'Confidence from 0 to 1 inclusive, not a percentage; defaults to 1 on creation.' })),
      expires_at: Type.Optional(Type.Union([Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' }), Type.Null()], { description: 'Calendar-valid UTC timestamp with milliseconds, e.g. 2030-01-01T00:00:00.000Z. Null clears expiry; omitted on creation means no expiry.' })),
      metadata: Type.Optional(Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()], { description: 'JSON object, not a JSON-encoded string or array. Supplied metadata replaces the object on patches; null resets it to {}. New records receive source pi; omit on patches to preserve provenance.' })),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const result = observe(ctx, 'retain', () => retainStore(params), selectedStore => runMemory({ cwd: ctx.cwd, store: selectedStore, operation: 'retain', input: retainInput(params) }));
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
      const result = observe(ctx, 'recall', () => selectedStore, () => (hasStore(ctx, selectedStore)
          ? runMemory({ cwd: ctx.cwd, store: selectedStore, operation: 'recall', input: { id: params.id }, create: false, readOnly: true })
          : null));
      return toolResponse(result);
    },
  });
  pi.registerTool({
    name: 'retrieve_memory',
    label: 'Retrieve Memory',
    description: 'Search or list active nanomneme memories.',
    parameters: Type.Object({
      query: Type.Optional(Type.String()), store: store(Type), kind: Type.Optional(Type.String()), scope: Type.Optional(Type.String()),
      namespace: Type.Optional(Type.String()), tags: Type.Optional(Type.Array(Type.String())), expires: Type.Optional(Type.String()),
      importance: scoreFilter(Type), confidence: scoreFilter(Type), order_by: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()), offset: Type.Optional(Type.Number()),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const selectedStore = params.store ?? 'project';
      const result = observe(ctx, 'retrieve', () => selectedStore, () => (hasStore(ctx, selectedStore)
          ? runMemory({ cwd: ctx.cwd, store: selectedStore, operation: 'retrieve', input: input(params, ['query', 'kind', 'scope', 'namespace', 'tags', 'expires', 'importance', 'confidence', 'order_by', 'limit', 'offset']), create: false, readOnly: true })
          : { total: 0, items: [] }));
      return toolResponse(result);
    },
  });
  pi.registerTool({
    name: 'remove_memory',
    label: 'Remove Memory',
    description: 'Soft-remove a nanomneme memory by ID.',
    parameters: Type.Object({ id: Type.String(), store: store(Type) }),
    async execute(_id, params, _signal, _update, ctx) {
      const selectedStore = params.store ?? 'project';
      const result = observe(ctx, 'remove', () => selectedStore, () => (hasStore(ctx, selectedStore)
          ? runMemory({ cwd: ctx.cwd, store: selectedStore, operation: 'remove', input: { id: params.id, mode: 'soft' }, create: false })
          : null));
      if (result) options.onMutation?.('remove');
      return toolResponse(result);
    },
  });
}
