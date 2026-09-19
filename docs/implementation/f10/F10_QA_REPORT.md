# F10 — Parent Experience 2.0 — QA Report

Branch: `f10/parent-experience-2`
Base: `origin/f9/exam-readiness-simulation` @ `c8699950c848dcf6831276c08ad82111f0d02809`
Certified HEAD: `17bdb56dbf8ff4b725e84aa3db3407e5ac26edd0`
Date: 2026-09-19

## Test Layer Matrix (task §65, mandatory format)

```
AUTOMATED_DOMAIN_UNIT:
  executed: 5509
  passed:   5509
  failed:   0
  skipped:  0
  environment: vitest, in-process, no database

REAL_POSTGRES:
  executed: 11 sections (identity fix, zero-child, pending/accept, cross-child, revoke+re-request,
             multi-child isolation, payer/relationship decoupling, read-only boundary,
             concurrency x2, read-model correctness, performance x5) = 40 individual assertions
  passed:   40
  failed:   0
  skipped:  0
  environment: ephemeral local Postgres (unix socket, never Neon/Preview/Production)

AUTHENTICATED_LOCAL_E2E:
  executed: 8 of 9 task-§53-required scenarios (real service/read-model calls against real Postgres
             with real resolved actor identities)
  passed:   8
  failed:   0
  deferred: 1 (multi-role Parent/Teacher -- F2's own unmodified logic, not re-tested; see F10_AUTHENTICATED_E2E_REPORT.md)
  environment: ephemeral local Postgres, real canAccessLearner/read-model functions, no mocks

REMOTE_AUTHENTICATED_E2E:
  executed: 0
  passed:   0
  deferred: 2 (IVG-F10-01 relationship lifecycle, IVG-F10-02 read-model matrix -- no real
             multi-session Clerk auth available in this environment)
  environment: n/a

REMOTE_PREVIEW_SMOKE:
  executed: 14 (8 new F10 routes anonymous-401 + 6 F0-S-F9 regression routes, see F10_PREVIEW_CERTIFICATION.md)
  passed:   14
  failed:   0
  environment: https://study-laoemfiv8-study-so.vercel.app (Vercel Preview, target: null, study-os project)

AI_REAL_PROVIDER:
  executed: 0
  passed:   0
  applicable: NO -- F10 introduces zero new AI call sites (task §56); see F10_IVG_DEFERRED_TEST_REGISTER.md

PERFORMANCE:
  executed: 5 operations x 20 samples = 100
  passed:   100
  environment: local ephemeral Postgres, no AI provider calls
  limitations: small local samples, no network latency, not a production capacity claim (F10_PERFORMANCE_BASELINE.md)

PRIVACY_PAYLOAD_TESTS:
  executed: 6 (one per read-model method, source-level field inspection + real-Postgres returned shapes)
  passed:   6
  failed:   0

CONCURRENCY:
  executed: 2 (duplicate accept, duplicate revoke) + 1 structural argument (duplicate request, see F10_CONCURRENCY_REPORT.md)
  passed:   2
  failed:   0

IVG_DEFERRED:
  count: 2 new (IVG-F10-01, IVG-F10-02) + 6 carried forward/reconciled (IVG-F7-01, IVG-F8-01/02/03, IVG-F9-01/02/03)
  IDs: IVG-F7-01, IVG-F8-01, IVG-F8-02, IVG-F8-03, IVG-F9-01, IVG-F9-02, IVG-F9-03, IVG-F10-01, IVG-F10-02
```

## 1. Automated domain/unit tests

| Suite | Result |
|---|---|
| Full repository suite (`npx vitest run`, no filter), 337 files | 5509/5509 PASS |
| F10's own new/extended suites (`f10-*.test.ts` x4, extended `f2-parent-relationship-lifecycle.test.ts`) | 36/36 PASS |
| `tsc --noEmit` | Clean, zero errors |
| `next build` | Compiled successfully, zero errors, all 6 new routes present |

## 2. Real-PostgreSQL certification

`scripts/operations/f10-parent-experience-migration-cert.sh` → `f10-lifecycle-cert-runner.ts`, 11 sections, all PASS. Full detail in `F10_AUTHORIZATION_CERTIFICATION.md` and `F10_CONCURRENCY_REPORT.md`. Confirms the migration ledger (unchanged from F9) applies cleanly and F10's identity fix, relationship fixes, and read-model authorization all behave correctly against real data.

## 3. Authenticated E2E

See `F10_AUTHENTICATED_E2E_REPORT.md`. 8 of 9 task §53 scenarios directly re-proven for F10's own new code; the 9th is F2's pre-existing, unmodified multi-role logic. Remote authenticated E2E honestly deferred (`IVG-F10-01`/`IVG-F10-02`), never simulated or upgraded to PASS.

## 4. AI real-provider certification

Not applicable — F10 adds zero new AI call sites (see `F10_IVG_DEFERRED_TEST_REGISTER.md`).

## 5. Non-interference verification (Canonical V2, legacy readiness, F0-S–F9)

`tests/unit/f10-legacy-readiness-noninterference.test.ts` asserts, at the source level: every F10 file exists; no F10 file imports `exam-readiness.service.ts` or calls `calculateExamReadiness`; no F10 file imports `getUpcomingForStudent` or references the `exam_readiness` column; the exam-prep read model sources exclusively from `@/lib/readiness/*` and `@/lib/simulation/*`; every read-model function taking a `studentId` calls `requireAccess` as its own first action. Corroborated behaviorally by the unmodified Canonical V2, F0-S–F9, and F2 named suites all passing unchanged (5509/5509 total).

## 6. Known non-blocking items

- A deployment-target incident occurred and was corrected mid-process — see `F10_PREVIEW_CERTIFICATION.md` §1. The certified Preview record is the corrected one; the incident is documented, not hidden.
- `getSubjectConcepts` has no active/inactive filter to reuse, so `ParentSubjectProgress.totalConcepts` counts every concept mapped to the subject, not only "active" ones — a genuine, pre-existing gap in the reusable read functions, documented in `F10_PARENT_READ_MODEL.md`, not papered over with new business logic.
- The existing `child-overview`/`getChildOverview` surface (pre-F10) still transitively exposes the legacy readiness percentage — a pre-existing condition, contained (not spread) by F10, documented in full in `F10_LEGACY_READINESS_CONTAINMENT.md`.

## 7. Overall QA verdict

**PASS**, with the deferrals above explicitly registered and none silently upgraded to PASS. Zero regressions across 5509 total automated tests, zero TypeScript errors, a clean production build, a real-PostgreSQL adversarial + concurrency + performance certification covering every INV-F10 invariant that could be exercised in this environment, and a corrected, verified Preview deployment.
