import { Type } from 'typebox';
import { registerPiMemory } from '../src/session.js';
import { registerPiTools } from '../src/tools.js';

export default function registerPiAdapter(pi) {
  const memory = registerPiMemory(pi);
  registerPiTools(pi, Type, { onMutation: (reason) => memory.refresh(reason) });
}
