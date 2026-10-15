// Portable V2 RPC contract. Plain JSON Schema keeps V2 runtime imports out of V1.
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const text = { type: 'string' };
const nullableText = { type: ['string', 'null'] };
const boolean = { type: 'boolean' };
const store = { type: 'string', enum: ['project', 'global'] };
const id = { type: 'string', minLength: 1, maxLength: 128 };
const target = { store, id };
const record = object({
  store, id, content: text, kind: text, scope: text, namespace: nullableText,
  tags: { type: 'array', items: text },
  importance: { type: 'number' }, confidence: { type: 'number' },
  created_at: text, updated_at: text, expires_at: nullableText, removed_at: nullableText,
  source: {}, metadata: { type: 'object', additionalProperties: true }, pinned: boolean,
});
const ok = { const: true };
const error = object({ ok: boolean, error: text });
const result = (...success) => ({ anyOf: [...success, error] });

export const browserRpc = {
  id: 'nmnm-opencode.browser',
  methods: {
    status: {
      input: object({}),
      output: result(object({ ok, status: text })),
    },
    browse: {
      input: object({
        store: { type: 'string', enum: ['project', 'global', 'both'] },
        source: { type: 'string', enum: ['all', 'opencode'] },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        offset: { type: 'integer', minimum: 0, maximum: 1000 },
      }, []),
      output: result(object({
        ok, store: { type: 'string', enum: ['project', 'global', 'both'] },
        total: { type: 'integer', minimum: 0 }, items: { type: 'array', items: record },
      })),
    },
    detail: {
      input: object(target),
      output: result(object({ ok, record }), object({ ok, memory: { type: 'null' } })),
    },
    mutate: {
      input: object({ ...target, mutation: { type: 'string', enum: ['pin', 'unpin', 'remove'] } }),
      output: result(object({ ok, pinned: boolean, removed: { const: true } }, ['ok', 'pinned'])),
    },
  },
  events: {},
};
