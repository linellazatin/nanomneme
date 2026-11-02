import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { codexConfigPath } from './logslines.js';
import { resolveSettings } from './config.js';
import { buildContext } from './context.js';

const output = (event, text) => text ? { hookSpecificOutput: { hookEventName: event, additionalContext: text } } : {};

export function handleHook(payload, options = {}) {
  try {
    if (!['SessionStart', 'UserPromptSubmit', 'SessionEnd'].includes(payload?.hook_event_name)) return {};
    if (typeof payload.cwd !== 'string' || !isAbsolute(payload.cwd) || !statSync(payload.cwd).isDirectory()) return {};
    if (typeof payload.session_id !== 'string' || !payload.session_id.trim() || payload.session_id.length > 256) return {};
    const context = { ...options, cwd: realpathSync(payload.cwd), home: options.home ?? homedir(), env: options.env ?? process.env };
    const event = payload.hook_event_name;
    // Resolve settings before any ephemeral state or memory-store access.
    const settings = event === 'SessionEnd' ? null : resolveSettings(context);
    if (event === 'SessionStart') return output(event, buildContext({ ...context, settings }));
    if (event === 'UserPromptSubmit' && !settings.reinjection.enabled) return {};
    const root = options.stateRoot ?? join(tmpdir(), `nmnm-codex-${process.getuid?.() ?? 'user'}`);
    if (event === 'SessionEnd' && !existsSync(root)) return {};
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const directory = lstatSync(root);
    if (!directory.isDirectory() || directory.isSymbolicLink() || (process.getuid && directory.uid !== process.getuid()) || (directory.mode & 0o077)) return {};
    const key = createHash('sha256').update(JSON.stringify([context.home, codexConfigPath(context), context.cwd, payload.session_id])).digest('hex');
    const path = join(root, `${key}.json`), lock = `${path}.lock`;
    const descriptor = openSync(lock, 'wx', 0o600);
    let temporary;
    try {
      if (event === 'SessionEnd') { rmSync(path, { force: true }); return {}; }
      let previous = {};
      try {
        const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          if (statSync(path).size <= 4096) previous = JSON.parse(readFileSync(fd, 'utf8'));
        } finally { closeSync(fd); }
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      const turn = typeof payload.turn_id === 'string' && payload.turn_id.length <= 256 ? payload.turn_id : null;
      if (turn && previous?.turn_id === turn) return {};
      const count = Number.isSafeInteger(previous?.prompt_count) && previous.prompt_count >= 0 && previous.prompt_count < Number.MAX_SAFE_INTEGER ? previous.prompt_count + 1 : 1;
      temporary = join(root, `${key}-${randomUUID()}.tmp`);
      writeFileSync(temporary, JSON.stringify({ prompt_count: count, turn_id: turn }), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, path);
      if (count % settings.reinjection.every_n_prompts !== 0) return {};
      return output(event, buildContext({ ...context, settings }));
    } finally {
      if (temporary) rmSync(temporary, { force: true });
      closeSync(descriptor);
      rmSync(lock, { force: true });
    }
  } catch {
    // Memory context must never block the host or expose prompts/configuration.
    return {};
  }
}
