# Logger and Logslines Developer Manual

This manual is for maintainers of nanomneme’s opt-in diagnostic logging. It covers the checked-in external Logslines source, the shared logger implementation, two generated runtimes, validation, and release checks. It does not describe normal memory operations or adapter configuration in full; see [Architecture](ARCHITECTURE.md) and [Memory handling sequence](SEQUENCE_MEMORY_HANDLING.md) for those boundaries.

## Purpose and boundaries

Nanomneme diagnostics are opt-in and append privacy-bounded `logslines/v1` JSONL records for selected explicit actions. The shared logger classifies an action’s result, resolves logging configuration, validates and serializes the record through Logslines, and writes it to the component log. It must remain subordinate to the action it observes: disabled, invalid, or failed diagnostics never change the action’s result or error.

The logger is intentionally shipped with `@openlines/nmnm-core/logging`, rather than fetched or installed at runtime. This lets the CLI and every adapter use one reviewed implementation and one pinned Logslines release. The observer does not serialize memory payload fields or stack traces; failed records preserve the thrown error's message and class name in `error`. Error messages are not redacted and may expose sensitive input, memory IDs, queries, or paths. Review logs before sharing.

## Source and artifact map

`nmnm ui` bypasses terminal command diagnostics and dynamically launches `nmnm-ui`. UI mutations use the core observer: edit/expiry/restore map to `retain`, remove/purge to `remove`. General request, launcher, and browser errors use the UI-only `ui.error` event, with operation `ui_error`, failed status, null duration/session, and empty attributes. The UI bundles the unchanged shared configuration, sink, error normalization, and pinned Logslines emitter separately; it does not extend the shared operation catalog. Successful reads/navigation, canceled actions, and empty patches emit nothing. Mutation errors emit once. Both paths reread shared settings per action and write `nmnm-ui.jsonl`.

| Path | Role | Edit directly? |
|---|---|---|
| `shared/logger/index.js` | Operation observer: executes once, measures duration, classifies completion, and preserves results/errors. | Yes. |
| `shared/logger/catalog.js` | Closed Nanomneme operation/event catalog and error normalization. | Yes. |
| `shared/logger/config.js` | Shared JSONC opt-in and user-level adapter overrides; invalid configuration disables logging. | Yes. |
| `shared/logger/sink.js` | Component JSONL output and owner-only permissions; calls the upstream emitter. | Yes. |
| `external/logslines/src/logger.js` | Generic Logslines envelope validation and emission; no Nanomneme operation policy. | Through `logslines:update` or focused `external:update`. |
| `external/logslines/src/sinks/stderr.js` | Upstream stderr sink; Nanomneme uses its own file sink instead. | Through `logslines:update` or focused `external:update`. |
| `external/logslines/spec/v1/schema.json`, `PROVENANCE.json`, `LICENSE` | Schema, pinned release/hashes, and attribution. | Through `logslines:update` or focused `external:update`. |
| `scripts/build-logger.js` | Builds separate core observer and UI error bundles from the pinned Logslines source. | Yes, when changing the build contract. |
| `packages/nmnm-core/src/logging-runtime.generated.js` | Generated, self-contained runtime included in published core packages. | No. Regenerate it. |
| `packages/nmnm-ui/src/ui-logging-runtime.generated.js` | Generated UI-only error runtime, including bundled JSONC and license. | No. Regenerate it. |
| `packages/nmnm-core/src/logslines.js` | Public core logging entry point that imports the generated runtime. | Yes. It is not itself a generator input. |
| `adapters/*/src/logslines.js` | Component bindings: adapter identity, user configuration, and host correlation helpers. | Yes. |
| `packages/nmnm-cli/src/logslines.js` | CLI identity/configuration binding; command observation remains in the executable. | Yes. |
| `packages/nmnm-ui/src/logslines.js` | UI mutation binding and deduplication of general errors. | Yes. |
| `packages/nmnm-ui/src/ui-logger.js` | Build-only general-error emitter; excluded from the UI npm package. | Yes. |
| `shared/fixtures/logslines-release.json` | Independent reviewed release metadata and SHA-256 pin; repository-only, excluded from runtime packages. | Updated by `logslines:update`; review the diff. |
| `test/external-logslines.test.js` | Offline fixture/provenance/source checks and both generated license banners. | Only when the validation contract changes. |
| `scripts/maintenance.js` | Coordinates read-only validation, logger builds, deliberate upstream release updates, and existing Codex installation refreshes. | Yes, when maintenance workflows change. |
| `scripts/check-logging-packages.js` | Installed-tarball checks, fixture/build-source exclusion, and reusable physical Codex dependency preparation. | Yes, when distribution checks change. |
| `scripts/external-logslines.js` | Maintainer-only snapshot check/update command. | Yes, when maintenance tooling changes. |
| `shared/logger/test/`, component logging tests, scripts' logger tests | Shared contracts, caller behavior, and packaging/maintenance regression tests. | Yes. |
| `adapters/pi/test/logger-helper.js` | Test-only clock/sink/configuration injection; not a production binding. | Yes. |

