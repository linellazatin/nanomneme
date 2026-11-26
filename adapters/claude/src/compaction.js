import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { extractSummaryCapture, open, summaryCaptureInstructions } from './core-runtime.generated.js';
import { claudeGlobalDir, readCaptureSettings } from './context.js';
import { getMemoryLogger } from './logslines.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const MAX_AGE = 3600000;

// Only opaque per-event bookkeeping is kept here, never summaries or transcripts.
export function handleCompactionHook(payload, options = {}) {
  let descriptor, lock, temporary;
  try {
    if (!['PreCompact', 'PostCompact'].includes(payload?.hook_event_name) || typeof payload.cwd !== 'string' || !isAbsolute(payload.cwd)) return { status: 'unavailable' };
    const home = options.home ?? homedir(), cwd = realpathSync(payload.cwd);
    const globalDir = options.globalDir ?? claudeGlobalDir({ home, env: options.env ?? process.env });
    const settings = readCaptureSettings({ cwd, home, globalDir });
    if (!settings.enabled) return { status: 'disabled' };
    if (!statSync(cwd).isDirectory() || !['manual', 'auto'].includes(payload.trigger)
      || ![payload.session_id, payload.prompt_id].every(value => typeof value === 'string' && value.trim() && value.length <= 256)) return { status: 'unavailable' };
    const root = options.stateRoot ?? join(tmpdir(), `nmnm-claude-capture-${process.getuid?.() ?? 'user'}`);
    const pre = payload.hook_event_name === 'PreCompact';
    if (!pre && !existsSync(root)) return { status: 'no_pending' };
    if (pre) mkdirSync(root, { recursive: true, mode: 0o700 });
    const directory = lstatSync(root);
    if (!directory.isDirectory() || directory.isSymbolicLink() || (process.getuid && directory.uid !== process.getuid()) || (directory.mode & 0o077)) return { status: 'unavailable' };
    const key = digest([home, globalDir, cwd, payload.session_id, payload.prompt_id, payload.trigger]);
    const path = join(root, `${key}.json`);
    lock = `${path}.lock`; descriptor = openSync(lock, 'wx', 0o600);
    const now = options.now?.() ?? Date.now(), policy = digest(settings);
    const save = state => {
      temporary = join(root, `${key}-${randomUUID()}.tmp`);
      writeFileSync(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, path); temporary = undefined;
    };
    if (pre) {
      const state = { token: randomUUID(), as_of: new Date(now).toISOString(), issued_at: now, policy, consumed: false };
      const text = summaryCaptureInstructions({ ...state, guidance: settings.guidance });
      save(state);
      return { status: 'prepared', text };
    }
    if (!existsSync(path)) return { status: 'no_pending' };
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let state;
    try { if (statSync(path).size > 4096) return { status: 'unavailable' }; state = JSON.parse(readFileSync(fd, 'utf8')); } finally { closeSync(fd); }
    if (state.consumed) return { status: 'already_processed' };
    if (typeof state.issued_at !== 'number' || now < state.issued_at || now - state.issued_at > MAX_AGE || state.policy !== policy) {
      save({ ...state, consumed: true }); return { status: 'stale' };
    }
    // A completion from an older attempt must not consume a newer marker.
    if (typeof payload.compact_summary === 'string' && payload.compact_summary.includes('NMNM_SUMMARY_') && !payload.compact_summary.includes(`NMNM_SUMMARY_${state.token}_BEGIN`)) return { status: 'stale' };
    save({ ...state, consumed: true });
    if (payload.error || (payload.status && payload.status !== 'completed')) return { status: 'skipped' };
    const summary = extractSummaryCapture(payload.compact_summary, state);
    if (!summary) return { status: 'skipped' };
    const logger = options.logger ?? getMemoryLogger({ home, globalDir });
    return logger.run({ operation: 'retain' }, () => {
      const db = open(join(cwd, '.nanomneme/memory.db'));
      try {
        const record = db.retainSummary({ summary, source: 'claude-code', capture_id: state.token });
        return { status: 'saved', id: record.id };
      } finally { db.close(); }
    });
  } catch {
    // Capture failures never block compaction or initiate inference/repair.
    return { status: 'unavailable' };
  } finally {
    if (temporary) { try { rmSync(temporary, { force: true }); } catch {} }
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch {}
      try { rmSync(lock, { force: true }); } catch {}
    }
  }
}
