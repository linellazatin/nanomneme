import { existsSync } from 'node:fs';
import { buildMemoryIndex, pin, piAgentDir, pinsPath, readPins, readSettings, settingsPath, unpin, writePins } from './context.js';
import { databasePath, runMemory } from './store.js';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const LIST_PREVIEW_LENGTH = 60;
const BROWSER_LIMIT = 20;

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

function listedStore({ cwd, home, platform, store, limit, offset, query }) {
  return existingStoreMemory({ cwd, home, platform, store, operation: 'retrieve', input: { query, limit, offset } }) ?? { total: 0, items: [] };
}

function listResult({ cwd, home, platform, target }) {
  if (target.store !== 'both') {
    const result = listedStore({ cwd, home, platform, ...target });
    return { store: target.store, total: result.total, items: result.items.map((memory) => ({ store: target.store, memory })) };
  }
  const project = listedStore({ cwd, home, platform, store: 'project', limit: 1, offset: 0, query: target.query });
  const global = listedStore({ cwd, home, platform, store: 'global', limit: 1, offset: 0, query: target.query });
  const items = [];
  if (target.offset < project.total) {
    const projectPage = listedStore({ cwd, home, platform, store: 'project', limit: target.limit, offset: target.offset, query: target.query });
    items.push(...projectPage.items.map((memory) => ({ store: 'project', memory })));
    if (items.length < target.limit) {
      const globalPage = listedStore({ cwd, home, platform, store: 'global', limit: target.limit - items.length, offset: 0, query: target.query });
      items.push(...globalPage.items.map((memory) => ({ store: 'global', memory })));
    }
  } else {
    const globalPage = listedStore({ cwd, home, platform, store: 'global', limit: target.limit, offset: target.offset - project.total, query: target.query });
    items.push(...globalPage.items.map((memory) => ({ store: 'global', memory })));
  }
  return { store: 'both', total: project.total + global.total, items };
}

function memoryIndexContent(memoryIndex) {
  return [memoryIndex.total ? memoryIndex.content : undefined, memoryIndex.autoretention]
    .filter(Boolean)
    .join('\n\n');
}

function statusLine(label, value) {
  return `${label.padEnd(26)}${value}`;
}

function browserRow({ store, memory }, pinned) {
  return `[${store}]${pinned ? ' *' : ''} ${memory.id} ${preview(memory.content)}`;
}

function browserDetails(store, memory, pinned) {
  return [
    `Nanomneme [${store}] ${memory.id}${pinned ? ' · pinned' : ''}`,
    '',
    memory.content,
    '',
    `Kind       ${memory.kind}`,
    `Scope      ${memory.scope}`,
    `Namespace  ${memory.namespace ?? '(none)'}`,
    `Tags       ${memory.tags.length ? memory.tags.join(', ') : '(none)'}`,
    `Importance ${memory.importance}`,
    `Confidence ${memory.confidence}`,
    `Created    ${memory.created_at}`,
    `Updated    ${memory.updated_at}`,
    `Expires    ${memory.expires_at ?? '(never)'}`,
    `Removed    ${memory.removed_at ?? '(active)'}`,
    `Metadata   ${JSON.stringify(memory.metadata)}`,
  ].join('\n');
}

function browserPins({ cwd, home }) {
  return {
    project: new Set(readPins(pinsPath({ cwd, home, store: 'project' }))),
    global: new Set(readPins(pinsPath({ cwd, home, store: 'global' }))),
  };
}

