import { buildMemoryIndex } from './context.js';

export function sessionStartOutput(context) {
  try {
    const { content } = buildMemoryIndex(context);
    return content ? {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: content,
      },
    } : {};
  } catch {
    return {};
  }
}
