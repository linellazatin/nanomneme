const LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const STATUSES = new Set(['ok', 'empty', 'not_found', 'skipped', 'blocked', 'partial', 'failed']);
const ERROR_KINDS = new Set([
  'validation',
  'configuration',
  'filesystem',
  'network',
  'provider',
  'protocol',
  'platform',
  'policy',
  'timeout',
  'unknown',
]);
const EVENT_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/;
const OPERATION_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const ATTRIBUTE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const ERROR_CODE_PATTERN = OPERATION_PATTERN;
const CAUSE_KIND_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*(?:[.$][A-Za-z_$][A-Za-z0-9_$]*)*$/;
const SERVICE_KEYS = ['namespace', 'name', 'component', 'version'];
const CONTEXT_KEYS = ['session_id'];
const ERROR_KEYS = ['kind', 'code', 'message', 'retryable', 'cause_kind'];

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactlyKeys(value, allowedKeys, requiredKeys = allowedKeys) {
  if (!isPlainObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.every((key) => typeof key === 'string' && allowedKeys.includes(key))
    && requiredKeys.every((key) => Object.hasOwn(value, key));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isService(value) {
  return hasExactlyKeys(value, SERVICE_KEYS)
    && SERVICE_KEYS.every((key) => isNonEmptyString(value[key]));
}

function isContext(value) {
  return hasExactlyKeys(value, CONTEXT_KEYS)
    && (value.session_id === null || isNonEmptyString(value.session_id));
}

function isAttributeValue(value) {
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  const itemType = typeof value[0];
  if (!['string', 'boolean', 'number'].includes(itemType)) return false;
  return Array.from(value).every((item) => typeof item === itemType
    && (itemType !== 'number' || Number.isFinite(item)));
}

function isAttributes(value) {
  return isPlainObject(value)
    && Reflect.ownKeys(value).every((key) => typeof key === 'string'
      && ATTRIBUTE_PATTERN.test(key)
      && isAttributeValue(value[key]));
}

function isError(value) {
  if (!hasExactlyKeys(value, ERROR_KEYS, ['kind', 'code', 'message', 'retryable'])) return false;
  return ERROR_KINDS.has(value.kind)
    && isNonEmptyString(value.code)
    && ERROR_CODE_PATTERN.test(value.code)
    && isNonEmptyString(value.message)
    && typeof value.retryable === 'boolean'
    && (value.cause_kind === undefined
      || (isNonEmptyString(value.cause_kind) && CAUSE_KIND_PATTERN.test(value.cause_kind)));
}

function isValidInput(input) {
  if (!isPlainObject(input)) return false;
  if (!isContext(input.context)
    || !LEVELS.has(input.level)
    || !isNonEmptyString(input.event)
    || !EVENT_PATTERN.test(input.event)
    || !isNonEmptyString(input.message)
    || !isNonEmptyString(input.operation)
    || !OPERATION_PATTERN.test(input.operation)
    || !STATUSES.has(input.status)
    || !(input.duration_ms === null
      || (typeof input.duration_ms === 'number'
        && Number.isFinite(input.duration_ms)
        && input.duration_ms >= 0))
    || !isAttributes(input.attributes)) {
    return false;
  }
  return input.status === 'failed' ? isError(input.error) : input.error === null;
}

export function createLogger({ service, sink = createStderrSink(), now = () => new Date() } = {}) {
  return {
    emit(input) {
      try {
        if (!isService(service) || typeof sink !== 'function' || !isValidInput(input) || typeof now !== 'function') {
          return false;
        }

        const date = now();
        if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return false;

        const record = {
          schema: 'logslines/v1',
          timestamp: date.toISOString(),
          level: input.level,
          event: input.event,
          message: input.message,
          service: {
            namespace: service.namespace,
            name: service.name,
            component: service.component,
            version: service.version,
          },
          context: { session_id: input.context.session_id },
          operation: input.operation,
          status: input.status,
          duration_ms: input.duration_ms,
          attributes: { ...input.attributes },
          error: input.error === null ? null : {
            kind: input.error.kind,
            code: input.error.code,
            message: input.error.message,
            retryable: input.error.retryable,
            ...(input.error.cause_kind === undefined ? {} : { cause_kind: input.error.cause_kind }),
          },
        };

        return sink(record) !== false;
      } catch {
        return false;
      }
    },
  };
}
import { createStderrSink } from './sinks/stderr.js';
