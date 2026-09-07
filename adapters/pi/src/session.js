import { existsSync } from 'node:fs';
import { buildMemoryIndex, pin, piAgentDir, pinsPath, readPins, unpin, writePins } from './context.js';
import { databasePath, runMemory } from './store.js';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const LIST_PREVIEW_LENGTH = 60;

function commandInput(args) {
  return args.trim().split(/\s+/).filter(Boolean);
}

function pinTarget(values) {
  if (values.length === 1) return { store: 'project', id: values[0] };
  if (values.length === 2 && ['project', 'global'].includes(values[0])) return { store: values[0], id: values[1] };
  return null;
}

function removeTarget(values) {
  if (values.length === 1) return { id: values[0] };
  if (values.length === 2 && ['project', 'global'].includes(values[0])) return { store: values[0], id: values[1] };
  return null;
}

function listTarget(values) {
  const remaining = [...values];
  const store = ['project', 'global'].includes(remaining[0]) ? remaining.shift() : 'both';
  if (remaining.length > 2) return null;
  const [limitText, offsetText] = remaining;
  const limit = limitText === undefined ? DEFAULT_LIST_LIMIT : Number(limitText);
  const offset = offsetText === undefined ? 0 : Number(offsetText);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000) return null;
  return { store, limit, offset };
}

function preview(content) {
  const text = content.replace(/\s+/g, ' ').trim();
  return text.length > LIST_PREVIEW_LENGTH ? `${text.slice(0, LIST_PREVIEW_LENGTH)}...` : text;
}

function listMessage(store, result, pins) {
  const rows = result.items.map(({ store: memoryStore, memory }) => `- [${memoryStore}] ${memory.id}${pins[memoryStore].has(memory.id) ? ' *' : ''} ${preview(memory.content)}`);
  return [`Nanomneme [${store}]: showing ${result.items.length} of ${result.total}; * pinned`, ...rows].join('\n');
}

function existingStoreMemory({ cwd, home, platform, store, operation, input }) {
  if (!existsSync(databasePath({ cwd, home, platform, store }))) return null;
  return runMemory({ cwd, home, platform, store, operation, input, create: false, readOnly: operation !== 'remove' });
}

function listedStore({ cwd, home, platform, store, limit, offset }) {
  return existingStoreMemory({ cwd, home, platform, store, operation: 'retrieve', input: { limit, offset } }) ?? { total: 0, items: [] };
}

function listResult({ cwd, home, platform, target }) {
  if (target.store !== 'both') {
    const result = listedStore({ cwd, home, platform, ...target });
    return { store: target.store, total: result.total, items: result.items.map((memory) => ({ store: target.store, memory })) };
  }
  const project = listedStore({ cwd, home, platform, store: 'project', limit: 1, offset: 0 });
  const global = listedStore({ cwd, home, platform, store: 'global', limit: 1, offset: 0 });
  const items = [];
  if (target.offset < project.total) {
    const projectPage = listedStore({ cwd, home, platform, store: 'project', limit: target.limit, offset: target.offset });
    items.push(...projectPage.items.map((memory) => ({ store: 'project', memory })));
    if (items.length < target.limit) {
      const globalPage = listedStore({ cwd, home, platform, store: 'global', limit: target.limit - items.length, offset: 0 });
      items.push(...globalPage.items.map((memory) => ({ store: 'global', memory })));
    }
  } else {
    const globalPage = listedStore({ cwd, home, platform, store: 'global', limit: target.limit, offset: target.offset - project.total });
    items.push(...globalPage.items.map((memory) => ({ store: 'global', memory })));
  }
  return { store: 'both', total: project.total + global.total, items };
}

function notify(ctx, message) {
  ctx.ui.notify(message, 'info');
}

