import { runMemory } from './store.js';

export const DEFAULT_INDEX_BUDGET = 1200;
const PREVIEW_LENGTH = 160;

function preview(content) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized.length <= PREVIEW_LENGTH ? normalized : `${normalized.slice(0, PREVIEW_LENGTH - 1)}…`;
}

function memoryLine(store, memory) {
  const source = typeof memory.metadata?.source === 'string' ? memory.metadata.source : 'unknown';
  return `[${store}] [${source}] ${memory.id} ${preview(memory.content)}`;
}

function appendWithinBudget(lines, line, budget) {
  const candidate = lines.length ? `${lines.join('\n')}\n${line}` : line;
  if (candidate.length <= budget) lines.push(line);
}

export function buildMemoryIndex({ cwd, home, platform, budget = DEFAULT_INDEX_BUDGET } = {}) {
  if (!Number.isInteger(budget) || budget < 1) throw new RangeError('budget must be a positive integer');
  const lines = [];
  let total = 0;
  for (const store of ['project', 'global']) {
    let result;
    try {
      result = runMemory({ cwd, home, platform, store, operation: 'retrieve', input: { limit: 20 }, create: false, readOnly: true });
    } catch (error) {
      if (/database does not exist/.test(error.message) || (store === 'global' && /supported only on Linux and macOS/.test(error.message))) continue;
      throw error;
    }
    total += result.total;
    for (const memory of result.items) appendWithinBudget(lines, memoryLine(store, memory), budget);
  }
  return { total, content: lines.join('\n') };
}
