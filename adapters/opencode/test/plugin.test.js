import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NanomnemePlugin } from '../index.js';
import { runMemory } from '../src/store.js';
import { settingsPath } from '../src/context.js';

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), name));
}

async function fixture() {
  const project = temporaryDirectory('nmnm-opencode-plugin-project-');
  const home = temporaryDirectory('nmnm-opencode-plugin-home-');
  const hooks = await NanomnemePlugin({ directory: project, home, platform: 'darwin' });
  const ctx = { cwd: project, home, platform: 'darwin' };
  return { project, home, ctx, hooks, cleanup() { rmSync(project, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); } };
}

const run = (fn) => async (t) => {
  const f = await fixture();
  t.after(() => f.cleanup());
  return fn(f);
};

const transform = (hooks, output) => hooks['experimental.chat.system.transform']({ sessionID: 's1' }, output);

test('server plugin registers exactly the four nanomneme tools', run(async ({ hooks }) => {
  assert.deepEqual(Object.keys(hooks.tool).sort(), ['recall_memory', 'remove_memory', 'retain_memory', 'retrieve_memory']);
  assert.equal(typeof hooks.tool.retain_memory.execute, 'function');
}));

test('tool schemas expose the expected arguments', run(async ({ hooks }) => {
  assert.ok(hooks.tool.retain_memory.args.content && hooks.tool.retain_memory.args.metadata);
  assert.equal(hooks.tool.retain_memory.args.store, undefined);
  assert.ok(hooks.tool.recall_memory.args.id && hooks.tool.recall_memory.args.store);
  assert.ok(hooks.tool.retrieve_memory.args.query && hooks.tool.retrieve_memory.args.store);
  assert.ok(hooks.tool.remove_memory.args.id && hooks.tool.remove_memory.args.store);
}));

test('retain tool writes to the tool-context project directory and tags source', run(async ({ hooks, ctx }) => {
  const text = await hooks.tool.retain_memory.execute({ content: 'From OpenCode tool', tags: ['opencode'] }, { sessionID: 's1', directory: ctx.cwd });
  const retained = JSON.parse(text);
  assert.equal(retained.metadata.source, 'opencode');
  const stored = runMemory({ ...ctx, store: 'project', operation: 'recall', input: { id: retained.id }, create: false, readOnly: true });
  assert.equal(stored.content, 'From OpenCode tool');
}));

test('recall tool reads a missing project store as null without creating it', run(async ({ hooks }) => {
  const text = await hooks.tool.recall_memory.execute({ id: '00000000-0000-4000-8000-000000000001', store: 'project' }, { sessionID: 's1' });
  assert.equal(JSON.parse(text), null);
}));

test('system transform appends the bounded index to the last system entry', run(async ({ hooks, ctx }) => {
  runMemory({ ...ctx, store: 'project', operation: 'retain', input: { content: 'Injected memory' } });
  const output = { system: ['Base prompt'] };
  await transform(hooks, output);
  assert.equal(output.system.length, 1);
  assert.match(output.system[0], /^Base prompt\n\n# Nanomneme memory/);
  assert.match(output.system[0], /Injected memory/);
}));

test('system transform pushes a new entry when the system array is empty', run(async ({ hooks, ctx }) => {
  runMemory({ ...ctx, store: 'project', operation: 'retain', input: { content: 'Fallback memory' } });
  const output = { system: [] };
  await transform(hooks, output);
  assert.equal(output.system.length, 1);
  assert.match(output.system[0], /Fallback memory/);
}));

test('system transform re-appends on each request so a new memory always surfaces', run(async ({ hooks, ctx }) => {
  runMemory({ ...ctx, store: 'project', operation: 'retain', input: { content: 'Baseline memory' } });
  const first = { system: [] };
  await transform(hooks, first);
  assert.doesNotMatch(first.system[0], /Another memory/);

  await hooks.tool.retain_memory.execute({ content: 'Another memory' }, { sessionID: 's1', directory: ctx.cwd });
  const second = { system: [] };
  await transform(hooks, second);
  assert.match(second.system[0], /Another memory/);
}));

test('an empty memory index injects nothing', run(async ({ hooks }) => {
  const output = { system: ['Base prompt'] };
  await transform(hooks, output);
  assert.deepEqual(output.system, ['Base prompt']);
}));

test('invalid settings omit context without blocking the chat', run(async ({ hooks, ctx }) => {
  mkdirSync(join(ctx.cwd, '.nanomneme'), { recursive: true });
  writeFileSync(settingsPath({ cwd: ctx.cwd, home: ctx.home, platform: 'darwin', store: 'project' }), '{ not valid jsonc }\n');
  const output = { system: [] };
  await transform(hooks, output);
  assert.equal(output.system.length, 0);
}));