# Nanomneme for Codex

`@openlines/nmnm-codex` is an MCP-free Codex plugin prototype for macOS and Linux. It bundles `@openlines/nmnm-core@0.1.1`, gives Codex one lazy-loaded `memory` skill backed by a package-relative Node runner, and adds a trusted read-only SessionStart memory index.

The adapter stores canonical records in Nanomneme's standard project database, `./.nanomneme/memory.db`, and standard global database, `~/.local/share/nanomneme/memory.db`. It has no adapter settings, pins, automatic retention, management CLI, MCP server, or Windows support claim.

Install and test from a packed local artifact during the prototype phase. See [the Codex adapter manual](docs/CODEX_ADAPTER_MANUAL.md).