async function browseMemory({ ctx, home, platform, refresh, showStatus }) {
  if (ctx.hasUI === false) {
    notify(ctx, 'Nanomneme interactive memory browser is unavailable in this mode. Use /memory list, status, pin, unpin, or remove.');
    return;
  }

  showStatus(ctx);
  const target = { store: 'both', limit: BROWSER_LIMIT, offset: 0, query: undefined };
  while (true) {
    const result = listResult({ cwd: ctx.cwd, home, platform, target });
    if (result.items.length === 0 && target.offset > 0) {
      target.offset = Math.max(0, target.offset - target.limit);
      continue;
    }
    const pins = browserPins({ cwd: ctx.cwd, home });
    const rows = result.items.map((item) => ({
      item,
      label: browserRow(item, pins[item.store].has(item.memory.id)),
    }));
    const title = [
      `Nanomneme memories [${target.store}]`,
      `showing ${result.items.length} of ${result.total}`,
      target.query ? `search: ${target.query}` : undefined,
    ].filter(Boolean).join(' · ');
    const actions = [
      'Search',
      `Store: ${target.store}`,
      ...(target.query ? ['Clear search'] : []),
      ...rows.map(({ label }) => label),
      ...(target.offset > 0 ? ['Previous page'] : []),
      ...(target.offset + result.items.length < result.total ? ['Next page'] : []),
      'Close',
    ];
    const choice = await ctx.ui.select(title, actions);
    if (!choice || choice === 'Close') return;

    const selected = rows.find(({ label }) => label === choice)?.item;
    if (selected) {
      const pinned = pins[selected.store].has(selected.memory.id);
      const action = await ctx.ui.select(browserDetails(selected.store, selected.memory, pinned), [pinned ? 'Unpin' : 'Pin', 'Remove', 'Back']);
      if (action && action !== 'Back') {
        await applyBrowserAction({ ctx, home, platform, refresh, selected, pinned, action });
      }
      continue;
    }
    if (choice === 'Search') {
      const query = await ctx.ui.input('Search nanomneme memories', target.query ?? '');
      if (query !== undefined) {
        target.query = query.trim() || undefined;
        target.offset = 0;
      }
      continue;
    }
    if (choice === 'Clear search') {
      target.query = undefined;
      target.offset = 0;
      continue;
    }
    if (choice.startsWith('Store:')) {
      const store = await ctx.ui.select('Nanomneme store', ['Both', 'Project', 'Global']);
      if (store) {
        target.store = store.toLowerCase();
        target.offset = 0;
      }
      continue;
    }
    if (choice === 'Previous page') target.offset = Math.max(0, target.offset - target.limit);
    if (choice === 'Next page') target.offset += target.limit;
  }
}

async function applyBrowserAction({ ctx, home, platform, refresh, selected, pinned, action }) {
  const { store, memory } = selected;
  const active = existingStoreMemory({
    cwd: ctx.cwd,
    home,
    platform,
    store,
    operation: 'recall',
    input: { id: memory.id },
  });
  if (!active) {
    notify(ctx, `Nanomneme memory is no longer active [${store}] ${memory.id}.`);
    return;
  }

  if (action === 'Pin' || action === 'Unpin') {
    const path = pinsPath({ cwd: ctx.cwd, home, store });
    const pins = readPins(path);
    writePins(path, action === 'Pin' ? pin(pins, memory.id) : unpin(pins, memory.id));
    refresh(action.toLowerCase());
    notify(ctx, `Nanomneme ${action.toLowerCase()}ned [${store}] ${memory.id}.`);
    return;
  }

  if (action !== 'Remove') return;
  const confirmed = await ctx.ui.confirm(
    'Remove nanomneme memory?',
    `[${store}] ${memory.id}\n${preview(memory.content)}\n\nThis is reversible soft removal.`,
  );
  if (!confirmed) return;
  const result = existingStoreMemory({
    cwd: ctx.cwd,
    home,
    platform,
    store,
    operation: 'remove',
    input: { id: memory.id, mode: 'soft' },
  });
  if (!result) {
    notify(ctx, `Nanomneme memory is no longer active [${store}] ${memory.id}.`);
    return;
  }
  refresh('remove');
  notify(ctx, pinned
    ? `Nanomneme removed [${store}] ${memory.id}. Its pin remains configured and is now unresolved until unpinned.`
    : `Nanomneme removed [${store}] ${memory.id}.`);
}

function notify(ctx, message) {
  ctx.ui.notify(message, 'info');
}

function validateConfiguration({ cwd, home, agentDir }) {
  for (const store of ['project', 'global']) {
    readSettings(settingsPath({ cwd, home, agentDir, store }));
    readPins(pinsPath({ cwd, home, store }));
  }
}

