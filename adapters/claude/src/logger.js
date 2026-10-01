import pkg from '../package.json' with { type: 'json' };
import { createMemoryLogger } from '@openlines/nmnm-core/logging';
import { claudeGlobalDir, settingsPath } from './context.js';

export function getMemoryLogger({ home, globalDir } = {}) {
  return createMemoryLogger({ home,
    adapterConfigPath: settingsPath({ store: 'global', globalDir: globalDir ?? claudeGlobalDir({ home }) }),
    service: { namespace: 'openlines', name: 'nanomneme', component: 'nmnm-claude', version: pkg.version },
  });
}
