import adapterPackage from '../package.json' with { type: 'json' };

import { piAgentDir, readSettings, settingsPath } from './context.js';
import { createProjectLogger } from './logger-runtime.generated.js';

// Adapter logging template: identity, host correlation, outcome mapping, and safe emission live here.
const SERVICE = {
  namespace: 'openlines',
  name: 'nanomneme',
  component: 'nmnm-pi',
  version: adapterPackage.version,
};

const OUTCOMES = {
  retain: {
    ok: ['info', 'memory.retained', 'Memory retention completed'],
    blocked: ['warn', 'memory.retain_blocked', 'Memory retention blocked'],
    failed: ['error', 'memory.retain_failed', 'Memory retention failed'],
  },
  recall: {
    ok: ['info', 'memory.recalled', 'Memory recall completed'],
    not_found: ['info', 'memory.recall_not_found', 'Memory was not found'],
    blocked: ['warn', 'memory.recall_blocked', 'Memory recall blocked'],
    failed: ['error', 'memory.recall_failed', 'Memory recall failed'],
  },
  retrieve: {
    ok: ['info', 'memory.retrieved', 'Memory retrieval completed'],
    empty: ['info', 'memory.retrieved', 'Memory retrieval completed with no results'],
    blocked: ['warn', 'memory.retrieve_blocked', 'Memory retrieval blocked'],
    failed: ['error', 'memory.retrieve_failed', 'Memory retrieval failed'],
  },
  remove: {
    ok: ['info', 'memory.removed', 'Memory removal completed'],
    not_found: ['info', 'memory.remove_not_found', 'Memory was not found'],
    blocked: ['warn', 'memory.remove_blocked', 'Memory removal blocked'],
    failed: ['error', 'memory.remove_failed', 'Memory removal failed'],
  },
  browser_pin: {
    ok: ['info', 'memory.browser.pin', 'Browser pin completed'],
    not_found: ['info', 'memory.browser.pin_not_found', 'Browser memory was not found'],
    failed: ['error', 'memory.browser.pin_failed', 'Browser pin failed'],
  },
  browser_unpin: {
    ok: ['info', 'memory.browser.unpin', 'Browser unpin completed'],
    not_found: ['info', 'memory.browser.unpin_not_found', 'Browser memory was not found'],
    failed: ['error', 'memory.browser.unpin_failed', 'Browser unpin failed'],
  },
  browser_remove: {
    ok: ['info', 'memory.browser.remove', 'Browser removal completed'],
    not_found: ['info', 'memory.browser.remove_not_found', 'Browser memory was not found'],
    failed: ['error', 'memory.browser.remove_failed', 'Browser removal failed'],
  },
  command_pin: {
    ok: ['info', 'memory.command.pin', 'Command pin completed'],
    not_found: ['info', 'memory.command.pin_not_found', 'Command memory was not found'],
    failed: ['error', 'memory.command.pin_failed', 'Command pin failed'],
  },
  command_unpin: {
    ok: ['info', 'memory.command.unpin', 'Command unpin completed'],
    not_found: ['info', 'memory.command.unpin_not_found', 'Command pin was not found'],
    failed: ['error', 'memory.command.unpin_failed', 'Command unpin failed'],
  },
  command_remove: {
    ok: ['info', 'memory.command.remove', 'Command removal completed'],
    not_found: ['info', 'memory.command.remove_not_found', 'Command memory was not found'],
    blocked: ['warn', 'memory.command.remove_blocked', 'Command removal blocked'],
    failed: ['error', 'memory.command.remove_failed', 'Command removal failed'],
  },
};

function sessionId(ctx) {
  try {
    const value = ctx?.sessionManager?.getSessionId?.();
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function createPiLogger({ enabled, sink, now, home, agentDir } = {}) {
  let optIn = enabled === true;
  if (enabled === undefined) {
    try {
      const path = settingsPath({ store: 'global', agentDir: agentDir ?? piAgentDir({ home }) });
      optIn = readSettings(path, { includeLogging: true }).logging?.enabled === true;
    } catch {
      optIn = false;
    }
  }
  const logger = createProjectLogger({ service: SERVICE, enabled: optIn, sink, now, home });

  return {
    record({ ctx, operation, status, duration_ms }) {
      try {
        const outcome = OUTCOMES[operation]?.[status];
        if (!outcome) return false;

        const [level, event, message] = outcome;
        return logger.emit({
          context: { session_id: sessionId(ctx) },
          level,
          event,
          message,
          operation,
          status,
          duration_ms,
          attributes: {},
          error: status === 'failed'
            ? { kind: 'unknown', code: `${operation}_failed`, message, retryable: false }
            : null,
        });
      } catch {
        return false;
      }
    },
  };
}

export function getPiLogger(options) {
  let logger;
  return {
    record(fields) {
      logger ??= createPiLogger(options);
      return logger.record(fields);
    },
  };
}

function safeRecord(logger, fields) {
  try {
    return logger.record(fields) === true;
  } catch {
    return false;
  }
}

const BROWSER_OPERATIONS = { Pin: 'browser_pin', Unpin: 'browser_unpin', Remove: 'browser_remove' };

export function recordPiBrowserOperation(logger, ctx, action, status, duration_ms) {
  const operation = BROWSER_OPERATIONS[action];
  return operation ? safeRecord(logger, { ctx, operation, status, duration_ms }) : false;
}

const COMMAND_OPERATIONS = { pin: 'command_pin', unpin: 'command_unpin', remove: 'command_remove' };

export function recordPiCommandOperation(logger, ctx, action, status, duration_ms) {
  const operation = COMMAND_OPERATIONS[action];
  return operation ? safeRecord(logger, { ctx, operation, status, duration_ms }) : false;
}

export function recordPiBlockedOperation(logger, ctx, operation) {
  return safeRecord(logger, { ctx, operation, status: 'blocked', duration_ms: null });
}

export function runPiOperation(logger, { ctx, operation, execute, status }) {
  const started = performance.now();
  try {
    const result = execute();
    safeRecord(logger, {
      ctx,
      operation,
      status: status(result),
      duration_ms: Math.max(0, performance.now() - started),
    });
    return result;
  } catch (error) {
    safeRecord(logger, {
      ctx,
      operation,
      status: 'failed',
      duration_ms: Math.max(0, performance.now() - started),
    });
    throw error;
  }
}
