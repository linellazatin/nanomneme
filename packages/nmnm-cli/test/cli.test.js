import assert from 'node:assert/strict';
import { access, mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/nmnm.js', import.meta.url));

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

test('CLI prints readable output without --json and reports invalid input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmnm-cli-'));
  const db = join(directory, 'memory.db');
  const result = run('retain', 'Readable output', '--db', db);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^ID: /m);

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
  assert.equal(JSON.parse(purged.stdout).mode, 'hard');
  const readableTarget = JSON.parse(run('retain', 'Readable purge target', '--db', db, '--json').stdout);
  const purgedReadable = run('remove', readableTarget.id, '--purge', '--db', db);
  assert.match(purgedReadable.stdout, /^Purged: /m);

  const invalid = run('retrieve', '--purge', '--db', db);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /--purge is only valid with remove/);
});
