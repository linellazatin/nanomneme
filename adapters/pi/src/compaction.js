import { createHash } from 'node:crypto';
import { validateSummary } from '@openlines/nmnm-core';
import { captureAvailability } from './context.js';
import { saveProjectSummary } from './store.js';

function trusted(ctx) {
  try { return ctx?.isProjectTrusted?.() === true; } catch { return false; }
}

// No text queue or session identity: only bounded, in-process completion receipts.
export function createCompactionCapture(options = {}) {
  const seen = new Set();
  return async (event, ctx) => {
    try {
      if (!trusted(ctx)) return { state: 'untrusted' };
      const cwd = ctx.cwd;
      const configuration = () => captureAvailability({ ...options, cwd });
      const initial = configuration();
      if (!initial.enabled) return { state: 'disabled' };
      if (ctx.hasUI !== true || typeof ctx.ui?.editor !== 'function' || typeof ctx.ui?.confirm !== 'function') return { state: 'needs-review' };
      const entry = event?.compactionEntry;
      // An absent trigger is neither persisted nor inferred.
      if (event?.type !== 'session_compact' || event.fromExtension !== false || (event.reason !== undefined && !['manual', 'threshold', 'overflow'].includes(event.reason))
        || entry?.type !== 'compaction' || typeof entry.id !== 'string' || !/^[a-zA-Z0-9-]{1,256}$/.test(entry.id)) return { state: 'invalid' };
      if (typeof entry.summary !== 'string' || Buffer.byteLength(entry.summary) > 8192) return { state: 'invalid' };
      let summary;
      try { summary = validateSummary({ format: 'nanomneme/native-compaction-summary', format_version: 1,
        title: 'Pi compaction checkpoint', as_of: entry.timestamp, text: entry.summary }); }
      catch { return { state: 'invalid' }; }
      const bytes = createHash('sha256').update(JSON.stringify([cwd, entry.id, entry.timestamp])).digest().subarray(0, 16);
      bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
      const hex = bytes.toString('hex');
      const receipt = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      if (seen.has(receipt)) return { state: 'duplicate' };
      seen.add(receipt);
      if (seen.size > 256) seen.delete(seen.values().next().value);
      const unchanged = () => ctx.cwd === cwd && trusted(ctx) && JSON.stringify(configuration()) === JSON.stringify(initial);
      const reviewed = await ctx.ui.editor('Review native checkpoint; submit unchanged to continue, Escape to skip', summary.text);
      if (reviewed !== summary.text) return { state: 'declined' };
      if (!unchanged()) return { state: 'changed' };
      const approved = await ctx.ui.confirm('Save reviewed checkpoint to project memory?', [
        'Save only after reviewing all text. Never save secrets, credentials, private keys, personal data, raw logs or raw tool output. Skip if retention policy cannot be satisfied. Never rules override ask rules; approval applies only to this checkpoint.',
        initial.guidance,
        'This preserves historical unverified text, not current permission. No extra model call is made.',
      ].filter(Boolean).join('\n\n'));
      if (approved !== true) return { state: 'declined' };
      if (!unchanged()) return { state: 'changed' };
      const save = () => saveProjectSummary({ ...options, cwd }, { summary, source: 'pi', capture_id: receipt });
      const record = options.logger ? options.logger.run({ operation: 'retain', session_id: null }, save) : save();
      return { state: record.removed_at || record.expires_at && record.expires_at <= new Date().toISOString() ? 'inactive' : 'saved', id: record.id };
    } catch {
      // Native compaction must succeed independently of review/config/storage failures.
      return { state: 'unavailable' };
    }
  };
}
