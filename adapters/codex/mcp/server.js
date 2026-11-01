#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { resolveLaunchContext } from '../src/launch.js';
import { createMemoryServer } from '../src/server.js';

try {
  const context = resolveLaunchContext();
  const handle = serveStdio(() => createMemoryServer(context), {
    onerror: () => process.stderr.write('Nanomneme MCP transport error\n'),
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    void handle.close().catch(() => { process.exitCode = 1; });
  });
} catch {
  process.stderr.write('Nanomneme MCP startup failed: NMNM_PROJECT_DIR must name an absolute existing project directory\n');
  process.exitCode = 1;
}
