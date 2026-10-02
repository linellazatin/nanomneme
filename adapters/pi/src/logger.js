import adapterPackage from '../package.json' with { type: 'json' };
import { createMemoryLogger } from '@openlines/nmnm-core/logging';
import { piAgentDir, settingsPath } from './context.js';

export function piSessionId(ctx) {
  try {
    const id = ctx?.sessionManager?.getSessionId?.();
    return typeof id === 'string' && id.length ? id : null;
  } catch { return null; }
}

export function getPiLogger({ home, agentDir } = {}) {
  return createMemoryLogger({ home,
    adapterConfigPath: settingsPath({ store: 'global', agentDir: agentDir ?? piAgentDir({ home }) }),
    service: { namespace: 'openlines', name: 'nanomneme', component: 'nmnm-pi', version: adapterPackage.version },
  });
}