export function registerPiMemory(pi, options = {}) {
  let pending = true;
  let pendingReason = 'session_start';
  let promptCountSinceInjection = 0;
  let periodicPolicy = { enabled: false, every_n_prompts: 5 };
  let lastInjection;
  let lastError;
  const refresh = (reason) => {
    pending = true;
    pendingReason = reason ?? pendingReason;
  };
  const agentDir = options.agentDir ?? piAgentDir({ home: options.home });
  const memoryOptions = { ...options, agentDir };
  const index = (cwd) => buildMemoryIndex({ cwd, ...memoryOptions });
  const showStatus = (ctx) => {
    let projectPins;
    let globalPins;
    let memoryIndex;
    try {
      projectPins = readPins(pinsPath({ cwd: ctx.cwd, home: options.home, store: 'project' }));
      globalPins = readPins(pinsPath({ cwd: ctx.cwd, home: options.home, store: 'global' }));
      memoryIndex = index(ctx.cwd);
    } catch (error) {
      lastError = { message: error.message, occurredAt: new Date().toISOString() };
    }
    const policy = memoryIndex?.reinjection ?? periodicPolicy;
    const last = lastInjection
      ? `${lastInjection.reason} at ${lastInjection.injectedAt} · ${lastInjection.indexCount} ${lastInjection.indexCount === 1 ? 'entry' : 'entries'} · ${lastInjection.characterCount} characters · autoretention ${lastInjection.autoretentionEnabled ? 'enabled' : 'disabled'}`
      : 'none';
    notify(ctx, [
      'Nanomneme status',
      statusLine('Injection pending', pending ? 'yes' : 'no'),
      statusLine('Periodic reinjection', policy.enabled ? `every ${policy.every_n_prompts} prompts` : 'disabled'),
      statusLine('Prompts since injection', promptCountSinceInjection),
      statusLine('Last', last),
      statusLine('Pins', `project: ${projectPins?.length ?? 'unavailable'} · global: ${globalPins?.length ?? 'unavailable'}`),
      statusLine('Index', `budget: ${memoryIndex?.budget ?? 'unavailable'} · current: ${memoryIndex ? memoryIndexContent(memoryIndex).length : 'unavailable'} · unresolved: ${memoryIndex?.unresolved ?? 'unavailable'}`),
      statusLine('Error', lastError ? `${lastError.message} at ${lastError.occurredAt}` : 'none'),
    ].join('\n'));
  };

  pi.on('session_start', (_event, ctx) => {
    refresh('session_start');
    if (!ctx) return;
    try {
      validateConfiguration({ cwd: ctx.cwd, ...memoryOptions });
    } catch (error) {
      notify(ctx, `Nanomneme configuration unavailable: ${error.message}`);
    }
  });
  pi.on('session_compact', () => refresh('compact'));
  pi.on('before_agent_start', (event, ctx) => {
    if (!pending && periodicPolicy.enabled) {
      promptCountSinceInjection += 1;
      if (promptCountSinceInjection >= periodicPolicy.every_n_prompts) refresh('cadence');
    }
    if (!pending) return undefined;
    try {
      const memoryIndex = index(ctx.cwd);
      periodicPolicy = memoryIndex.reinjection;
      const content = memoryIndexContent(memoryIndex);
      pending = false;
      promptCountSinceInjection = 0;
      lastError = undefined;
      if (!content) return undefined;
      lastInjection = {
        reason: pendingReason,
        injectedAt: new Date().toISOString(),
        characterCount: content.length,
        indexCount: memoryIndex.total,
        unresolvedPins: memoryIndex.unresolved,
        autoretentionEnabled: Boolean(memoryIndex.autoretention),
      };
      return { systemPrompt: `${event.systemPrompt}\n\n${content}` };
    } catch (error) {
      lastError = { message: error.message, occurredAt: new Date().toISOString() };
      notify(ctx, `Nanomneme memory index unavailable: ${error.message}`);
      return undefined;
    }
  });
  pi.registerCommand('memory', {
    description: 'Browse, refresh, list, remove, pin, unpin, or inspect Pi nanomneme memory context.',
    handler: async (args, ctx) => {
      const [action, ...values] = commandInput(args);
      if ((action === undefined || action === 'browse') && values.length === 0) {
        await browseMemory({ ctx, home: options.home, platform: options.platform, refresh, showStatus });
        return;
      }
      if (action === 'refresh' && values.length === 0) {
        refresh('refresh');
        notify(ctx, 'Nanomneme memory index will refresh on the next prompt.');
        return;
      }
      if (action === 'status' && values.length === 0) {
        showStatus(ctx);
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
            refresh('remove');
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
          refresh(action);
          notify(ctx, `Nanomneme ${action}ned [${target.store}] ${target.id}.`);
          return;
        }
      }
      notify(ctx, 'Usage: /memory [browse] | refresh | status | list [project|global] [limit] [offset] | remove [project|global] <id> | pin [project|global] <id> | unpin [project|global] <id>');
    },
  });
  return { refresh };
}
