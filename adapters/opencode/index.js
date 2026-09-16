import { tool } from '@opencode-ai/plugin';
import { storeContext, runBridge } from './src/bridge-client.js';

// OpenCode server plugin. Functional parity with the Pi and Claude Code adapters: the four
// nanomneme 4R tools, bounded transient memory-index injection, adapter-owned pins, and
// opt-in autoretention guidance. OpenCode loads server plugins under Bun, which has no
// `node:sqlite` (required by @openlines/nmnm-core), so every core call is delegated to a
// short-lived `node` bridge (see src/bridge-client.js). This module never imports the core or
// SQLite; it only registers tools and appends the bounded index to the system prompt. OpenCode
// rebuilds the system prompt per model request (it is not a persisted session message), so the
// index is (re)appended on every request whose context is non-empty rather than once per
// session; a Pi/Claude cadence is therefore unnecessary and reinjection settings stay inert.
const z = tool.schema;

const storeArg = z.enum(['project', 'global']).optional()
  .describe('Physical nanomneme store to read or remove from (default project).');

const retainArgs = {
  content: z.string().optional().describe('Memory content. Required for a new record.'),
  id: z.string().optional().describe('Existing memory id to patch (reversible restore of a soft-removed record).'),
  kind: z.string().optional().describe('note | decision | preference | fact | instruction.'),
  scope: z.string().optional().describe('project | global. Selects the physical store and record scope.'),
  namespace: z.string().optional().describe('Lowercase kebab-case namespace slug.'),
  tags: z.array(z.string()).optional().describe('Lowercase kebab-case tag slugs.'),
  importance: z.number().optional().describe('0..1 importance.'),
  confidence: z.number().optional().describe('0..1 confidence.'),
  expires_at: z.union([z.string(), z.null()]).optional().describe('UTC ISO timestamp or null.'),
  metadata: z.any().optional().describe('Plain JSON metadata object; new records get metadata.source = "opencode".'),
};

const retrieveArgs = {
  query: z.string().optional().describe('FTS/BM25 text query. Omit to list active memories.'),
  kind: z.string().optional(),
  scope: z.string().optional(),
  namespace: z.string().optional(),
  tags: z.array(z.string()).optional(),
  expires: z.string().optional().describe('active | expired | any (default active).'),
  importance: z.any().optional(),
  confidence: z.any().optional(),
  order_by: z.string().optional().describe('relevance | id | created_at | updated_at | importance | confidence.'),
  limit: z.number().optional(),
  offset: z.number().optional(),
  store: storeArg,
};

export const NanomnemePlugin = async (input = {}) => {
  const ctx = storeContext(input);

  async function callTool(name, params) {
    const result = runBridge({ op: 'tool', name, params: params ?? {}, ctx });
    if (!result.ok) throw new Error(result.error);
    return result.text;
  }

  return {
    tool: {
      retain_memory: tool({
        description: 'Create or explicitly patch a nanomneme memory. Prefer project scope unless the fact clearly applies to all projects (then scope: global).',
        args: retainArgs,
        async execute(args) {
          return callTool('retain_memory', args);
        },
      }),
      recall_memory: tool({
        description: 'Read one active nanomneme memory by id.',
        args: { id: z.string(), store: storeArg },
        async execute(args) {
          return callTool('recall_memory', args);
        },
      }),
      retrieve_memory: tool({
        description: 'Search or list active nanomneme memories.',
        args: retrieveArgs,
        async execute(args) {
          return callTool('retrieve_memory', args);
        },
      }),
      remove_memory: tool({
        description: 'Soft-remove a nanomneme memory by id (reversible; purge is CLI-only).',
        args: { id: z.string(), store: storeArg },
        async execute(args) {
          return callTool('remove_memory', args);
        },
      }),
    },

    // Append the bounded memory index to the assembled system prompt for every model request
    // with non-empty context. OpenCode forwards a single merged system string, so the block is
    // appended to the last entry (pushed only when none exists) to match working plugins. Any
    // bridge or settings failure omits the block; injection never blocks a chat.
    'experimental.chat.system.transform': async (_input, output) => {
      let block;
      try {
        const result = runBridge({ op: 'index', ctx });
        if (!result.ok || !result.context) return;
        block = `# Nanomneme memory\n${result.context}`;
      } catch {
        return;
      }
      if (output.system.length) output.system[output.system.length - 1] += `\n\n${block}`;
      else output.system.push(block);
    },
  };
};

export default NanomnemePlugin;