`src/logslines.js` consistently means a component binding. Core uses the same internal filename while preserving its public `@openlines/nmnm-core/logging` export; upstream filenames remain unchanged.

`npm install`, package runtime, and CI do not fetch Logslines. `npm test` does not regenerate the runtime; it runs `node scripts/build-logger.js --check` and fails if either checked-in artifact is stale.

## Read-only repository validation

Run `npm run validate` before shipping. It runs `npm test` (generated-output check and full suite), `npm audit --audit-level=high --omit=dev`, then standalone package validation. Each step must pass before the next runs. npm registry access is required for audit and may be required for package dependencies; Codex is not required. Validation never regenerates tracked bundles, fetches upstream Logslines, prepares dependencies in the adapter, or reinstalls plugins.

Standalone validation also checks Claude's plugin-local registry lock and performs a frozen copied-plugin install, separate audit, adapter suite, and stdio MCP/management smoke. That copy currently resolves core `0.3.0` under `^0.3.0`; workspace and packed checkout checks use `0.3.1`. The logging import is compatible across both releases. Publishing core does not update Claude's lock; follow the [Claude refresh procedure](../adapters/claude/docs/CLAUDE_ADAPTER_MANUAL.md#refresh-the-locked-core) after publication.

CI and release use this command as a blocking validation gate and retain the informational full-tree audit. Both separately run rendered Chromium checks; those are not part of `npm run validate`. Tagged publishing requires repository validation and rendered UI success on the tagged checkout. Release validation checks the root tag and extracts nonempty changelog notes before publication; validated notes become the GitHub Release body. See [UI validation](../packages/nmnm-ui/README.md#validation) for browser setup and artifacts.

## Configuration and record contract

- Default: off. Enable `logging.enabled` in `~/.local/share/nanomneme/config.jsonc`; JSONC comments and trailing commas are accepted.
- User-level adapter overrides accept explicit booleans; absence inherits. Invalid applicable shared/adapter configuration disables logging. Project settings cannot authorize it.
- The first eligible action caches configuration per logger instance. UI creates a fresh logger per mutation/error; Pi reload, MCP restart, or a new CLI/bridge/runner process refreshes the corresponding instance.
- Logs append to `~/.local/share/nanomneme/logs/<component>.jsonl`. First emission creates/tightens the logs directory to `0700` and regular JSONL files to `0600`; parent data-directory permissions are unchanged. No stderr fallback or automatic rotation.
- Logging failures preserve the observed result/error. Successful internal reads, context injection, navigation, help/version, and canceled actions remain quiet; model-facing recall/retrieve calls are observed.

| Caller | User override | Correlation |
|---|---|---|
| CLI, UI | Shared config only | Null. |
| Core standalone | Shared default; optional caller-supplied `adapterConfigPath` | Caller-supplied `session_id`, otherwise null. |
| Pi | `<Pi agent directory>/nmnm.jsonc`, normally `~/.pi/agent/nmnm.jsonc` | `ctx.sessionManager.getSessionId()`, otherwise null. |
| Claude | `${CLAUDE_PLUGIN_DATA}/nmnm.jsonc`, fallback `~/.claude/nmnm.jsonc` | Null for MCP tools and management; hook IDs are not forwarded. |
| OpenCode | `${XDG_CONFIG_HOME:-~/.config}/opencode/nmnm.jsonc` | Server tool-context `sessionID`; management/TUI use null. |
| Codex | `$CODEX_HOME/nmnm.jsonc`, fallback `~/.codex/nmnm.jsonc` | Nonempty `CODEX_THREAD_ID`, then `CODEX_SESSION_ID`, otherwise null. |

Every record has the closed 12-field envelope: `schema`, `timestamp`, `level`, `event`, `message`, `service`, `context`, `operation`, `status`, `duration_ms`, `attributes`, and `error`. `schema` is `logslines/v1`; `service` identifies namespace `openlines`, name `nanomneme`, the emitting component, and its package version. `context` contains only `session_id`; `attributes` is empty.

Shared outcomes use `ok`, `empty`, `not_found`, `blocked`, or `failed`. Retrieve is `empty` only when `total` is zero, not merely when an offset produces an empty page. Blocked duration is null; other shared durations measure the action callback. Only failed outcomes carry normalized errors, with `kind`, `code`, raw `message`, `retryable: false`, and optional class-name `cause_kind`. Verify/repair can fail from their reports without throwing. UI general errors use `ui_error`/`ui.error`, failed status, and null duration/session. The exact event/message combinations live in the [shared catalog](../shared/logger/catalog.js); the envelope is defined by the [pinned schema](../external/logslines/spec/v1/schema.json).

Memory fields, IDs, queries, filters, paths, prompts, and stack traces are not added as structured diagnostic payloads. Raw error messages remain unredacted and may contain those values; review logs before sharing. Existing databases, pins, and logs require no migration.

## When regeneration is required

Use `npm run logslines:build` for routine maintenance. It checks both bundles, regenerates only stale outputs, rechecks, and validates standalone installed packages even when the bundles were already current. Node 22.19+, npm, and installed repository dependencies are required; package validation may need npm registry access. It does not fetch upstream Logslines or prepare/reinstall Codex.

- `up-to-date`: both bundles already match current inputs.
- `updated`: stale bundles were regenerated and rechecked.
- `validated`: standalone package logging checks passed.
- `failed`: generation, filesystem access, rechecking, or package validation failed; the command exits nonzero.
- `npm run logslines:build -- --fast`: skip package validation for the edit loop; prints `validation skipped (--fast)`.

The focused `node scripts/build-logger.js --check` remains read-only: exit `0` means current, `2` means stale/missing, and `1` means failure. Direct `node scripts/build-logger.js` regenerates stale outputs without package validation. Both targets are compiled before any writes; build/read failures prevent writes. Generated output is independent of the caller's working directory. Review generated changes and run `npm test` before shipping.

Run `node scripts/build-logger.js` before shipping when a change affects the generated runtime’s inputs:

- Production source under `shared/logger/` (tests alone do not require regeneration).
- UI general-error source `packages/nmnm-ui/src/ui-logger.js`, or the bundled JSONC parser version/license.
- The Logslines snapshot, its provenance, or its license under `external/logslines/`.
- `scripts/build-logger.js`.

**Do not regenerate solely because ordinary core storage, CLI, UI, adapter, documentation, or logger-test files changed**. A change to `packages/nmnm-core/src/logslines.js` alone also does not make the generated runtime stale. Run the generator whenever uncertain; `node scripts/build-logger.js --check` is the authoritative staleness test.

## Workflow: change the shared logger

Use this workflow for a behavior, catalog, configuration, observer, or sink change in `shared/logger/`.

1. Change the source and add or update focused tests under `shared/logger/test/`.
2. Refresh stale runtimes and validate installed packages:

```sh
npm run logslines:build
```

3. Confirm it is current and run the repository suite:

```sh
node scripts/build-logger.js --check
npm test
```

4. Include handwritten source and every affected generated bundle in the same change. Review both artifacts; the generator preserves bytes for unaffected targets.

If you skipped package validation with `--fast`, run it before a release or package-distribution change:

```sh
node scripts/check-logging-packages.js
```

This packs core, CLI, UI, and adapters, installs them outside the workspace, and verifies that the logging runtime is present and loadable. It verifies enabled success/failure emission from core, CLI, and every adapter, plus UI mutations/general errors and a live installed UI request error. It uses npm registry access for ordinary dependencies. `logslines:build` includes this check by default; `--fast` provides the shorter edit loop.

## UI error bundle

- Source: `packages/nmnm-ui/src/ui-logger.js`; generated runtime: `packages/nmnm-ui/src/ui-logging-runtime.generated.js`. The source is build-only and excluded from the npm package; `src/logslines.js` imports the generated runtime.
- Regenerate with `node scripts/build-logger.js`; verify with `node scripts/build-logger.js --check`.
- `npm test` checks both generated runtimes. The single command builds/checks both targets and reports each stale artifact. UI-only changes preserve core output bytes; core keeps JSONC external, while UI bundles its ESM entry and license. Shared configuration/sink or upstream snapshot changes affect both targets.
- Browser reports are authenticated, bounded to 600 message characters, and best effort; server unavailability prevents delivery. Raw error messages are not redacted.

## Workflow: update the upstream Logslines release

Use an exact published semantic-version tag. The command requires installed repository dependencies, GitHub access for the release snapshot, and npm registry access as needed for standalone package validation.

```sh
npm run logslines:update -- v0.1.0
```

- Replace the example with the intended published `v<major>.<minor>.<patch>` tag; no automatic latest-version lookup.
- Fetch and validate all required files before replacing the snapshot. Snapshot directory replacement and fixture file replacement are individually atomic, not one transaction.
- Update `external/logslines/PROVENANCE.json` and the independent `shared/fixtures/logslines-release.json` from the validated release. The fixture is a reviewed release pin, not runtime state; it is excluded from published packages.
- Check the offline pin, refresh stale core/UI bundles, run `npm test`, then validate standalone packages once.
- Review the source, provenance, fixture, and generated diffs. If a later step fails, updated files remain for review; the command names the paths that may be partially updated and exits nonzero. Correct the failure and rerun the coordinated command.
- Tests compare the checked-in fixture against provenance, actual source hashes, and both generated banners without fetching upstream or regenerating expectations.

Focused commands remain available:

```sh
npm run external:check -- v0.1.0
npm run external:update -- v0.1.0
```

`external:check` compares local source/provenance with the selected upstream release. `external:update` replaces only the snapshot/provenance; it leaves the shared fixture and generated bundles unchanged and does not run tests. It does not complete a coordinated release update. All three upstream commands require network access and are maintainer-only; CI, installation, and package runtime do not fetch Logslines.

## Workflow: refresh Codex after logging updates

For an existing enabled local marketplace installation:

```sh
npm run codex:update
```

- Requires the existing marketplace to point to this checkout and the installed plugin source to match its adapter. Missing setup prints the applicable command; wrong registrations, disabled plugins, and unsupported CLI metadata stop before generation/preparation.
- Refreshes stale bundles, then prepares only physical core/parser dependencies using packaged core files and the installed exact parser. No full package suite, npm dependency installation, or upstream fetch is repeated during this workflow.
- Compares adapter files, prepared dependencies, and cached plugin contents. Same-version changes and obsolete managed files trigger refresh; unrelated adapter dependencies remain intact.
- Reinstalls only when cached content differs and verifies the result. Respects `CODEX_HOME`; default cache is `~/.codex/plugins/cache/nanomneme-local/nmnm-codex/<installed-version>/`.
- Reports `up-to-date` or `updated`; `reload-required` follows reinstall. Start a new session and review hook trust prompts. Cache verification is not live hook or end-to-end memory validation.
- Disabled plugins are left untouched. The current command supports refreshing enabled installations only.

`node scripts/check-logging-packages.js --prepare-codex` remains compatible: it validates standalone packages first, then uses the extracted preparation helper with the validated physical dependencies. It may require npm registry access. The plain package check does not refresh the adapter or cache. See the [Codex manual](../adapters/codex/docs/CODEX_ADAPTER_MANUAL.md#refresh-after-checkout-updates).

## What not to do

- Do not hand-edit either `*.generated.js` logging runtime.
- Do not add Logslines as an npm dependency, a workspace dependency, or a runtime download.
- Do not replace the external snapshot by copying files manually. Use `logslines:update` for the complete validated snapshot, fixture, generation, and testing workflow.
- Do not omit the generated runtime from a shared-logger or external-source change.
- Do not weaken the offline hash test to accommodate a changed snapshot. Update the reviewed fixture's exact tag, release URL, and hashes through `logslines:update` after reviewing the upstream release.
- Do not add memory payloads, identifiers, queries, storage paths, or stack traces as diagnostic fields. Extend the closed catalog and its tests instead of adding ad hoc fields. Raw error messages remain unredacted and may contain sensitive values.
- Do not make memory persistence, context injection, read-only navigation, or diagnostics-disabled execution depend on logging success.

## Troubleshooting

| Symptom | Meaning | Correct action |
|---|---|---|
| `Shared logger bundle is stale` or `UI error logger bundle is stale` | The named runtime differs from current generator inputs. | Run `node scripts/build-logger.js`, review the artifact, then run `npm test`. |
| `external:check` reports source or provenance differences | The checked-in snapshot does not exactly match the selected upstream release. | Use the intended exact tag, inspect the discrepancy, and use `logslines:update` only when deliberately adopting that release. |
| Offline Logslines hash test fails after an update | The shared release fixture, snapshot, or provenance differs; a focused update may have left the prior fixture in place. | Review the intended tag and rerun `npm run logslines:update -- <tag>`; review the resulting fixture and artifacts. |
| Package check reports missing logging files | A package manifest or bundled dependency does not ship the logging runtime it needs. | Inspect the affected package’s `files` list and packaging preparation; do not suppress the check. |
| Diagnostics fail while an action succeeds | Diagnostic failures are intentionally subordinate. | Inspect configuration, sink permissions, and the bounded record path without changing the action’s behavior. |

## Future feature: shared general-error emission

- Not implemented: a public general-error API in `@openlines/nmnm-core/logging`.
- Goal: allow UI to reuse core's runtime for `ui.error`, removing its build-only emitter and second bundle.
- Requires an explicit shared/core API change, event ownership, privacy rules, and regression coverage. Current UI-only emission remains separate.

## Final pre-shipping checklist

- [ ] Shared logger, external source, and generated runtime changes are all reviewed together when applicable.
- [ ] `npm run validate` passes: generated-output check, full suite, shipped audit, and installed-package checks.
- [ ] For an external update, `shared/fixtures/logslines-release.json` matches reviewed provenance and source hashes; offline pin tests pass.
- [ ] No generated file was hand-edited and no upstream Logslines fetch was introduced into CI, installation, or runtime.
