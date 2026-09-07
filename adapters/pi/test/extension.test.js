import test from 'node:test';
import assert from 'node:assert/strict';
import registerPiAdapter from '../extensions/index.js';

test('registers a session-start hook and the nanomneme 4Rs', () => {
  const handlers = new Map();
  const tools = [];
  const commands = [];
  registerPiAdapter({
    on: (event, handler) => handlers.set(event, handler),
    registerTool: (tool) => tools.push(tool),
    registerCommand: (name, command) => commands.push({ name, command }),
  });

  assert.deepEqual([...handlers.keys()], ['session_start', 'before_agent_start']);
  assert.doesNotThrow(() => handlers.get('session_start')());
  assert.deepEqual(tools.map((tool) => tool.name), ['retain_memory', 'recall_memory', 'retrieve_memory', 'remove_memory']);
  assert.deepEqual(commands.map((command) => command.name), ['memory']);
});
