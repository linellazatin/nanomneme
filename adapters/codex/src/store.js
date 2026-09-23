import { existsSync } from 'node:fs';
import { homedir, platform as currentPlatform } from 'node:os';
import { open } from '@openlines/nmnm-core';
import { databasePath } from './runner.js';

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
