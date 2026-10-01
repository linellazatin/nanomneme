export const OUTCOMES = {
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
    ok: ['info', 'memory.browser.pin', 'Memory pin completed'],
    not_found: ['info', 'memory.browser.pin_not_found', 'Memory was not found'],
    failed: ['error', 'memory.browser.pin_failed', 'Memory pin failed'],
  },
  browser_unpin: {
    ok: ['info', 'memory.browser.unpin', 'Memory unpin completed'],
    not_found: ['info', 'memory.browser.unpin_not_found', 'Memory was not found'],
    failed: ['error', 'memory.browser.unpin_failed', 'Memory unpin failed'],
  },
  browser_remove: {
    ok: ['info', 'memory.browser.remove', 'Memory removal completed'],
    not_found: ['info', 'memory.browser.remove_not_found', 'Memory was not found'],
    failed: ['error', 'memory.browser.remove_failed', 'Memory removal failed'],
  },
  command_pin: {
    ok: ['info', 'memory.command.pin', 'Command pin completed'],
    blocked: ['warn', 'memory.command.pin_blocked', 'Command pin blocked'],
    not_found: ['info', 'memory.command.pin_not_found', 'Command memory was not found'],
    failed: ['error', 'memory.command.pin_failed', 'Command pin failed'],
  },
  command_unpin: {
    ok: ['info', 'memory.command.unpin', 'Command unpin completed'],
    blocked: ['warn', 'memory.command.unpin_blocked', 'Command unpin blocked'],
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

for (const [operation, past] of [['import', 'imported'], ['export', 'exported'], ['verify', 'verified'], ['repair', 'repaired']]) {
  OUTCOMES[operation] = {
    ok: ['info', `memory.${past}`, `Memory ${operation} completed`],
    failed: ['error', `memory.${operation}_failed`, `Memory ${operation} failed`],
  };
}

export function classifyOutcome(operation, result, { status, thrown = false } = {}) {
  if (!Object.hasOwn(OUTCOMES, operation)) return null;
  if (thrown) status = status === 'blocked' ? 'blocked' : 'failed';
  if (status === undefined) {
    status = ['recall', 'remove'].includes(operation) && result == null ? 'not_found'
      : operation === 'retrieve' && result?.total === 0 ? 'empty'
      : operation === 'verify' && result?.ok === false ? 'failed'
      : operation === 'repair' && result?.verification?.ok === false ? 'failed' : 'ok';
  }
  if (!Object.hasOwn(OUTCOMES[operation], status)) return null;
  const [level, event, message] = OUTCOMES[operation][status];
  const code = !thrown && status === 'failed' && ['verify', 'repair'].includes(operation)
    ? operation === 'verify' ? 'verify_integrity_failed' : 'repair_verification_failed'
    : `${operation}_failed`;
  return { level, event, message, status,
    error: status === 'failed' ? { kind: 'unknown', code, message, retryable: false } : null };
}
