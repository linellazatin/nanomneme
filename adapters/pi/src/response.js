export const MAX_TOOL_RESULT_BYTES = 50 * 1024;
const PREVIEW_CHARACTERS = 240;
const GUIDANCE = 'Result exceeded the Pi tool-output limit. Narrow retrieval filters/limit or use nmnm CLI for complete inspection.';

function bytes(value) {
  return Buffer.byteLength(value, 'utf8');
}

function preview(value) {
  if (typeof value !== 'string') return undefined;
  const characters = Array.from(value);
  return characters.length > PREVIEW_CHARACTERS
    ? `${characters.slice(0, PREVIEW_CHARACTERS).join('')}...`
    : value;
}

function memorySummary(memory) {
  return Object.fromEntries([
    ['id', preview(memory?.id)],
    ['scope', preview(memory?.scope)],
    ['kind', preview(memory?.kind)],
    ['namespace', preview(memory?.namespace)],
    ['updated_at', preview(memory?.updated_at)],
    ['content_preview', preview(memory?.content)],
  ].filter(([, value]) => value !== undefined));
}

function diagnostics(originalBytes, extra = {}) {
  return {
    truncated: true,
    original_bytes: originalBytes,
    limit_bytes: MAX_TOOL_RESULT_BYTES,
    ...extra,
    guidance: GUIDANCE,
  };
}

function boundedSummary(result, originalBytes) {
  if (result && typeof result === 'object' && Array.isArray(result.items) && Number.isFinite(result.total)) {
    const base = diagnostics(originalBytes, {
      total: result.total,
      returned_items: result.items.length,
      items: result.items.map(memorySummary),
    });
    while (base.items.length && bytes(JSON.stringify(base)) > MAX_TOOL_RESULT_BYTES) base.items.pop();
    return base;
  }
  if (result && typeof result === 'object' && typeof result.id === 'string') {
    return diagnostics(originalBytes, { memory: memorySummary(result) });
  }
  return diagnostics(originalBytes);
}

export function toolResponse(result) {
  const original = JSON.stringify(result);
  const originalBytes = bytes(original);
  if (originalBytes <= MAX_TOOL_RESULT_BYTES) {
    return {
      content: [{ type: 'text', text: original }],
      details: { truncated: false, originalBytes, limitBytes: MAX_TOOL_RESULT_BYTES },
    };
  }

  let summary = JSON.stringify(boundedSummary(result, originalBytes));
  if (bytes(summary) > MAX_TOOL_RESULT_BYTES) summary = JSON.stringify(diagnostics(originalBytes));
  return {
    content: [{ type: 'text', text: summary }],
    details: { truncated: true, originalBytes, limitBytes: MAX_TOOL_RESULT_BYTES },
  };
}
