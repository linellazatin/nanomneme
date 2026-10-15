import { browserRpc } from './browser-rpc.js';

// V2 transport only: never import the local bridge into this client.
export function createBrowserClient(api) {
  const controller = new AbortController();
  const rpc = api.client.rpc(browserRpc);
  return {
    async call(op, input = {}) {
      controller.signal.throwIfAborted();
      if (!Object.hasOwn(browserRpc.methods, op)) throw new Error(`Unknown browser operation: ${op}`);
      const route = api.ui.router.current();
      const location = route.type === 'session'
        ? api.data.session.get(route.sessionID)?.location
        : api.location ?? api.data.location.default();
      if (typeof location?.directory !== 'string' || !location.directory) {
        throw new Error('Nanomneme browser requires a known server location');
      }
      return rpc[op](input, { location, signal: controller.signal });
    },
    dispose() { controller.abort(); },
  };
}
