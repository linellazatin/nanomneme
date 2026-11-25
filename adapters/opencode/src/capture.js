import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { extractSummaryCapture, open, summaryCaptureInstructions } from '@openlines/nmnm-core';
import { readCaptureSettings } from './context.js';
import { getMemoryLogger } from './logslines.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function captureOperation(op, ctx, request = {}) {
  const settings = readCaptureSettings(ctx);
  if (!settings.enabled) return { status: 'disabled' };
  const directory = realpathSync(ctx.cwd);
  const policy = digest([directory, ctx.home, ctx.globalDir, settings]);
  if (op === 'capture_prepare') {
    const prepared_at = Date.now();
    const capture = { token: randomUUID(), as_of: new Date(prepared_at).toISOString(), prepared_at, policy, directory };
    return { status: 'prepared', capture, instructions: summaryCaptureInstructions({ ...capture, guidance: settings.guidance }) };
  }
  const { capture, text } = request;
  const age = Date.now() - capture?.prepared_at;
  if (!capture || !Number.isSafeInteger(capture.prepared_at) || age < 0 || age > 3600000 || capture.policy !== policy || capture.directory !== directory) return { status: 'stale' };
  let summary;
  try { summary = extractSummaryCapture(text, capture); } catch { /* Invalid preparation never opens a store. */ }
  if (!summary) return { status: 'skipped' };
  return getMemoryLogger(ctx).run({ operation: 'retain' }, () => {
    const db = open(join(directory, '.nanomneme/memory.db'));
    try {
      const record = db.retainSummary({ summary, source: 'opencode', capture_id: capture.token });
      return { status: record.removed_at ? 'already_processed' : 'saved', id: record.id };
    } finally { db.close(); }
  });
}
