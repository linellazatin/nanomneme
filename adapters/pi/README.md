# nmnm-pi

Private Pi package for the nanomneme SQLite memory adapter. It imports `nmnm-core`
directly and never shells out to the CLI.

From a repository checkout, load it for one run:

```sh
pi -e ./adapters/pi/extensions/index.js
```

To add this checkout as a project-local Pi package:

```sh
pi install -l "$(pwd)/adapters/pi"
```

This is not an npm-installable `nmnm-pi` package yet. See the
[Pi Adapter Manual](../../docs/PI_ADAPTER_MANUAL.md) for Git installation, tools, JSONC
settings, pins, list and removal controls, native-read behavior, reinjection, and transient
index lifecycle.
