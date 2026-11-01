import { existsSync } from 'node:fs';
import { homedir, platform as currentPlatform } from 'node:os';
import { open } from '@openlines/nmnm-core';
import { join, resolve } from 'node:path';

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

export function runMemory({ cwd, home = homedir(), platform = currentPlatform(), store = 'project', operation, input, create, readOnly }) {
  const path = databasePath({ cwd, home, platform, store });
  if (!existsSync(path) && (readOnly || create === false)) {
    if (operation === 'retrieve') return { total: 0, items: [] };
    return null;
  }
  const memoryStore = open(path, { create, readOnly });
  try {
    return memoryStore[operation](input);
  } finally {
    memoryStore.close();
  }
}
