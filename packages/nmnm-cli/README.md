# @openlines/nmnm-cli

<div align="center">

[![nmnm-cli version](https://img.shields.io/npm/v/%40openlines%2Fnmnm-cli?label=cli&logo=npm&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-cli) [![nmnm-cli downloads](https://img.shields.io/npm/dt/@openlines/nmnm-cli?label=downloads&logo=npm&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-cli)

</div>

Local-first SQLite memory CLI for [nanomneme](https://github.com/linellazatin/nanomneme).

Requires Node.js 22.13 or later and the built-in `node:sqlite` runtime with FTS5.

```sh
npm install --global @openlines/nmnm-cli
nmnm --help
```

For a checkout-based CLI, run these commands at the repository root. Root dependency installation alone does not replace an existing global `nmnm`; linking makes the active npm prefix's command follow this checkout. Keep the checkout at its linked path and check `type -a nmnm` if another installation appears first on PATH.

```sh
npm install
npm link --workspace @openlines/nmnm-cli --ignore-scripts --no-audit --no-fund
nmnm --version
```

```sh
nmnm retain "Prefer concise operator documentation" --tags preference
nmnm retrieve "operator documentation" --both
```

Installing this package also installs its exact `@openlines/nmnm-core` dependency. The CLI defaults to `./.nanomneme/memory.db`. Use `--global` for the standard global database or `--db <path> --scope project|global` for a custom database. See the [Core and CLI Manual](../../docs/CORE_CLI_MANUAL.md) for commands and recovery workflows. `export --out <file>` replaces its destination atomically after the complete JSONL file is written. `verify` and `export` open their source databases read-only; `repair` remains writable.

## Shared opt-in diagnostics

Set `"logging": { "enabled": true }` in `~/.local/share/nanomneme/config.jsonc` to enable the shared default. JSONC comments and trailing commas are supported. The CLI has no user-level override; invalid shared logging configuration disables it. Project settings cannot authorize logging. Records use the shared `logslines/v1` catalog and core-distributed runtime, contain no memory payloads or stack traces, carry thrown-error messages verbatim in failed records, and append to `~/.local/share/nanomneme/logs/<component>.jsonl`. Logging failures preserve operations and output. Existing databases, pin files, and logs require no migration.

The CLI observes retain, recall, retrieve, remove, import, export, verify, and repair once per command. Combined retrieval and repair have one aggregate outcome; transfer output completion is included. Help/version/unknown commands and temporary validation stores are unlogged. It reads shared settings per invocation and has no adapter override. Correlation is null.
