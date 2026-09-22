import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_TOOL_RESULT_BYTES, toolResponse } from '../src/response.js';

function visibleText(response) {
  return response.content[0].text;
}

test('preserves ordinary model-visible JSON exactly', () => {
  const result = { id: 'abc', content: 'small', metadata: { source: 'pi' } };
  const response = toolResponse(result);
  assert.equal(visibleText(response), JSON.stringify(result));
  assert.deepEqual(response.details, {
    truncated: false,
    originalBytes: Buffer.byteLength(JSON.stringify(result), 'utf8'),
    limitBytes: MAX_TOOL_RESULT_BYTES,
  });
});

test('summarizes an oversized memory as bounded valid JSON', () => {
  const result = {
    id: '00000000-0000-4000-8000-000000000001',
    content: 'x'.repeat(MAX_TOOL_RESULT_BYTES),
    kind: 'fact', scope: 'project', namespace: 'large-memory',
    updated_at: '2026-09-22T00:00:00.000Z',
    metadata: { payload: 'y'.repeat(MAX_TOOL_RESULT_BYTES) },
  };
  const response = toolResponse(result);
  const parsed = JSON.parse(visibleText(response));
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.memory.id, result.id);
  assert.match(parsed.memory.content_preview, /^x+/);
  assert.equal(Object.hasOwn(parsed.memory, 'metadata'), false);
  assert.ok(Buffer.byteLength(visibleText(response), 'utf8') <= MAX_TOOL_RESULT_BYTES);
  assert.equal(Object.hasOwn(response.details, 'result'), false);
});

test('summarizes oversized retrieval pages and preserves totals', () => {
  const items = Array.from({ length: 200 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    content: 'result '.repeat(2000), kind: 'fact', scope: 'project',
    namespace: 'retrieval-page', updated_at: '2026-09-22T00:00:00.000Z', metadata: {},
  }));
  const response = toolResponse({ total: 250, items });
  const parsed = JSON.parse(visibleText(response));
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.total, 250);
  assert.equal(parsed.returned_items, parsed.items.length);
  assert.ok(parsed.items.length > 0);
  assert.ok(parsed.items.length < 200);
  assert.ok(Buffer.byteLength(visibleText(response), 'utf8') <= MAX_TOOL_RESULT_BYTES);
});

test('measures multibyte overflow in UTF-8 bytes', () => {
  const result = { id: 'multibyte', content: '界'.repeat(18_000), metadata: {} };
  assert.ok(JSON.stringify(result).length < MAX_TOOL_RESULT_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_TOOL_RESULT_BYTES);
  const response = toolResponse(result);
  assert.equal(JSON.parse(visibleText(response)).truncated, true);
  assert.ok(Buffer.byteLength(visibleText(response), 'utf8') <= MAX_TOOL_RESULT_BYTES);
});

test('uses a bounded minimal fallback for unknown oversized shapes', () => {
  const response = toolResponse({ payload: 'z'.repeat(MAX_TOOL_RESULT_BYTES * 2) });
  const parsed = JSON.parse(visibleText(response));
  assert.equal(parsed.truncated, true);
  assert.match(parsed.guidance, /narrow|CLI/i);
  assert.ok(Buffer.byteLength(visibleText(response), 'utf8') <= MAX_TOOL_RESULT_BYTES);
});
