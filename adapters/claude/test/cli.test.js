import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, runCli } from '../src/cli.js';
import { pinsPath, settingsPath, writePins } from '../src/context.js';
import { runMemory } from '../src/store.js';

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), name));
}

function fixture() {
  const project = temporaryDirectory('nmnm-claude-cli-project-');
  const home = temporaryDirectory('nmnm-claude-cli-home-');
  const globalDir = join(home, 'claude-data');
  return { project, home, globalDir, ctx: { cwd: project, home, globalDir, platform: 'darwin' } };
}

function cleanup({ project, home }) {
  rmSync(project, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

test('parseArgs recognizes every command and its optional store/paging arguments', () => {
  assert.deepEqual(parseArgs([]), { command: 'status' });
  assert.deepEqual(parseArgs(['status']), { command: 'status' });
  assert.deepEqual(parseArgs(['list']), { command: 'list', store: 'both', limit: 20, offset: 0 });
  assert.deepEqual(parseArgs(['list', 'global', '5', '10']), { command: 'list', store: 'global', limit: 5, offset: 10 });
  assert.deepEqual(parseArgs(['search', 'token', 'project', '3']), { command: 'search', query: 'token', store: 'project', limit: 3, offset: 0 });
  assert.deepEqual(parseArgs(['show', 'global', 'abc']), { command: 'show', store: 'global', id: 'abc' });
  assert.deepEqual(parseArgs(['show', 'abc']), { command: 'show', store: undefined, id: 'abc' });
  assert.deepEqual(parseArgs(['pin', 'global', 'abc']), { command: 'pin', store: 'global', id: 'abc' });
  assert.deepEqual(parseArgs(['unpin', 'abc']), { command: 'unpin', store: undefined, id: 'abc' });
  assert.deepEqual(parseArgs(['remove', 'project', 'abc']), { command: 'remove', store: 'project', id: 'abc' });
  assert.ok(parseArgs(['bogus']).error);
  assert.ok(parseArgs(['list', 'nope']).error);
  assert.ok(parseArgs(['list', 'project', '0']).error);
  assert.ok(parseArgs(['search']).error);
  assert.ok(parseArgs(['pin']).error);
});

test('status reports budget, reinjection, autoretention, pins, and per-store totals', () => {
  const f = fixture();
  try {
    const projectMemory = runMemory({ cwd: f.project, store: 'project', operation: 'retain', input: { content: 'Project fact' } });
    runMemory({ cwd: f.project, home: f.home, platform: 'darwin', store: 'global', operation: 'retain', input: { content: 'Global fact' } });
    mkdirSync(join(f.project, '.nanomneme'), { recursive: true });
    mkdirSync(f.globalDir, { recursive: true });
    writeFileSync(settingsPath({ cwd: f.project, globalDir: f.globalDir, store: 'project' }), JSON.stringify({
      injection_budget: 1000,
      reinjection: { enabled: true, every_n_prompts: 7 },
      autoretention: { enabled: true, always_persist: ['A', 'B'], never_persist: ['C'], always_ask: [] },
    }));
    writePins(pinsPath({ cwd: f.project, home: f.home, store: 'project' }), [projectMemory.id]);

    const { text, ok } = runCli({ argv: ['status'], ...f.ctx });

    assert.equal(ok, true);
    assert.match(text, /Nanomneme status/);
    assert.match(text, /Injection budget\s+1000/);
    assert.match(text, /current: \d+/);
    assert.match(text, /Periodic reinjection\s+every 7 prompts/);
    assert.match(text, /Autoretention\s+enabled \(persist 2 · ask 0 · never 1\)/);
    assert.match(text, /Pins\s+project: 1 · global: 0/);
    assert.match(text, /Memories\s+project: 1 · global: 1/);
  } finally {
    cleanup(f);
  }
});

test('list shows project-then-global rows with a pinned marker and total count', () => {
  const f = fixture();
  try {
    const projectMemory = runMemory({ cwd: f.project, store: 'project', operation: 'retain', input: { content: 'Project row' } });
    runMemory({ cwd: f.project, home: f.home, platform: 'darwin', store: 'global', operation: 'retain', input: { content: 'Global row' } });
    writePins(pinsPath({ cwd: f.project, home: f.home, store: 'project' }), [projectMemory.id]);

    const { text } = runCli({ argv: ['list'], ...f.ctx });

    assert.match(text, /showing 2 of 2/);
    assert.match(text, new RegExp(`\\[project\\] ${projectMemory.id} \\*`));
    assert.ok(text.indexOf('Project row') < text.indexOf('Global row'));

    const scoped = runCli({ argv: ['list', 'global'], ...f.ctx });
    assert.match(scoped.text, /showing 1 of 1/);
    assert.doesNotMatch(scoped.text, /Project row/);
  } finally {
    cleanup(f);
  }
});

test('search filters memories with a full-text query', () => {
  const f = fixture();
  try {
    runMemory({ cwd: f.project, store: 'project', operation: 'retain', input: { content: 'alpha lookup target' } });
    runMemory({ cwd: f.project, store: 'project', operation: 'retain', input: { content: 'unrelated beta content' } });

    const { text } = runCli({ argv: ['search', 'alpha'], ...f.ctx });

    assert.match(text, /alpha lookup target/);
    assert.doesNotMatch(text, /unrelated beta content/);
  } finally {
    cleanup(f);
  }
});

test('show prints a full record detail card', () => {
  const f = fixture();
  try {
    const memory = runMemory({ cwd: f.project, store: 'project', operation: 'retain', input: { content: 'Detailed memory', tags: ['x'] } });

    const { text, ok } = runCli({ argv: ['show', 'project', memory.id], ...f.ctx });

    assert.equal(ok, true);
    assert.match(text, new RegExp(`\\[project\\] ${memory.id}`));
    assert.match(text, /Detailed memory/);
    assert.match(text, /Kind\s+/);
    assert.match(text, /Tags\s+x/);
  } finally {
    cleanup(f);
  }
});

test('pin and unpin edit the adapter pin file deterministically', () => {
  const f = fixture();
  try {
    const memory = runMemory({ cwd: f.project, store: 'project', operation: 'retain', input: { content: 'Pin me' } });
    const path = pinsPath({ cwd: f.project, home: f.home, store: 'project' });

    const pinned = runCli({ argv: ['pin', 'project', memory.id], ...f.ctx });
    assert.equal(pinned.ok, true);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), [memory.id]);

    const unpinned = runCli({ argv: ['unpin', 'project', memory.id], ...f.ctx });
    assert.equal(unpinned.ok, true);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), []);
  } finally {
    cleanup(f);
  }
});

