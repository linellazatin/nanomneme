import { spawnSync } from 'node:child_process';
import { homedir, platform as hostPlatform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { getMemoryLogger } from './logger.js';

const bridge = fileURLToPath(new URL('./bridge.js', import.meta.url));

// Resolves the Node runtime that must execute the bridge. Under the Bun plugin host
// `process.execPath` is the OpenCode binary (no `node:sqlite`), so the system `node` from
// PATH is required; `NMNM_NODE` overrides it. Under Node (tests, CLI) `process.execPath` is
// already correct.
function resolveNode() {
  if (typeof process.env.NMNM_NODE === 'string' && process.env.NMNM_NODE) return process.env.NMNM_NODE;
  return typeof globalThis.Bun !== 'undefined' ? 'node' : process.execPath;
}

// Resolves the store-routing context shared with nmnm-core. `home`/`platform` fall back to
// the host unless an override is supplied (used to isolate tests). `globalDir` is computed
// inside the Node bridge; the Bun host only passes the portable fields.
export function storeContext({ directory, home, platform } = {}) {
  return {
    cwd: typeof directory === 'string' ? directory : process.cwd(),
    home: typeof home === 'string' ? home : homedir(),
    platform: typeof platform === 'string' ? platform : hostPlatform(),
  };
}

// Runs one core request in a short-lived `node` process and returns the parsed response.
// The OpenCode plugin host is Bun without `node:sqlite`, so every nmnm-core call (tools and
// the bounded index) is delegated here; the Bun module graph imports only the sqlite-free
// `@openlines/nmnm-core/logging` subpath, never the core itself. Returns the response object,
// or `{ ok: false, error }` on any transport or parse failure so callers can fail safe rather
// than throw into the host.
const TOOL_OPERATIONS = { retain_memory: 'retain', recall_memory: 'recall', retrieve_memory: 'retrieve', remove_memory: 'remove' };

// A spawn failure means the bridge process, and with it the Node-side observer, provably never
// ran, so the Bun host records the one failed outcome itself for operations that are logged.
// Later transport failures (non-zero exit, invalid JSON) are ambiguous: the bridge may already
// have recorded the true terminal outcome, so they stay unlogged to avoid contradicting records.
function spawnFailureTarget(request) {
  if (request?.op === 'tool') {
    const operation = TOOL_OPERATIONS[request.name];
    if (!operation) return null;
    const session = request.diagnostic_context?.session_id;
    return { operation, session_id: typeof session === 'string' && session.length ? session : null };
  }
  if (request?.op === 'mutate' && ['pin', 'unpin', 'remove'].includes(request.mutation)) {
    return { operation: `browser_${request.mutation}`, session_id: null };
  }
  return null;
}

function logSpawnFailure(request, error, logger) {
  const target = spawnFailureTarget(request);
  if (!target) return;
  try {
    const resolved = logger ?? getMemoryLogger({ home: request?.ctx?.home, globalDir: request?.ctx?.globalDir });
    resolved.run(target, () => { throw error; });
  } catch { /* A diagnostic failure must not change the transport result. */ }
}

export function runBridge(request, { execPath, logger } = {}) {
  const child = spawnSync(execPath ?? resolveNode(), [bridge], {
    encoding: 'utf8',
    input: JSON.stringify(request),
  });
  if (child.error) {
    logSpawnFailure(request, child.error, logger);
    return { ok: false, error: child.error.message };
  }
  if (child.status !== 0) {
    return { ok: false, error: child.stderr?.trim() || `nanomneme bridge exited with status ${child.status}` };
  }
  try {
    return JSON.parse(child.stdout);
  } catch {
    return { ok: false, error: 'nanomneme bridge returned invalid JSON' };
  }
}