import { nanomnemeTui } from './src/tui-v1.js';
export { nanomnemeTui };
export default {
  id: 'nmnm-opencode-tui',
  tui: nanomnemeTui,
  async setup(api) {
    if (!api.client || !api.keymap?.layer) return;
    const { setupTuiV2 } = await import('./src/tui-v2.js');
    return setupTuiV2(api);
  },
};