test('remove soft-removes an active memory and leaves purge to the CLI operator', () => {
  const f = fixture();
  try {
    const memory = runMemory({ cwd: f.project, store: 'project', operation: 'retain', input: { content: 'Remove me' } });

    const removed = runCli({ argv: ['remove', 'project', memory.id], ...f.ctx });
    assert.equal(removed.ok, true);
    assert.match(removed.text, new RegExp(memory.id));

    const recalled = runMemory({ cwd: f.project, store: 'project', operation: 'recall', input: { id: memory.id }, create: false, readOnly: true });
    assert.equal(recalled, null);
  } finally {
    cleanup(f);
  }
});

test('missing stores render as empty without creating databases', () => {
  const f = fixture();
  try {
    const list = runCli({ argv: ['list'], ...f.ctx });
    const status = runCli({ argv: ['status'], ...f.ctx });

    assert.match(list.text, /showing 0 of 0/);
    assert.match(status.text, /Memories\s+project: 0 · global: 0/);
    assert.equal(existsSync(join(f.project, '.nanomneme', 'memory.db')), false);
    assert.equal(existsSync(join(f.home, '.local', 'share', 'nanomneme', 'memory.db')), false);
  } finally {
    cleanup(f);
  }
});

test('unknown commands return usage text and a non-ok result', () => {
  const f = fixture();
  try {
    const { text, ok } = runCli({ argv: ['bogus'], ...f.ctx });
    assert.equal(ok, false);
    assert.match(text, /Usage: \/nanomneme:memory/);
  } finally {
    cleanup(f);
  }
});
