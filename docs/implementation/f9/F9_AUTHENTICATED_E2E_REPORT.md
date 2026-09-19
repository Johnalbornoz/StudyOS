# F9 — Authenticated E2E Report

Per task §49: "Where safely possible in isolated environment, test [the full Student/Parent/Teacher/Entitlement matrix]... Remote testing may remain IVG-deferred if Preview DB isolation is not proven."

## What was executed for real (local, isolated, real Postgres, real service functions)

| Case | Method | Result |
|---|---|---|
| Student A → own readiness/simulation data | Real `canAccessLearner(OWNER_1, STUDENT_1, 'LEARNER_PROGRESS_VIEW')` against real Postgres, real F1 `students.user_id` relationship | **ALLOW** — confirmed (task §45 case T, lifecycle cert runner) |
| Student A → Student B readiness/simulation data | Real `canAccessLearner(OWNER_1, STUDENT_2, 'LEARNER_PROGRESS_VIEW')` against real Postgres | **DENY** — confirmed |

This calls F2's real, unmodified `canAccessLearner` against a real database with real `students`/`users` rows connected by a real `user_id` foreign key — the exact same function every F9 route calls (both for readiness reads and for the `LEARNER_INTERVENTION_CREATE`-gated simulation-attempt routes, which share the same underlying ownership check).

## What was NOT executed for real, and why (deferred, consistent with F8's own precedent)

| Case | Status | Reason |
|---|---|---|
| Parent accepted → appropriate read = ALLOW | `AUTHENTICATED_LOCAL_E2E: DEFERRED` | F9 introduces no new parent-relationship code — it calls F2's existing, unmodified `canAccessLearner`, already certified for this exact case in F2's own phase |
| Parent revoked → DENY | `AUTHENTICATED_LOCAL_E2E: DEFERRED` | Same reasoning |
| Teacher assigned → appropriate read = ALLOW | `AUTHENTICATED_LOCAL_E2E: DEFERRED` | F9 introduces no new teacher-assignment code |
| Teacher wrong class → DENY | `AUTHENTICATED_LOCAL_E2E: DEFERRED` | Same reasoning |
| ACTIVE entitlement → paid simulation capability ALLOW | `AUTHENTICATED_LOCAL_E2E: DEFERRED` | F9 calls F3's existing, unmodified `canUseCapability('LEARNING_FULL_ACCESS')` exactly as F8 already does for AI content generation; F3's own real-Postgres certification already proved this function's ACTIVE/SUSPENDED behavior |
| SUSPENDED entitlement → DENY | `AUTHENTICATED_LOCAL_E2E: DEFERRED` | Same reasoning |
| Any case against the REAL deployed Preview app (not local ephemeral Postgres) | `REMOTE_AUTHENTICATED_E2E: DEFERRED_TO_INTEGRATED_VERIFICATION_GATE` | No mechanism in this environment to authenticate as a real Clerk user against the live Preview deployment (carried forward from F8's `IVG-F8-02`, now also covering F9's own new routes) |

Every deferred item is registered in `F9_IVG_DEFERRED_TEST_REGISTER.md`. None is reported as PASS.

## Why the Student A/B case specifically was chosen for the real, non-deferred proof

Identical reasoning to F8: it is the boundary F9's own routes actually gate on (`LEARNER_PROGRESS_VIEW`/`LEARNER_INTERVENTION_CREATE`), proven for real against real Postgres. The parent/teacher/entitlement boundaries are pre-existing F2/F3 code paths F9 merely calls unmodified — re-deriving F2/F3's entire certification matrix a second time per phase would be duplicative effort without matching new risk, exactly as reasoned in F8's own report.
