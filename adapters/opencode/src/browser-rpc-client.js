import { browserRpc } from './browser-rpc.js';

// V2 transport only: never import the local bridge into this client.
export function createBrowserClient(api) {
  const controller = new AbortController();
  const rpc = api.client.rpc(browserRpc);
  function location() {
    const route = api.ui.router.current();
    const value = route.type === 'session'
      ? api.data.session.get(route.sessionID)?.location
      : api.location ?? api.data.location.default();
    if (typeof value?.directory !== 'string' || !value.directory) {
      throw new Error('Nanomneme browser requires a known server location');
    }
    return { ...value };
  }
  return {
    location,
    async call(op, input = {}, expectedLocation) {
      controller.signal.throwIfAborted();
      if (!Object.hasOwn(browserRpc.methods, op)) throw new Error(`Unknown browser operation: ${op}`);
      const current = location();
      if (expectedLocation && (current.directory !== expectedLocation.directory || current.workspaceID !== expectedLocation.workspaceID)) {
        throw new Error('Nanomneme browser location changed; reopen the browser.');
      }
      return rpc[op](input, { location: current, signal: controller.signal });
    },
    dispose() { controller.abort(); },
  };
}
