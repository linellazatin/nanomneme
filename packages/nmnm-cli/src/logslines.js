import pkg from '../package.json' with { type: 'json' };
import { createMemoryLogger } from '@openlines/nmnm-core/logging';

export function getCLILogger({ home } = {}) {
  return createMemoryLogger({ home,
    service: { namespace: 'openlines', name: 'nanomneme', component: 'nmnm-cli', version: pkg.version },
  });
}
