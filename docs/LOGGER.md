# Logger and Logslines Developer Manual

This manual is for maintainers of nanomneme’s opt-in diagnostic logging. It covers the checked-in external Logslines source, the shared logger implementation, generated runtime, validation, and release checks. It does not describe normal memory operations or adapter configuration in full; see [Architecture](ARCHITECTURE.md) and [Memory handling sequence](SEQUENCE_MEMORY_HANDLING.md) for those boundaries.

## Purpose and boundaries

Nanomneme diagnostics are opt-in and append privacy-bounded `logslines/v1` JSONL records for selected explicit actions. The shared logger classifies an action’s result, resolves logging configuration, validates and serializes the record through Logslines, and writes it to the component log. It must remain subordinate to the action it observes: disabled, invalid, or failed diagnostics never change the action’s result or error.

The logger is intentionally shipped with `@openlines/nmnm-core/logging`, rather than fetched or installed at runtime. This lets the CLI and every adapter use one reviewed implementation and one pinned Logslines release. No memory content, memory IDs, queries, store paths, or raw errors belong in emitted records.

## Source and artifact map

| Path | Role | Edit directly? |
|---|---|---|
| `shared/logger/` | Handwritten shared implementation: catalog, configuration resolver, observer, and JSONL sink. | Yes. |
| `external/logslines/` | Exact upstream Logslines release snapshot, license, and SHA-256 provenance. | Only through `npm run external:update -- <tag>`. |
| `scripts/build-logger.js` | Bundles the shared logger and external Logslines source for the core package. | Yes, when changing the build contract. |
| `packages/nmnm-core/src/logging-runtime.generated.js` | Generated, self-contained runtime included in published core packages. | No. Regenerate it. |
| `packages/nmnm-core/src/logging.js` | Public core logging entry point that imports the generated runtime. | Yes. It is not itself a generator input. |
| `test/external-logslines.test.js` | Offline pinned-release and SHA-256 contract. | Update it when adopting a new upstream Logslines release. |
| `scripts/check-logging-packages.js` | Explicit release check for logging files in packed, independently installed packages. | No normal edits needed. |

`npm install`, package runtime, and CI do not fetch Logslines. `npm test` does not regenerate the runtime; it runs `node scripts/build-logger.js --check` and fails if the checked-in artifact is stale.

## When regeneration is required

Run `node scripts/build-logger.js` before shipping when a change affects the generated runtime’s inputs:

- Any file under `shared/logger/`.
- The Logslines snapshot, its provenance, or its license under `external/logslines/`.
- `scripts/build-logger.js`.

**Do not regenerate solely because ordinary core storage, CLI, adapter, documentation, or logger-test files changed**. A change to `packages/nmnm-core/src/logging.js` alone also does not make the generated runtime stale. Run the generator whenever uncertain; `node scripts/build-logger.js --check` is the authoritative staleness test.

## Workflow: change the shared logger

Use this workflow for a behavior, catalog, configuration, observer, or sink change in `shared/logger/`.

1. Change the source and add or update focused tests under `shared/logger/test/`.
2. Regenerate the shipped runtime:

```sh
node scripts/build-logger.js
```

3. Confirm it is current and run the repository suite:

```sh
node scripts/build-logger.js --check
npm test
```

4. Include both the handwritten source and `packages/nmnm-core/src/logging-runtime.generated.js` in the same change. The generated file must exactly reflect its source before it is shipped.

For a release or package-distribution change, also run:

```sh
node scripts/check-logging-packages.js
```

This packs the core, CLI, and adapters, installs them outside the workspace, and verifies that the logging runtime is present and loadable. It uses npm registry access for ordinary dependencies. It is an explicit release check, not a normal edit-loop command.

## Workflow: update the upstream Logslines release

Use an exact published semantic-version tag, such as `v0.1.0`. The update command downloads the required release files, validates the release metadata and schema, writes the snapshot atomically, and records SHA-256 provenance.

1. Check the currently pinned snapshot against its release tag when validating an unchanged snapshot:

```sh
npm run external:check -- v0.1.0
```

2. Update to the selected upstream release:

```sh
npm run external:update -- v<major>.<minor>.<patch>
```

3. Review the external-source and provenance diff. Confirm that the tag, release URL, required file list, and hashes in `external/logslines/PROVENANCE.json` identify the intended release.
4. Update `test/external-logslines.test.js` to match the new tag, release URL, and each SHA-256 value from `PROVENANCE.json`. This test is deliberately pinned independently so CI can validate the snapshot without network access.
5. Regenerate the shipped runtime and verify it:

