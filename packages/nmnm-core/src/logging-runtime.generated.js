/* Logslines v0.1.0

MIT License

Copyright (c) 2026 Linel Lazatin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

// shared/logger/sink.js
import { chmodSync, closeSync, mkdirSync, openSync, readdirSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// external/logslines/src/sinks/stderr.js
function createStderrSink({ stream = process.stderr } = {}) {
  return (record) => {
    try {
      const serialized = JSON.stringify(record);
      if (typeof serialized !== "string") return false;
      stream.write(`${serialized}
`);
      return true;
    } catch {
      return false;
    }
  };
}

// external/logslines/src/logger.js
var LEVELS = /* @__PURE__ */ new Set(["debug", "info", "warn", "error"]);
var STATUSES = /* @__PURE__ */ new Set(["ok", "empty", "not_found", "skipped", "blocked", "partial", "failed"]);
var ERROR_KINDS = /* @__PURE__ */ new Set([
  "validation",
  "configuration",
  "filesystem",
  "network",
  "provider",
  "protocol",
  "platform",
  "policy",
  "timeout",
  "unknown"
]);
var EVENT_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/;
var OPERATION_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
var ATTRIBUTE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
var ERROR_CODE_PATTERN = OPERATION_PATTERN;
var CAUSE_KIND_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*(?:[.$][A-Za-z_$][A-Za-z0-9_$]*)*$/;
var SERVICE_KEYS = ["namespace", "name", "component", "version"];
var CONTEXT_KEYS = ["session_id"];
var ERROR_KEYS = ["kind", "code", "message", "retryable", "cause_kind"];
function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function hasExactlyKeys(value, allowedKeys, requiredKeys = allowedKeys) {
  if (!isPlainObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.every((key) => typeof key === "string" && allowedKeys.includes(key)) && requiredKeys.every((key) => Object.hasOwn(value, key));
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
function isService(value) {
  return hasExactlyKeys(value, SERVICE_KEYS) && SERVICE_KEYS.every((key) => isNonEmptyString(value[key]));
}
function isContext(value) {
  return hasExactlyKeys(value, CONTEXT_KEYS) && (value.session_id === null || isNonEmptyString(value.session_id));
}
function isAttributeValue(value) {
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  const itemType = typeof value[0];
  if (!["string", "boolean", "number"].includes(itemType)) return false;
  return Array.from(value).every((item) => typeof item === itemType && (itemType !== "number" || Number.isFinite(item)));
}
function isAttributes(value) {
  return isPlainObject(value) && Reflect.ownKeys(value).every((key) => typeof key === "string" && ATTRIBUTE_PATTERN.test(key) && isAttributeValue(value[key]));
}
function isError(value) {
  if (!hasExactlyKeys(value, ERROR_KEYS, ["kind", "code", "message", "retryable"])) return false;
  return ERROR_KINDS.has(value.kind) && isNonEmptyString(value.code) && ERROR_CODE_PATTERN.test(value.code) && isNonEmptyString(value.message) && typeof value.retryable === "boolean" && (value.cause_kind === void 0 || isNonEmptyString(value.cause_kind) && CAUSE_KIND_PATTERN.test(value.cause_kind));
}
function isValidInput(input) {
  if (!isPlainObject(input)) return false;
  if (!isContext(input.context) || !LEVELS.has(input.level) || !isNonEmptyString(input.event) || !EVENT_PATTERN.test(input.event) || !isNonEmptyString(input.message) || !isNonEmptyString(input.operation) || !OPERATION_PATTERN.test(input.operation) || !STATUSES.has(input.status) || !(input.duration_ms === null || typeof input.duration_ms === "number" && Number.isFinite(input.duration_ms) && input.duration_ms >= 0) || !isAttributes(input.attributes)) {
    return false;
  }
  return input.status === "failed" ? isError(input.error) : input.error === null;
}
function createLogger({ service, sink = createStderrSink(), now = () => /* @__PURE__ */ new Date() } = {}) {
  return {
    emit(input) {
      try {
        if (!isService(service) || typeof sink !== "function" || !isValidInput(input) || typeof now !== "function") {
          return false;
        }
        const date = now();
        if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return false;
        const record = {
          schema: "logslines/v1",
          timestamp: date.toISOString(),
          level: input.level,
          event: input.event,
          message: input.message,
          service: {
            namespace: service.namespace,
            name: service.name,
            component: service.component,
            version: service.version
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
            ...input.error.cause_kind === void 0 ? {} : { cause_kind: input.error.cause_kind }
          }
        };
        return sink(record) !== false;
      } catch {
        return false;
      }
    }
  };
}

// shared/logger/sink.js
var COMPONENT = /^[a-z][a-z0-9-]*$/;
function createProjectLogger({ service, enabled = false, home, sink, now } = {}) {
  if (!enabled) return { emit: () => false };
  const safeComponent = typeof service?.component === "string" && COMPONENT.test(service.component);
  const path = safeComponent ? join(home ?? homedir(), ".local", "share", "nanomneme", "logs", `${service.component}.jsonl`) : void 0;
  const directory = path === void 0 ? void 0 : dirname(path);
  let directorySecured = false;
  const fileSink = (record) => {
    if (!directorySecured) {
      mkdirSync(dirname(directory), { recursive: true });
      mkdirSync(directory, { recursive: true, mode: 448 });
      chmodSync(directory, 448);
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          chmodSync(join(directory, entry.name), 384);
        }
      }
      directorySecured = true;
    }
    const line = Buffer.from(`${JSON.stringify(record)}
`, "utf8");
    const descriptor = openSync(path, "a", 384);
    try {
      return writeSync(descriptor, line) === line.length;
    } finally {
      closeSync(descriptor);
    }
  };
  const logger = createLogger({ service, sink: sink === void 0 ? fileSink : sink, now });
  return { emit: (input) => safeComponent && logger.emit(input) };
}

