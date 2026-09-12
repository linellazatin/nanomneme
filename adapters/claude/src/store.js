import { open } from 'nmnm-core';
import { homedir, platform as currentPlatform } from 'node:os';
import { join, resolve } from 'node:path';

const OPERATIONS = new Set(['retain', 'recall', 'retrieve', 'remove']);

export function databasePath({ cwd, home = homedir(), platform = currentPlatform(), store = 'project' }) {
  if (store === 'project') return resolve(cwd, '.nanomneme', 'memory.db');
  if (store === 'global') {
    if (!['darwin', 'linux'].includes(platform)) throw new TypeError('--global is supported only on Linux and macOS; use --db');
    return join(home, '.local', 'share', 'nanomneme', 'memory.db');
  }
  throw new TypeError('store must be project or global');
}

export function runMemory({ cwd, home, platform, store = 'project', operation, input, create, readOnly }) {
  if (!OPERATIONS.has(operation)) throw new TypeError('operation must be retain, recall, retrieve, or remove');
  const next = operation === 'retain' && store === 'global' && input.scope === undefined
    ? { ...input, scope: 'global' }
    : input;
  const memoryStore = open(databasePath({ cwd, home, platform, store }), { create, readOnly });
  try {
    return memoryStore[operation](next);
  } finally {
    memoryStore.close();
  }
}
