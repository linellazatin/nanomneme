import { createProjectLogger } from './sink.js';
import { resolveLoggingEnabled } from './config.js';
import { classifyOutcome } from './catalog.js';

export function createMemoryLogger({ service, home, adapterConfigPath } = {}, dependencies = {}) {
  let emitter;
  let initialized = false;
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
  function initialize() {
    if (initialized) return;
    initialized = true;
    const enabled = (dependencies.resolveEnabled ?? resolveLoggingEnabled)({ home, adapterConfigPath });
    if (enabled === true) emitter = createProjectLogger({ service, home, enabled: true, sink: dependencies.sink, now: dependencies.now });
  }
  return {
    run(input, execute) {
      let operation, session_id, started, status, valid = true, finished = false;
      const observation = { setStatus(value) { status = value; } };
      try {
        operation = input.operation;
        session_id = input.session_id ?? null;
        if (session_id !== null && (typeof session_id !== 'string' || !session_id.length)) valid = false;
        if (!classifyOutcome(operation, undefined)) valid = false;
        if (valid) { initialize(); if (emitter) started = monotonicNow(); }
      } catch { valid = false; }
      function finish(result, thrown = false, error = null) {
        if (finished) return;
        finished = true;
        try {
          if (!valid || !emitter) return;
          if (status !== undefined && !classifyOutcome(operation, undefined, { status })) return;
          const outcome = classifyOutcome(operation, result, { status, thrown, error });
          if (!outcome) return;
          const duration_ms = outcome.status === 'blocked' ? null : Math.max(0, monotonicNow() - started);
          emitter.emit({ ...outcome, operation, context: { session_id }, duration_ms, attributes: {} });
        } catch { /* Diagnostics are subordinate to execution. */ }
      }
      let result;
      try { result = execute(observation); }
      catch (error) { finish(undefined, true, error); throw error; }
      if (!valid || !emitter) return result;
      let then;
      try { then = result?.then; } catch { return result; }
      if (typeof then === 'function') {
        try { then.call(result, value => finish(value), reason => finish(undefined, true, reason)); }
        catch { /* A diagnostic settlement subscription cannot change the result. */ }
        return result;
      }
      finish(result);
      return result;
    },
  };
}
