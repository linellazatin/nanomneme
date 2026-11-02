#!/usr/bin/env node
try {
  process.env.NMNM_PROJECT_DIR = process.cwd();
  await import('./server.js');
} catch {
  process.stderr.write('Nanomneme MCP launcher failed\n');
  process.exitCode = 1;
}
