import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBridge, storeContext } from '../src/bridge-client.js';
import { settingsPath } from '../src/context.js';

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), name));
}

// The OpenCode plugin host is Bun (no `node:sqlite`), so every SQLite/jsonc/core import must
// stay inside the Node-side modules. These source guards fail if a Node-only import leaks
// back into the Bun-loaded entry or its bridge client.
test('Bun-loaded entry and client never import the core, SQLite, or jsonc', async () => {
  const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const indexSource = await source('index.js');
  const clientSource = await source('src/bridge-client.js');
  const tuiSource = await source('tui.js');
  const forbidden = [
    /from ['"]@openlines\/nmnm-core['"]/,
    /from ['"]node:sqlite['"]/,
    /from ['"]jsonc-parser['"]/,
    /import\(['"]@openlines\/nmnm-core['"]\)/,
    /require\(['"]@openlines\/nmnm-core['"]\)/,
    /from ['"]\.\/(?:src\/)?(?:operations|context|store|cli|browse)\.js['"]/,
  ];
  for (const text of [indexSource, clientSource, tuiSource]) {
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern);
    }
  }
});

test('the Node bridge loads the SQLite core and runs tool operations', () => {
  const project = temporaryDirectory('nmnm-opencode-bridge-project-');
  try {
    const ctx = storeContext({ directory: project, platform: 'darwin' });
    const retained = JSON.parse(runBridge({ op: 'tool', name: 'retain_memory', params: { content: 'Bridge memory' }, ctx }).text);
    assert.equal(retained.metadata.source, 'opencode');
    assert.equal(existsSync(join(project, '.nanomneme', 'memory.db')), true);
    const recalled = JSON.parse(runBridge({ op: 'tool', name: 'recall_memory', params: { id: retained.id, store: 'project' }, ctx }).text);
    assert.equal(recalled.content, 'Bridge memory');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('the Node bridge builds the bounded index and reports reinjection', () => {
  const project = temporaryDirectory('nmnm-opencode-bridge-index-');
  const home = temporaryDirectory('nmnm-opencode-bridge-home-');
  try {
    const ctx = storeContext({ directory: project, home, platform: 'darwin' });
    runBridge({ op: 'tool', name: 'retain_memory', params: { content: 'Indexed via bridge' }, ctx });
    const result = runBridge({ op: 'index', ctx });
    assert.equal(result.ok, true);
    assert.equal(result.total, 1);
    assert.match(result.context, /Indexed via bridge/);
    assert.deepEqual(result.reinjection, { enabled: false, every_n_prompts: 5 });
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('the Node bridge serves the TUI status, browse, and mutate ops', () => {
  const project = temporaryDirectory('nmnm-opencode-bridge-browse-');
  const home = temporaryDirectory('nmnm-opencode-bridge-browse-home-');
  try {
    const ctx = storeContext({ directory: project, home, platform: 'darwin' });
    const retained = JSON.parse(runBridge({ op: 'tool', name: 'retain_memory', params: { content: 'browse via bridge' }, ctx }).text);
    const status = runBridge({ op: 'status', ctx });
    assert.equal(status.ok, true);
    assert.match(status.status, /Nanomneme status/);
    const page = runBridge({ op: 'browse', ctx, store: 'both', source: 'all', limit: 20, offset: 0 });
    assert.equal(page.total, 1);
    assert.equal(page.items[0].id, retained.id);
    assert.equal(page.items[0].pinned, false);
    const pinned = runBridge({ op: 'mutate', ctx, store: 'project', id: retained.id, mutation: 'pin' });
    assert.equal(pinned.pinned, true);
    const browsed = runBridge({ op: 'browse', ctx, store: 'project' });
    assert.equal(browsed.items[0].pinned, true);
    const detail = runBridge({ op: 'detail', ctx, store: 'project', id: retained.id });
    assert.equal(detail.record.id, retained.id);
    const removed = runBridge({ op: 'mutate', ctx, store: 'project', id: retained.id, mutation: 'remove' });
    assert.equal(removed.removed, true);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('the Node bridge fails safe on invalid settings', () => {
  const project = temporaryDirectory('nmnm-opencode-bridge-bad-');
  const home = temporaryDirectory('nmnm-opencode-bridge-home-');
  try {
    mkdirSync(join(project, '.nanomneme'), { recursive: true });
    writeFileSync(settingsPath({ cwd: project, home, platform: 'darwin', store: 'project' }), '{ not jsonc }\n');
    const result = runBridge({ op: 'index', ctx: storeContext({ directory: project, home, platform: 'darwin' }) });
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid JSONC|JSONC/);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});