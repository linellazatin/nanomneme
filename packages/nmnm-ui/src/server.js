import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { open } from '@openlines/nmnm-core';

const uiVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const editable = new Set(['content', 'kind', 'namespace', 'tags', 'importance', 'confidence', 'expires_at']);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const source = row => typeof row.metadata.source === 'string' && row.metadata.source.trim() ? row.metadata.source : null;
const state = row => row.removed_at ? 'removed' : row.expires_at && row.expires_at <= new Date().toISOString() ? 'expired' : 'active';
function openReviewStore(path) {
  const reader = open(path, { create: false, readOnly: true });
  try {
    const issues = reader.verify().issues.filter(issue => issue.code.startsWith('schema_') || issue.code === 'sqlite_integrity');
    if (issues.length) fail(400, 'Not a compatible Nanomneme database: ' + issues.map(issue => issue.code + (issue.ids.length ? ' (' + issue.ids.join(', ') + ')' : '')).join('; '));
    return reader;
  } catch (error) { reader.close(); throw error; }
}
const assets = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']], ...['inter-400.woff2', 'inter-500.woff2', 'inter-600.woff2', 'inter-700.woff2'].map(name => ['/assets/' + name, ['assets/' + name, 'font/woff2']]), ...['nanomneme-logo.svg', 'nanomneme-logo-dark-accent.svg'].map(name => ['/assets/' + name, ['assets/' + name, 'image/svg+xml']])]);

async function body(req) {
  if (req.headers['content-type'] !== 'application/json') fail(415, 'JSON required');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) fail(413, 'Request exceeds 1 MiB'); chunks.push(chunk); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Expected an object');
  return value;
}

