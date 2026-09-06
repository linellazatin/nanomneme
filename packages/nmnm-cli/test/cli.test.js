import assert from 'node:assert/strict';
import { access, link, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/nmnm.js', import.meta.url));

test('CLI reports its package version without opening a database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-version-'));
  const long = runIn(directory, '--version');
  const short = runIn(directory, '-v');

  assert.equal(long.status, 0, long.stderr);
  assert.equal(short.status, 0, short.stderr);
  assert.equal(long.stdout, '0.0.5\n');
  assert.equal(short.stdout, '0.0.5\n');
  await assert.rejects(access(join(directory, '.nanomneme', 'memory.db')));
});

test('CLI help lists command-specific maintenance options', () => {
  const result = run('--help');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Remove options: --purge/);
  assert.match(result.stdout, /Export options: --out <file>/);
  assert.match(result.stdout, /Repair options: --rebuild-fts/);
});

test('CLI rejects options unsupported by each command without creating a database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-options-'));
  const id = '00000000-0000-4000-8000-000000000000';

  for (const [args, message] of [
    [['retain', 'Memory', '--limit', '1'], /--limit is not valid with retain/],
    [['recall', id, '--tags', 'test'], /--tags is not valid with recall/],
    [['retrieve', '--metadata', '{}'], /--metadata is not valid with retrieve/],
    [['remove', id, '--kind', 'note'], /--kind is not valid with remove/],
    [['verify', '--limit', '1'], /--limit is not valid with verify/],
    [['export', '--limit', '1'], /--limit is not valid with export/],
    [['import', 'missing.jsonl', '--limit', '1'], /--limit is not valid with import/],
    [['repair', '--limit', '1'], /--limit is not valid with repair/],
  ]) {
    const result = runIn(directory, ...args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  }
  await assert.rejects(access(join(directory, '.nanomneme', 'memory.db')));
});

test('CLI validates commands and positional arguments before creating a database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-command-'));

  for (const [args, message] of [
    [['--limit', '1'], /command is required/],
    [['unknown'], /unknown command: unknown/],
    [['recall'], /recall requires an id/],
    [['retrieve', 'one', 'two'], /retrieve accepts one query argument/],
    [['verify', 'unexpected'], /verify does not accept arguments/],
  ]) {
    const result = runIn(directory, ...args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  }
  await assert.rejects(access(join(directory, '.nanomneme', 'memory.db')));
});

test('CLI exports canonical JSONL and imports it atomically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-portable-cli-'));
  const source = join(directory, 'source.db');
  const target = join(directory, 'target.db');
  const first = JSON.parse(run('retain', 'Portable CLI memory', '--db', source, '--tags', 'portable', '--json').stdout);
  const removed = JSON.parse(run('retain', 'Removed portable CLI memory', '--db', source, '--json').stdout);
  run('remove', removed.id, '--db', source);

  const exported = run('export', '--db', source);
  assert.equal(exported.status, 0, exported.stderr);
  const lines = exported.stdout.trimEnd().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(lines[0], { _format: 'nanomneme', _version: 1 });
  assert.equal(lines.length, 3);
  const file = join(directory, 'memory.jsonl');
  await writeFile(file, exported.stdout);

  const imported = run('import', file, '--db', target, '--json');
  assert.equal(imported.status, 0, imported.stderr);
  assert.deepEqual(JSON.parse(imported.stdout), { imported: 2 });
  assert.equal(JSON.parse(run('recall', first.id, '--db', target, '--json').stdout).id, first.id);
  assert.equal(JSON.parse(run('recall', removed.id, '--db', target, '--json').stdout), null);
});

test('CLI validates complete import input before creating the destination', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-cli-import-validation-'));
  const source = join(directory, 'invalid.jsonl');
  const destination = join(directory, 'destination.sqlite');
  const lines = [
    JSON.stringify({ _format: 'nanomneme', _version: 1 }),
    JSON.stringify({
      id: '7b8d1ac8-9a1d-4a73-913f-f7d5486ee090',
      kind: 'invalid',
      scope: 'project',
      namespace: 'default',
      content: 'Invalid memory',
      importance: 0.5,
      confidence: 1,
      tags: [],
      metadata: {},
      created_at: '2026-09-06T00:00:00.000Z',
      updated_at: '2026-09-06T00:00:00.000Z',
      expires_at: null,
      removed_at: null,
    }),
  ];
  await writeFile(source, `${lines.join('\n')}\n`);

  const result = run('import', source, '--db', destination);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /kind/);
  await assert.rejects(access(destination));
});