// shared/logger/config.js
import { readFileSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
import { parse } from "jsonc-parser";
function enabledAt(path, readFile) {
  let source;
  try {
    source = readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return void 0;
    throw error;
  }
  const errors = [];
  const value = parse(source, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid config");
  if (value.logging === void 0) return void 0;
  const logging = value.logging;
  if (!logging || typeof logging !== "object" || Array.isArray(logging)) throw new Error("Invalid logging config");
  if (logging.enabled !== void 0 && typeof logging.enabled !== "boolean") throw new Error("Invalid enabled setting");
  return logging.enabled;
}
function resolveLoggingEnabled({ home = homedir2(), adapterConfigPath, readFile = readFileSync } = {}) {
  try {
    const global = enabledAt(join2(home, ".local", "share", "nanomneme", "config.jsonc"), readFile);
    const override = adapterConfigPath === void 0 ? void 0 : enabledAt(adapterConfigPath, readFile);
    return override ?? global ?? false;
  } catch {
    return false;
  }
}

// shared/logger/catalog.js
var OUTCOMES = {
  retain: {
    ok: ["info", "memory.retained", "Memory retention completed"],
    blocked: ["warn", "memory.retain_blocked", "Memory retention blocked"],
    failed: ["error", "memory.retain_failed", "Memory retention failed"]
  },
  recall: {
    ok: ["info", "memory.recalled", "Memory recall completed"],
    not_found: ["info", "memory.recall_not_found", "Memory was not found"],
    blocked: ["warn", "memory.recall_blocked", "Memory recall blocked"],
    failed: ["error", "memory.recall_failed", "Memory recall failed"]
  },
  retrieve: {
    ok: ["info", "memory.retrieved", "Memory retrieval completed"],
    empty: ["info", "memory.retrieved", "Memory retrieval completed with no results"],
    blocked: ["warn", "memory.retrieve_blocked", "Memory retrieval blocked"],
    failed: ["error", "memory.retrieve_failed", "Memory retrieval failed"]
  },
  remove: {
    ok: ["info", "memory.removed", "Memory removal completed"],
    not_found: ["info", "memory.remove_not_found", "Memory was not found"],
    blocked: ["warn", "memory.remove_blocked", "Memory removal blocked"],
    failed: ["error", "memory.remove_failed", "Memory removal failed"]
  },
  browser_pin: {
    ok: ["info", "memory.browser.pin", "Memory pin completed"],
    not_found: ["info", "memory.browser.pin_not_found", "Memory was not found"],
    failed: ["error", "memory.browser.pin_failed", "Memory pin failed"]
  },
  browser_unpin: {
    ok: ["info", "memory.browser.unpin", "Memory unpin completed"],
    not_found: ["info", "memory.browser.unpin_not_found", "Memory was not found"],
    failed: ["error", "memory.browser.unpin_failed", "Memory unpin failed"]
  },
  browser_remove: {
    ok: ["info", "memory.browser.remove", "Memory removal completed"],
    not_found: ["info", "memory.browser.remove_not_found", "Memory was not found"],
    failed: ["error", "memory.browser.remove_failed", "Memory removal failed"]
  },
  command_pin: {
    ok: ["info", "memory.command.pin", "Command pin completed"],
    blocked: ["warn", "memory.command.pin_blocked", "Command pin blocked"],
    not_found: ["info", "memory.command.pin_not_found", "Command memory was not found"],
    failed: ["error", "memory.command.pin_failed", "Command pin failed"]
  },
  command_unpin: {
    ok: ["info", "memory.command.unpin", "Command unpin completed"],
    blocked: ["warn", "memory.command.unpin_blocked", "Command unpin blocked"],
    not_found: ["info", "memory.command.unpin_not_found", "Command memory was not found"],
    failed: ["error", "memory.command.unpin_failed", "Command unpin failed"]
  },
  command_remove: {
    ok: ["info", "memory.command.remove", "Command removal completed"],
    not_found: ["info", "memory.command.remove_not_found", "Command memory was not found"],
    blocked: ["warn", "memory.command.remove_blocked", "Command removal blocked"],
    failed: ["error", "memory.command.remove_failed", "Command removal failed"]
  }
};
for (const [operation, past] of [["import", "imported"], ["export", "exported"], ["verify", "verified"], ["repair", "repaired"]]) {
  OUTCOMES[operation] = {
    ok: ["info", `memory.${past}`, `Memory ${operation} completed`],
    failed: ["error", `memory.${operation}_failed`, `Memory ${operation} failed`]
  };
}
var ERROR_KINDS_BY_NAME = { TypeError: "validation", RangeError: "validation", SyntaxError: "validation", TimeoutError: "timeout" };
var FILESYSTEM_ERROR_CODES = /* @__PURE__ */ new Set(["ENOENT", "EACCES", "EPERM", "EISDIR", "ENOTDIR", "EEXIST", "ENOTEMPTY", "EBUSY", "EROFS", "EMFILE", "ENFILE"]);
var CAUSE_KIND_PATTERN2 = /^[A-Za-z_$][A-Za-z0-9_$]*(?:[.$][A-Za-z_$][A-Za-z0-9_$]*)*$/;
function errorDetail(error, fallback) {
  const detail = { kind: "unknown", message: fallback };
  try {
    if (typeof error === "string") {
      if (error.length) detail.message = error;
    } else if (typeof error?.message === "string" && error.message.length) detail.message = error.message;
    const code = typeof error?.code === "string" ? error.code : null;
    const name = typeof error?.name === "string" ? error.name : null;
    if (code === "ETIMEDOUT") detail.kind = "timeout";
    else if (code !== null && FILESYSTEM_ERROR_CODES.has(code)) detail.kind = "filesystem";
    else if (name !== null && Object.hasOwn(ERROR_KINDS_BY_NAME, name)) detail.kind = ERROR_KINDS_BY_NAME[name];
    if (name !== null && CAUSE_KIND_PATTERN2.test(name)) detail.cause_kind = name;
  } catch {
  }
  return detail;
}
function classifyOutcome(operation, result, { status, thrown = false, error = null } = {}) {
  if (!Object.hasOwn(OUTCOMES, operation)) return null;
  if (thrown) status = status === "blocked" ? "blocked" : "failed";
  if (status === void 0) {
    status = ["recall", "remove"].includes(operation) && result == null ? "not_found" : operation === "retrieve" && result?.total === 0 ? "empty" : operation === "verify" && result?.ok === false ? "failed" : operation === "repair" && result?.verification?.ok === false ? "failed" : "ok";
  }
  if (!Object.hasOwn(OUTCOMES[operation], status)) return null;
  const [level, event, message] = OUTCOMES[operation][status];
  const code = !thrown && status === "failed" && ["verify", "repair"].includes(operation) ? operation === "verify" ? "verify_integrity_failed" : "repair_verification_failed" : `${operation}_failed`;
  return {
    level,
    event,
    message,
    status,
    error: status === "failed" ? { ...errorDetail(error, message), code, retryable: false } : null
  };
}

// shared/logger/index.js
function createMemoryLogger({ service, home, adapterConfigPath } = {}, dependencies = {}) {
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
      const observation = { setStatus(value) {
        status = value;
      } };
      try {
        operation = input.operation;
        session_id = input.session_id ?? null;
        if (session_id !== null && (typeof session_id !== "string" || !session_id.length)) valid = false;
        if (!classifyOutcome(operation, void 0)) valid = false;
        if (valid) {
          initialize();
          if (emitter) started = monotonicNow();
        }
      } catch {
        valid = false;
      }
      function finish(result2, thrown = false, error = null) {
        if (finished) return;
        finished = true;
        try {
          if (!valid || !emitter) return;
          if (status !== void 0 && !classifyOutcome(operation, void 0, { status })) return;
          const outcome = classifyOutcome(operation, result2, { status, thrown, error });
          if (!outcome) return;
          const duration_ms = outcome.status === "blocked" ? null : Math.max(0, monotonicNow() - started);
          emitter.emit({ ...outcome, operation, context: { session_id }, duration_ms, attributes: {} });
        } catch {
        }
      }
      let result;
      try {
        result = execute(observation);
      } catch (error) {
        finish(void 0, true, error);
        throw error;
      }
      if (!valid || !emitter) return result;
      let then;
      try {
        then = result?.then;
      } catch {
        return result;
      }
      if (typeof then === "function") {
        try {
          then.call(result, (value) => finish(value), (reason) => finish(void 0, true, reason));
        } catch {
        }
        return result;
      }
      finish(result);
      return result;
    }
  };
}
export {
  createMemoryLogger
};
