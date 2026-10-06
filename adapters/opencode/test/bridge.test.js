import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBridge, storeContext } from '../src/bridge-client.js';
import { settingsPath } from '../src/context.js';
import { createMemoryLogger } from '../../../shared/logger/index.js';

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), name));
}

// The OpenCode plugin host is Bun (no `node:sqlite`), so every SQLite/core import must stay
// inside the Node-side modules. The bridge client may import the sqlite-free
// `@openlines/nmnm-core/logging` subpath (via src/logslines.js and src/paths.js) for host-side
// spawn-failure diagnostics; jsonc-parser reaches Bun only transitively through that bundle.
// These source guards fail if a Node-only import leaks back into the Bun-loaded entry or its
// bridge client.
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

test('the Node bridge preserves Unicode search and returns validation errors without changing records', () => {
  const project = temporaryDirectory('nmnm-opencode-bridge-hardening-');
  const home = temporaryDirectory('nmnm-opencode-bridge-hardening-home-');
  try {
    const ctx = storeContext({ directory: project, home, platform: 'darwin' });
    const call = (name, params) => runBridge({ op: 'tool', name, params, ctx });
    const result = call('retain_memory', { content: '東京 alpha beta 😀' });
    assert.equal(result.ok, true);
    const retained = JSON.parse(result.text);
    for (const query of ['東京', '東*', 'alpha AND beta', 'NEAR(alpha beta, 0)']) {
      const found = call('retrieve_memory', { query });
      assert.equal(found.ok, true);
      assert.deepEqual(JSON.parse(found.text).items.map(item => item.id), [retained.id]);
    }
    assert.equal(JSON.parse(call('retrieve_memory', { query: '!!!' }).text).total, 0);
    for (const content of ['bad\ud800', 'bad\udc00']) {
      const failed = call('retain_memory', { id: retained.id, content });
      assert.equal(failed.ok, false);
      assert.match(failed.error, /well-formed Unicode/);
    }
    const metadata = call('retain_memory', { id: retained.id, metadata: [] });
    assert.equal(metadata.ok, false);
    assert.match(metadata.error, /metadata must be a JSON object/);
    for (const field of ['importance', 'confidence']) {
      for (const operator of ['constructor', 'toString', '__proto__']) {
        const failed = call('retrieve_memory', { [field]: { [operator]: 0.5 } });
        assert.equal(failed.ok, false);
        assert.match(failed.error, /unsupported operator/);
      }
    }
    assert.deepEqual(JSON.parse(call('recall_memory', { id: retained.id }).text), retained);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('bridge first retains publish private complete project and global stores', { skip: process.platform === 'win32' }, () => {
  const project = temporaryDirectory('nmnm-opencode-bridge-private-');
  const home = temporaryDirectory('nmnm-opencode-bridge-private-home-');
  try {
    const ctx = storeContext({ directory: project, home, platform: 'darwin' });
    for (const scope of ['project', 'global']) {
      const result = runBridge({ op: 'tool', name: 'retain_memory', params: { content: 'Private bridge store', scope }, ctx });
      assert.equal(result.ok, true);
      const directory = scope === 'project' ? join(project, '.nanomneme') : join(home, '.local/share/nanomneme');
      assert.equal(statSync(directory).mode & 0o777, 0o700);
      assert.equal(statSync(join(directory, 'memory.db')).mode & 0o777, 0o600);
      assert.deepEqual(readdirSync(directory), ['memory.db']);
      const record = JSON.parse(result.text);
      const recalled = runBridge({ op: 'tool', name: 'recall_memory', params: { id: record.id, store: scope }, ctx });
      assert.equal(recalled.ok, true);
      assert.deepEqual(JSON.parse(recalled.text), record);
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
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

function recordingLogger(records) {
  return createMemoryLogger({ service: { namespace: 'openlines', name: 'nanomneme', component: 'nmnm-opencode', version: 'test' } }, { resolveEnabled: () => true, sink: r => records.push(r) });
}

test('bridge spawn failures log one verbatim failed outcome for logged operations only', () => {
  const project = temporaryDirectory('nmnm-opencode-spawn-failure-');
  const home = temporaryDirectory('nmnm-opencode-spawn-failure-home-');
  try {
    const ctx = storeContext({ directory: project, home, platform: 'darwin' });
    const records = [];
    const missing = { execPath: join(home, 'missing-node'), logger: recordingLogger(records) };

    const tool = runBridge({ op: 'tool', name: 'retain_memory', params: { content: 'x' }, ctx, diagnostic_context: { session_id: 'host-session-1' } }, missing);
    assert.equal(tool.ok, false);
    assert.match(tool.error, /ENOENT/);
    assert.equal(records.length, 1);
    assert.deepEqual([records[0].operation, records[0].status, records[0].context.session_id], ['retain', 'failed', 'host-session-1']);
    assert.deepEqual(records[0].error, { kind: 'filesystem', code: 'retain_failed', message: tool.error, retryable: false, cause_kind: 'Error' });

    runBridge({ op: 'tool', name: 'remove_memory', params: { id: 'x' }, ctx, diagnostic_context: { session_id: '' } }, missing);
    assert.equal(records.length, 2);
    assert.deepEqual([records[1].operation, records[1].context.session_id], ['remove', null]);

    runBridge({ op: 'mutate', mutation: 'pin', id: 'some-id', store: 'project', ctx }, missing);
    assert.equal(records.length, 3);
    assert.deepEqual([records[2].operation, records[2].status, records[2].context.session_id], ['browser_pin', 'failed', null]);

    for (const request of [
      { op: 'index', ctx },
      { op: 'status', ctx },
      { op: 'browse', ctx },
      { op: 'detail', ctx, id: 'x' },
      { op: 'tool', name: 'unknown_tool', params: {}, ctx },
      { op: 'mutate', mutation: 'unknown', ctx },
    ]) assert.equal(runBridge(request, missing).ok, false);
    assert.equal(records.length, 3);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('bridge spawn failures use the resolved adapter logger when none is injected', () => {
  const home = temporaryDirectory('nmnm-opencode-spawn-default-logger-');
  try {
    const base = join(home, '.local/share/nanomneme');
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'config.jsonc'), '{"logging":{"enabled":true}}');
    const ctx = storeContext({ directory: home, home, platform: 'darwin' });
    const result = runBridge({ op: 'tool', name: 'remove_memory', params: { id: 'x' }, ctx }, { execPath: join(home, 'missing-node') });
    assert.equal(result.ok, false);
    const lines = readFileSync(join(base, 'logs/nmnm-opencode.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(lines.length, 1);
    assert.deepEqual([lines[0].operation, lines[0].status, lines[0].service.component], ['remove', 'failed', 'nmnm-opencode']);
    assert.equal(lines[0].error.message, result.error);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
