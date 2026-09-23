#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { sessionStartOutput } from '../src/hooks.js';

try {
  const payload = JSON.parse(readFileSync(0, 'utf8'));
  const output = sessionStartOutput({ cwd: payload.cwd || process.cwd() });
  if (output.hookSpecificOutput) process.stdout.write(JSON.stringify(output));
} catch {
  // Session-start context is optional and must never delay or block Codex startup.
}
