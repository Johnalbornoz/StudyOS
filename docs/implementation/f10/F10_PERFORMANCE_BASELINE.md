# F10 — Performance Baseline

Characterization only, per task §59 — not a production capacity claim. Measured against a real, ephemeral, local, unix-socket Postgres instance with a small seeded dataset (single-digit rows per table), in-process (no network hop, no AI provider calls, no HTTP layer). Real production latency will be materially higher (network round-trip, TLS, larger datasets, a real connection pool, provider-hosted Postgres).

## Results (20 samples each)

| Operation | p50 | p95 | max |
|---|---|---|---|
| `getParentLearners` | 0.1ms | 0.1ms | 0.1ms |
| `getParentLearnerOverview` | 0.4ms | 0.8ms | 0.8ms |
| `getParentSubjectProgress` | 0.5ms | 1.0ms | 1.0ms |
| `getParentAttentionAreas` | 0.6ms | 1.0ms | 1.0ms |
| Multi-child switch (two sequential `getParentLearnerOverview` calls, D→E) | 0.7ms | 0.9ms | 0.9ms |

## Interpretation

All 5 required operations complete in low single-digit milliseconds against this local instance, meaning none of them does anything algorithmically expensive (no N+1 query pattern was introduced — `getParentSubjectProgress` runs 3 queries per subject via `Promise.all`, not sequentially, and `getParentLearnerOverview` runs its 6 sources via one `Promise.all`). This baseline says nothing about production latency, connection-pool contention under real concurrent Parent traffic, or behavior at realistic dataset sizes (hundreds of concepts, months of activity history) — none of which this environment can characterize.

## Limitations (stated, not hidden)

- Local-only, unix socket, no network latency.
- Small seeded dataset (1 subject, 1 concept, 1 debt row per test learner) — not representative of an established student's actual data volume.
- Excludes AI provider latency (none of these 6 methods call an AI provider, so this is a non-issue here, unlike F7/F8/F9's generation paths).
- No connection-pool or concurrent-load testing beyond the 2-way races in `F10_CONCURRENCY_REPORT.md`.
