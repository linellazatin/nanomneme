import pkg from '../package.json' with { type: 'json' };
import { createMemoryLogger } from '@openlines/nmnm-core/logging';
import { opencodeGlobalDir, settingsPath } from './context.js';

export function getMemoryLogger({ home, globalDir } = {}) {
  return createMemoryLogger({ home,
    adapterConfigPath: settingsPath({ store: 'global', globalDir: globalDir ?? opencodeGlobalDir({ home }) }),
    service: { namespace: 'openlines', name: 'nanomneme', component: 'nmnm-opencode', version: pkg.version },
  });
}
