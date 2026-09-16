import { storeContext, runBridge } from './src/bridge-client.js';

// OpenCode TUI memory browser: a deterministic, model-free dialog UI mirroring the Pi adapter's
// browser and the openclaude-memory ctrl+alt+m pattern. It is a SEPARATE plugin module from the
// server plugin (index.js): register it in ~/.config/opencode/tui.jsonc, not opencode.json.
//
// Like the server plugin it runs under Bun, which has no `node:sqlite`, so it NEVER touches the
// core, SQLite, JSONC, or pin files directly. Every read and mutation goes through the short-lived
// `node` bridge (src/bridge.js). This module only drives OpenCode's native dialog API
// (api.ui.DialogSelect / DialogAlert) and keymap — no LLM turn is involved.

const TABS = ['status', 'both', 'project', 'global'];
const TAB_LABELS = { status: 'Status', both: 'All', project: 'Project', global: 'Global' };
const SOURCES = ['all', 'opencode'];
const LIMIT = 20;
const PREVIEW = 60;

function preview(content) {
  const text = String(content ?? '').replace(/\s+/g, ' ').trim();
  return text.length > PREVIEW ? `${text.slice(0, PREVIEW)}...` : text;
}

function listTitle(tab, source, offset, result) {
  const store = TABS[tab];
  return [
    TAB_LABELS[store],
    `showing ${offset + 1}-${offset + result.items.length} of ${result.total}`,
    source === 'all' ? undefined : `source: ${source}`,
  ].filter(Boolean).join(' · ');
}

