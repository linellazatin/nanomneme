import assert from 'node:assert/strict';
import { access, mkdtemp, writeFile } from 'node:fs/promises';
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
  assert.equal(long.stdout, '0.0.3\n');
  assert.equal(short.stdout, '0.0.3\n');
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
