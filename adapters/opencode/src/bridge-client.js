import { spawnSync } from 'node:child_process';
import { homedir, platform as hostPlatform } from 'node:os';
import { fileURLToPath } from 'node:url';

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
// the bounded index) is delegated here; `@openlines/nmnm-core` is never imported by the Bun
// module graph. Returns the response object, or `{ ok: false, error }` on any transport or
// parse failure so callers can fail safe rather than throw into the host.
export function runBridge(request, { execPath } = {}) {
  const child = spawnSync(execPath ?? resolveNode(), [bridge], {
    encoding: 'utf8',
    input: JSON.stringify(request),
  });
  if (child.error) return { ok: false, error: child.error.message };
  if (child.status !== 0) {
    return { ok: false, error: child.stderr?.trim() || `nanomneme bridge exited with status ${child.status}` };
  }
  try {
    return JSON.parse(child.stdout);
  } catch {
    return { ok: false, error: 'nanomneme bridge returned invalid JSON' };
  }
}