export function registerPiMemory(pi, options = {}) {
  let pending = true;
  const agentDir = options.agentDir ?? piAgentDir({ home: options.home });
  const memoryOptions = { ...options, agentDir };
  const index = (cwd) => buildMemoryIndex({ cwd, ...memoryOptions });

  pi.on('session_start', () => {
    pending = true;
  });
  pi.on('before_agent_start', (_event, ctx) => {
    if (!pending) return undefined;
    pending = false;
    try {
      const memoryIndex = index(ctx.cwd);
      if (!memoryIndex.total) return undefined;
      return {
        message: {
          customType: 'nanomneme-memory-index',
          content: memoryIndex.content,
          display: false,
        },
      };
    } catch (error) {
      notify(ctx, `Nanomneme memory index unavailable: ${error.message}`);
      return undefined;
    }
  });
  pi.registerCommand('memory', {
    description: 'Refresh, list, remove, pin, unpin, or inspect Pi nanomneme memory context.',
    handler: async (args, ctx) => {
      const [action, ...values] = commandInput(args);
      if (action === 'refresh' && values.length === 0) {
        pending = true;
        notify(ctx, 'Nanomneme memory index will refresh on the next prompt.');
        return;
      }
      if (action === 'status' && values.length === 0) {
        const projectPins = readPins(pinsPath({ cwd: ctx.cwd, home: options.home, store: 'project' }));
        const globalPins = readPins(pinsPath({ cwd: ctx.cwd, home: options.home, store: 'global' }));
        const memoryIndex = index(ctx.cwd);
        notify(ctx, `Nanomneme: project pins ${projectPins.length}, global pins ${globalPins.length}, budget ${memoryIndex.budget}, unresolved ${memoryIndex.unresolved}.`);
        return;
      }
      if (action === 'list') {
        const target = listTarget(values);
        if (target) {
          const result = listResult({ cwd: ctx.cwd, home: options.home, platform: options.platform, target });
          const pins = {
            project: new Set(readPins(pinsPath({ cwd: ctx.cwd, home: options.home, store: 'project' }))),
            global: new Set(readPins(pinsPath({ cwd: ctx.cwd, home: options.home, store: 'global' }))),
          };
          notify(ctx, listMessage(result.store, result, pins));
          return;
        }
      }
      if (action === 'remove') {
        const target = removeTarget(values);
        if (target) {
          const matches = target.store
            ? [target.store]
            : ['project', 'global'].filter((store) => existingStoreMemory({
              cwd: ctx.cwd, home: options.home, platform: options.platform, store,
              operation: 'recall', input: { id: target.id },
            }));
          if (matches.length !== 1) {
            notify(ctx, matches.length ? `Nanomneme memory ID is ambiguous; use /memory remove project ${target.id} or /memory remove global ${target.id}.` : `Nanomneme memory not found in project or global stores: ${target.id}.`);
            return;
          }
          const store = matches[0];
          const result = existingStoreMemory({
            cwd: ctx.cwd, home: options.home, platform: options.platform, store,
            operation: 'remove', input: { id: target.id, mode: 'soft' },
          });
          if (result) {
            pending = true;
            notify(ctx, `Nanomneme removed [${store}] ${target.id}. Any matching pin remains configured until /memory unpin.`);
          } else {
            notify(ctx, `Nanomneme memory not found [${store}] ${target.id}.`);
          }
          return;
        }
      }
      if (['pin', 'unpin'].includes(action)) {
        const target = pinTarget(values);
        if (target) {
          if (action === 'pin' && !existingStoreMemory({
            cwd: ctx.cwd, home: options.home, platform: options.platform, store: target.store,
            operation: 'recall', input: { id: target.id },
          })) {
            const globalMemory = target.store === 'project' && values.length === 1 && existingStoreMemory({
              cwd: ctx.cwd, home: options.home, platform: options.platform, store: 'global',
              operation: 'recall', input: { id: target.id },
            });
            notify(ctx, globalMemory
              ? `Nanomneme memory is global; use /memory pin global ${target.id}.`
              : `Nanomneme memory not found [${target.store}] ${target.id}.`);
            return;
          }
          const path = pinsPath({ cwd: ctx.cwd, home: options.home, store: target.store });
          const pins = readPins(path);
          writePins(path, action === 'pin' ? pin(pins, target.id) : unpin(pins, target.id));
          pending = true;
          notify(ctx, `Nanomneme ${action}ned [${target.store}] ${target.id}.`);
          return;
        }
      }
      notify(ctx, 'Usage: /memory refresh | status | list [project|global] [limit] [offset] | remove [project|global] <id> | pin [project|global] <id> | unpin [project|global] <id>');
    },
  });
}
