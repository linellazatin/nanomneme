import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { readFileSync } from 'node:fs';

export const USAGE = 'Usage: nmnm-ui [--port <0..65535> | -p <0..65535>] [--no-auto | -na] [--help | -h] [--version | -v]';

export async function launchWorkbench(args = [], { command = 'nmnm-ui' } = {}) {
  const usage = USAGE.replace('nmnm-ui', command);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(usage + '\nStarts a loopback memory workbench and opens your default browser. --no-auto or -na prints the URL without opening it. Ctrl-C stops the server.');
    return;
  }
  if (args.length === 1 && ['--version', '-v'].includes(args[0])) {
    console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version);
    return;
  }
  let options;
  try { options = parseLauncherArgs(args); } catch { throw new Error(usage); }
  const { startServer } = await import('./server.js');
  const app = await startServer({ port: options.port });
  const opening = new AbortController();
  let stopping = false;
  const closeServer = app.close;
  const stop = async () => {
    if (stopping) return;
    stopping = true; opening.abort();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    await closeServer();
  };
  app.close = stop;
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  console.log(`Open ${app.url}\nCtrl-C stops the workbench.`);
  if (options.autoOpen) {
    try { await openBrowser(app.url, { signal: opening.signal }); }
    catch { if (!stopping) console.error('Could not open the default browser. The server is running; open the printed URL manually.'); }
  }
  return app;
}

export function parseLauncherArgs(args) {
  const options = { port: 0, autoOpen: true }; let hasPort = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--no-auto' || args[index] === '-na') options.autoOpen = false;
    else if (['--port', '-p'].includes(args[index]) && !hasPort) {
      const value = args[++index];
      if (!value || !/^\d+$/.test(value) || Number(value) > 65535) throw new Error(USAGE);
      options.port = Number(value); hasPort = true;
    } else throw new Error(USAGE);
  }
  return options;
}

export async function openBrowser(url, { platformName = platform(), spawnProcess = spawn, timeoutMs = 5000, signal } = {}) {
  // Only launcher-generated URLs may reach the Windows command interpreter.
  if (!/^http:\/\/127\.0\.0\.1:\d+\/#(?:[a-f0-9]{64})$/.test(url)) throw new Error('Invalid workbench URL');
  const command = platformName === 'darwin' ? 'open' : platformName === 'linux' ? 'xdg-open' : platformName === 'win32' ? 'cmd.exe' : null;
  if (!command) throw new Error('Automatic browser opening is unsupported on this platform');
  const args = platformName === 'win32' ? ['/d', '/c', 'start', '""', url] : [url];
  if (signal?.aborted) throw new Error('Browser opening cancelled');
  await new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, { stdio: 'ignore', detached: true, windowsHide: true, windowsVerbatimArguments: platformName === 'win32' });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancelled); };
    const cancelled = () => { cleanup(); reject(new Error('Browser opening cancelled')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Browser opener timed out')); }, timeoutMs);
    signal?.addEventListener('abort', cancelled, { once: true });
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', code => { cleanup(); if (code === 0) resolve(); else reject(new Error('Browser opener failed')); });
    child.unref();
  });
}
