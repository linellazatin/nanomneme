import { browserRpc } from './browser-rpc.js';

// V2 transport only: never import the local bridge into this client.
export function createBrowserClient(api) {
  const controller = new AbortController();
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
      for (let attempt = 0; ; attempt++) {
        controller.signal.throwIfAborted();
        const active = location();
        if (active.directory !== current.directory || active.workspaceID !== current.workspaceID) {
          throw new Error('Nanomneme browser location changed; reopen the browser.');
        }
        try {
          return await api.client.rpc(browserRpc)[op](input, { location: current, signal: controller.signal });
        } catch (error) {
          // Only reads are safe to replay while a location's plugins load.
          if (op === 'mutate' || error?.type !== 'rpc.unavailable' || attempt >= 49) throw error;
          await new Promise((resolve, reject) => {
            const signal = controller.signal;
            signal.throwIfAborted();
            const aborted = () => { clearTimeout(timer); reject(signal.reason); };
            const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, 100);
            signal.addEventListener('abort', aborted, { once: true });
          });
        }
      }
    },
    dispose() { controller.abort(); },
  };
}