test('CLI refuses to export over its source database or an alias', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-export-safety-'));
  const source = join(directory, 'memory.db');
  const hardlink = join(directory, 'memory-hardlink.db');
  const symlinkPath = join(directory, 'memory-symlink.db');
  const memory = JSON.parse(run('retain', 'Export safety', '--db', source, '--json').stdout);
  await link(source, hardlink);
  await symlink(source, symlinkPath);

  for (const output of [source, hardlink, symlinkPath]) {
    const exported = run('export', '--db', source, '--out', output);
    assert.notEqual(exported.status, 0);
    assert.match(exported.stderr, /--out cannot reference the source database/);
    const recalled = run('recall', memory.id, '--db', source, '--json');
    assert.equal(recalled.status, 0, recalled.stderr);
    assert.equal(JSON.parse(recalled.stdout).id, memory.id);
  }
});

test('CLI atomically replaces an existing export file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-export-atomic-'));
  const source = join(directory, 'memory.db');
  const output = join(directory, 'memory.jsonl');
  const snapshot = join(directory, 'previous.jsonl');
  run('retain', 'Atomic export target', '--db', source);
  await writeFile(output, 'previous export\n');
  await link(output, snapshot);

  const exported = run('export', '--db', source, '--out', output);

  assert.equal(exported.status, 0, exported.stderr);
  assert.equal(await readFile(snapshot, 'utf8'), 'previous export\n');
  assert.deepEqual(JSON.parse((await readFile(output, 'utf8')).split('\n')[0]), { _format: 'nanomneme', _version: 1 });
  assert.equal((await readdir(directory)).some((name) => name.startsWith('.memory.jsonl.')), false);
});

test('CLI removes temporary files when atomic export replacement fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-export-cleanup-'));
  const source = join(directory, 'memory.db');
  const output = join(directory, 'memory.jsonl');
  run('retain', 'Failed export target', '--db', source);
  await mkdir(output);
  await writeFile(join(output, 'marker'), 'unchanged');

  const exported = run('export', '--db', source, '--out', output);

  assert.notEqual(exported.status, 0);
  assert.equal(await readFile(join(output, 'marker'), 'utf8'), 'unchanged');
  assert.equal((await readdir(directory)).some((name) => name.startsWith('.memory.jsonl.')), false);
});

test('CLI repairs FTS only with the explicit rebuild flag', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-repair-cli-'));
  const db = join(directory, 'memory.db');
  const memory = JSON.parse(run('retain', 'Repair CLI target', '--db', db, '--json').stdout);
  const raw = new DatabaseSync(db);
  const row = raw.prepare('SELECT rowid FROM memories WHERE id = ?').get(memory.id);
  raw.prepare('DELETE FROM memories_fts WHERE rowid = ?').run(row.rowid);
  raw.close();

  const repaired = run('repair', '--rebuild-fts', '--db', db, '--json');
  assert.equal(repaired.status, 0, repaired.stderr);
  assert.deepEqual(JSON.parse(repaired.stdout), {
    mode: 'rebuild-fts',
    rebuilt: 1,
    verification: { ok: true, schema_version: 1, issues: [] },
  });
  const missingFlag = run('repair', '--db', db);
  assert.notEqual(missingFlag.status, 0);
  assert.match(missingFlag.stderr, /--rebuild-fts is required/);
});

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

function runIn(directory, ...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, HOME: directory },
  });
}

