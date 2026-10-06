import { createProjectLogger } from '../../../shared/logger/sink.js';
import { resolveLoggingEnabled } from '../../../shared/logger/config.js';
import { errorDetail } from '../../../shared/logger/catalog.js';

export function reportUIError(error, { service, home } = {}) {
  try {
    if (!resolveLoggingEnabled({ home })) return;
    createProjectLogger({ service, home, enabled: true }).emit({
      level: 'error', event: 'ui.error', message: 'UI operation failed', operation: 'ui_error',
      status: 'failed', duration_ms: null, context: { session_id: null }, attributes: {},
      error: { ...errorDetail(error, 'UI operation failed'), code: 'ui_error', retryable: false },
    });
  } catch { /* Diagnostics must not affect the UI. */ }
}
