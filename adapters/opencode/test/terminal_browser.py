"""Disposable native terminal checks. Requires pexpect and pyte; no provider calls."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

import pexpect
import pyte


ADAPTER = Path(os.environ.get('NMNM_ADAPTER_ROOT', Path(__file__).resolve().parents[1])).resolve()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', required=True)
    parser.add_argument('--generation', choices=['v1', 'v2'], required=True)
    parser.add_argument('--connected', action='store_true', help='V2: use a separate server and terminal home')
    args = parser.parse_args()
    preferred = Path(tempfile.gettempdir()) / 'opencode'
    with tempfile.TemporaryDirectory(prefix='nmnm-terminal-', dir=preferred if preferred.is_dir() else None) as temporary:
        root = Path(temporary)
        home, project = root / 'home', root / 'project'
        config = home / 'config' / 'opencode'
        config.mkdir(parents=True)
        project.mkdir()
        env = {key: value for key, value in os.environ.items() if not key.startswith(('OPENCODE_', 'XDG_', 'AWS_'))}
        env.update(HOME=str(home), XDG_CONFIG_HOME=str(home / 'config'), XDG_DATA_HOME=str(home / 'data'), XDG_CACHE_HOME=str(home / 'cache'), XDG_STATE_HOME=str(home / 'state'), TERM='xterm-256color')
        v2 = args.generation == 'v2'
        (config / 'opencode.json').write_text(json.dumps({'plugins' if v2 else 'plugin': [str(ADAPTER)] if v2 else [(ADAPTER / 'index.js').as_uri()]}))
        (config / ('cli.json' if v2 else 'tui.json')).write_text(json.dumps({'plugins' if v2 else 'plugin': [str(ADAPTER)] if v2 else [(ADAPTER / 'tui.js').as_uri()]}))
        bridge_url = (ADAPTER / 'src/bridge-client.js').as_uri()

        def bridge(request, directory=project):
            request['ctx'] = {'cwd': str(directory), 'home': str(home)}
            result = subprocess.run(['node', '--input-type=module', '-e', f'import {{ runBridge }} from {json.dumps(bridge_url)}; process.stdout.write(JSON.stringify(runBridge(JSON.parse(process.argv[1]))));', json.dumps(request)], env=env, capture_output=True, text=True, check=True)
            output = json.loads(result.stdout)
            assert output['ok'], output
            return output

        for index in range(20):
            bridge({'op': 'tool', 'name': 'retain_memory', 'params': {'content': f'Project filler {index}'}})
        for index in range(2):
            bridge({'op': 'tool', 'name': 'retain_memory', 'params': {'content': f'Global filler {index}', 'scope': 'global'}})
        manual = json.loads(bridge({'op': 'tool', 'name': 'retain_memory', 'params': {'content': 'Other adapter fact'}})['text'])
        bridge({'op': 'tool', 'name': 'retain_memory', 'params': {'id': manual['id'], 'metadata': {'source': 'other'}}})
        seed = json.loads(bridge({'op': 'tool', 'name': 'retain_memory', 'params': {'content': 'Terminal verification fact', 'tags': ['terminal'], 'kind': 'fact'}})['text'])
        server = None
        password = None
        terminal_env = env.copy()
        arguments = ['--standalone'] if v2 else []
        if args.connected:
            assert v2, '--connected requires V2'
            server = pexpect.spawn(args.host, ['serve', '--hostname', '127.0.0.1', '--port', '0'], cwd=str(home), env=env, encoding='utf-8', codec_errors='replace')
            output = ''
            deadline = time.monotonic() + 30
            while not (re.search(r'server listening on (http://\S+)', output) and re.search(r'server password (\S+)', output)):
                assert time.monotonic() < deadline, 'Isolated server did not start'
                try:
                    output += server.read_nonblocking(65536, timeout=0.2)
                except pexpect.TIMEOUT:
                    pass
            address = re.search(r'server listening on (http://\S+)', output).group(1)
            password = re.search(r'server password (\S+)', output).group(1)
            terminal_home = root / 'terminal-home'
            terminal_config = terminal_home / 'config' / 'opencode'
            terminal_config.mkdir(parents=True)
            other = root / 'other-project'
            other.mkdir()
            observer = root / 'terminal-observer'
            observer.mkdir()
            (observer / 'package.json').write_text(json.dumps({'type': 'module', 'exports': {'./tui': './tui.js'}}))
            (observer / 'tui.js').write_text('''export default { id: 'nmnm-terminal-observer', async setup(api) { try {
              const session = await api.client.session.create({ title: 'Second location', location: { directory: DIRECTORY } });
              await api.data.session.sync(session.id);
              api.keymap.layer(() => ({ mode: 'global', commands: [{ id: 'nmnm-test.move', bind: 'ctrl+alt+l', run() {
                api.ui.router.navigate({ type: 'session', sessionID: session.id });
                api.ui.toast.show({ message: 'Location switched' });
              } }], bindings: ['nmnm-test.move'] }));
            } catch (error) { (await import('node:fs')).writeFileSync(ERROR_PATH, String(error.stack)); throw error; } } };'''.replace('DIRECTORY', json.dumps(str(other))).replace('ERROR_PATH', json.dumps(str(root / 'observer-error'))))
            (terminal_config / 'cli.json').write_text(json.dumps({'plugins': [str(ADAPTER), str(observer)]}))
            terminal_env.update(HOME=str(terminal_home), XDG_CONFIG_HOME=str(terminal_home / 'config'), XDG_DATA_HOME=str(terminal_home / 'data'), XDG_CACHE_HOME=str(terminal_home / 'cache'), XDG_STATE_HOME=str(terminal_home / 'state'))
            terminal_env['OPENCODE_PASSWORD'] = password
            arguments = ['--server', address]
        child = pexpect.spawn(args.host, arguments + [str(project)], cwd=str(project), env=terminal_env, encoding='utf-8', codec_errors='replace', dimensions=(45, 140))
        screen = pyte.Screen(140, 45)
        stream = pyte.Stream(screen)

        def text():
            return '\n'.join(screen.display)

        def pump(timeout=0.2):
            try:
                chunk = child.read_nonblocking(65536, timeout=timeout)
                stream.feed(chunk)
                if '\x1b[6n' in chunk:
                    child.send('\x1b[1;1R')
            except pexpect.TIMEOUT:
                pass
            except pexpect.EOF:
                raise AssertionError(text().replace(password, '[redacted]') if password else text()) from None

        def wait(value, timeout=30):
            deadline = time.monotonic() + timeout
            while value not in text():
                assert time.monotonic() < deadline, f'Missing {value!r}:\n{text()}\n' + ((root / 'observer-error').read_text() if (root / 'observer-error').exists() else '')
                pump()

        def send(value):
            child.send(value)
            end = time.monotonic() + 0.25
            while time.monotonic() < end:
                pump(0.05)

        def choose(index):
            send('\x1b[B' * index + '\r')

        def click(label):
            row = next(index for index, line in enumerate(screen.display) if label in line)
            column = screen.display[row].index(label)
            send(f'\x1b[<0;{column + 2};{row + 1}M\x1b[<0;{column + 2};{row + 1}m')

        try:
            wait('ctrl', 45)
            send('\x1b[109;7u')  # CSI-u ctrl+alt+m.
            wait('Nanomneme', 30)
            wait('Memories:')
            choose(2)
            wait('Terminal verification fact')
            wait('of 24')
            send('Next page')
            send('\r')
            wait('21-24 of 24')
            send('Previous page')
            send('\r')
            wait('1-20 of 24')
            send('Source:')
            send('\r')
            wait('source: opencode')
            wait('of 23')
            send('Terminal verification fact')
            send('\r')
            wait('View detail')
            choose(0)
            wait('Namespace')
            choose(5)
            wait('View detail')
            choose(1)
            wait('Unpin')
            assert bridge({'op': 'detail', 'store': 'project', 'id': seed['id']})['record']['pinned']
            choose(2)
            wait('Soft-remove this memory')
            click('Cancel')
            wait('View detail')
            assert bridge({'op': 'detail', 'store': 'project', 'id': seed['id']})['record']['pinned']
            choose(3)
            wait('Terminal verification fact')
            send('\r')
            wait('View detail')  # The selected record, not the first navigation row.
            choose(1)
            wait('Remove (soft)')
            assert not bridge({'op': 'detail', 'store': 'project', 'id': seed['id']})['record']['pinned']
            choose(2)
            wait('Soft-remove this memory')
            click('Confirm')
            wait('Source: opencode')
            removed = bridge({'op': 'detail', 'store': 'project', 'id': seed['id']})
            assert 'memory' in removed and removed['memory'] is None, removed
            send('\x1b')
            send('\x1b[109;7u')
            wait('Source: opencode')
            send('Project')
            send('\r')
            wait('Project ·')
            send('Global')
            send('\r')
            wait('Global ·')
            wait('Global filler')
            send('Status')
            send('\r')
            wait('Nanomneme status')
            if not v2:
                # V1's documented configuration workflow requires a terminal restart.
                for enabled in [False, True]:
                    child.terminate(force=True)
                    (config / 'tui.json').write_text(json.dumps({'plugin': [(ADAPTER / 'tui.js').as_uri()] if enabled else []}))
                    child = pexpect.spawn(args.host, [str(project)], cwd=str(project), env=env, encoding='utf-8', codec_errors='replace', dimensions=(45, 140))
                    screen.reset()
                    wait('ctrl', 45)
                    send('\x1b[109;7u')
                    if enabled:
                        wait('Nanomneme status')
                    else:
                        assert 'Nanomneme' not in text(), 'Removed V1 plugin remained reachable after restart'
            if v2:
                active_config = Path(terminal_env['XDG_CONFIG_HOME']) / 'opencode' / 'cli.json'
                for _ in range(2):
                    active_config.write_text(json.dumps({'plugins': ['-nmnm-opencode-tui'] + ([str(observer)] if args.connected else [])}))
                    deadline = time.monotonic() + 30
                    while 'Nanomneme status' in text():
                        assert time.monotonic() < deadline, 'V2 unload did not close its owned dialog'
                        pump()
                    send('\x1b[109;7u')
                    assert 'Nanomneme status' not in text(), 'Disabled command remained reachable'
                    active_config.write_text(json.dumps({'plugins': [str(ADAPTER)] + ([str(observer)] if args.connected else [])}))
                    deadline = time.monotonic() + 30
                    while 'Nanomneme status' not in text():
                        assert time.monotonic() < deadline, 'V2 reload did not restore its command'
                        send('\x1b[109;7u')
                    send('\x1b')
                    send('\x10')
                    send('Nanomneme Memory Browser')
                    wait('Nanomneme Memory Browser')
                    assert text().count('Nanomneme Memory Browser') == 2, 'Expected one palette result plus search input'
                    send('\x1b')
                    send('\x1b[109;7u')
                    wait('Nanomneme status')
                if args.connected:
                    assert not (Path(terminal_env['HOME']) / '.local/share/nanomneme/memory.db').exists()
                    choose(2)
                    wait('Source:')
                    send('Project filler 19')
                    send('\r')
                    wait('View detail')
                    choose(2)
                    wait('Soft-remove this memory')
                    send('\x1b[108;7u')  # Observer navigates to an actual second-location session.
                    wait('Location switched')
                    click('Confirm')
                    wait('location changed')
                    assert not (other / '.nanomneme/memory.db').exists()
                    assert bridge({'op': 'browse', 'store': 'project', 'limit': 100})['total'] == 21
                    send('\x1b')
                    send('\x1b[109;7u')
                    wait('of 2')  # Server-global records remain visible in All.
                    send('Project')
                    send('\r')
                    wait('of 0')
            print(f'{args.generation}: rendered hotkey, all tabs, pagination, filtering, detail/back, pin/unpin, cancel, selection restoration, confirmed soft removal, and reopen passed' + ('; unload/reload passed' if v2 else ''))
        finally:
            child.terminate(force=True)
            if server:
                server.terminate(force=True)


if __name__ == '__main__':
    main()
