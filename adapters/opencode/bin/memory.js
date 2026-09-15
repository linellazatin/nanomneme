#!/usr/bin/env node
// Deterministic, model-free memory management entrypoint for the OpenCode adapter. Invoke
// directly (e.g. `nmnm-memory status` after install, or `node adapters/opencode/bin/memory.js
// status`). It imports nmnm-core through the shared helpers; no model, worker, or network is
// involved. NMNM_PROJECT_DIR (or the OpenCode project directory env) selects the project store.
import { opencodeGlobalDir } from '../src/context.js';
import { runCli } from '../src/cli.js';

try {
  const cwd = process.env.NMNM_PROJECT_DIR || process.cwd();
  const { text, ok } = runCli({ argv: process.argv.slice(2), cwd, globalDir: opencodeGlobalDir() });
  process.stdout.write(`${text}\n`);
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  process.stdout.write(`Nanomneme memory command failed: ${error.message}\n`);
  process.exitCode = 1;
}