test('CLI performs all 4Rs with JSON output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-cli-'));
  const db = join(directory, 'memory.db');
  const retained = run('retain', 'SQLite is embedded.', '--db', db, '--kind', 'decision', '--tags', 'architecture,storage', '--json');
  assert.equal(retained.status, 0, retained.stderr);
  const memory = JSON.parse(retained.stdout);
  assert.equal(memory.kind, 'decision');

  const recalled = run('recall', memory.id, '--db', db, '--json');
  assert.deepEqual(JSON.parse(recalled.stdout), memory);

  const retrieved = run('retrieve', 'SQLite', '--db', db, '--kind', 'decision', '--json');
  assert.equal(JSON.parse(retrieved.stdout).items[0].id, memory.id);

  const removed = run('remove', memory.id, '--db', db, '--json');
  assert.equal(JSON.parse(removed.stdout).id, memory.id);
  assert.equal(JSON.parse(run('recall', memory.id, '--db', db, '--json').stdout), null);
});

test('CLI verifies existing project and global databases', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-verify-cli-'));
  const db = join(directory, 'memory.db');
  const retained = JSON.parse(run('retain', 'Verify CLI target', '--db', db, '--json').stdout);
  const healthy = run('verify', '--db', db, '--json');
  assert.equal(healthy.status, 0, healthy.stderr);
  assert.deepEqual(JSON.parse(healthy.stdout), { ok: true, schema_version: 1, issues: [] });
  const readable = run('verify', '--db', db);
  assert.equal(readable.status, 0, readable.stderr);
  assert.match(readable.stdout, /^OK$/m);
  assert.match(readable.stdout, /^Schema version: 1$/m);

  const raw = new DatabaseSync(db);
  const row = raw.prepare('SELECT rowid FROM memories WHERE id = ?').get(retained.id);
  raw.prepare('DELETE FROM memories_fts WHERE rowid = ?').run(row.rowid);
  raw.close();
  const damaged = run('verify', '--db', db, '--json');
  assert.equal(damaged.status, 1);
  assert.equal(JSON.parse(damaged.stdout).issues[0].code, 'fts_missing');

  const home = await mkdtemp(join(tmpdir(), 'nmnm-verify-home-'));
  runIn(home, 'retain', 'Global verify target', '--global');
  const global = runIn(home, 'verify', '--global', '--json');
  assert.equal(global.status, 0, global.stderr);
  assert.equal(JSON.parse(global.stdout).ok, true);

  const missing = run('verify', '--db', join(directory, 'missing.db'));
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /does not exist/);
  const unexpectedArgument = run('verify', 'unexpected', '--db', db);
  assert.notEqual(unexpectedArgument.status, 0);
  assert.match(unexpectedArgument.stderr, /does not accept arguments/);
});

test('CLI prints readable output without --json and reports invalid input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-cli-'));
  const db = join(directory, 'memory.db');
  const result = run(
    'retain', 'Readable output', '--db', db,
    '--importance', '0.8', '--confidence', '0.9', '--metadata', '{"source":"test"}',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^ID: /m);
  assert.match(result.stdout, /^Importance: 0.8$/m);
  assert.match(result.stdout, /^Confidence: 0.9$/m);
  assert.match(result.stdout, /^Expires: never$/m);
  assert.match(result.stdout, /^Created: \d{4}-\d{2}-\d{2}T/m);
  assert.match(result.stdout, /^Updated: \d{4}-\d{2}-\d{2}T/m);
  assert.match(result.stdout, /^Metadata: {"source":"test"}$/m);

  const invalid = run('retain', '--db', db);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /content/);
  const emptyNumber = run('retain', 'Invalid empty number', '--importance', '', '--db', db);
  assert.notEqual(emptyNumber.status, 0);
  assert.match(emptyNumber.stderr, /importance/);
});

test('CLI can retrieve expired memories explicitly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-cli-'));
  const db = join(directory, 'memory.db');
  const expired = JSON.parse(run('retain', 'Expired', '--db', db, '--expires-at', '2000-01-01T00:00:00.000Z', '--json').stdout);
  const result = run('retrieve', '--db', db, '--expires', 'expired', '--json');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).items[0].id, expired.id);
});

