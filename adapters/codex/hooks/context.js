#!/usr/bin/env node
try {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 1048576) throw new RangeError('Hook input too large');
    chunks.push(chunk);
  }
  const { handleHook } = await import('../src/hooks.js');
  const result = handleHook(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  if (result.hookSpecificOutput) process.stdout.write(JSON.stringify(result));
} catch {
  // A missing dependency, invalid input or context failure must not block Codex.
}
