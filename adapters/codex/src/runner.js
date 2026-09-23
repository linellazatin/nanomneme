import { existsSync } from 'node:fs';
import { homedir, platform as currentPlatform } from 'node:os';
import { join, resolve } from 'node:path';
import { open } from '@openlines/nmnm-core';

const OPERATIONS = new Set(['retain', 'recall', 'retrieve', 'remove']);
const EMPTY_RETRIEVAL = Object.freeze({ total: 0, items: [] });

export function supportsGlobalStore(platform = currentPlatform()) {
  return ['darwin', 'linux'].includes(platform);
}

export function databasePath({ cwd, home = homedir(), platform = currentPlatform(), store = 'project' }) {
  if (store === 'project') return resolve(cwd, '.nanomneme', 'memory.db');
  if (store === 'global') {
    if (!supportsGlobalStore(platform)) throw new TypeError('global memory is supported only on Linux and macOS');
    return join(home, '.local', 'share', 'nanomneme', 'memory.db');
  }
  throw new TypeError('store must be project or global');
}

function requestInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('input must be an object');
  return value;
}

function retainInput(input) {
  if (input.id != null) {
    const patch = { ...input };
    delete patch.metadata;
    return patch;
  }
  const metadata = input.metadata ?? {};
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new TypeError('metadata must be a JSON object');
  return { ...input, metadata: { ...metadata, source: 'codex' } };
}

function callStore(path, options, operation, input) {
  const store = open(path, options);
  try {
    return store[operation](input);
  } finally {
    store.close();
  }
}

export function handleRequest(request, { cwd = process.cwd(), home = homedir(), platform = currentPlatform() } = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('request must be an object');
  const { operation, store = 'project' } = request;
  if (!OPERATIONS.has(operation)) throw new TypeError('operation must be retain, recall, retrieve, or remove');
  const input = requestInput(request.input ?? {});
  const path = databasePath({ cwd, home, platform, store });

  if (operation === 'retain') return callStore(path, { create: true }, operation, retainInput(store === 'global' && input.scope === undefined ? { ...input, scope: 'global' } : input));
  if (!existsSync(path)) return operation === 'retrieve' ? { ...EMPTY_RETRIEVAL } : null;
  if (operation === 'remove') return callStore(path, { create: false }, operation, { id: input.id, mode: 'soft' });
  return callStore(path, { create: false, readOnly: true }, operation, input);
}
