import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Container, TuiMainScreen, TuiAltScreen } from '@earendil-works/pi-tui';

import { pinsPath, readPins } from '../src/context.js';
import { registerPiMemory } from '../src/session.js';
import { runMemory } from '../src/store.js';
import { createPiLogger } from './logger-helper.js';

const { createChatViewport } = await import(new URL('./modes/interactive/chat-viewport.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const unsafeControls = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;
const clipboard = '\x1b]52;c;VEVTVA==\x07';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'nmnm-pi-browser-regression-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'project');
  const home = join(root, 'home');
  mkdirSync(cwd);
  mkdirSync(home);
  const commands = new Map();
  registerPiMemory({ on() {}, registerCommand: (name, command) => commands.set(name, command) }, {
    home, agentDir: join(home, 'agent'), logger: createPiLogger({ sink: () => true }),
  });
  return {
    cwd,
    home,
    retain: content => runMemory({ cwd, operation: 'retain', input: { content } }),
    command: (args, ui, mode = 'rpc') => commands.get('memory').handler(args, { cwd, mode, hasUI: true, isProjectTrusted: () => true, ui }),
  };
}

const keys = { matches: (data, action) => data === ({
  'tui.select.down': 'j', 'tui.select.up': 'k', 'tui.select.confirm': '\r', 'tui.select.cancel': '\x1b',
})[action] };
const theme = { fg: (_color, text) => text, bold: text => text };

function terminal(rows = 24) {
  const writes = [];
  return { rows, columns: 100, writes, write: text => writes.push(text), hideCursor() {}, showCursor() {}, stop() {} };
}

test('Pi browser escapes stored controls in lists, details, and removal confirmation without changing content', async t => {
  const browser = fixture(t);
  const content = `Control ${clipboard} \x1b[8m hidden\u009b2J\u0085 end\nSecond line`;
  const memory = browser.retain(content);
  const shown = [];
  let selections = 0;
  const ui = {
    notify: message => shown.push(message),
    select: async (title, options) => {
      shown.push(title, ...options);
      if (++selections === 1) return options.find(option => option.includes('Control'));
      if (selections === 2) return 'Remove';
      return undefined;
    },
    confirm: async (title, message) => { shown.push(title, message); return false; },
  };
  await browser.command('list', ui);
  await browser.command('browse', ui);
  assert.ok(shown.some(text => text.includes('Second line')));
  for (const text of shown) assert.doesNotMatch(text, unsafeControls);
  assert.equal(runMemory({ cwd: browser.cwd, operation: 'recall', input: { id: memory.id } }).content, content);
});

test('Pi native browser disambiguates identical previews before pinning and removing', async t => {
  const browser = fixture(t);
  const first = browser.retain('Identical preview');
  const second = browser.retain('Identical preview');
  const opened = [];
  const labels = [];
  let calls = 0;
  await browser.command('browse', {
    notify() {},
    select: async (title, options) => {
      calls += 1;
      if (calls === 1 || calls === 3) {
        const rows = options.filter(option => option.includes('Identical preview'));
        labels.push(rows);
        return rows[calls === 1 ? 0 : 1];
      }
      if (calls === 2 || calls === 4) {
        opened.push([first.id, second.id].find(id => title.includes(id)));
        return calls === 2 ? 'Pin' : 'Remove';
      }
      return undefined;
    },
    confirm: async () => true,
  });
  for (const rows of labels) assert.equal(new Set(rows).size, 2);
  assert.notEqual(opened[0], opened[1]);
  assert.deepEqual(readPins(pinsPath({ cwd: browser.cwd, home: browser.home, store: 'project' })), [opened[0]]);
  assert.ok(runMemory({ cwd: browser.cwd, operation: 'recall', input: { id: opened[0] } }));
  assert.equal(runMemory({ cwd: browser.cwd, operation: 'recall', input: { id: opened[1] } }), null);
});

for (const remaining of [15, 0]) {
  test(`Pi browser recovers pagination focus when concurrent removals leave ${remaining} records`, async t => {
    const browser = fixture(t);
    const memories = Array.from({ length: 25 }, (_, index) => browser.retain(`Record ${index}`));
    let screens = 0;
    await browser.command('browse', {
      notify() {},
      custom: async factory => new Promise((resolve, reject) => {
        try {
          const component = factory({ terminal: terminal(), requestRender() {} }, theme, keys, resolve);
          screens += 1;
          if (screens === 1) {
            component.handleInput('l');
            const nextPage = component.items().findIndex(item => item.key === 'next-page');
            assert.ok(nextPage >= 0);
            for (let index = 0; index < nextPage; index += 1) component.handleInput('j');
            component.handleInput('\r');
            return;
          }
          assert.equal(screens, 2);
          // Another store writer removes records before the next page's first render.
          for (const memory of memories.slice(remaining)) {
            runMemory({ cwd: browser.cwd, operation: 'remove', input: { id: memory.id, mode: 'soft' } });
          }
          const lines = component.render(100);
          assert.ok(lines.some(line => line.includes(`showing ${remaining} of ${remaining}`)));
          assert.ok(lines.some(line => line.endsWith('> Close')));
          assert.equal(component.items().some(item => item.key === 'previous-page'), false);
          component.handleInput('k');
          assert.ok(component.render(100).some(line => line.includes(remaining ? '> [project]' : '> Source: all')));
          component.handleInput('\x1b');
        } catch (error) { reject(error); }
      }),
    }, 'tui');
    assert.equal(screens, 2);
    assert.equal(runMemory({ cwd: browser.cwd, operation: 'retrieve', input: {} }).total, remaining);
  });
}

for (const mode of ['regular', 'fullscreen']) {
  test(`Pi ${mode} browser keeps selection visible after navigation and resizing and emits no stored OSC`, async t => {
    const browser = fixture(t);
    for (let i = 0; i < 23; i += 1) browser.retain(`Record ${i}`);
    browser.retain(`Clipboard ${clipboard} end`);
    await browser.command('browse', {
      notify() {},
      custom: async factory => new Promise((resolve, reject) => {
        const screen = terminal();
        const renderer = mode === 'regular' ? new TuiMainScreen(screen, false) : new TuiAltScreen(screen, false);
        renderer.requestRender = () => {};
        try {
          const component = factory(renderer, theme, keys, resolve);
          component.handleInput('l');
          const editor = new Container();
          editor.addChild(component);
          if (mode === 'fullscreen') {
            const empty = () => new Container();
            const { root } = createChatViewport({ document: empty(), pendingMessages: empty(), status: empty(), editor, footer: empty() });
            renderer.setLayoutRoot(root);
            renderer.altScreenActive = true;
          } else renderer.addChild(editor);
          const assertVisible = () => {
            renderer.doRender();
            const visible = mode === 'regular' ? renderer.previousLines.slice(-screen.rows) : renderer.previousScreen;
            assert.ok(visible.some(line => line.startsWith('> ')), `selection hidden at ${screen.columns}x${screen.rows}`);
          };
          for (const [columns, rows] of [[100, 24], [24, 12], [18, 8], [100, 32]]) {
            screen.columns = columns;
            screen.rows = rows;
            assertVisible();
            for (let i = 0; i < component.items().length; i += 1) {
              component.handleInput('j');
              assertVisible();
            }
            for (let i = 0; i < component.items().length; i += 1) {
              component.handleInput('k');
              assertVisible();
            }
          }
          assert.equal(screen.writes.join('').includes(clipboard), false);
          component.handleInput('\x1b');
          resolve(undefined);
        } catch (error) { reject(error); }
        finally { renderer.stop({ preserveScreen: true }); }
      }),
    }, 'tui');
  });
}
