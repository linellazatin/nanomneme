import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Ephemeral per-session prompt-count state. This is transient lifecycle bookkeeping,
// never canonical memory: it lives in a temp directory and may be discarded any time.
export function statePath(sessionId, dir = join(tmpdir(), 'nmnm-claude')) {
  const id = typeof sessionId === 'string' && /^[\w-]+$/.test(sessionId) ? sessionId : 'default';
  return join(dir, `session-${id}.json`);
}

export function readState(path) {
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function writeState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state));
}
