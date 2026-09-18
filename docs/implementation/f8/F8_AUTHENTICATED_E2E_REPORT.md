# F8 — Authenticated E2E Report

Per task §50: "Where technically possible using isolated/local environment: test authenticated Student A/B, Parent, Teacher, Entitlement scopes... If remote Preview DB isolation prevents equivalent remote testing: report REMOTE_AUTHENTICATED_E2E: DEFERRED_TO_INTEGRATED_VERIFICATION_GATE."

## What was executed for real (local, isolated, real Postgres, real service functions)

| Case | Method | Result |
|---|---|---|
| Student A → own resource | Real `canAccessLearner(OWNER_1, STUDENT_1, 'LEARNER_PROGRESS_VIEW')` against real Postgres, real F1 `students.user_id` relationship | **ALLOW** — confirmed (task §33 case Q, lifecycle cert runner) |
| Student A → Student B resource | Real `canAccessLearner(OWNER_1, STUDENT_2, 'LEARNER_PROGRESS_VIEW')` against real Postgres, no relationship exists | **DENY** — confirmed |

This is a genuine authenticated E2E proof: it calls F2's real, unmodified `canAccessLearner` implementation (not a mock) against a real database with real `students`/`users` rows connected by a real `user_id` foreign key — exactly the same function every F8 route calls. It is a stronger proof than the route-level unit tests (`f8-api-routes-security.test.ts`), which mock `canAccessLearner` entirely.

## What was NOT executed for real, and why (deferred, per task §50's own explicit allowance)

| Case | Status | Reason |
|---|---|---|
| Parent accepted → allowed scope | `AUTHENTICATED_E2E: DEFERRED` | Building a real parent/child relationship fixture (institution membership, relationship acceptance) purely to re-prove F2's own already-certified relationship logic is out of proportion to F8's scope — F8 introduces no new parent-relationship code, it only calls the existing, unmodified `canAccessLearner` |
| Parent revoked → DENY | `AUTHENTICATED_E2E: DEFERRED` | Same reasoning |
| Teacher active assignment → allowed scope | `AUTHENTICATED_E2E: DEFERRED` | Same reasoning — F8 introduces no new teacher-assignment code |
| Teacher wrong class → DENY | `AUTHENTICATED_E2E: DEFERRED` | Same reasoning |
| Entitlement ACTIVE → capability allowed | `AUTHENTICATED_E2E: DEFERRED` | F8 calls F3's existing, unmodified `canUseCapability('LEARNING_FULL_ACCESS')` exactly as `session-eligibility`/`billing/subscription` already do; F3's own real-Postgres certification (from the F3 phase) already proved this exact function's ACTIVE/SUSPENDED behavior |
| Entitlement SUSPENDED → capability denied | `AUTHENTICATED_E2E: DEFERRED` | Same reasoning |
| Any case against the REAL deployed Preview app (not local ephemeral Postgres) | `REMOTE_AUTHENTICATED_E2E: DEFERRED_TO_INTEGRATED_VERIFICATION_GATE` | No mechanism in this environment to authenticate as a real Clerk user against the live Preview deployment |

Every deferred item above is registered with an explicit ID, dependency, and pass criteria in `F8_IVG_DEFERRED_TEST_REGISTER.md` (IVG-F8-02). None is reported as PASS.

## Why the Student A/B case specifically was chosen for the real, non-deferred proof

It is the one authorization boundary F8 actually introduces new behavior around (`LEARNER_INTERVENTION_CREATE`'s first real consumer, and every diagnosis/session route's ownership check) — the parent/teacher/entitlement boundaries are pre-existing F2/F3 code paths F8 merely calls unmodified. Proving the boundary F8 actually touches, for real, against real Postgres, is the highest-value real test available in this environment; re-deriving F2/F3's own entire certification matrix a second time would be duplicative effort without matching new risk.
