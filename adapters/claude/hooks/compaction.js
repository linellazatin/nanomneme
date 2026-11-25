#!/usr/bin/env node
import { handleCompactionHook } from '../src/compaction.js';

try {
  const chunks = []; let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 1048576) throw new RangeError('Compaction hook input too large');
    chunks.push(chunk);
  }
  const result = handleCompactionHook(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  if (result.status === 'prepared') process.stdout.write(result.text);
} catch {
  // Never block native compaction or expose its content in errors.
}
