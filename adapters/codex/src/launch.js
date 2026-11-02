import { statSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { homedir, platform } from 'node:os';
import { codexSessionId } from './logslines.js';

export function resolveLaunchContext({ env = process.env, home = homedir(), platform: hostPlatform = platform() } = {}) {
  const directory = env.NMNM_PROJECT_DIR;
  try {
    if (typeof directory !== 'string' || !isAbsolute(directory) || !statSync(directory).isDirectory()) throw new Error();
  } catch {
    throw new TypeError('NMNM_PROJECT_DIR must name an absolute existing project directory');
  }
  const snapshot = { ...env };
  return Object.freeze({ cwd: realpathSync(directory), home, platform: hostPlatform, env: snapshot, session_id: codexSessionId(snapshot) });
}
