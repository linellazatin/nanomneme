import { buildMemoryIndex } from './context.js';

// Combine the bounded memory index and any autoretention guidance into one
// transient context block. Never a persistent session-message snapshot.
export function renderContext(index) {
  const parts = [];
  if (index.total) parts.push(index.content.trimEnd());
  if (index.autoretention) parts.push(index.autoretention);
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
export function reinjectionContext(env = {}, state = {}) {
  const index = buildMemoryIndex(env);
  const promptCount = (state.prompt_count ?? 0) + 1;
  const nextState = { ...state, prompt_count: promptCount };
  if (!index.reinjection.enabled) return { output: {}, state: nextState };
  if (promptCount % index.reinjection.every_n_prompts !== 0) return { output: {}, state: nextState };
  return {
    output: hookOutput('UserPromptSubmit', renderContext(index)),
    state: { ...nextState, last_injection: promptCount },
  };
}
