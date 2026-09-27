import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createErrorRecord, createLogger } from '@openlines/logslines';
import adapterPackage from '../package.json' with { type: 'json' };

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
};

function createPiFileSink({ home = homedir() } = {}) {
  const path = join(home, '.local', 'share', 'nanomneme', 'logs', `${SERVICE.component}.jsonl`);
  return (record) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
    return true;
  };
}

function sessionId(ctx) {
  try {
    const value = ctx?.sessionManager?.getSessionId?.();
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function createPiLogger({ sink, now, home } = {}) {
  const logger = createLogger({
    service: SERVICE,
    sink: sink === undefined ? createPiFileSink({ home }) : sink,
    now,
  });

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
            ? createErrorRecord({
              kind: 'unknown',
              code: `${operation}_failed`,
              message,
              retryable: false,
            })
            : null,
        });
      } catch {
        return false;
      }
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
