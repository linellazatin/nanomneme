export const fixtureId = index => `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;

export function generateRecords(size) {
  if (!Number.isInteger(size) || size < 1 || size > 100000) throw new RangeError('fixture size must be between 1 and 100000');
  const topics = ['SQLite memory retrieval', 'PostgreSQL analytics', 'DatabaseSync node.js', 'config.toml llama-server'];
  return Array.from({ length: size }, (_, index) => ({
    id: fixtureId(index),
    content: `${topics[index % topics.length]} item ${index}. ${'Deterministic technical context. '.repeat(1 + index % 40)}`.trim(),
    kind: index % 5 ? 'note' : 'decision',
    scope: index % 7 ? 'project' : 'global',
    namespace: index % 10 ? 'default' : 'selected',
    importance: (index % 11) / 10,
    confidence: (index % 5) / 4,
    created_at: '2000-01-01T00:00:00.000Z',
    updated_at: `2026-01-${String(1 + index % 28).padStart(2, '0')}T00:00:00.000Z`,
    expires_at: index % 13 === 12 ? '2000-01-01T00:00:00.000Z' : index % 17 === 16 ? '9999-01-01T00:00:00.000Z' : null,
    removed_at: index % 19 === 18 ? '2026-01-29T00:00:00.000Z' : null,
    metadata: { source: ['pi', 'claude', 'opencode', 'codex'][index % 4] },
    tags: index % 3 ? ['common', ...(index % 100 === 1 ? ['rare'] : [])] : [],
  }));
}
