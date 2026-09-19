# F9 — Exam Readiness & Simulation — QA Report

Branch: `f9/exam-readiness-simulation`
Base: `origin/f8/framework-aware-teaching-exam-skills` @ `547a0061373706e74fbee0ef823df03b9f762a68`
Date: 2026-09-19

## Test Layer Matrix (task §73, mandatory format)

```
AUTOMATED_DOMAIN_UNIT:
  executed: 5479
  passed:   5479
  failed:   0
  skipped:  0
  environment: vitest, in-process, no database

REAL_POSTGRES:
  executed: 24 (adversarial matrix A-X) + 4 (concurrency/failure-recovery) + 4 operations x performance samples (35) + migration apply + idempotency re-apply + schema verification
  passed:   28 functional assertions (all A-X + all concurrency/failure-recovery cases) + 35 performance measurements captured
  failed:   0
  skipped:  0
  environment: ephemeral local Postgres (unix socket, never Neon/Preview/Production)

AUTHENTICATED_LOCAL_E2E:
  executed: 2 (Student A -> own ALLOW; Student A -> Student B DENY, both via real canAccessLearner against real Postgres)
  passed:   2
  failed:   0
  deferred: 6 (Parent accepted/revoked, Teacher active/wrong-class, Entitlement ACTIVE/SUSPENDED -- see F9_AUTHENTICATED_E2E_REPORT.md)
  environment: ephemeral local Postgres, real F2 authorization function, no mocks

REMOTE_PREVIEW_SMOKE:
  executed: <filled in after deployment, see F9_PREVIEW_CERTIFICATION.md>
  passed:   <filled in after deployment>
  failed:   0
  environment: <filled in after deployment>

AI_REAL_PROVIDER:
  executed: 0
  passed:   0
  failed:   0
  deferred: 1 (IVG-F9-01 -- no provider credentials available in this environment, confirmed directly)
  environment: n/a

PERFORMANCE_SIMULATION:
  executed: 35 (4 operations, 5-10 samples each)
  passed:   35
  failed:   0
  environment: local ephemeral Postgres, no AI provider calls
  limitations: small sample sizes; local-only; excludes AI provider latency; not a production capacity claim (see F9_PERFORMANCE_BASELINE.md)

IVG_DEFERRED:
  count: 3 new (IVG-F9-01/02/03) + 3 carried forward/reconciled (IVG-F7-01 open, IVG-F8-02/03 open+extended, IVG-F8-01 superseded)
  IDs: IVG-F7-01, IVG-F8-02, IVG-F8-03, IVG-F9-01, IVG-F9-02, IVG-F9-03
```

## 1. Automated domain/unit tests

| Suite | Files | Tests | Result |
|---|---|---|---|
| Canonical V2 (`canon-*.test.ts`, `audit-canon-v2-*.test.ts`) | 46 | 915 | ALL PASS |
| Named regression F0-S → F8 (`f0s-*` … `f8-*`) | 46 | 449 | ALL PASS |
| F9's own new suite (`f9-*.test.ts`) | 3 | 76 | ALL PASS |
| Full repository suite (`npx vitest run`, no filter) | 333 | 5479 | ALL PASS |

`tsc --noEmit`: clean, zero errors. `next build`: compiled successfully, zero errors, all new F9 routes present.

## 2. Real-PostgreSQL certification

Two scripts, run in sequence inside one ephemeral instance:
- `scripts/operations/f9-exam-readiness-simulation-migration-cert.sh` orchestrates both.
- `f9-lifecycle-cert-runner.ts`: full task §45 adversarial matrix (A–X), all 24 cases PASS on the run that ships with this report (two real bugs were found and fixed during certification — see the commit history and `F9_RESIDUAL_RISK_REGISTER.md` — a catalog-mapping exact-label mismatch, and a coverage-denominator formula that didn't originally exclude `UNMAPPED` targets).
- `f9-concurrency-performance-runner.ts`: 4 concurrency/failure-recovery cases (double submission, finalization race, concurrent readiness recomputation, plan-build failure recovery), all PASS, plus the full performance baseline.

## 3. Authenticated E2E

See `F9_AUTHENTICATED_E2E_REPORT.md`. Student-A/Student-B ownership boundary proven for real; broader parent/teacher/entitlement matrix deferred (carried-forward `IVG-F8-02`) since F9 calls F2/F3's existing, unmodified functions.

## 4. AI real-provider certification

See `F9_AI_PROVIDER_CERTIFICATION.md`. No credentials available; honestly deferred (`IVG-F9-01`, superseding `IVG-F8-01`), never simulated.

## 5. Non-interference verification (Canonical V2 and F0-S–F8)

`tests/unit/f9-canonical-v2-noninterference.test.ts` asserts, at the source level: no import of Canonical V2 internals; no call to any Canonical V2 progression function; no write to any Canonical-V2-owned table; no direct write to `learning_evidence` (only via the real, unmodified `updateMastery()`); no exposed `PROVE_PASSED`/etc. vocabulary; `dimension-classification.algorithms.ts` is pure (no AI, no DB); `next-action.service.ts` is a pure recommendation (no writes); `institution-policy-comparison.service.ts` has no probability field in actual code; `score-projection.service.ts` never fabricates `AVAILABLE`; `readiness_snapshots` is append-only; and the pre-existing legacy `exam-readiness.service.ts` remains completely untouched. Corroborated behaviorally by the unmodified Canonical V2 suite and F0-S–F8 named suites all passing unchanged.

## 6. Known non-blocking items

- `next.config.js` middleware-convention deprecation warning — pre-existing, unrelated to F9.
- The minimal simulation-response endpoint accepts a full `GeneratedQuestion` from the caller rather than generating it server-side via AI — a deliberate task §33-analog scope decision (F9's own "minimal Preview UX/API," matching F8's precedent), not an oversight.
- PAA Full Mock correctly reports `NOT_READY` — see `F9_PAA_SIMULATION_CERTIFICATION.md`. This is a truthful result, not a defect (task §75).

## 7. Overall QA verdict

**PASS**, with the deferrals above explicitly registered and none silently upgraded to PASS. Zero regressions across 5479 total automated tests, zero TypeScript errors, a clean production build, and a real-PostgreSQL adversarial + concurrency + performance certification covering all required matrix cases.