export async function startServer({ port = 0, cwd = process.cwd() } = {}) {
  const token = randomBytes(32).toString('hex');
  const stores = new Map(); let origin;
  const lookup = id => stores.get(id) ?? fail(404, 'Store is not registered');
  const info = store => ({ id: store.id, path: store.path, label: store.label, editing: !!store.writer });
  const snapshot = ids => ids.flatMap(id => { const store = lookup(id); return store.reader.export().map(row => ({ ...row, store: id, store_path: store.path })); });
  const server = createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) fail(403, 'Local origin required');
      const url = new URL(req.url, origin);
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') fail(405, 'GET required');
        const asset = assets.get(url.pathname); if (!asset) fail(404, 'Not found');
        res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store' });
        const content = readFileSync(new URL('../public/' + asset[0], import.meta.url));
        res.end(asset[0] === 'index.html' ? content.toString('utf8').replace('{{UI_VERSION}}', uiVersion) : content); return;
      }
      if (req.headers['x-nmnm-token'] !== token) fail(401, 'Launch token required');
      const route = url.pathname.slice(5); const params = url.searchParams;
      if (req.method === 'GET' && route === 'browse') {
        const path = realpathSync(resolve(cwd, params.get('path') || cwd));
        if (!statSync(path).isDirectory()) fail(400, 'Select a directory to browse');
        const entries = readdirSync(path, { withFileTypes: true }).flatMap(entry => {
          const entryPath = join(path, entry.name);
          try {
            const stat = entry.isSymbolicLink() ? statSync(entryPath) : entry;
            if (!stat.isDirectory() && !stat.isFile()) return [];
            return [{ name: entry.name, path: entryPath, directory: stat.isDirectory() }];
          } catch { return []; }
        });
        entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
        return send(200, { path, parent: dirname(path), entries, shortcuts: { project: resolve(cwd), home: homedir(), global: ['darwin', 'linux'].includes(platform()) ? join(homedir(), '.local/share/nanomneme') : null } });
      }
      if (req.method === 'GET' && route === 'stores') return send(200, { stores: [...stores.values()].map(info), defaults: { project: resolve(cwd, '.nanomneme/memory.db'), global: ['darwin', 'linux'].includes(platform()) ? join(homedir(), '.local/share/nanomneme/memory.db') : null } });
      if (req.method === 'POST' && route === 'stores') {
        const input = await body(req);
        if (typeof input.path !== 'string' || !input.path.trim()) fail(400, 'Database path required');
        const path = realpathSync(resolve(cwd, input.path));
        const existing = [...stores.values()].find(store => store.path === path); if (existing) return send(200, info(existing));
        const reader = openReviewStore(path);
        const store = { id: randomUUID(), path, label: path, reader, writer: null }; stores.set(store.id, store); return send(200, info(store));
      }
      if (req.method === 'POST' && route === 'editing') {
        const input = await body(req); const store = lookup(input.store);
        if (typeof input.enabled !== 'boolean') fail(400, 'enabled must be boolean');
        if (input.enabled && !store.writer) { const checked = openReviewStore(store.path); checked.close(); store.writer = open(store.path, { create: false }); }
        if (!input.enabled && store.writer) { store.writer.close(); store.writer = null; }
        return send(200, info(store));
      }
      if (req.method === 'GET' && route === 'memories') {
        const ids = [...new Set((params.get('stores') ?? '').split(',').filter(Boolean))];
        const rows = snapshot(ids); const sources = [...new Set(rows.map(source).filter(Boolean))].sort();
        const wantedState = params.get('state') ?? 'active'; if (!['active', 'expired', 'removed'].includes(wantedState)) fail(400, 'Invalid lifecycle state');
        const query = (params.get('query') ?? '').toLowerCase(); const wantedSource = params.get('source');
        const recordedSource = wantedSource?.startsWith('recorded:') ? wantedSource.slice(9) : wantedSource;
        const filtered = rows.filter(row => state(row) === wantedState && row.content.toLowerCase().includes(query) && (!wantedSource || (wantedSource === 'unknown' ? source(row) === null : source(row) === recordedSource)) && ['kind', 'namespace'].every(field => !params.get(field) || row[field] === params.get(field)) && (!params.get('tag') || row.tags.includes(params.get('tag'))));
        filtered.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.store_path.localeCompare(b.store_path) || a.id.localeCompare(b.id));
        const page = Number(params.get('page') ?? 0); if (!Number.isSafeInteger(page) || page < 0) fail(400, 'Invalid page');
        return send(200, { total: filtered.length, sources, items: filtered.slice(page * 50, (page + 1) * 50) });
      }
      if (req.method === 'GET' && route === 'memory') { const row = snapshot([params.get('store')]).find(row => row.id === params.get('id')); if (!row) fail(404, 'Memory no longer exists'); return send(200, row); }
      if (req.method === 'POST' && route === 'mutate') {
        const input = await body(req); const store = lookup(input.store); if (!store.writer) fail(403, 'Enable editing for this store first');
        const current = store.writer.export().find(row => row.id === input.id); if (!current) fail(404, 'Memory no longer exists');
        if (current.updated_at !== input.updated_at) fail(409, 'Memory changed. Refresh and review the newer version before saving.');
        let result;
        if (input.action === 'edit') {
          if (current.removed_at) fail(400, 'Restore before editing');
          const patch = input.patch; if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !editable.has(key))) fail(400, 'Invalid editable fields');
          if (!Object.keys(patch).length) return send(200, current);
          result = store.writer.retain({ ...patch, id: current.id });
        } else if (input.action === 'restore') { if (!current.removed_at) fail(400, 'Memory is not removed'); result = store.writer.retain({ id: current.id }); }
        else if (input.action === 'remove') { if (state(current) !== 'active') fail(400, 'Only active memories support soft removal'); result = store.writer.remove({ id: current.id }); }
        else if (input.action === 'purge') result = store.writer.remove({ id: current.id, mode: 'purge' });
        else fail(400, 'Unknown action');
        return send(200, result);
      }
      fail(404, 'Unknown API route or method');
    } catch (error) { if (!res.headersSent) send(error.status ?? 400, { error: error.message }); else res.end(); }
  });
  server.requestTimeout = 15000;
  await new Promise((resolveReady, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolveReady); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, token, url: `${origin}/#${token}`, close: async () => { server.closeIdleConnections(); await new Promise(resolveClose => server.close(resolveClose)); for (const store of stores.values()) { store.writer?.close(); store.reader.close(); } } };
}
