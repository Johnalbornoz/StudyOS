LANE: L10_SHARED_FOUNDATION
STATE: READY_FOR_ORCHESTRATOR_REVIEW
LAST_UPDATE: 2026-10-11T18:25Z
BASE_SHA: 4fb45b0
CURRENT_SHA: the single commit on feat/l10-shared-foundation whose parent is 4fb45b0 (git rev-parse feat/l10-shared-foundation)

CURRENT_PHASE: STOP (report written, work committed)

NOW_DOING: NONE

COMPLETED:
- SF-1 guard hardening (role + account status in every shared guard; account status gate in the proxy; suspension order made fail-safe)
- SF-2 one student resolver for the learning and exam families
- SF-3 teacher guards require an ACTIVE institution and a non-archived class
- SF-4 learner-data scope per the D-1 ruling (LEARNER_READ_SCOPE; three routes shaped; institution permission honoured)
- SF-5 workspace page guard in the proxy
- SF-6 invitations matched on the verified primary email
- SF-7 parent relationship lifecycle (expiry, stale-invitation refusal, re-request limit, admin end)
- SF-8 role onboarding carrier and service
- SF-10 one ACTIVE persona per account (database index)
- SF-12 institution-student membership (derived by trigger)
- EN-1 licence and seat tables (schema only)
- CR-L7-01, CR-L9-02, CR-L8-01 (see report for the two CR-L8-01 follow-ups), CR-L8-02; CR-L9-04 acknowledged
- Six migration files 20261120_1000..1500 (applied only to a throwaway local Postgres)

CURRENT_FINDINGS:
- LOCKS.md (studyos-orchestration @ 99bec29) still shows SCHEMA_AND_MIGRATIONS UNASSIGNED and SHARED_FOUNDATION not activated; both were assigned by the launch message.
- D-1 interpretations to confirm: Teacher gets item-level detail; Coordinator not admitted to the older whole-learner routes; "released" = SCORED. (report Finding 4)
- getOrCreateStudentId now refuses a revoked/suspended existing student; 32 callers deny with an uncaught error, not a 403. (report Finding 1, CR-L10-02)
- Teacher exam gaps are cut at concept level; domain and objective aggregates are withheld until exam-core has a subject option. (report Finding 5, CR-L10-01)
- Accounts lacking an ACTIVE role row will be newly denied; counts on shared databases were not available. (CR-L10-06)
- Migration 20261120_1500 breaks any SQL using ON CONFLICT (class_id, student_id) outside this branch; old pending parent invitations expire on apply. (report Finding 6)

FILES_READ:
- Control plane (CONTROL_PLANE, LOCKS, OBSERVABILITY, RELEASE_STATE, reports/README), L3R1_REPORT, L4R1_REPORT, L4_REPORT, L8_REPORT, L9_REPORT (read-only, other worktrees)
- src/lib/auth.ts, src/lib/authorization/**, src/lib/identity/**, src/lib/exam-core/route-auth.ts, src/lib/exam-core/exam-gaps.service.ts, src/proxy.ts, src/app/dashboard/layout.tsx, src/services/{parent,user-admin,institution,institution-admin}.service.ts, src/lib/teacher/**, src/lib/institution/**, the canAccessLearner routes, database/migrations/**

FILES_MODIFIED:
- See docs/orchestration/reports/L10_REPORT.md, FILES CHANGED (30 application files, 6 migrations, 5 scripts, 23 test files, 2 docs)

TESTS:
- npx tsc --noEmit -p . : no output
- npx vitest run (no database env) : 524 files, 9,402 tests passed
- ./scripts/l10-ephemeral-db-test.sh : 6 migrations apply and re-apply; SF-10 pre-check refuses a multi-persona account; integration 143 passed, 0 failed
- npx next build : exit 0, 229/229 static pages
- Browser, HTTP E2E, DEV/Stage/Production : NOT_RUN

BLOCKERS:
NONE

LOCK_REQUESTS:
NONE. LOCKS.md needs updating to show the two locks this lane was given.

CROSS_LANE_DEPENDENCIES:
- L2: CR-L10-01 (subject option on examGapsFor)
- L6: CR-L10-02 (32 callers of getOrCreateStudentId)
- L8: CR-L10-03 (call getTeacherClassExamGaps; a guard test fails on the merged line until then)
- L9: CR-L10-04 (enrollmentOf must read enrolment state through getClassEnrollmentState)
- L7: CR-L10-05 (show OWN_EMAIL / ALREADY_LINKED)
- L5: CR-L10-06 (read-only counts before any shared environment)
- L11: CR-L10-07 (review the licence schema)

NEXT:
Orchestrator review.

PROGRESS:
- L10 work packages: 10 of 13 implemented (SF-1, 2, 3, 4, 5, 6, 7, 8, 10, 12); 3 gated on unruled decisions (SF-9, SF-11, SF-13)
- Schema batch: 6/6 files written, 6/6 apply and re-apply on a throwaway Postgres, 0/6 applied to a shared database
- Orchestrator change requests: 3/3 implemented with their required regressions passing; CR-L8-01 has 2 follow-ups open
