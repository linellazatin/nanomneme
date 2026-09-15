#!/usr/bin/env node
// Node bridge worker for the OpenCode adapter. The OpenCode plugin host runs under Bun,
// which provides no `node:sqlite` (required by @openlines/nmnm-core). The plugin therefore
// spawns a short-lived `node` process per core call; this file owns every nmnm-core import
// (tools and the bounded index) so the Bun-side plugin stays thin and never touches SQLite,
// jsonc-parser, or the core directly. The JSON request is read from stdin; the JSON response
// is written to stdout (core's SQLite experimental warning goes to stderr and never pollutes
// the result channel). Invoked as: `node bridge.js` with the request piped on stdin.
import { readFileSync } from 'node:fs';
import { buildMemoryIndex, renderContext } from './context.js';
import { handleTool } from './operations.js';

function respond(payload) {
  process.stdout.write(JSON.stringify(payload));
}

const request = JSON.parse(readFileSync(0, 'utf8'));

try {
  if (request.op === 'tool') {
    const result = handleTool(request.name, request.params ?? {}, request.ctx ?? {});
    respond({ ok: true, text: result.text });
  } else if (request.op === 'index') {
    const index = buildMemoryIndex(request.ctx ?? {});
    respond({
      ok: true,
      context: renderContext(index),
      total: index.total,
      unresolved: index.unresolved,
      reinjection: index.reinjection,
    });
  } else {
    respond({ ok: false, error: `unknown bridge op: ${request.op}` });
  }
} catch (error) {
  respond({ ok: false, error: error?.message ?? String(error) });
}