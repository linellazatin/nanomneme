import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function fixture() {
  const calls = [];
  let route = { type: 'home' };
  const api = {
    location: { directory: '/server/project-a' },
    data: { location: { default: () => ({ directory: '/server/default' }) }, session: { get: id => id === 'known' ? { location: { directory: '/server/project-b', workspaceID: 'workspace-b' } } : undefined } },
    ui: { router: { current: () => route } },
    client: { rpc: definition => {
      assert.equal(definition.id, 'nmnm-opencode.browser');
      return Object.fromEntries(['status', 'browse', 'detail', 'mutate'].map(op => [op, async (input, options) => {
        calls.push({ op, input, options });
        return { ok: true, status: 'server result' };
      }]));
    } },
  };
  return { api, calls, route: value => { route = value; } };
}

test('V2 transport uses connected client and resolves active session location for each call', async () => {
  const { createBrowserClient } = await import('../src/browser-rpc-client.js');
  const f = fixture();
  const browser = createBrowserClient(f.api);
  assert.equal((await browser.call('status')).status, 'server result');
  f.route({ type: 'session', sessionID: 'known' });
  await browser.call('browse', { store: 'both' });
  assert.deepEqual(f.calls.map(call => call.options.location), [
    { directory: '/server/project-a' }, { directory: '/server/project-b', workspaceID: 'workspace-b' },
  ]);
  assert.deepEqual(f.calls[1].input, { store: 'both' });
  assert.ok(f.calls[0].options.signal instanceof AbortSignal);
});

test('V2 transport refuses an unknown session or missing location without cwd fallback', async () => {
  const { createBrowserClient } = await import('../src/browser-rpc-client.js');
  const f = fixture();
  const browser = createBrowserClient(f.api);
  f.route({ type: 'session', sessionID: 'unknown' });
  await assert.rejects(browser.call('mutate', { store: 'project', id: 'id', mutation: 'remove' }), /location/i);
  f.route({ type: 'home' });
  f.api.location = undefined;
  f.api.data.location.default = () => undefined;
  await assert.rejects(browser.call('status'), /location/i);
  assert.equal(f.calls.length, 0);
});

test('transport disposal aborts pending requests and prevents new calls', async () => {
  const { createBrowserClient } = await import('../src/browser-rpc-client.js');
  const f = fixture();
  const browser = createBrowserClient(f.api);
  await browser.call('status');
  browser.dispose();
  browser.dispose();
  assert.equal(f.calls[0].options.signal.aborted, true);
  await assert.rejects(browser.call('status'), /abort/i);
  assert.equal(f.calls.length, 1);
});

test('RPC failures are not retried and never fall back to a local bridge', async () => {
  const { createBrowserClient } = await import('../src/browser-rpc-client.js');
  const f = fixture();
  let calls = 0;
  f.api.client.rpc = () => ({ mutate: async () => { calls++; throw new Error('RPC unavailable'); } });
  const browser = createBrowserClient(f.api);
  await assert.rejects(browser.call('mutate', { store: 'project', id: 'id', mutation: 'pin' }), /RPC unavailable/);
  assert.equal(calls, 1);
});

test('read operations wait for location RPC readiness using the current connected client', async () => {
  const { createBrowserClient } = await import('../src/browser-rpc-client.js');
  for (const op of ['status', 'browse', 'detail']) {
    const f = fixture();
    const browser = createBrowserClient(f.api);
    let calls = 0;
    f.api.client = { rpc: () => ({ [op]: async () => {
      calls++;
      if (calls === 1) throw { type: 'rpc.unavailable', message: 'Location is loading' };
      return { ok: true };
    } }) };
    assert.deepEqual(await browser.call(op), { ok: true });
    assert.equal(calls, 2);
    browser.dispose();
  }
});

test('readiness waiting aborts on disposal and refuses a changed session location', async () => {
  const { createBrowserClient } = await import('../src/browser-rpc-client.js');
  for (const change of ['dispose', 'location']) {
    const f = fixture();
    let calls = 0;
    let browser;
    f.api.client.rpc = () => ({ status: async () => {
      calls++;
      if (change === 'dispose') browser.dispose();
      else f.route({ type: 'session', sessionID: 'known' });
      throw { type: 'rpc.unavailable' };
    } });
    browser = createBrowserClient(f.api);
    await assert.rejects(browser.call('status'), change === 'dispose' ? /abort/i : /location changed/i);
    assert.equal(calls, 1);
  }
});

test('readiness never retries mutations, authentication, transport, or application errors', async () => {
  const { createBrowserClient } = await import('../src/browser-rpc-client.js');
  for (const [op, error] of [
    ['mutate', { type: 'rpc.unavailable' }],
    ['status', { type: 'unauthorized' }],
    ['status', new Error('network failure')],
    ['browse', { type: 'not_found' }],
  ]) {
    const f = fixture();
    let calls = 0;
    f.api.client.rpc = () => ({ [op]: async () => { calls++; throw error; } });
    const browser = createBrowserClient(f.api);
    await assert.rejects(browser.call(op), caught => caught === error);
    assert.equal(calls, 1);
  }
});

test('persistent RPC unavailability has a bounded read retry budget', async () => {
  const { createBrowserClient } = await import('../src/browser-rpc-client.js');
  const f = fixture();
  const error = { type: 'rpc.unavailable' };
  let calls = 0;
  f.api.client.rpc = () => ({ status: async () => { calls++; throw error; } });
  const browser = createBrowserClient(f.api);
  await assert.rejects(browser.call('status'), caught => caught === error);
  assert.equal(calls, 50);
  browser.dispose();
});

test('disposal cancels a pending readiness timer', async () => {
  const { createBrowserClient } = await import('../src/browser-rpc-client.js');
  const f = fixture();
  let calls = 0;
  f.api.client.rpc = () => ({ status: async () => { calls++; throw { type: 'rpc.unavailable' }; } });
  const browser = createBrowserClient(f.api);
  const timer = setTimeout(() => browser.dispose(), 10);
  try { await assert.rejects(browser.call('status'), /abort/i); } finally { clearTimeout(timer); browser.dispose(); }
  assert.equal(calls, 1);
});

test('transport does not expose retain or purge operations', async () => {
  const { createBrowserClient } = await import('../src/browser-rpc-client.js');
  const f = fixture();
  const browser = createBrowserClient(f.api);
  await assert.rejects(browser.call('retain_memory'), /operation/i);
  assert.equal(f.calls.length, 0);
});

test('V2 transport has no local bridge, core, or cwd dependency', () => {
  const source = readFileSync(new URL('../src/browser-rpc-client.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /bridge-client|runBridge|nmnm-core|node:sqlite|process\.cwd/);
});
