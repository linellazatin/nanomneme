import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const host = process.env.NMNM_OPENCODE_V1;
const entry = process.env.NMNM_ADAPTER_ROOT ? pathToFileURL(join(process.env.NMNM_ADAPTER_ROOT, 'index.js')) : new URL('../index.js', import.meta.url);

test('native V1 host loads selected adapter legacy tools and injection with the dual entry', {
  skip: host ? false : 'Set NMNM_OPENCODE_V1 to a native V1 executable', timeout: 60000,
}, t => {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-browser-v1-host-'));
  const home = join(root, 'home');
  const project = join(root, 'project');
  const config = join(home, 'config/opencode');
  for (const path of [home, project, config]) mkdirSync(path, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const proof = join(root, 'proof.json');
  const fixture = join(root, 'entry.mjs');
  // Observe the selected checkout or independently installed entry through the native loader.
  writeFileSync(fixture, `
import plugin from ${JSON.stringify(entry.href)};
import { writeFileSync } from 'node:fs';
export default {
  ...plugin,
  async server(input, options) {
    const hooks = await plugin.server(input, options);
    const retained = JSON.parse(await hooks.tool.retain_memory.execute({ content: 'v1 native regression fact' }, { directory: input.directory, sessionID: 'v1-regression' }));
    const output = { system: [] };
    await hooks['experimental.chat.system.transform']({}, output);
    writeFileSync(${JSON.stringify(proof)}, JSON.stringify({ tools: Object.keys(hooks.tool).sort(), source: retained.metadata.source, system: output.system }));
    return hooks;
  },
};
`);
  writeFileSync(join(config, 'opencode.json'), JSON.stringify({ plugin: [fixture] }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OPENCODE_') && !key.startsWith('XDG_')));
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache'), XDG_STATE_HOME: join(home, 'state') });
  execFileSync(host, ['debug', 'config'], { cwd: project, env, timeout: 45000, stdio: 'pipe' });
  assert.equal(existsSync(proof), true, 'native V1 loader must invoke the selected server callback');
  const result = JSON.parse(readFileSync(proof, 'utf8'));
  assert.deepEqual(result.tools, ['recall_memory', 'remove_memory', 'retain_memory', 'retrieve_memory']);
  assert.equal(result.source, 'opencode');
  assert.match(result.system.join('\n'), /v1 native regression fact/);
});
