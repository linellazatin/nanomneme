#!/usr/bin/env node
// Node bridge worker for the OpenCode adapter. The OpenCode plugin host (both the server
// plugin and the TUI plugin) runs under Bun, which provides no `node:sqlite` (required by
// @openlines/nmnm-core). The plugin therefore spawns a short-lived `node` process per core
// call; this file owns every nmnm-core, SQLite, JSONC, and pin import so the Bun-side plugin
// stays thin. The JSON request is read from stdin and the JSON response written to stdout (the
// core's SQLite experimental warning goes to stderr and never pollutes the result).
import { readFileSync } from 'node:fs';
import { buildMemoryIndex, opencodeGlobalDir, renderContext } from './context.js';
import { handleTool } from './operations.js';
import { browsePage, detail, mutate, statusText } from './browse.js';

function respond(payload) {
  process.stdout.write(JSON.stringify(payload));
}

function withGlobalDir(ctx) {
  if (ctx && typeof ctx.globalDir === 'string') return ctx;
  return { ...ctx, globalDir: opencodeGlobalDir({ home: ctx?.home }) };
}

const request = JSON.parse(readFileSync(0, 'utf8'));
const ctx = withGlobalDir(request.ctx ?? {});

try {
  let result;
  switch (request.op) {
    case 'tool':
      result = { text: handleTool(request.name, request.params ?? {}, ctx).text };
      break;
    case 'index': {
      const index = buildMemoryIndex(ctx);
      result = {
        context: renderContext(index),
        total: index.total,
        unresolved: index.unresolved,
        reinjection: index.reinjection,
      };
      break;
    }
    case 'status':
      result = statusText({ ctx });
      break;
    case 'browse':
      result = browsePage({ ctx, ...request });
      break;
    case 'detail':
      result = detail({ ctx, store: request.store, id: request.id });
      break;
    case 'mutate':
      result = mutate({ ctx, store: request.store, id: request.id, mutation: request.mutation });
      break;
    default:
      throw new Error(`unknown bridge op: ${request.op}`);
  }
  respond({ ok: true, ...result });
} catch (error) {
  respond({ ok: false, error: error?.message ?? String(error) });
}