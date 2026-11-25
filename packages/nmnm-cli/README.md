# @openlines/nmnm-cli

<div align="center">

[![nmnm-cli version](https://img.shields.io/npm/v/%40openlines%2Fnmnm-cli?label=cli&logo=npm&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-cli) [![nmnm-cli downloads](https://img.shields.io/npm/dt/@openlines/nmnm-cli?label=downloads&logo=npm&color=cb3837)](https://www.npmjs.com/package/@openlines/nmnm-cli)

</div>

Local-first SQLite memory CLI for [nanomneme](https://github.com/linellazatin/nanomneme).

Requires Node.js 22.19.0 or later and the built-in `node:sqlite` runtime with FTS5.

Core is independently installable and does not require this CLI.

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

The CLI installs core and UI as regular dependencies. The manifest declares compatible ranges; the root lockfile records checkout resolutions. Publication is a separate maintainer action, so installing from the registry and running a checkout can yield different releases. The CLI defaults to `./.nanomneme/memory.db`. Use `--global` for the standard global database or `--db <path>` for a custom database; custom retains also require `--scope project|global`. Scope is trimmed and validated before opening a database; standard selectors reject scope mismatches. See the [Core and CLI Manual](../../docs/CORE_CLI_MANUAL.md) for commands and recovery workflows. `export --out <file>` replaces its destination atomically after the complete JSONL file is written. `verify` and `export` open their source databases read-only; `repair` remains writable.

Ordinary 4Rs and `retrieve --both` open stores writable, so even retrieval can install or upgrade the optional performance index. `--both` leaves missing stores absent. `verify`/`export` do not install or upgrade it or require its presence. See [optional-index upgrades](../../docs/CORE_CLI_MANUAL.md#optional-index-upgrades) for first-open costs and compatibility.

On POSIX systems, new database files request `0600` and new store directories request `0700`. File exports request `0600` from temporary-file creation, preserving stricter owner permissions when replacing a destination; the caller's umask may restrict these further. Existing database permissions are unchanged, and `verify` reports group/other access as `file_permissions` with exit status `1`. Review intentional sharing before manually restricting permissions. These checks do not audit ACLs or apply on Windows.

CLI import rejects malformed UTF-8 bytes before opening or creating its destination; valid Unicode content is preserved.

Readable fields and stderr escape terminal controls, including embedded newlines and tabs. JSON/JSONL escape DEL and C1 controls while preserving parsed values; stored content is unchanged.

Dependencies use compatible patch ranges recorded in `package.json`. Fresh resolution can select newer compatible patches; existing lockfiles and installations require explicit updates.

## Installed versions

`nmnm --version` and `nmnm -v` print separate labeled lines for the installed CLI, core, and UI versions without opening storage or starting UI. Use the command's actual output when reporting an issue.

## Browser workbench

```sh
nmnm ui
nmnm ui --port 8080
nmnm ui -p 8080 --no-auto
nmnm ui -na
nmnm ui --help
nmnm ui --version
```

- `ui` must be first; subsequent flags go to the shared UI launcher.
- Default: loopback server on an available port, automatic default-browser opening.
- `--port <0..65535>` or `-p <0..65535>` selects a port; `0` requests an available port.
- `--no-auto` or `-na` prints the URL without opening a browser.
- `ui --help`/`ui -h` prints UI usage. `ui --version`/`ui -v` reports UI version; `nmnm --version`/`nmnm -v` prints installed `cli`, `core`, and `ui` versions on separate labeled lines.
- Ctrl-C stops the foreground server. Browser-opening failures leave it running for manual access.
- Select stores and source harnesses in the workbench; terminal `--db`, `--global`, and `--json` are not UI flags.
- UI loads only on `ui`; ordinary terminal commands start no UI server or browser.
- See the [UI README](../nmnm-ui/README.md) for review, cleanup, editing authorization, limitations, and future features.

## Shared opt-in diagnostics

`src/logslines.js` binds CLI identity and shared settings to `@openlines/nmnm-core/logging`; the executable observes command processing and stdout completion. Adapter and UI bindings use the same filename. See the [Logger manual](../../docs/LOGGER.md#source-and-artifact-map) for file roles and generated artifacts.

Diagnostics default off. Enable shared `logging.enabled` in `~/.local/share/nanomneme/config.jsonc`. Raw error messages are not redacted. See the [Logger manual](../../docs/LOGGER.md#configuration-and-record-contract) for configuration, record fields, permissions, and privacy boundaries.

The CLI observes retain, recall, retrieve, remove, import, export, verify, and repair once per command. Combined retrieval and repair have one aggregate outcome; transfer output completion is included. Successful help/version/UI launch, unknown terminal commands, and temporary validation stores are unlogged. The UI owns its separate `nmnm-ui` binding for mutations and general errors. The terminal CLI reads shared settings per invocation, has no adapter override, and uses null correlation.

## Project summaries and brief preview

A summary is a stored project work account; a brief is a deterministic historical view of its source summaries. You or the current agent supplies JSON; Nanomneme uses no separate model and reads no transcripts. Save the [JSON example](../../docs/examples/project-summary.json) locally, then use:

```sh
nmnm summary add --file summary.json --json
nmnm brief
nmnm brief --budget 1000 --json
nmnm summary update <returned-id> --file summary.json --json
```

Use `--file -` for explicit stdin. These commands use only the current project's store and reject global/custom selectors. Invalid input is rejected before store creation. `brief` is read-only, unlogged, and quiet when the store is absent or empty. Summary writes log as `retain`. Update replaces the complete payload of an active supported summary while preserving identity and original provenance; concurrent updates use last-successful-write semantics. Existing recall/retrieve/remove, explicit restore, purge and export/import remain available. Adapter brief delivery is opt-in through existing `brief.enabled` context settings. See the [complete contract and limits](../../docs/CORE_CLI_MANUAL.md#project-work-summaries-and-briefs).

Remove a contributing summary with `nmnm summary remove <id> --json` (core: `store.removeSummary({ id })`). This guarded soft removal rejects ordinary records and changes the next brief; remaining history may become the primary source. Briefs have no separate ID. Existing explicit restoration and permanent purge remain available through general memory operations. Already-injected conversation context is not erased.
