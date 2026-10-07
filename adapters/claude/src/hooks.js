import { buildMemoryIndex, readReinjectionSettings } from './context.js';

// Combine the bounded memory index and any autoretention guidance into one
// transient context block. Never a persistent session-message snapshot.
export function renderContext(index) {
  const parts = [];
  if (index.autoretention) parts.push(index.autoretention);
  if (index.total) parts.push(index.content.trimEnd());
  return parts.join('\n\n');
}

export function hookOutput(eventName, additionalContext) {
  if (!additionalContext) return {};
  return { hookSpecificOutput: { hookEventName: eventName, additionalContext } };
}

export function sessionStartOutput(env = {}) {
  return hookOutput('SessionStart', renderContext(buildMemoryIndex(env)));
}

// Decide whether to reinject on prompt submit. Disabled by default; when enabled,
// fires every `every_n_prompts` eligible prompts. Returns the hook output plus the
// advanced ephemeral prompt-count state (the caller persists it).
export function reinjectionContext(env = {}, state = {}, reinjection = readReinjectionSettings(env)) {
  if (!reinjection.enabled) return { output: {}, state };
  const previousCount = Number.isSafeInteger(state.prompt_count) && state.prompt_count >= 0 && state.prompt_count < Number.MAX_SAFE_INTEGER ? state.prompt_count : 0;
  const promptCount = previousCount + 1;
  const nextState = { ...state, prompt_count: promptCount };
  if (promptCount % reinjection.every_n_prompts !== 0) return { output: {}, state: nextState };
  try {
    return {
      output: hookOutput('UserPromptSubmit', renderContext(buildMemoryIndex(env))),
      state: { ...nextState, last_injection: promptCount },
    };
  } catch {
    // A failed context build must not block prompts or stall the enabled cadence.
    return { output: {}, state: nextState };
  }
}
