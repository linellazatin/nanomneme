import { z } from 'zod';
import { runMemory } from './store.js';
import { resolveLaunchContext } from './launch.js';
import { getMemoryLogger } from './logslines.js';

const store = z.enum(['project', 'global']);
const kind = z.enum(['note', 'decision', 'preference', 'fact', 'instruction']);
const text = max => z.string().refine(s => s.trim().length > 0 && s.isWellFormed() && Array.from(s).length <= max, 'Invalid or oversized text').describe(`Nonempty well-formed text; maximum ${max} Unicode code points.`);
const slug = z.string().max(128).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const score = z.number().min(0).max(1);
const expiry = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine(s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s, 'Expected UTC timestamp with milliseconds').nullable();
const tags = z.array(slug).max(32);
const metadata = z.record(z.string(), z.json()).refine(value => Buffer.byteLength(JSON.stringify(value)) <= 8192, 'Metadata exceeds byte limit');
const range = z.union([score, z.strictObject({ gt: score.optional(), gte: score.optional(), lt: score.optional(), lte: score.optional() }).refine(value => Object.keys(value).length > 0)]);

export const toolSchemas = {
  retain_memory: z.strictObject({ store: store.optional(), id: id.optional(), content: text(16384).optional(), kind: kind.optional(), scope: store.optional(), namespace: slug.optional(), tags: tags.optional(), importance: score.optional(), confidence: score.optional(), expires_at: expiry.optional(), metadata: metadata.optional() }),
  recall_memory: z.strictObject({ store: store.optional(), id, content_offset: z.number().int().min(0).optional(), content_limit: z.number().int().min(1).max(4096).optional() }),
  retrieve_memory: z.strictObject({ store: store.optional(), query: text(2048).optional(), kind: kind.optional(), scope: store.optional(), namespace: slug.optional(), tags: tags.optional(), source: text(128).optional(), expires: z.enum(['active', 'expired', 'any']).optional(), importance: range.optional(), confidence: range.optional(), order_by: z.enum(['relevance', 'id', 'created_at', 'updated_at', 'importance', 'confidence']).optional(), limit: z.number().int().min(1).max(20).optional(), offset: z.number().int().min(0).max(1000).optional() }),
  remove_memory: z.strictObject({ store: store.optional(), id }),
};

function validate(name, args) {
  if (!Object.hasOwn(toolSchemas, name)) throw new TypeError('Unknown memory tool');
  if (Buffer.byteLength(JSON.stringify(args)) > 131072) throw new TypeError('Arguments exceed byte limit');
  const parsed = toolSchemas[name].safeParse(args);
  if (!parsed.success) throw new TypeError('Invalid memory arguments');
  const value = parsed.data;
  if (name === 'retain_memory') {
    if (value.scope !== undefined && value.scope !== (value.store ?? 'project')) throw new TypeError('scope must agree with store');
    if (value.id === undefined && value.content === undefined) throw new TypeError('Create requires content');
    if (value.id === undefined && Buffer.byteLength(JSON.stringify({ ...value.metadata, source: 'codex' })) > 8192) throw new TypeError('Metadata including provenance exceeds byte limit');
    if (value.id !== undefined && (value.metadata !== undefined || !Object.keys(value).some(key => !['id', 'store', 'metadata'].includes(key)))) throw new TypeError('Patch requires mutable fields and cannot replace metadata');
  }
  if (name === 'retrieve_memory' && value.order_by === 'relevance' && value.query === undefined) throw new TypeError('Relevance ordering requires query');
  return value;
}

const response = result => ({ content: [{ type: 'text', text: JSON.stringify(result) }] });

function projectResult(operation, result, selected, input) {
  if (result === null) {
    if (operation === 'retain') throw new RangeError('Patch target does not exist');
    return { status: 'not_found', store: selected };
  }
  if (operation === 'retrieve') {
    const offset = input.offset ?? 0;
    const next = offset + result.items.length;
    const more = next < result.total && result.items.length > 0;
    return { status: result.total ? 'ok' : 'empty', store: selected, total: result.total, offset, next_offset: more && next <= 1000 ? next : null, pagination_limited: more && next > 1000, items: result.items.map(record => ({ id: record.id, store: selected, kind: record.kind, scope: record.scope, preview: Array.from(record.content).slice(0, 160).join('') })) };
  }
  if (operation === 'recall') {
    const json = JSON.stringify(result), characters = Array.from(json);
    const offset = input.content_offset ?? 0, limit = input.content_limit ?? 4096;
    if (offset >= characters.length) throw new RangeError('Recall offset exceeds record length');
    if (characters.length <= limit && offset === 0) return { status: 'ok', store: selected, record: result };
    const end = Math.min(offset + limit, characters.length);
    return { status: 'ok', store: selected, id: result.id, record_json: characters.slice(offset, end).join(''), offset, next_offset: end < characters.length ? end : null, total_characters: characters.length, updated_at: result.updated_at };
  }
  return { status: 'ok', store: selected, id: result.id };
}

export function createMemoryOperations(options) {
  const context = resolveLaunchContext({ ...options, env: { ...options.env, NMNM_PROJECT_DIR: options.cwd } });
  const logger = options.logger ?? getMemoryLogger(context);
  return (name, args = {}) => {
    const operation = Object.hasOwn(toolSchemas, name) ? name.replace('_memory', '') : null;
    let input, selected, projected;
    try {
      logger.run({ operation, session_id: context.session_id }, () => {
        const { store: destination = 'project', ...fields } = validate(name, args);
        selected = destination; input = fields;
        let value = input;
        if (operation === 'retain' && input.id === undefined) value = { ...input, scope: input.scope ?? selected, metadata: { ...input.metadata, source: 'codex' } };
        if (operation === 'remove') value = { id: input.id, mode: 'soft' };
        if (operation === 'retrieve') value = { ...input, limit: input.limit ?? 5 };
        const canonical = runMemory({ ...context, store: selected, operation, input: value, create: operation === 'retain' && input.id === undefined, readOnly: ['recall', 'retrieve'].includes(operation) });
        projected = projectResult(operation, canonical, selected, input);
        return canonical;
      });
      return response(projected);
    } catch (error) {
      return { ...response({ error: { code: error instanceof TypeError || error instanceof RangeError ? 'invalid_input' : 'operation_failed', message: Array.from(error.message ?? 'Memory operation failed').slice(0, 512).join('') } }), isError: true };
    }
  };
}
