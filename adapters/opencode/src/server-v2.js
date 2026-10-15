import { isAbsolute } from 'node:path';
import { storeContext, runBridge } from './bridge-client.js';
import { registerBrowserRpc } from './browser-rpc-server.js';

const text = { type: 'string' };
const number = { type: 'number' };
const tags = { type: 'array', items: text };
const store = { type: 'string', enum: ['project', 'global'], description: 'Physical store (default project).' };
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const byID = object({ id: text, store }, ['id']);
const definitions = [
  {
    name: 'retain_memory',
    description: 'Create or explicitly patch a nanomneme memory. Prefer project scope unless the fact clearly applies to all projects (then scope: global).',
    input: object({
      content: { ...text, description: 'Memory content. Required for a new record.' },
      id: { ...text, description: 'Existing memory id to patch (reversible restore of a soft-removed record).' },
      kind: { ...text, description: 'note | decision | preference | fact | instruction.' },
      scope: { ...text, description: 'project | global. Selects the physical store and record scope.' },
      namespace: { ...text, description: 'Lowercase kebab-case namespace slug.' },
      tags: { ...tags, description: 'Lowercase kebab-case tag slugs.' },
      importance: { ...number, description: '0..1 importance.' },
      confidence: { ...number, description: '0..1 confidence.' },
      expires_at: { type: ['string', 'null'], description: 'UTC ISO timestamp or null.' },
      metadata: { description: 'Plain JSON metadata object; new records get metadata.source = "opencode".' },
    }),
  },
  { name: 'recall_memory', description: 'Read one active nanomneme memory by id.', input: byID },
  {
    name: 'retrieve_memory', description: 'Search or list active nanomneme memories.',
    input: object({
      query: { ...text, description: 'FTS/BM25 text query. Omit to list active memories.' },
      kind: text, scope: text, namespace: text, tags,
      expires: { ...text, description: 'active | expired | any (default active).' },
      importance: {}, confidence: {},
      order_by: { ...text, description: 'relevance | id | created_at | updated_at | importance | confidence.' },
      limit: number, offset: number, store,
    }),
  },
  { name: 'remove_memory', description: 'Soft-remove a nanomneme memory by id (reversible; purge requires an explicit CLI or UI workbench action).', input: byID },
];

export async function setupServerV2(api) {
  const cleanups = [];
  try {
    cleanups.push(await registerBrowserRpc(api));
    const tools = await api.tool.transform(editor => {
      for (const definition of definitions) editor.add({
        ...definition,
        async execute(params, context) {
          context.signal.throwIfAborted();
          const ctx = await sessionContext(api, context.sessionID);
          context.signal.throwIfAborted();
          const result = runBridge({ op: 'tool', name: definition.name, params, ctx, diagnostic_context: { session_id: context.sessionID } });
          if (!result.ok) throw new Error(result.error);
          return { content: result.text };
        },
      });
    });
    cleanups.push(() => tools.dispose());
    const hook = await api.session.hook('context', async event => {
      try {
        const ctx = await sessionContext(api, event.sessionID);
        const result = runBridge({ op: 'index', ctx });
        if (result.ok && result.context) event.system.push({ type: 'text', text: `# Nanomneme memory\n${result.context}` });
      } catch {
        // Index failures must not block the model request.
      }
    });
    cleanups.push(() => hook.dispose());
  } catch (error) {
    await Promise.allSettled(cleanups.map(dispose => dispose()));
    throw error;
  }
  return () => Promise.all(cleanups.map(dispose => dispose()));
}

async function sessionContext(api, sessionID) {
  if (typeof sessionID !== 'string' || !sessionID) throw new Error('Missing OpenCode session location.');
  const session = await api.session.get({ sessionID });
  const directory = session?.location?.directory;
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw new Error('Missing absolute OpenCode session location.');
  return storeContext({ directory });
}
