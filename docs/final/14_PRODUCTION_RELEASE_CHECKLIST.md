# 14 — Production Release Checklist

Production requires a materially higher bar than Pilot. This checklist is intentionally longer and stricter than [13_PILOT_RUNBOOK.md](13_PILOT_RUNBOOK.md) — an item marked acceptable-for-Pilot above may still be a hard requirement here.

## Gates that must close before Production (beyond every Pilot gate)

| Gate | Current status | What closes it |
|---|---|---|
| Credential rotation | **OPEN** | Same gate as Pilot — see [08_SECURITY_AND_PRIVACY.md](08_SECURITY_AND_PRIVACY.md) |
| Full authenticated E2E | **BLOCKED, in progress** | Same as Pilot |
| Distributed rate limiting | **DEFERRED** | A shared (e.g. Redis-backed) limiter, replacing the current per-process `checkRateLimit` |
| Backup/restore drill with documented RPO/RTO | **DEFERRED, not rehearsed** | Operator identifies Neon's backup offering and performs one real restore drill |
| Paging/alerting/incident communication | **DEFERRED, no tooling exists** | A real alerting integration, minimally on top of `/api/health` |
| Dedicated feature-level kill switches | **DEFERRED** | Flags for Exam Prep / Teacher assignments / Institution Intelligence beyond the existing `AI_ENABLED` |
| Correlation-id end-to-end threading | **DEFERRED** | Wire the existing utility through every downstream log call |
| Real concurrency/load characterization | **DEFERRED, not measured** | A real load test at realistic Production concurrency, not just single-run samples |
| Real assistive-technology accessibility verification | **DEFERRED** | Live screen-reader confirmation of the `aria-live` fix (and a fuller AT pass) |
| CI/CD pipeline (automated gate checks before promotion) | **Does not exist** | Every deploy in this program's history has been a manually-run, human-verified `vercel deploy` |
| Timed exam mode enforcement | **DEFERRED** | Real timer UI + server-side enforcement for `TRAINING_TIMED`/`OFFICIAL_SIMULATION_TIMED` |
| Institution curriculum/exam-version picker | **DEFERRED** | Real picker UI backed by a real list endpoint, replacing the current raw-ID requirement |

## What is already sufficient for Production, carried forward from Pilot readiness

- Architecture and identity/authorization model — real, tested, negative-case-covered across 16 phases.
- AI safety controls (timeout, cost cap, validation, audit trail, kill switch) — real and re-verified live at least once.
- Migration governance and rehearsal pattern (Neon branch trial before a real change) — real and demonstrated.
- Full automated test suite and dependency security — both currently clean.
- Support/incident/rollback/data-strategy model — documented, though not yet exercised on a real incident at Production scale.

## GO/NO-GO decision rule for Production

Production readiness requires **every** row in the gate table above to close, plus everything required for Pilot. This package does not shortcut that by treating "Pilot-ready" as "mostly Production-ready" — the two are evaluated independently, per this program's own standing separation of Pilot and Production bars (see every phase's own Final Report, which has never once flipped `READY FOR PRODUCTION` to YES).

## Current call

```
READY FOR PRODUCTION: NO
```

Every gate in the table above is open. See [16_TRACEABILITY_MATRIX.md](16_TRACEABILITY_MATRIX.md) for the live-updated final decision once the authenticated E2E session (in progress) completes — that will change the Pilot call, but **not** this one, since none of the Production-specific gates above are affected by E2E completion.
