import pkg from '../package.json' with { type: 'json' };
import { createMemoryLogger } from '../../../shared/logger/index.js';
import { resolveLoggingEnabled } from '../../../shared/logger/config.js';
import { piAgentDir, settingsPath } from '../src/context.js';

// Private test injection, never part of the published adapter's logger interface.
export function createPiLogger({ enabled, sink, now, home, agentDir } = {}) {
  return createMemoryLogger({ home, adapterConfigPath: settingsPath({ store: 'global', agentDir: agentDir ?? piAgentDir({ home }) }),
    service: { namespace: 'openlines', name: 'nanomneme', component: 'nmnm-pi', version: pkg.version } },
    { resolveEnabled: enabled === undefined ? (home ? resolveLoggingEnabled : () => false) : () => enabled, sink, now });
}
