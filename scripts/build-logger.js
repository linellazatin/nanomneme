#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const entry = fileURLToPath(new URL('../shared/logger/index.js', import.meta.url));
const output = fileURLToPath(new URL('../adapters/pi/src/logger-runtime.generated.js', import.meta.url));
const result = await build({
  entryPoints: [entry],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'none',
  write: false,
});
const generated = result.outputFiles[0].text;
if (process.argv.includes('--check')) {
  let current;
  try { current = readFileSync(output, 'utf8'); } catch { /* missing output is stale */ }
  if (current !== generated) {
    console.error('Pi logger bundle is stale; run node scripts/build-logger.js');
    process.exitCode = 1;
  }
} else {
  writeFileSync(output, generated);
}
