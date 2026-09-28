import { appendFileSync, chmodSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createLogger } from '../../external/logslines/src/logger.js';

const COMPONENT = /^[a-z][a-z0-9-]*$/;

export function createProjectLogger({ service, enabled = false, home, sink, now } = {}) {
  if (!enabled) return { emit: () => false };
  const safeComponent = typeof service?.component === 'string' && COMPONENT.test(service.component);
  const path = safeComponent
    ? join(home ?? homedir(), '.local', 'share', 'nanomneme', 'logs', `${service.component}.jsonl`)
    : undefined;
  const directory = path === undefined ? undefined : dirname(path);
  let directorySecured = false;
  const fileSink = (record) => {
    if (!directorySecured) {
      mkdirSync(dirname(directory), { recursive: true });
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      chmodSync(directory, 0o700);
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          chmodSync(join(directory, entry.name), 0o600);
        }
      }
      directorySecured = true;
    }
    appendFileSync(path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    return true;
  };
  const logger = createLogger({ service, sink: sink === undefined ? fileSink : sink, now });
  return { emit: (input) => safeComponent && logger.emit(input) };
}
