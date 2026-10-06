import pkg from '../package.json' with { type: 'json' };
import { createMemoryLogger } from '@openlines/nmnm-core/logging';
import { reportUIError } from './ui-logging-runtime.generated.js';

const service = { namespace: 'openlines', name: 'nanomneme', component: 'nmnm-ui', version: pkg.version };

export function getUILogger({ home } = {}) {
  const observedErrors = new WeakSet();
  return {
    run(operation, execute) {
      return createMemoryLogger({ service, home }).run({ operation }, observation => {
        try { return execute(observation); }
        catch (error) { if (error && typeof error === 'object') observedErrors.add(error); throw error; }
      });
    },
    error(error) {
      if (error && typeof error === 'object') {
        if (observedErrors.has(error)) return;
        observedErrors.add(error);
      }
      reportUIError(error, { service, home });
    },
  };
}
