import test from 'node:test';
import assert from 'node:assert/strict';
import { validateToolArguments } from '@earendil-works/pi-ai';
import { Type } from 'typebox';

import { registerPiTools } from '../src/tools.js';

function registeredTools() {
  const tools = new Map();
  registerPiTools({ registerTool: tool => tools.set(tool.name, tool) }, Type);
  return tools;
}

function validate(tool, args) {
  return validateToolArguments(tool, { id: 'host-validation', name: tool.name, arguments: args });
}

test('Pi host validator preserves canonical memory tool arguments', () => {
  const tools = registeredTools();
  const id = '12345678-1234-4234-8234-123456789abc';
  const cases = [
    ['retain_memory', { content: 'A fact' }],
    ['retain_memory', { id }],
    ...['note', 'decision', 'preference', 'fact', 'instruction'].map(kind => ['retain_memory', { content: 'A fact', kind }]),
    ['retain_memory', { content: 'A fact', scope: 'global', namespace: 'my-project', tags: ['sqlite', 'node-22'], importance: 0, confidence: 1, expires_at: '2030-01-01T00:00:00.000Z', metadata: { nested: [null, true, { value: 1 }] } }],
    ['retain_memory', { id, metadata: null, expires_at: null }],
    ['recall_memory', { id, store: 'global' }],
    ['remove_memory', { id, store: 'project' }],
    ['retrieve_memory', { query: 'SQLite', tags: ['sqlite'], limit: 20, offset: 0 }],
    ...['importance', 'confidence'].flatMap(field => [null, 0, 1, { gt: 0, lte: 1 }, { gte: 0.5 }, { lt: 1 }].map(value => ['retrieve_memory', { [field]: value }])),
  ];
  for (const [name, args] of cases) {
    assert.deepEqual(validate(tools.get(name), args), args, `${name}: ${JSON.stringify(args)}`);
  }
});

test('Pi host validator rejects invalid memory tool constraints without executing tools', () => {
  const tools = registeredTools();
  const cases = [
    ...[{ kind: 'rule' }, { scope: 'local' }, { content: '' }, { id: 'made-up' },
      { namespace: 'My Project' }, { tags: ['Uppercase'] }, { tags: ['two_words'] },
      { expires_at: '2030-01-01' }, { expires_at: '2030-01-01T00:00:00Z' }, { metadata: [] },
      ...['importance', 'confidence'].flatMap(field => [-0.01, 1.01].map(value => ({ [field]: value })))
    ].map(args => ['retain_memory', args]),
    ...['importance', 'confidence'].flatMap(field => [{}, { eq: 0.5 }, { gt: -1 }, { lte: 2 }, -1, 2].map(value => ['retrieve_memory', { [field]: value }])),
    ...['recall_memory', 'remove_memory'].map(name => [name, {}]),
    ...['recall_memory', 'retrieve_memory', 'remove_memory'].map(name => [name, { id: 'known-id', store: 'local' }]),
  ];
  for (const [name, args] of cases) {
    assert.throws(() => validate(tools.get(name), args), /Validation failed/, `${name}: ${JSON.stringify(args)}`);
  }
});

test('Pi host validator coerces loose inputs without mutating transcript arguments', () => {
  const tool = registeredTools().get('retain_memory');
  const args = { content: 'A fact', importance: '0.7', confidence: '1', tags: 'sqlite', scope: null };
  const original = structuredClone(args);
  assert.deepEqual(validate(tool, args), { content: 'A fact', importance: 0.7, confidence: 1, tags: ['sqlite'] });
  assert.deepEqual(args, original);
});