test('CLI persists global memories in the home share directory', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nmnm-home-'));
  const retained = runIn(home, 'retain', 'Global preference', '--global', '--json');
  assert.equal(retained.status, 0, retained.stderr);
  const globalMemory = JSON.parse(retained.stdout);
  assert.equal(globalMemory.scope, 'global');
  await access(join(home, '.local', 'share', 'nanomneme', 'memory.db'));

  const projectScoped = JSON.parse(runIn(home, 'retain', 'Global db project scope', '--global', '--scope', 'project', '--json').stdout);
  assert.equal(projectScoped.scope, 'project');
  const patched = runIn(home, 'retain', 'Patched', '--global', '--id', projectScoped.id, '--json');
  assert.equal(JSON.parse(patched.stdout).scope, 'project');

  assert.equal(JSON.parse(runIn(home, 'recall', globalMemory.id, '--global', '--json').stdout).id, globalMemory.id);
  assert.equal(JSON.parse(runIn(home, 'retrieve', 'Global', '--global', '--json').stdout).items[0].id, globalMemory.id);
  assert.equal(JSON.parse(runIn(home, 'remove', globalMemory.id, '--global', '--json').stdout).id, globalMemory.id);
  assert.equal(JSON.parse(runIn(home, 'recall', globalMemory.id, '--global', '--json').stdout), null);
});

test('CLI keeps project defaults and rejects ambiguous database flags', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-project-'));
  const project = runIn(directory, 'retain', 'Project default', '--json');
  assert.equal(project.status, 0, project.stderr);
  assert.equal(JSON.parse(project.stdout).scope, 'project');
  await access(join(directory, '.nanomneme', 'memory.db'));

  const conflict = runIn(directory, 'retrieve', '--global', '--db', join(directory, 'other.db'));
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /--global cannot be combined with --db/);
});

test('CLI retrieval selects only the requested project, global, or custom database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-store-selection-'));
  const customDb = join(directory, 'custom.db');
  const project = JSON.parse(runIn(directory, 'retain', 'Project isolation', '--json').stdout);
  const global = JSON.parse(runIn(directory, 'retain', 'Global isolation', '--global', '--json').stdout);
  const custom = JSON.parse(runIn(directory, 'retain', 'Custom isolation', '--db', customDb, '--json').stdout);

  const projectResult = JSON.parse(runIn(directory, 'retrieve', 'isolation', '--json').stdout);
  const globalResult = JSON.parse(runIn(directory, 'retrieve', 'isolation', '--global', '--json').stdout);
  const customResult = JSON.parse(runIn(directory, 'retrieve', 'isolation', '--db', customDb, '--json').stdout);

  assert.deepEqual(projectResult.items.map(({ id, store }) => ({ id, store })), [{ id: project.id, store: 'project' }]);
  assert.deepEqual(globalResult.items.map(({ id, store }) => ({ id, store })), [{ id: global.id, store: 'global' }]);
  assert.deepEqual(customResult.items.map(({ id, store }) => ({ id, store })), [{ id: custom.id, store: 'custom' }]);
  assert.equal(runIn(directory, 'retrieve', 'isolation').stdout, `Total: 1\nproject  ${project.id}  note  Project isolation\n`);
  assert.equal(Object.hasOwn(project, 'store'), false);
  assert.equal(Object.hasOwn(JSON.parse(runIn(directory, 'recall', project.id, '--json').stdout), 'store'), false);
});

test('CLI retrieves project then global memories with --both', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-both-'));
  const project = JSON.parse(runIn(directory, 'retain', 'Project combined', '--json').stdout);
  const global = JSON.parse(runIn(directory, 'retain', 'Global combined', '--global', '--json').stdout);

  const result = runIn(directory, 'retrieve', 'combined', '--both', '--json');

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout).items.map(({ id, store }) => ({ id, store })),
    [{ id: project.id, store: 'project' }, { id: global.id, store: 'global' }],
  );
});

