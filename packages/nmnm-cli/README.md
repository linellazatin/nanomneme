# nmnm-cli

Local-first SQLite memory CLI for [nanomneme](https://github.com/linellazatin/nanomneme).

Requires Node.js 22.13 or later and the built-in `node:sqlite` runtime with FTS5.

```sh
npm install --global nmnm-cli
nmnm --help
```

```sh
nmnm retain "Prefer concise operator documentation" --tags preference
nmnm retrieve "operator documentation" --both
```

The CLI defaults to `./.nanomneme/memory.db`. Use `--global` for the standard global
database or `--db <path>` for a custom database. See the repository README for all
commands, storage behavior, and recovery guidance.
