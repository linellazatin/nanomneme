import pkg from '../package.json' with { type: 'json' };
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createMemoryLogger } from '@openlines/nmnm-core/logging';

export function codexSessionId(env = process.env) {
  try {
    for (const key of ['CODEX_THREAD_ID', 'CODEX_SESSION_ID']) {
      const id = env?.[key];
      if (typeof id === 'string' && id.trim().length) return id;
    }
  } catch { /* Missing host correlation must not affect memory operations. */ }
  return null;
}

export function codexConfigPath({ home = homedir(), env = process.env } = {}) {
  const configured = typeof env.CODEX_HOME === 'string' && env.CODEX_HOME.length ? env.CODEX_HOME : null;
  const directory = configured === null ? join(home, '.codex')
    : configured === '~' ? home : configured.startsWith('~/') ? join(home, configured.slice(2)) : resolve(configured);
  return join(directory, 'nmnm.jsonc');
}

export function getMemoryLogger(options = {}) {
  return createMemoryLogger({ home: options.home, adapterConfigPath: codexConfigPath(options),
    service: { namespace: 'openlines', name: 'nanomneme', component: 'nmnm-codex', version: pkg.version },
  });
}
