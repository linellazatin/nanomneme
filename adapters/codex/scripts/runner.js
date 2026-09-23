#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { handleRequest } from '../src/runner.js';

try {
  const request = JSON.parse(readFileSync(0, 'utf8'));
  process.stdout.write(`${JSON.stringify({ ok: true, result: handleRequest(request) })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error?.message ?? String(error) })}\n`);
  process.exitCode = 1;
}
