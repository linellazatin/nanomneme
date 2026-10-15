import { createBrowserClient } from './browser-rpc-client.js';

const TABS = ['status', 'both', 'project', 'global'];
const LABELS = ['Status', 'All', 'Project', 'Global'];
const SOURCES = ['all', 'opencode'];
const LIMIT = 20;
const option = (title, value, description) => ({ title, value, description });
const recordKey = record => `record:${record.store}:${record.id}`;
const preview = content => {
  const text = String(content ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 60)}...` : text;
};

export function setupTuiV2(api) {
  const browser = createBrowserClient(api);
  let disposed = false, running = false, dialogOpen = false;
  const state = { tab: 0, source: 0, offsets: TABS.map(() => 0), selected: undefined };
  const toast = message => {
    try { api.ui.toast.show({ message, variant: 'info' }); } catch { /* Best-effort notification. */ }
  };
  async function dialog(type, options) {
    if (disposed) return;
    dialogOpen = true;
    try { return await api.ui.dialog[type](options); } finally { dialogOpen = false; }
  }
  async function run() {
    if (running || disposed) return;
    running = true;
    try {
      const origin = browser.location();
      const call = async (op, input) => {
        const result = await browser.call(op, input, origin);
        if (!result.ok || result.error) throw new Error(result.error || `${op} failed`);
        const current = browser.location();
        if (origin.directory !== current.directory || origin.workspaceID !== current.workspaceID) {
          throw new Error('Nanomneme browser location changed; reopen the browser.');
        }
        return result;
      };
      api.ui.dialog.set({ size: 'large' });
      let record, summary = false;
      while (!disposed) {
        if (record) {
          const action = await dialog('select', {
            title: summary ? `Nanomneme [${record.store}] detail` : `${record.pinned ? '* ' : ''}Nanomneme [${record.store}] ${record.kind}`,
            options: summary ? [
              option(`Tags        ${record.tags.length ? record.tags.join(', ') : '(none)'}`, 'noop'),
              option(`Namespace   ${record.namespace ?? '(none)'}`, 'noop'),
              option(`Kind        ${record.kind}`, 'noop'),
              option(`Importance  ${record.importance}`, 'noop'),
              option(`Updated     ${record.updated_at}`, 'noop'),
              option('Back', 'back-detail'),
            ] : [option('View detail', 'view', 'Show memory fields'), option(record.pinned ? 'Unpin' : 'Pin', 'pin'), option('Remove (soft)', 'remove'), option('Back to list', 'back')],
          });
          if (disposed || action === undefined) break;
          if (action === 'view') { record = (await call('detail', { store: record.store, id: record.id })).record; summary = true; }
          if (action === 'back-detail') summary = false;
          if (action === 'back') { record = undefined; summary = false; }
          if (action === 'pin') {
            const result = await call('mutate', { store: record.store, id: record.id, mutation: record.pinned ? 'unpin' : 'pin' });
            record = { ...record, pinned: result.pinned };
            toast(record.pinned ? 'Pinned' : 'Unpinned');
          }
          if (action === 'remove') {
            const confirmed = await dialog('confirm', { title: 'Remove memory', message: `Soft-remove this memory from the ${record.store} store? The topic record is preserved and any matching pin stays configured.` });
            if (disposed) break;
            if (confirmed === true) {
              await call('mutate', { store: record.store, id: record.id, mutation: 'remove' });
              toast('Memory soft-removed');
              record = undefined;
            }
          }
          continue;
        }
        const options = [option(`‹ ${LABELS[(state.tab + 3) % 4]}`, `tab:${(state.tab + 3) % 4}`), option(`${LABELS[state.tab]} (tab ${state.tab + 1}/4)`, 'noop'), option(`${LABELS[(state.tab + 1) % 4]} ›`, `tab:${(state.tab + 1) % 4}`)];
        let title, records = [];
        if (state.tab === 0) {
          const [head, ...lines] = String((await call('status')).status).split('\n');
          title = head || 'Nanomneme status';
          options.push(option('Refresh', 'refresh'), ...lines.map(line => option(line || ' ', 'noop')));
        } else {
          const source = SOURCES[state.source], offset = state.offsets[state.tab];
          const result = await call('browse', { store: TABS[state.tab], source, limit: LIMIT, offset });
          records = result.items;
          title = `${LABELS[state.tab]} · showing ${records.length ? offset + 1 : 0}-${offset + records.length} of ${result.total}${source === 'all' ? '' : ` · source: ${source}`}`;
          options.push(option(`Source: ${source}  (cycle)`, 'source'));
          if (offset > 0) options.push(option('Previous page', 'previous'));
          options.push(...records.map(item => option(`${item.pinned ? '* ' : ''}[${item.store}] ${preview(item.content)}`, recordKey(item), item.kind)));
          if (offset + records.length < result.total) options.push(option('Next page', 'next'));
        }
        const selected = await dialog('select', { title, placeholder: 'Filter by content...', options, current: state.selected });
        if (disposed || selected === undefined) break;
        if (selected.startsWith('tab:')) { state.tab = Number(selected.slice(4)); state.selected = undefined; }
        if (selected === 'source') { state.source = (state.source + 1) % SOURCES.length; state.offsets[state.tab] = 0; state.selected = undefined; }
        if (selected === 'previous' || selected === 'next') { state.offsets[state.tab] = Math.max(0, state.offsets[state.tab] + (selected === 'next' ? LIMIT : -LIMIT)); state.selected = undefined; }
        if (selected.startsWith('record:')) { record = records.find(item => recordKey(item) === selected); state.selected = selected; }
      }
    } catch (error) {
      if (!disposed) await dialog('alert', { title: 'Nanomneme browser error', message: error.message });
    } finally { running = false; }
  }
  try {
    api.keymap.layer(() => ({ mode: 'global', commands: [{ id: 'nmnm-opencode.browser', title: 'Nanomneme Memory Browser', description: 'Browse and manage the project and global memory stores', group: 'Memory', bind: 'ctrl+alt+m', palette: true, run }], bindings: ['nmnm-opencode.browser'] }));
  } catch (error) { browser.dispose(); throw error; }
  return () => {
    disposed = true;
    browser.dispose();
    if (dialogOpen) api.ui.dialog.clear();
  };
}