```sh
node scripts/build-logger.js
node scripts/build-logger.js --check
npm test
```

6. Before publishing packages that include diagnostics, run the package check:

```sh
node scripts/check-logging-packages.js
```

`external:check` and `external:update` require network access. They are maintainer commands only and must not be added to CI, package installation, or application runtime paths.

## Workflow: refresh Codex after logging updates

After changing the shared logger, its generated runtime, the core, or Codex dependencies, refresh an existing local Codex installation in this order. Codex uses a cached plugin containing a physical core copy, so a current checkout and a matching displayed version do not establish that its installed logger is current.

1. From the repository root, check the generated runtime. If stale, regenerate it and review the diff before continuing:

```sh
node scripts/build-logger.js --check
```

2. Prepare the current core/parser dependencies in the adapter, then reinstall through the already registered local marketplace:

```sh
node scripts/check-logging-packages.js --prepare-codex
codex plugin add nmnm-codex@nanomneme-local --json
```

Preparation uses npm registry access for ordinary dependencies. Wait for it to succeed before reinstalling. `node scripts/check-logging-packages.js` without `--prepare-codex` only checks temporary installations; it does not refresh the adapter's dependency copy. Reinstalling before preparation can copy the older logger into the cache again, including when the plugin version is unchanged.

3. Reload Codex or start a new session.
4. Confirm the generated runtime matches both the prepared adapter and installed cache:

```sh
cmp packages/nmnm-core/src/logging-runtime.generated.js \
  adapters/codex/node_modules/@openlines/nmnm-core/src/logging-runtime.generated.js

cmp packages/nmnm-core/src/logging-runtime.generated.js \
  "${CODEX_HOME:-$HOME/.codex}/plugins/cache/nanomneme-local/nmnm-codex/0.2.0/node_modules/@openlines/nmnm-core/src/logging-runtime.generated.js"
```

No output and exit code `0` means a comparison matches. Replace `0.2.0` with the installed version when it changes. An adapter mismatch requires preparation; a cache-only mismatch requires marketplace reinstall and reload. These checks establish logger artifact freshness, not end-to-end memory operation behavior. See the [Codex manual](../adapters/codex/docs/CODEX_ADAPTER_MANUAL.md#refresh-after-checkout-updates) for the complete local installation context.

## What not to do

- Do not hand-edit `packages/nmnm-core/src/logging-runtime.generated.js`.
- Do not add Logslines as an npm dependency, a workspace dependency, or a runtime download.
- Do not replace the external snapshot by copying files manually. Use `external:update` so provenance and replacement are validated and atomic.
- Do not omit the generated runtime from a shared-logger or external-source change.
- Do not weaken the offline hash test to accommodate a changed snapshot. Update its exact expected tag, release URL, and hashes after reviewing the upstream release.
- Do not log memory payloads, identifiers, queries, storage paths, or raw errors. Extend the closed catalog and its tests instead of adding ad hoc diagnostic fields.
- Do not make memory persistence, context injection, read-only navigation, or diagnostics-disabled execution depend on logging success.

## Troubleshooting

| Symptom | Meaning | Correct action |
|---|---|---|
| `Shared logger bundle is stale` | The generated core runtime differs from current generator inputs. | Run `node scripts/build-logger.js`, review the artifact, then run `npm test`. |
| `external:check` reports source or provenance differences | The checked-in snapshot does not exactly match the selected upstream release. | Use the intended exact tag, inspect the discrepancy, and use `external:update` only when deliberately adopting that release. |
| Offline Logslines hash test fails after an update | `test/external-logslines.test.js` still pins the prior release metadata or hashes. | Copy the reviewed values from `external/logslines/PROVENANCE.json`, then regenerate and run `npm test`. |
| Package check reports missing logging files | A package manifest or bundled dependency does not ship the logging runtime it needs. | Inspect the affected package’s `files` list and packaging preparation; do not suppress the check. |
| Diagnostics fail while an action succeeds | Diagnostic failures are intentionally subordinate. | Inspect configuration, sink permissions, and the sanitized record path without changing the action’s behavior. |

## Final pre-shipping checklist

- [ ] Shared logger, external source, and generated runtime changes are all reviewed together when applicable.
- [ ] `node scripts/build-logger.js --check` passes.
- [ ] `npm test` passes.
- [ ] For an external update, `test/external-logslines.test.js` matches reviewed provenance.
- [ ] For a package release involving diagnostics, `node scripts/check-logging-packages.js` passes.
- [ ] No generated file was hand-edited and no network fetch was introduced into CI, installation, or runtime.
