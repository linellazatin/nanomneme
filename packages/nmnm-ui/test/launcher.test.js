import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { parseLauncherArgs, openBrowser } from '../src/launcher.js';

test('auto opening defaults on; opt-outs compose with port in either order', () => {
  assert.deepEqual(parseLauncherArgs([]), { port: 0, autoOpen: true });
  assert.deepEqual(parseLauncherArgs(['--port', '8080']), { port: 8080, autoOpen: true });
  assert.deepEqual(parseLauncherArgs(['--no-auto', '--port', '8080']), { port: 8080, autoOpen: false });
  assert.deepEqual(parseLauncherArgs(['--port', '8080', '-na']), { port: 8080, autoOpen: false });
  assert.deepEqual(parseLauncherArgs(['-p', '8080', '-na']), { port: 8080, autoOpen: false });
  assert.deepEqual(parseLauncherArgs(['-na']), { port: 0, autoOpen: false });
  for (const args of [['--port'], ['--port', '-1'], ['--port', '65536'], ['--port', 'x'], ['--bad'], ['--port', '1', '--port', '2'], ['-p'], ['--port', '1', '-p', '2']]) assert.throws(() => parseLauncherArgs(args));
});

test('default browser dispatch preserves the authorized URL and reports failures', async () => {
  const url = 'http://127.0.0.1:1234/#' + 'a'.repeat(64);
  for (const [platformName, command] of [['darwin', 'open'], ['linux', 'xdg-open'], ['win32', 'cmd.exe']]) {
    await openBrowser(url, { platformName, spawnProcess: (actualCommand, args, options) => {
      assert.equal(actualCommand, command); assert.equal(args.at(-1), url); assert.notEqual(options.shell, true);
      const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit('close', 0)); return child;
    } });
  }
  await assert.rejects(openBrowser(url, { platformName: 'linux', spawnProcess: () => { const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit('error', new Error('missing opener'))); return child; } }));
  await assert.rejects(openBrowser(url, { platformName: 'linux', spawnProcess: () => { const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit('close', 1)); return child; } }));
  await assert.rejects(openBrowser('http://example.com/'));
  await assert.rejects(openBrowser(url, { platformName: 'unsupported' }));
  await assert.rejects(openBrowser(url, { platformName: 'linux', timeoutMs: 5, spawnProcess: () => { const child = new EventEmitter(); child.unref = () => {}; return child; } }), /timed out/);
  const opening = new AbortController();
  const pending = openBrowser(url, { platformName: 'linux', signal: opening.signal, spawnProcess: () => { const child = new EventEmitter(); child.unref = () => {}; return child; } });
  opening.abort(); await assert.rejects(pending, /cancelled/);
});

test('launcher automatically dispatches by default and both flags suppress dispatch', { skip: !['darwin', 'linux'].includes(platform()) }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmnm-ui-opener-'));
  const log = join(dir, 'opened-url');
  const launchers = [
    [fileURLToPath(new URL('../bin/nmnm-ui.js', import.meta.url))],
    [fileURLToPath(new URL('../../nmnm-cli/bin/nmnm.js', import.meta.url)), 'ui'],
  ];
  writeFileSync(join(dir, platform() === 'darwin' ? 'open' : 'xdg-open'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.NMNM_UI_OPENER_LOG, process.argv[2]);\n`, { mode: 0o700 });
  try {
    for (const launcher of launchers) for (const args of [[], ['--port', '0'], ['--no-auto', '--port', '0'], ['-p', '0', '-na']]) {
      if (existsSync(log)) rmSync(log);
      const child = spawn(process.execPath, [...launcher, ...args], { env: { ...process.env, HOME: dir, PATH: dir + delimiter + process.env.PATH, NMNM_UI_OPENER_LOG: log }, stdio: ['ignore', 'pipe', 'pipe'] });
      try {
        const [output] = await once(child.stdout, 'data'); const url = output.toString().match(/http:\/\/127\.0\.0\.1:\d+\/#[a-f0-9]+/)[0];
        assert.equal((await fetch(url.split('#')[0])).status, 200);
        if (args.includes('--no-auto') || args.includes('-na')) { await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(existsSync(log), false); }
        else { const deadline = Date.now() + 10000; while (!existsSync(log) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(readFileSync(log, 'utf8'), url); }
        const exit = once(child, 'exit'); child.kill('SIGTERM'); assert.equal((await exit)[0], 0);
      } finally { if (child.exitCode === null) { const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit; } }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
