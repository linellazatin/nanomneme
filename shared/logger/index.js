import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createLogger } from '@openlines/logslines';

const COMPONENT = /^[a-z][a-z0-9-]*$/;

export function createProjectLogger({ service, enabled = false, home, sink, now } = {}) {
  if (!enabled) return { emit: () => false };
  const safeComponent = typeof service?.component === 'string' && COMPONENT.test(service.component);
  const fileSink = (record) => {
    const path = join(home ?? homedir(), '.local', 'share', 'nanomneme', 'logs', `${service.component}.jsonl`);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
    return true;
  };
  const logger = createLogger({ service, sink: sink === undefined ? fileSink : sink, now });
  return { emit: (input) => safeComponent && logger.emit(input) };
}
