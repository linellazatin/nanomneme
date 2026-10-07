const $ = id => document.getElementById(id);
let token = location.hash.slice(1);
if (token) { sessionStorage.setItem('nmnm-ui-token', token); history.replaceState(null, '', location.pathname); }
else token = sessionStorage.getItem('nmnm-ui-token');
let stores = [], selected = new Set(), page = 0, total = 0, current = null, dirty = false, busy = false, browserDirectory = null;
const fields = ['content', 'kind', 'namespace', 'tags', 'importance', 'confidence', 'expires_at'];
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function message(text = '', error = false) { $('message').textContent = text; $('message').className = error ? 'error' : ''; }
async function api(route, body) { const response = await fetch('/api/' + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-nmnm-token': token ?? '', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const data = await response.json(); if (!response.ok) { const error = new Error(data.error); error.reported = true; throw error; } return data; }
const reportedErrors = new WeakSet();
function reportClientError(error) {
  if (!token || error?.reported) return;
  if (error && typeof error === 'object') { if (reportedErrors.has(error)) return; reportedErrors.add(error); }
  const text = typeof error?.message === 'string' ? error.message : 'Unexpected browser error';
  fetch('/api/error', { method: 'POST', headers: { 'x-nmnm-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ message: text.slice(0, 600) || 'Unexpected browser error' }) }).catch(() => {});
}
window.addEventListener('error', event => reportClientError(event.error ?? new Error(event.message || 'Browser resource failed to load')), true);
window.addEventListener('unhandledrejection', event => reportClientError(event.reason));
function guard() { return !dirty || confirm('Discard unsaved edits?'); }
function clearDetail() { current = null; dirty = false; $('detail').replaceChildren(node('p', 'Select a memory to inspect its content and origin.', 'placeholder')); document.querySelector('.workbench').classList.remove('detail-open'); }
async function run(task) {
  if (busy) return;
  busy = true; document.querySelector('main').inert = true; document.querySelector('main').setAttribute('aria-busy', 'true');
  $('store-picker').inert = true;
  try { await task(); } catch (error) { message(error.message, true); reportClientError(error); }
  finally { busy = false; document.querySelector('main').inert = false; document.querySelector('main').setAttribute('aria-busy', 'false'); $('store-picker').inert = false; if ($('store-picker').open && !$('store-picker').contains(document.activeElement)) $('directory').focus(); }
}
function renderStores() {
  $('stores-count').textContent = `(${stores.length})`;
  $('store-list').replaceChildren();
  for (const store of stores) {
    const row = node('div', undefined, 'store'); const label = node('label'); const check = node('input'); check.type = 'checkbox'; check.checked = selected.has(store.id); check.setAttribute('aria-label', 'Select ' + store.path);
    check.onchange = () => run(async () => { if (!guard()) { check.checked = !check.checked; return; } if (check.checked) selected.add(store.id); else selected.delete(store.id); page = 0; clearDetail(); await load(); });
    label.append(check, node('span', store.path)); const controls = node('div', undefined, 'store-controls'); controls.append(node('small', store.editing ? 'Editing enabled' : 'Read-only'));
    const button = node('button', store.editing ? 'Disable editing' : 'Enable editing'); button.onclick = () => run(async () => { if (!guard()) return; const updated = await api('editing', { store: store.id, enabled: !store.editing }); Object.assign(store, updated); renderStores(); if (current?.store === store.id) await inspect(current.store, current.id); message(store.editing ? 'Editing enabled for this store for this session.' : 'Store is read-only.'); }); controls.append(button); row.append(label, controls); $('store-list').append(row);
    const remove = node('button', undefined, 'store-remove'); remove.type = 'button'; remove.setAttribute('aria-label', 'Remove store from list: ' + store.path); remove.title = 'Remove from list; database stays on disk';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.5');
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7'); svg.append(path); remove.append(svg);
    remove.onclick = async () => { let unregistered = false; await run(async () => { if (!guard()) return; await api('unregister', { store: store.id }); unregistered = true; stores = stores.filter(item => item.id !== store.id); selected.delete(store.id); page = 0; clearDetail(); renderStores(); await load(); message('Store removed from list. Database remains on disk.'); }); if (unregistered) $('add-store').focus(); }; controls.append(remove);
  }
}
async function add(path) { if (!guard()) return false; const store = await api('stores', { path }); if (!stores.some(item => item.id === store.id)) stores.push(store); selected.add(store.id); renderStores(); page = 0; clearDetail(); await load(); message(store.editing ? 'Existing store selected; editing remains enabled.' : 'Store opened read-only.'); return true; }
async function browse(path) {
  $('picker-message').textContent = 'Loading directory…';
  try {
    const data = await api('browse' + (path ? '?' + new URLSearchParams({ path }) : ''));
    browserDirectory = data.path; $('directory').value = data.path; $('picker-entries').replaceChildren();
    $('picker-up').disabled = data.parent === data.path; $('picker-up').onclick = () => run(() => browse(data.parent));
    for (const name of ['project', 'home', 'global']) { $('picker-' + name).disabled = !data.shortcuts[name]; $('picker-' + name).onclick = () => run(() => browse(data.shortcuts[name])); }
    for (const entry of data.entries) {
      const button = node('button', undefined, 'picker-entry'); button.type = 'button'; button.setAttribute('aria-label', (entry.directory ? 'Open folder ' : 'Select database ') + entry.name);
      button.append(node('span', entry.name), node('small', entry.directory ? 'Folder' : 'File'));
      button.onclick = async () => { await run(async () => { if (entry.directory) await browse(entry.path); else { try { if (await add(entry.path)) $('store-picker').close(); } catch (error) { $('picker-message').textContent = error.message; reportClientError(error); } } }); if (!$('store-picker').open) $('add-store').focus(); };
      $('picker-entries').append(button);
    }
    $('picker-message').textContent = data.entries.length ? 'Choose a folder to open, or a database file to add.' : 'This directory is empty.';
  } catch (error) { $('picker-message').textContent = error.message; reportClientError(error); }
}
async function load() {
  const params = new URLSearchParams({ stores: [...selected].join(','), page, ...Object.fromEntries(['source', 'state', 'query', 'kind', 'namespace', 'tag'].map(id => [id, $(id).value])) });
  const data = await api('memories?' + params); total = data.total;
  const oldSource = $('source').value; $('source').replaceChildren();
  for (const [value, label] of [['', 'All sources'], ['unknown', 'Unknown / unrecorded'], ...data.sources.map(value => ['recorded:' + value, value])]) { const option = node('option', label); option.value = value; $('source').append(option); }
  if (oldSource && ![...$('source').options].some(option => option.value === oldSource)) { const option = node('option', oldSource); option.value = oldSource; $('source').append(option); }
  $('source').value = oldSource;
  $('count').textContent = selected.size ? `${total} ${total === 1 ? 'memory' : 'memories'} · ${selected.size} ${selected.size === 1 ? 'store' : 'stores'}` : 'Select a store to begin.';
  $('rows').replaceChildren();
  $('rows').scrollTop = 0;
  for (const row of data.items) {
    const button = node('button', undefined, 'row'); button.setAttribute('aria-pressed', String(current?.id === row.id && current?.store === row.store));
    button.append(node('span', row.content.length > 220 ? row.content.slice(0, 220) + '…' : row.content, 'preview'), node('span', `${row.kind} · ${typeof row.metadata.source === 'string' && row.metadata.source.trim() ? row.metadata.source : 'unrecorded'} · ${row.updated_at}`, 'meta'), node('span', row.store_path, 'meta'));
    button.onclick = () => run(async () => { if (!guard()) return; await inspect(row.store, row.id); document.querySelectorAll('.row').forEach(el => el.setAttribute('aria-pressed', String(el === button))); }); $('rows').append(button);
  }
  if (!data.items.length) $('rows').append(node('p', selected.size ? 'No memories match this selection.' : 'Add an existing database above, then select it.', 'placeholder'));
  $('prev').disabled = page === 0; $('next').disabled = (page + 1) * 50 >= total; $('page-label').textContent = total ? `Page ${page + 1} of ${Math.ceil(total / 50)}` : '';
}
async function inspect(store, id) {
  const memory = await api(`memory?${new URLSearchParams({ store, id })}`); current = memory; dirty = false;
  const enabled = stores.find(item => item.id === store)?.editing && !memory.removed_at;
  const detail = $('detail'); detail.replaceChildren(); const back = node('button', 'Back to memories', 'back'); back.onclick = () => { if (guard()) clearDetail(); }; detail.append(back, node('h3', 'Memory details'));
  detail.append(node('p', `${memory.store_path}\nSource: ${memory.metadata.source ?? 'unrecorded'} · Scope: ${memory.scope}`, 'detail-origin'));
  const form = node('form', undefined, 'editor'); const controls = {}; const grid = node('div', undefined, 'fields');
  for (const field of fields) {
    const label = node('label', ({ expires_at: 'Expiry (UTC ISO timestamp, blank for none)', tags: 'Tags (comma-separated)' })[field] ?? field[0].toUpperCase() + field.slice(1));
    let control;
    if (field === 'content') control = node('textarea');
    else if (field === 'kind') { control = node('select'); for (const kind of ['note', 'decision', 'preference', 'fact', 'instruction']) control.append(node('option', kind)); }
    else control = node('input');
    if (['importance', 'confidence'].includes(field)) { control.type = 'number'; control.min = '0'; control.max = '1'; control.step = 'any'; }
    control.value = field === 'tags' ? memory.tags.join(', ') : memory[field] ?? ''; control.disabled = !enabled; control.id = 'edit-' + field; control.oninput = () => { dirty = true; }; controls[field] = control; label.append(control);
    if (field === 'content') form.append(label); else { if (!grid.parentNode) form.append(grid); grid.append(label); }
  }
  const save = node('button', 'Save changes', 'primary'); save.disabled = !enabled; form.append(save);
  form.onsubmit = event => { event.preventDefault(); run(async () => { const patch = {}; for (const field of fields) { let value = controls[field].value; if (field === 'tags') value = value.split(',').map(tag => tag.trim()).filter(Boolean); if (['importance', 'confidence'].includes(field)) { if (!value.trim()) throw new Error(field + ' requires a number'); value = Number(value); } if (field === 'expires_at') value = value.trim() || null; if (JSON.stringify(value) !== JSON.stringify(memory[field])) patch[field] = value; } await mutate('edit', patch); }); };
  detail.append(form);
  const note = memory.removed_at ? 'Restore this memory before editing. Restoration preserves its expiry.' : enabled ? 'Stale edits are checked before saving; simultaneous harness writes can still race.' : 'Enable editing for this store to change this memory.'; detail.append(node('p', note, 'note'));
  const actions = node('div', undefined, 'actions');
  const expired = memory.expires_at && memory.expires_at <= new Date().toISOString();
  for (const [action, title] of memory.removed_at ? [['restore', 'Restore'], ['purge', 'Purge permanently']] : [['remove', 'Remove'], ['purge', 'Purge permanently']]) {
    const button = node('button', title, action === 'purge' ? 'danger' : ''); button.disabled = !stores.find(item => item.id === store)?.editing || (action === 'remove' && expired); button.onclick = () => run(async () => { if (!guard()) return; if (confirm(action === 'purge' ? `Permanently purge this memory from ${memory.store_path}? This cannot be undone in this store.` : `${title} this memory in ${memory.store_path}?`)) await mutate(action); }); actions.append(button);
  }
  detail.append(actions); if (expired && !memory.removed_at) detail.append(node('p', 'Expired memories cannot be soft-removed. Renew expiry or explicitly purge.', 'note'));
  const details = node('details'); details.append(node('summary', 'Metadata and timestamps'), node('pre', JSON.stringify({ id: memory.id, metadata: memory.metadata, created_at: memory.created_at, updated_at: memory.updated_at, removed_at: memory.removed_at }, null, 2))); detail.append(details);
  document.querySelector('.workbench').classList.add('detail-open');
}
async function mutate(action, patch) { const memory = current; await api('mutate', { store: memory.store, id: memory.id, updated_at: memory.updated_at, action, patch }); dirty = false; if (action === 'remove' || action === 'purge') clearDetail(); else await inspect(memory.store, memory.id); await load(); message(action === 'edit' ? 'Changes saved.' : `Memory ${action === 'remove' ? 'removed' : action === 'restore' ? 'restored' : 'purged'}.`); }
function theme(value) { document.documentElement.dataset.theme = value; $('theme-sun').toggleAttribute('hidden', value !== 'dark'); $('theme-moon').toggleAttribute('hidden', value !== 'light'); $('theme').setAttribute('aria-label', 'Switch to ' + (value === 'dark' ? 'light' : 'dark') + ' theme'); $('logo').src = '/assets/' + (value === 'dark' ? 'nanomneme-logo.svg' : 'nanomneme-logo-dark-accent.svg'); try { localStorage.setItem('nmnm-ui-theme', value); } catch {} }
let savedTheme = 'dark'; try { savedTheme = localStorage.getItem('nmnm-ui-theme') === 'light' ? 'light' : 'dark'; } catch {} theme(savedTheme);
$('theme').onclick = () => theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
$('stores-toggle').onclick = () => { const collapsed = !$('stores-content').hidden; $('stores-content').hidden = collapsed; $('stores-toggle').setAttribute('aria-expanded', String(!collapsed)); };
$('add-store').onclick = () => { if (busy) return; $('store-picker').showModal(); run(() => browse(browserDirectory)); };
$('picker-close').onclick = () => $('store-picker').close();
$('browse-directory').onsubmit = event => { event.preventDefault(); run(() => browse($('directory').value)); };
$('filters').onsubmit = event => { event.preventDefault(); run(async () => { if (!guard()) return; page = 0; clearDetail(); await load(); }); };
$('refresh').onclick = () => run(async () => { if (!guard()) return; clearDetail(); await load(); message('Refreshed from selected stores.'); });
for (const [id, delta] of [['prev', -1], ['next', 1]]) $(id).onclick = () => run(async () => { if (!guard()) return; page += delta; clearDetail(); await load(); });
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
const chromeObserver = new ResizeObserver(() => { document.documentElement.style.setProperty('--header-height', document.querySelector('header').getBoundingClientRect().height + 'px'); document.documentElement.style.setProperty('--footer-height', document.querySelector('footer').getBoundingClientRect().height + 'px'); });
chromeObserver.observe(document.querySelector('header')); chromeObserver.observe(document.querySelector('footer'));
run(async () => { if (!token) throw new Error('Open the full URL printed by nmnm-ui to authorize this browser tab.'); const data = await api('stores'); stores = data.stores; renderStores(); await load(); });
