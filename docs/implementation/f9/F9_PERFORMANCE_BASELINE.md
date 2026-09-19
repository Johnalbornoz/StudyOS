# F9 — Performance Baseline

Per task §53. **Local, ephemeral-Postgres characterization only — never a production capacity claim.** Measured inside `scripts/operations/f9-concurrency-performance-runner.ts`, same run as the concurrency certification, using Node's `performance.now()` around each real service call.

| Operation | n | median (p50) | p95 | max |
|---|---|---|---|---|
| Readiness calculation (`computeReadinessSnapshot`) | 10 | 2.7ms | 4.8ms | 4.8ms |
| Simulation planning (`buildSimulationPlan`) | 10 | 0.3ms | 0.6ms | 0.6ms |
| Evaluation persistence (`recordSimulationItemResponse`, structured/deterministic grading path — no AI latency) | 10 | 2.3ms | 4.4ms | 4.4ms |
| Post-exam recomputation (readiness snapshot recompute after new Evidence) | 5 | 1.9ms | 2.4ms | 2.4ms |

## Labeling and limitations (explicit, per task §53's own requirement)

- **Environment**: a single ephemeral, local, unix-socket-only Postgres instance on the certification machine — no network latency, no connection pooling contention, no concurrent load from other tenants/requests.
- **AI latency is excluded and labeled as such**: the evaluation-persistence measurement uses only the deterministic (`gradeStructuredAnswer`) grading path specifically so the number reflects database/service overhead, not a real AI provider's response time — no real AI call was made anywhere in this baseline (consistent with `F9_AI_PROVIDER_CERTIFICATION.md`'s deferral). A real `gradeAnswer` (AI-graded free-text) call would add real provider latency on top of these numbers, not instead of them.
- **Sample sizes are small** (5-10) — sufficient to characterize order-of-magnitude local behavior, not to establish a statistically rigorous production SLA.
- **These numbers must never be quoted as production capacity or production latency** — they exist only to catch a gross regression (e.g. an accidental N+1 query) between phases, and to give a rough sense of where time is spent (readiness calculation, which invokes F8's real diagnosis per evidenced blueprint target, is the most expensive of the four, as expected given it does the most real work).

## Reported per task §73's mandatory matrix

```
PERFORMANCE_SIMULATION:
  executed: 4 operations x (10, 10, 10, 5) samples = 35 total measurements
  passed: 35
  failed: 0
  environment: local ephemeral Postgres (unix socket), no AI provider calls
  limitations: small sample sizes; local-only; excludes AI provider latency; not a production capacity claim
```
