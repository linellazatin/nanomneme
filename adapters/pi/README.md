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

This is not an npm-installable `nmnm-pi` package yet. New `retain_memory` entries record
`metadata.source` as `"pi"`; ID-based patches preserve an existing source. The model-facing
`remove_memory` tool and `/memory remove` are soft-only; irreversible purge remains an explicit CLI operation.
Run `/memory` or `/memory browse` for the model-free native-dialog browser. The shared status
card appears before the browser opens; record details stay inside a native action dialog, so the
card remains visible on return. Search and store selection stay above every record page. `/memory
status` remains available for an on-demand card.
Explicit list, refresh, pin, unpin, and soft-remove subcommands remain available.
See the [Pi Adapter Manual](../../docs/PI_ADAPTER_MANUAL.md) for Git installation, tools, JSONC
settings, pins, list and removal controls, native-read behavior, reinjection, and transient
index lifecycle.
