# @openlines/nmnm-pi

Pi package for the nanomneme SQLite memory adapter. It imports `@openlines/nmnm-core`
directly and never shells out to the CLI.

Install it globally with Pi:

```sh
pi install npm:@openlines/nmnm-pi
```

From a repository checkout, load it for one run:

```sh
pi -e ./adapters/pi/extensions/index.js
```

To add this checkout as a project-local Pi package:

```sh
pi install -l "$(pwd)/adapters/pi"
```

New `retain_memory` entries record `metadata.source` as `"pi"`; ID-based patches preserve an
existing source. Retain scope selects the matching write store: omit it for project or use
`scope: "global"` for global. The browser and `/memory list` can show all records or Pi-source
records. The model-facing `remove_memory` tool and `/memory remove` are soft-only; irreversible
purge remains an explicit CLI operation. Run `/memory` or `/memory browse` for the model-free
custom browser: left/right changes Status, All, Project, and Global tabs. Record details remain in
a native action dialog; search and source controls remain in each store tab. `/memory status`
remains available for an on-demand card. Explicit list, refresh, pin, unpin, and soft-remove
subcommands remain available.
See the [Pi Adapter Manual](../../docs/PI_ADAPTER_MANUAL.md) for npm, Git, and local installation, tools, JSONC
settings, pins, list and removal controls, native-read behavior, reinjection, and transient
index lifecycle.
