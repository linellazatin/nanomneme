import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { discoverAndLoadExtensions } from '@earendil-works/pi-coding-agent';

export const piHostVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.resolve('@earendil-works/pi-coding-agent')), 'utf8')).version;

export async function loadPiAdapter(t, { projectSettings = {}, globalSettings = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-pi-host-'));
  const cwd = join(root, 'project');
  const home = join(root, 'home');
  const agentDir = join(home, 'agent');
  const previousHome = process.env.HOME;
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.HOME = home;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(cwd, '.nanomneme'), { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(cwd, '.nanomneme', 'nmnm.jsonc'), JSON.stringify(projectSettings));
  writeFileSync(join(agentDir, 'nmnm.jsonc'), JSON.stringify(globalSettings));
  const loaded = await discoverAndLoadExtensions([resolve('adapters/pi/extensions/index.js')], cwd, agentDir);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  return { root, cwd, home, agentDir, loaded };
}
