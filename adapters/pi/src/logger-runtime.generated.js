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

// shared/logger/index.js
import { appendFileSync, mkdirSync } from "node:fs";
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

// shared/logger/index.js
var COMPONENT = /^[a-z][a-z0-9-]*$/;
function createProjectLogger({ service, enabled = false, home, sink, now } = {}) {
  if (!enabled) return { emit: () => false };
  const safeComponent = typeof service?.component === "string" && COMPONENT.test(service.component);
  const fileSink = (record) => {
    const path = join(home ?? homedir(), ".local", "share", "nanomneme", "logs", `${service.component}.jsonl`);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(record)}
`, "utf8");
    return true;
  };
  const logger = createLogger({ service, sink: sink === void 0 ? fileSink : sink, now });
  return { emit: (input) => safeComponent && logger.emit(input) };
}
export {
  createProjectLogger
};