export const nanomnemeTui = async (api) => {
  const cwd = api.state?.path?.directory ?? process.cwd();
  const ctx = storeContext({ directory: cwd });
  const state = { tab: 0, source: 0, offsets: TABS.map(() => 0), last: undefined };

  const call = (op, args) => {
    const result = runBridge({ op, ctx, ...args });
    if (!result.ok) throw new Error(result.error || `${op} failed`);
    return result;
  };

  function toast(message) {
    try {
      api.ui.toast?.({ message, variant: 'info' });
    } catch {
      // Toasts are best-effort; the browser stays usable without them.
    }
  }

  function tabNav() {
    const wrap = (delta) => ({ tab: (state.tab + delta + TABS.length) % TABS.length });
    return [
      { title: `‹ ${TAB_LABELS[TABS[(state.tab - 1 + TABS.length) % TABS.length]]}`, value: { tab: wrap(-1).tab } },
      { title: `${TAB_LABELS[TABS[state.tab]]} (tab ${state.tab + 1}/${TABS.length})`, value: { action: 'noop' } },
      { title: `${TAB_LABELS[TABS[(state.tab + 1) % TABS.length]]} ›`, value: { tab: wrap(1).tab } },
    ];
  }

  function onSelectOption(opt) {
    const value = opt.value ?? {};
    if (typeof value.tab === 'number') {
      state.tab = value.tab;
      state.last = undefined;
      return showTab();
    }
    if (value.record) {
      state.last = opt;
      return showDetail(value.record);
    }
    if (value.action === 'cycle-source') {
      state.source = (state.source + 1) % SOURCES.length;
      state.offsets[state.tab] = 0;
      state.last = undefined;
      return showTab();
    }
    if (value.action === 'page-prev') {
      state.offsets[state.tab] = Math.max(0, state.offsets[state.tab] - LIMIT);
      state.last = undefined;
      return showTab();
    }
    if (value.action === 'page-next') {
      state.offsets[state.tab] += LIMIT;
      state.last = undefined;
      return showTab();
    }
    if (value.action === 'status-refresh') return showStatus();
  }

  function showTab(message) {
    if (message) toast(message);
    if (TABS[state.tab] === 'status') return showStatus();
    const store = TABS[state.tab];
    const source = SOURCES[state.source];
    const offset = state.offsets[state.tab];
    let result;
    try {
      result = call('browse', { store, source, limit: LIMIT, offset });
    } catch (error) {
      return showFatal(error.message);
    }
    const options = [...tabNav(), { title: `Source: ${source}  (cycle)`, value: { action: 'cycle-source' } }];
    if (offset > 0) options.push({ title: 'Previous page', value: { action: 'page-prev' } });
    for (const record of result.items) {
      options.push({ title: `${record.pinned ? '* ' : ''}[${record.store}] ${preview(record.content)}`, description: record.kind, value: { record } });
    }
    if (offset + result.items.length < result.total) options.push({ title: 'Next page', value: { action: 'page-next' } });
    api.ui.dialog.replace(() => api.ui.DialogSelect({
      title: listTitle(state.tab, source, offset, result),
      placeholder: 'Filter by content...',
      options,
      // Restore the highlight by passing the exact option object previously chosen (identity,
      // not a rebuilt copy). If a live session shows OpenCode does not match this, cache the last
      // browse result and reuse its item objects so the reference is stable across renders.
      current: state.last,
      onSelect: onSelectOption,
    }));
  }

  function showStatus() {
    let text;
    try {
      text = call('status').status;
    } catch (error) {
      return showFatal(error.message);
    }
    const [head, ...rest] = String(text).split('\n');
    const options = [
      ...tabNav(),
      { title: 'Refresh', value: { action: 'status-refresh' } },
      ...rest.map((line) => ({ title: line.trim() ? line : ' ', value: { action: 'noop' } })),
    ];
    api.ui.dialog.replace(() => api.ui.DialogSelect({
      title: head || 'Nanomneme status',
      skipFilter: true,
      renderFilter: false,
      options,
      onSelect: onSelectOption,
    }));
  }

  function showDetail(record) {
    api.ui.dialog.replace(() => api.ui.DialogSelect({
      title: `${record.pinned ? '* ' : ''}Nanomneme [${record.store}] ${record.kind}`,
      skipFilter: true,
      renderFilter: false,
      options: [
        { title: 'View detail', description: 'Show memory fields', value: { action: 'view' } },
        { title: record.pinned ? 'Unpin' : 'Pin', value: { action: 'pin', to: !record.pinned } },
        { title: 'Remove (soft)', value: { action: 'remove' } },
        { title: 'Back to list', value: { action: 'back' } },
      ],
      onSelect: (opt) => {
        const value = opt.value ?? {};
        if (value.action === 'view') return showSummary(record);
        if (value.action === 'pin') {
          try {
            const result = call('mutate', { store: record.store, id: record.id, mutation: value.to ? 'pin' : 'unpin' });
            if (result.error) return showTab(result.error);
            toast(value.to ? 'Pinned' : 'Unpinned');
            return showDetail({ ...record, pinned: result.pinned });
          } catch (error) {
            return showTab(error.message);
          }
        }
        if (value.action === 'remove') {
          return api.ui.dialog.replace(() => api.ui.DialogConfirm({
            title: 'Remove memory',
            message: `Soft-remove this memory from the ${record.store} store? The topic record is preserved and any matching pin stays configured.`,
            onConfirm: () => {
              try {
                const result = call('mutate', { store: record.store, id: record.id, mutation: 'remove' });
                if (result.error) return showTab(result.error);
                return showTab('Memory soft-removed');
              } catch (error) {
                return showTab(error.message);
              }
            },
            onCancel: () => showDetail(record),
          }));
        }
        if (value.action === 'back') return showTab();
      },
    }));
  }

  function showSummary(record) {
    api.ui.dialog.replace(() => api.ui.DialogSelect({
      title: `Nanomneme [${record.store}] detail`,
      skipFilter: true,
      renderFilter: false,
      options: [
        { title: `Tags        ${record.tags.length ? record.tags.join(', ') : '(none)'}`, value: { action: 'noop' } },
        { title: `Namespace   ${record.namespace ?? '(none)'}`, value: { action: 'noop' } },
        { title: `Kind        ${record.kind}`, value: { action: 'noop' } },
        { title: `Importance  ${record.importance}`, value: { action: 'noop' } },
        { title: `Updated     ${record.updated_at}`, value: { action: 'noop' } },
        { title: 'Back', description: 'Return to the memory menu', value: { action: 'back-detail' } },
      ],
      onSelect: () => showDetail(record),
    }));
  }

  function showFatal(message) {
    api.ui.dialog.replace(() => api.ui.DialogAlert({
      title: 'Nanomneme browser error',
      message,
      onConfirm: () => showTab(),
    }));
  }

  const disposeLayer = api.keymap.registerLayer({
    commands: [{
      name: 'nmnm-opencode.browser',
      title: 'Nanomneme Memory Browser',
      description: 'Browse and manage the project and global memory stores',
      category: 'Memory',
      run: () => {
        api.ui.dialog.setSize?.('xlarge');
        showTab();
      },
    }],
    bindings: [{ key: 'ctrl+alt+m', cmd: 'nmnm-opencode.browser' }],
  });
  api.lifecycle?.onDispose?.(disposeLayer);
};

export default { id: 'nmnm-opencode-tui', tui: nanomnemeTui };
