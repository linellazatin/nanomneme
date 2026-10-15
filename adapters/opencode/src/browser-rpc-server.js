import { isAbsolute } from 'node:path';
import { browserRpc } from './browser-rpc.js';
import { runBridge, storeContext } from './bridge-client.js';

export async function registerBrowserRpc(api) {
  if (typeof api.location?.directory !== 'string' || !isAbsolute(api.location.directory)) {
    throw new Error('Nanomneme browser RPC requires an absolute server location directory');
  }
  const ctx = storeContext({ directory: api.location.directory });
  const handlers = Object.fromEntries(Object.entries(browserRpc.methods).map(([op, method]) => [op, async (input, call) => {
    call.signal.throwIfAborted();
    // Only contract fields cross the bridge; location, home, op, and diagnostics are server-owned.
    const params = Object.fromEntries(Object.keys(method.input.properties)
      .filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]]));
    return runBridge({ ...params, op, ctx });
  }]));
  const registration = await api.rpc.register(browserRpc, handlers);
  return () => registration.dispose();
}
