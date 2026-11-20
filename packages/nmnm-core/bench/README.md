# Core benchmark

Developer-only; excluded from published core files. Run from repository root with Node.js 22.19.0+ and SQLite/FTS5. Runners create private synthetic databases, delete them afterward and never overwrite results. Never supply personal stores.

## Run and compare

1. Install the locked dependencies: `npm ci`.
2. Before changing core, create an output directory and run a smoke measurement:

   ```sh
   run=$(mktemp -d "${TMPDIR:-/tmp}/nmnm-bench.XXXXXX")
   node packages/nmnm-core/bench/retrieval.js "$run/before" 100 30
   ```

   Arguments: output directory, optional comma-separated sizes (`100,1000,10000,100000`), optional samples (`30`–`1000`). Omitting both optional arguments runs all four sizes with 30 samples. Each operation has five warmups; results are `<output>/<size>.json`.
3. Make the change; run `node packages/nmnm-core/bench/retrieval.js "$run/after" 100 30`. Keep machine, Node/SQLite, benchmark, fixtures and arguments identical. Record revisions/hashes. Use all four sizes for acceptance; investigate regressions with three alternating before/after pairs and fresh output paths.
4. Check `fixture_digest`, each mode's `result_digest` and `count_result_digest`; compare `modes.{reused,cold}.timings.*.{p50_ms,p95_ms}` and database bytes. Plans/bytecode explain SQL work, not latency gains.

## Follow-up matrix

1. Reuse `$run` above. Set `BASE_REF` and `PLAIN_REF` to reviewed baseline/control-source Git refs (they may match). Extract compatible standalone modules exporting `open`:

   ```sh
   : "${BASE_REF:?Set a reviewed baseline ref}" "${PLAIN_REF:?Set a reviewed control-source ref}"
   git show "${BASE_REF}:packages/nmnm-core/src/index.js" > "$run/before.mjs"
   git show "${PLAIN_REF}:packages/nmnm-core/src/index.js" > "$run/plain.mjs"
   ```

2. Disable only index installation; preserve other logic. Modules execute code: review them first. This guarded replacement requires the existing call; adapt other layouts manually:

   ```sh
   node --input-type=module - "$run/plain.mjs" <<'JS'
   import { readFileSync, writeFileSync } from 'node:fs';
   const path = process.argv[2], source = readFileSync(path, 'utf8');
   const call = '      ensurePerformanceIndex(db);';
   if (source.split(call).length !== 2) throw Error('Review index installation manually');
   writeFileSync(path, source.replace(call, '      // Indexless temporary benchmark control.'));
   JS
   ```

3. Smoke-test, then run the full matrix; the optional final size supports the same four sizes and defaults to 100,000:

   ```sh
   node packages/nmnm-core/bench/followup.js "$run/smoke.json" "$run/before.mjs" "$run/plain.mjs" 100
   node packages/nmnm-core/bench/followup.js "$run/matrix.json" "$run/before.mjs" "$run/plain.mjs"
   ```

4. Inspect `profiles` (dense/removed-heavy/expired-heavy × unanalyzed/bounded-analysis/stale statistics), `writes`, `fts` and control hashes. Reads use three rotating 30-sample comparisons; writes use three 100-sample reused/cold comparisons, all after five warmups. Checks: canonical/result parity, read-only bytes, count plans/bytecode and previous/current FTS readers/writers. Statistics changes and writable upgrade timings use disposable stores only. Apply timing budgets manually.

## Coverage and interpretation

- Fixtures: deterministic UUIDs/timestamps, distant expiry, tagless/tagged rows, uneven sources/namespaces, removals/expiry, varied content lengths and ranking ties. Initial exports equal fixtures; repeated reads and reused/cold digests must agree.
- Workload: recall; recency, kind/scope/importance/confidence/namespace/source/all-tag filters; pagination; strict/Boolean/phrase/prefix/NEAR/punctuation and broad/narrow searches; export; create; content/tag/metadata/score/expiry patches; soft removal/restoration. Retrieval includes exact counts and tag hydration.
- Main output: Node/SQLite/platform, journal mode, digests, plans, database/sidecar bytes, import time and latency samples/p50/p95/min/max. Plans cover guarded source pages/counts, unfiltered counts and BM25/rank with importance/ID ties. `count_canonical_column_reads` counts canonical-table `Column` instructions for source/kind/scope/score counts, not total index work or page hydration; `source_count_canonical_column_reads` remains compatible. Added counts have a separate digest, preserving the original `result_digest`.
- Timing: `reused` holds a writable connection; `cold` opens/closes one per operation, without flushing OS caches. Main-runner setup, validation, read-only SQL instrumentation, warmup and lifecycle preparation are excluded; import is separate. Other mutations are sequential, not independent interchangeable samples. Creation includes UUID generation; the production clock is unchanged.
- Limits: warm-cache synthetic measurements exclude startup disk I/O, read-only adapter setup, OpenCode bridge/native-host latency and network filesystems. Plans/performance vary by runtime. Main timings exclude populated-store index builds/replacements; follow-up records setup.

## Acceptance policy

Require matching digests/exports and passing lifecycle, transaction and secure-deletion tests. Require less observed SQL work and at least 10% or 0.1 ms targeted median improvement. Investigate unaffected median/p95 increases exceeding both 20% and 0.2 ms; reject unresolved regressions reproduced in three pairs. Provisional index budgets: ≤25% database growth and ≤20% create/content-patch median overhead unless approved. Never make latency an ordinary unit-test assertion.

## Retrieval quality

`fixtures/quality.json` has proposed, unvalidated labels; development/held-out splits; lexical, authority, identifier, alias, advanced-expression and semantic-gap cases. Require operator review of labels/criteria before experimenting; never tune on held-out queries. Preserve importance/ID ties. Small synthetic examples establish neither general semantic retrieval nor recency-only context-injection gains.

At K=5, Precision@5 = relevant returned IDs / 5; Recall@5 = relevant returned IDs / labeled relevant IDs. Queries without relevant labels have null recall: assess unwanted matches separately; exclude them from recall averages. Inspect recorded IDs/per-query metrics and split-level macro means. Provisional threshold: +0.05 macro Recall@5, no macro Precision@5 loss or advanced-expression/visibility regressions, and ≤20% retrieval p95 overhead.

## Recorded evidence

[Manual measurements](../../../docs/CORE_CLI_MANUAL.md#enhancement-quantification-and-evidence) summarize results. `docs/benchmarks/*.json` is developer audit evidence, not a user API/performance guarantee. Historical reruns require recorded revisions, transformations, hashes and environment; aggregates include additional one-off probes. Keep new results outside the checkout unless recording reviewed evidence.