test('CLI paginates --both across the project-first result sequence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-both-page-'));
  runIn(directory, 'retain', 'Project first', '--importance', '0.1');
  const projectSecond = JSON.parse(runIn(directory, 'retain', 'Project second', '--importance', '0.2', '--json').stdout);
  const globalFirst = JSON.parse(runIn(directory, 'retain', 'Global first', '--global', '--importance', '0.3', '--json').stdout);
  runIn(directory, 'retain', 'Global second', '--global', '--importance', '0.4');

  const result = runIn(directory, 'retrieve', '--both', '--order-by', 'importance', '--offset', '1', '--limit', '2', '--json');

  assert.equal(result.status, 0, result.stderr);
  const retrieved = JSON.parse(result.stdout);
  assert.equal(retrieved.total, 4);
  assert.deepEqual(
    retrieved.items.map(({ id, store }) => ({ id, store })),
    [{ id: projectSecond.id, store: 'project' }, { id: globalFirst.id, store: 'global' }],
  );
});

test('CLI keeps duplicate IDs from both stores as separate results', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-both-duplicate-'));
  const memory = JSON.parse(runIn(directory, 'retain', 'Duplicated identity', '--json').stdout);
  const exported = runIn(directory, 'export');
  const file = join(directory, 'memory.jsonl');
  await writeFile(file, exported.stdout);
  const imported = runIn(directory, 'import', file, '--global');
  assert.equal(imported.status, 0, imported.stderr);

  const result = runIn(directory, 'retrieve', 'Duplicated', '--both', '--json');

  assert.equal(result.status, 0, result.stderr);
  const retrieved = JSON.parse(result.stdout);
  assert.equal(retrieved.total, 2);
  assert.deepEqual(
    retrieved.items.map(({ id, store }) => ({ id, store })),
    [{ id: memory.id, store: 'project' }, { id: memory.id, store: 'global' }],
  );
});

test('CLI restricts --both to unambiguous retrieval', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-both-flags-'));
  const customDb = join(directory, 'custom.db');

  for (const [args, message] of [
    [['retrieve', '--both', '--global'], /--both cannot be combined with --global or --db/],
    [['retrieve', '--both', '--db', customDb], /--both cannot be combined with --global or --db/],
    [['retain', 'Invalid', '--both'], /--both is only valid with retrieve/],
  ]) {
    const result = runIn(directory, ...args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  }
});

test('CLI treats missing --both databases as empty without creating them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-both-missing-'));

  const result = runIn(directory, 'retrieve', '--both', '--json');

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { items: [], total: 0 });
  await assert.rejects(access(join(directory, '.nanomneme', 'memory.db')));
  await assert.rejects(access(join(directory, '.local', 'share', 'nanomneme', 'memory.db')));
});

test('CLI validates --both selectors when both databases are missing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-both-invalid-'));

  for (const [args, message] of [
    [['--limit', '0'], /limit must be an integer between 1 and 1000/],
    [['--offset', '-1'], /offset must be an integer between 0 and 1000/],
    [['--kind', 'summary'], /kind must be/],
    [['"'], /invalid FTS5 query/],
  ]) {
    const result = runIn(directory, 'retrieve', ...args, '--both');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  }
  await assert.rejects(access(join(directory, '.nanomneme', 'memory.db')));
  await assert.rejects(access(join(directory, '.local', 'share', 'nanomneme', 'memory.db')));
});

test('CLI restores soft removals and purges with an explicit flag', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-remove-'));
  const db = join(directory, 'memory.db');
  const memory = JSON.parse(run('retain', 'Restore target', '--db', db, '--json').stdout);
  const removed = run('remove', memory.id, '--db', db, '--json');
  assert.equal(JSON.parse(removed.stdout).mode, 'soft');

  const restored = run('retain', 'Restored target', '--id', memory.id, '--db', db, '--json');
  assert.equal(JSON.parse(restored.stdout).content, 'Restored target');
  const purged = run('remove', memory.id, '--purge', '--db', db, '--json');
  assert.equal(JSON.parse(purged.stdout).mode, 'purge');
  const readableTarget = JSON.parse(run('retain', 'Readable purge target', '--db', db, '--json').stdout);
  const purgedReadable = run('remove', readableTarget.id, '--purge', '--db', db);
  assert.match(purgedReadable.stdout, /^Purged: /m);
  assert.match(purgedReadable.stdout, /^Mode: purge$/m);
  assert.match(purgedReadable.stdout, /^Purged at: \d{4}-\d{2}-\d{2}T/m);

  const invalid = run('retrieve', '--purge', '--db', db);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /--purge is only valid with remove/);
});
