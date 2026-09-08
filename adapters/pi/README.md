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
[Pi Adapter Manual](../../docs/PI_ADAPTER_MANUAL.md) for Git installation, tools, pins,
JSONC settings, opt-in autoretention, store-validated pins, direct project-plus-global
`/memory list` with pin markers, ambiguity-safe soft `/memory remove` controls, non-creating
native reads, and transient automatic index behavior.
