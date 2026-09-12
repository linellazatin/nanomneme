#!/usr/bin/env node
// Deterministic, model-free memory management entrypoint. Invoke directly with `!` in the
// Claude Code prompt (e.g. `! node adapters/claude/bin/memory.js status`) or through the
// `/nanomneme:memory` slash command, which embeds this via bash execution. It imports
// nmnm-core through the shared helpers; no model, worker, or network is involved.
import { claudeGlobalDir } from '../src/context.js';
import { runCli } from '../src/cli.js';

try {
  const cwd = process.env.NMNM_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const { text, ok } = runCli({ argv: process.argv.slice(2), cwd, globalDir: claudeGlobalDir() });
  process.stdout.write(`${text}\n`);
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  process.stdout.write(`Nanomneme memory command failed: ${error.message}\n`);
  process.exitCode = 1;
}
