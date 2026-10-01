import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'jsonc-parser';

function enabledAt(path, readFile) {
  let source;
  try { source = readFile(path, 'utf8'); }
  catch (error) { if (error?.code === 'ENOENT') return undefined; throw error; }
  const errors = [];
  const value = parse(source, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid config');
  if (value.logging === undefined) return undefined;
  const logging = value.logging;
  if (!logging || typeof logging !== 'object' || Array.isArray(logging)) throw new Error('Invalid logging config');
  if (logging.enabled !== undefined && typeof logging.enabled !== 'boolean') throw new Error('Invalid enabled setting');
  return logging.enabled;
}

export function resolveLoggingEnabled({ home = homedir(), adapterConfigPath, readFile = readFileSync } = {}) {
  try {
    const global = enabledAt(join(home, '.local', 'share', 'nanomneme', 'config.jsonc'), readFile);
    const override = adapterConfigPath === undefined ? undefined : enabledAt(adapterConfigPath, readFile);
    return override ?? global ?? false;
  } catch { return false; }
}
