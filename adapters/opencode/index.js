import { NanomnemePlugin } from './src/server-v1.js';

export { NanomnemePlugin };

export default {
  id: 'nmnm-opencode',
  server: NanomnemePlugin,
  async setup(api) {
    // V1 1.19 also calls setup, but exposes no V2 session/tool/RPC domains.
    if (!api.session && !api.tool && !api.rpc) return;
    const { registerBrowserRpc } = await import('./src/browser-rpc-server.js');
    return registerBrowserRpc(api);
  },
};
