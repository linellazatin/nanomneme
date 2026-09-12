#!/usr/bin/env node
// Command hook (not an mcp_tool hook): imports nmnm-core directly so it works during
// the SessionStart launch window when MCP servers are not yet connected. Injects the
// bounded memory index and any autoretention guidance as transient additionalContext.
import { readHookInput } from '../src/io.js';
import { sessionStartOutput } from '../src/hooks.js';

try {
  const payload = await readHookInput();
  const output = sessionStartOutput({ cwd: payload.cwd || process.cwd() });
  if (output.hookSpecificOutput) process.stdout.write(JSON.stringify(output));
} catch {
  // Configuration or read failures must never block session startup.
}
