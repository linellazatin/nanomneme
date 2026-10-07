#!/usr/bin/env node
// Optional reinjection, disabled by default. When the user enables reinjection in
// nmnm.jsonc, this rebuilds the bounded context every N eligible prompts. Prompt-count
// state is ephemeral (temp dir), never canonical memory.
import { readHookInput } from '../src/io.js';
import { readReinjectionSettings } from '../src/context.js';
import { reinjectionContext } from '../src/hooks.js';
import { readState, statePath, writeState } from '../src/session-state.js';

try {
  const payload = await readHookInput();
  const env = { cwd: payload.cwd || process.cwd() };
  const reinjection = readReinjectionSettings(env);
  if (reinjection.enabled) {
    const path = statePath(payload.session_id);
    const { output, state } = reinjectionContext(env, readState(path), reinjection);
    writeState(path, state);
    if (output.hookSpecificOutput) process.stdout.write(JSON.stringify(output));
  }
} catch {
  // Never block a prompt on memory context.
}
