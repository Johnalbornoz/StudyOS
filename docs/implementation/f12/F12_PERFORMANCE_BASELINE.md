# F12 — Performance Baseline (local, non-production characterization ONLY)

**This is NOT a Production capacity claim (task section 44).** Measured against a real, ephemeral, local-only Postgres instance with no tuning beyond the schema's own existing indexes, on a single developer machine, with a synthetic 50-learner dataset. Numbers will differ under Production load, connection pooling, network latency, and a larger/differently-shaped dataset.

## Method

`scripts/operations/f12-performance-baseline-runner.ts`, invoked by `f12-performance-baseline.sh` (same ephemeral-Postgres bootstrap every other F12 script uses). Builds 1 institution, 5 classes, 50 learners (25 with real Evidence via a real `updateMastery` call each), then times 10 samples of each entry point with `process.hrtime.bigint()`.

## Results

| Entry point | Sample count | Dataset size | p50 | p95 | max |
|---|---|---|---|---|---|
| `getInstitutionOverview` | 10 | 50 learners / 5 classes / 1 institution | 0.2ms | 2.1ms | 2.1ms |
| `getInstitutionLearnerSummary` | 10 | same | 0.4ms | 1.2ms | 1.2ms |
| `getInstitutionClasses` | 10 | same | 0.2ms | 0.6ms | 0.6ms |

`getInstitutionCoverage`/`getInstitutionReadiness`/`getInstitutionInterventionSummary` were not exercised in this synthetic 50-learner run (they require a real `structureVersionId`/`examVersionId`/populated interventions, which this particular script does not build) — their CORRECTNESS is instead proven in `f12-institution-intelligence-cert-runner.ts`, and their query SHAPE is identical in kind to the three measured above (one or two set-based queries, never per-learner) — see `F12_QUERY_AND_SCALING_MODEL.md`.

## Query count

Each measured entry point issues a small, fixed number of SQL statements regardless of learner count (2–4 for `getInstitutionOverview`'s `Promise.all` batch, 4 for `getInstitutionLearnerSummary`'s parallel distribution queries, 2 for `getInstitutionClasses`'s count+page queries) — confirmed by direct code reading, not a query-log analysis tool (none was available in this environment).

## Interpretation

At 50 learners, every measured entry point completes in low single-digit milliseconds — consistent with the set-based query design (task section 45) rather than an artifact of the small dataset size alone, since the query SHAPE (not the row count scanned) is what determines whether latency scales linearly or catastrophically with institution size. A larger-scale characterization (thousands of learners) was not performed in this environment and is recorded as a residual for a future phase closer to pilot readiness.
