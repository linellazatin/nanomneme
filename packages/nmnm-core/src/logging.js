import pkg from '../package.json' with { type: 'json' };
import { createMemoryLogger as createSharedLogger } from './logging-runtime.generated.js';

const service = { namespace: 'openlines', name: 'nanomneme', component: 'nmnm-core', version: pkg.version };

export function createMemoryLogger(options = {}) {
  return createSharedLogger({ ...options, service: options.service ?? service });
}
