import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, runCli } from '../src/cli.js';
import { pinsPath, settingsPath, writePins } from '../src/context.js';
import { runMemory } from '../src/store.js';
import { open } from '@openlines/nmnm-core';

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), name));
}

function fixture() {
  const project = temporaryDirectory('nmnm-opencode-cli-project-');
  const home = temporaryDirectory('nmnm-opencode-cli-home-');
  const globalDir = join(home, 'opencode-data');
  return { project, home, globalDir, ctx: { cwd: project, home, globalDir, platform: 'darwin' } };
}

function cleanup({ project, home }) {
  rmSync(project, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

test('parseArgs recognizes every command and its optional store/paging arguments', () => {
  assert.deepEqual(parseArgs([]), { command: 'status' });
  assert.deepEqual(parseArgs(['status']), { command: 'status' });
  assert.deepEqual(parseArgs(['list']), { command: 'list', store: 'both', limit: 20, offset: 0, source: 'all' });
  assert.deepEqual(parseArgs(['list', 'global', '5', '10']), { command: 'list', store: 'global', limit: 5, offset: 10, source: 'all' });
  assert.deepEqual(parseArgs(['list', '--source', 'opencode']), { command: 'list', store: 'both', limit: 20, offset: 0, source: 'opencode' });
  assert.deepEqual(parseArgs(['search', 'token', 'project', '3']), { command: 'search', query: 'token', store: 'project', limit: 3, offset: 0, source: 'all' });
  assert.deepEqual(parseArgs(['search', 'token', '--source', 'opencode']), { command: 'search', query: 'token', store: 'both', limit: 20, offset: 0, source: 'opencode' });
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
    assert.match(text, /Injection budget:\s+1000 • \d+ • ur: 0/);
    assert.match(text, /Periodic reinjection:\s+every 7 prompts/);
    assert.match(text, /Autoretention:\s+enabled/);
    assert.match(text, /Pins:\s+project: 1 • global: 0/);
    assert.match(text, /Memories:\s+project: 1 • global: 1/);
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

test('list and search filter by OpenCode source', () => {
  const f = fixture();
  try {
    const opencode = runMemory({ cwd: f.project, store: 'project', operation: 'retain', input: { content: 'OpenCode source list memory', metadata: { source: 'opencode' } } });
    const pi = runMemory({ cwd: f.project, store: 'project', operation: 'retain', input: { content: 'Pi source list memory', metadata: { source: 'pi' } } });

    const list = runCli({ argv: ['list', '--source', 'opencode'], ...f.ctx });
    const search = runCli({ argv: ['search', 'source', '--source', 'opencode'], ...f.ctx });

    assert.match(list.text, /source: opencode/);
    assert.match(list.text, new RegExp(opencode.id));
    assert.doesNotMatch(list.text, new RegExp(pi.id));
    assert.match(search.text, new RegExp(opencode.id));
    assert.doesNotMatch(search.text, new RegExp(pi.id));
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

test('remove soft-removes an active memory and identifies explicit CLI or UI purge controls', () => {
  const f = fixture();
  try {
    const memory = runMemory({ cwd: f.project, store: 'project', operation: 'retain', input: { content: 'Remove me' } });

    const removed = runCli({ argv: ['remove', 'project', memory.id], ...f.ctx });
    assert.equal(removed.ok, true);
    assert.match(removed.text, new RegExp(memory.id));
    assert.match(removed.text, /purge requires an explicit CLI or UI workbench action/);

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
    assert.match(status.text, /Memories:\s+project: 0 • global: 0/);
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
    assert.match(text, /Usage: nmnm-opencode/);
  } finally {
    cleanup(f);
  }
});

test('an unqualified id with zero matches reports not found, not ambiguous', () => {
  const f = fixture();
  try {
    const { text, ok } = runCli({ argv: ['show', 'missing-id'], ...f.ctx });
    assert.equal(ok, false);
    assert.match(text, /memory not found: missing-id/);
    assert.doesNotMatch(text, /ambiguous/);
  } finally {
    cleanup(f);
  }
});

test('an unqualified id present in both stores reports ambiguous', () => {
  const f = fixture();
  try {
    const project = runMemory({ cwd: f.project, store: 'project', operation: 'retain', input: { content: 'both stores' } });
    const globalDir = join(f.home, '.local', 'share', 'nanomneme');
    mkdirSync(globalDir, { recursive: true });
    const globalStore = open(join(globalDir, 'memory.db'));
    globalStore.import([{ ...project, scope: 'global' }]); globalStore.close();
    const { text, ok } = runCli({ argv: ['show', project.id], ...f.ctx });
    assert.equal(ok, false);
    assert.match(text, /ambiguous; add project or global/);
  } finally {
    cleanup(f);
  }
});

test('unpin removes inactive targets and resolves missing targets from pins alone', () => {
  const f = fixture();
  try {
    for (const store of ['project', 'global']) {
      for (const state of ['removed', 'expired']) {
        const memory = runMemory({ ...f.ctx, store, operation: 'retain', input: { content: 'Unresolved pin', ...(state === 'expired' ? { expires_at: '2000-01-01T00:00:00.000Z' } : {}) } });
        const path = pinsPath({ ...f.ctx, store });
        writePins(path, [memory.id]);
        if (state === 'removed') runMemory({ ...f.ctx, store, operation: 'remove', input: { id: memory.id } });
        assert.equal(runCli({ ...f.ctx, argv: ['unpin', store, memory.id] }).ok, true);
        assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), []);
      }
    }
    const missing = 'missing-target';
    const projectPath = pinsPath({ ...f.ctx, store: 'project' });
    const globalPath = pinsPath({ ...f.ctx, store: 'global' });
    writePins(projectPath, [missing]); writePins(globalPath, [missing]);
    const ambiguous = runCli({ ...f.ctx, argv: ['unpin', missing] });
    assert.equal(ambiguous.ok, false); assert.match(ambiguous.text, /ambiguous/);
    assert.deepEqual(JSON.parse(readFileSync(projectPath, 'utf8')), [missing]);
    assert.equal(runCli({ ...f.ctx, argv: ['unpin', 'project', missing] }).ok, true);
    assert.equal(runCli({ ...f.ctx, argv: ['unpin', missing] }).ok, true);
    assert.deepEqual(JSON.parse(readFileSync(globalPath, 'utf8')), []);
  } finally { cleanup(f); }
});

test('unpin of an absent pin does not create storage', () => {
  const f = fixture();
  try {
    for (const argv of [['unpin', 'project', 'missing'], ['unpin', 'global', 'missing'], ['unpin', 'missing']]) {
      assert.equal(runCli({ ...f.ctx, argv }).ok, false);
    }
    assert.equal(existsSync(join(f.project, '.nanomneme')), false);
    assert.equal(existsSync(join(f.home, '.local')), false);
  } finally { cleanup(f); }
});


test('unpin cleans a missing-store pin without creating a database', () => {
  const f = fixture();
  try {
    for (const store of ['project', 'global']) {
      const path = pinsPath({ ...f.ctx, store });
      writePins(path, ['orphan']);
      assert.equal(runCli({ ...f.ctx, argv: ['unpin', store, 'orphan'] }).ok, true);
      assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), []);
    }
    assert.equal(existsSync(join(f.project, '.nanomneme', 'memory.db')), false);
    assert.equal(existsSync(join(f.home, '.local', 'share', 'nanomneme', 'memory.db')), false);
  } finally { cleanup(f); }
});
