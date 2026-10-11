LANE: L10_SHARED_FOUNDATION
STATE: READY_FOR_ORCHESTRATOR_REVIEW
LAST_UPDATE: 2026-10-11T19:05Z
BASE_SHA: 4fb45b0
CURRENT_SHA: the R2 commit on feat/l10-shared-foundation, parent e094c5a (git rev-parse feat/l10-shared-foundation)

CURRENT_PHASE: STOP (L10-R2 report appended, work committed)

NOW_DOING: NONE

COMPLETED:
- Core (c2bcae9, accepted) and R1 (e094c5a, accepted)
- R2: migration chain rebuilt as three files (20261120_1000 parent lifecycle, _1100 enrolment history, _1200 one ACTIVE persona); seat-model, institution-student membership and onboarding schema removed (D-2, D-4)
- R2: Teacher whole-learner scope -- one gate on every learner-wide read route; Teacher overview cut to the authorized subject; readiness withheld
- R2: Transfer concurrent exactly-once -- exclusive transaction-scoped claim before grading, no schema
- R2: preflight contract updated for the three-file chain (ledger 83 -> 86)
- R2: exact selection semantics written for L9's enrollmentOf

CURRENT_FINDINGS:
- A third, unhardened copy of the "classes this actor teaches" query existed in src/lib/teacher/intervention.service.ts; fixed. (R2-3)
- The Transfer claim holds one pooled connection for the duration of a grading call. (R2-4)
- CR-L8-01 stays OPEN (L8 call site, L2 aggregates).
- L9's enrollmentOf must select the open row, else the most recent closed row. (R2-5)

FILES_READ:
- As in R1, plus: every route under src/app/api/teacher, src/lib/teacher/{learner-view,class-progress,intervention}.service.ts, the eight remaining whole-learner routes, src/services/activity-launch-lock.service.ts

FILES_MODIFIED:
- See docs/orchestration/reports/L10_REPORT.md, section "L10-R2", FILES CHANGED

TESTS:
- npx vitest run tests/unit/l10-*.test.ts : 9 files, 196 tests passed
- npx vitest run (no database env) : 528 files, 9,489 tests passed
- npx tsc --noEmit -p . : no output
- npx next build : exit 0, 229/229 static pages
- ./scripts/l10-ephemeral-db-test.sh : 3 migrations apply and re-apply; SF-10 pre-check refuses a multi-persona account; governed runner ledger 83 -> 86 (last 20261120_1200); preflight SQL 21 + 6 statements, SELECT only; integration 178 passed, 0 failed (includes the concurrent Transfer regression)
- Browser, HTTP E2E, DEV/Stage/Production : NOT_RUN

BLOCKERS:
NONE

LOCK_REQUESTS:
NONE

CROSS_LANE_DEPENDENCIES:
- L8: CR-L10-03 (use getTeacherClassExamGaps for gaps, goals and AICE); three L10 guard tests fail on the merged line until then
- L9: CR-L9-ENROLMENT-LOOKUP (enrollmentOf selection semantics); one L10 guard test fails on the merged line until then
- L2: CR-L10-01, CR-L10-08 (subject-aware aggregates; visibility predicate; subject of review items) -- CR-L8-01 stays OPEN until then
- L5: run docs/orchestration/L10_MIGRATION_PREFLIGHT.md before any shared database migration; apply the conflict-resolution list in its check 4.6
- L7: CR-L10-05 (cosmetic)
- L11: none (CR-L10-07 withdrawn)

NEXT:
Orchestrator review of the R2 commit.

PROGRESS:
- L10 work packages in scope for this release: SF-1, 2, 3, 4, 5, 6, 7, 10 implemented; SF-8 removed by ruling; SF-9, 11, 12, 13 deferred by ruling
- Migration chain: 3/3 files apply and re-apply on a throwaway Postgres; 0/3 applied to a shared database; expected ledger 83 -> 86
- Orchestrator change requests: CR-L7-01 closed, CR-L9-02 closed, CR-L11-05 and CR-L11-06 implemented, CR-L8-01 open (external)
- Convergence: L10 has no open work of its own; two external patches and the L5 preflight are required
