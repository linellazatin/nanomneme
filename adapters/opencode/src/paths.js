import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// Bun-safe path helpers shared by the Node side (context/logger) and the Bun plugin host
// (bridge-client). This module must stay free of SQLite, JSONC, and filesystem imports so the
// Bun module graph can load it.

const SETTINGS_FILE = 'nmnm.jsonc';

function expandedPath(path, home) {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return resolve(path);
}

export function opencodeGlobalDir({ home = homedir(), env = process.env } = {}) {
  const base = env.XDG_CONFIG_HOME ? expandedPath(env.XDG_CONFIG_HOME, home) : join(home, '.config');
  return join(base, 'opencode');
}

export function settingsPath({ cwd, home = homedir(), globalDir = opencodeGlobalDir({ home }), store }) {
  if (store === 'project') return join(cwd, '.nanomneme', SETTINGS_FILE);
  if (store === 'global') return join(globalDir, SETTINGS_FILE);
  throw new TypeError('store must be project or global');
}
