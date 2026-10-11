LANE: L10_SHARED_FOUNDATION
STATE: READY_FOR_ORCHESTRATOR_REVIEW
LAST_UPDATE: 2026-10-11T18:45Z
BASE_SHA: 4fb45b0
CURRENT_SHA: the R1 commit on feat/l10-shared-foundation, parent c2bcae9 (git rev-parse feat/l10-shared-foundation)

CURRENT_PHASE: STOP (L10-R1 report appended, work committed)

NOW_DOING: NONE

COMPLETED:
- Core (c2bcae9, accepted): SF-1, 2, 3, 4, 5, 6, 7, 8, 10, 12; EN-1 schema; CR-L7-01; CR-L9-02; six migrations 20261120_1000..1500
- R1: D-1 final rulings (released = Student-visible; Teacher detail only in the authorized subject of a submitted attempt; Coordinator kept off the legacy routes)
- R1: Teacher exam goals and AICE entries withheld (no subject attribution exists)
- R1: revoked / inactive Student => 403 on the API, redirect before render on pages, never 500
- R1: repository-wide guard on enrolment SQL callers
- R1: L5 preflight contract (docs/orchestration/L10_MIGRATION_PREFLIGHT.md), every statement executed on a throwaway database
- R1: CR-L11-05 (manual payment approval refused on an administrator-set row), CR-L11-06 (Transfer exactly-once from existing evidence state, no schema)

CURRENT_FINDINGS:
- "Scored and not invalidated" was not Student-visible: it showed a Parent a result the Student had removed from history. Fixed. (R1-1)
- On exam attempts a Teacher now receives no item-level review at all: a review item cannot be attributed to a subject. Needs exam-core support. (R1-1, CR-L10-08)
- The 32 getOrCreateStudentId callers are pages, not API routes; no API route was affected. CR-L10-02 withdrawn. (R1-4)
- Page requests are redirected (307), not answered 403. To confirm. (R1-4)
- L9's enrollmentOf reads one enrolment row with no status filter; incompatible with 20261120_1500. (R1-5, CR-L10-04)
- Transfer: two simultaneous FIRST submissions can both reach the grader; closing that needs schema. (R1-7)
- Teacher subject scoping on eight remaining whole-learner routes is not done. (R1-1)

FILES_READ:
- As in the core run, plus: L11_REPORT.md and the L11 worktree (read-only), the Student result page, src/lib/exam-core/{result-view,results,history,exam-gaps}.service.ts, src/services/{membership-admin,transfer-task-instance,mastery}.service.ts, every lane worktree and both integration lines (git grep only)

FILES_MODIFIED:
- See docs/orchestration/reports/L10_REPORT.md, section "L10-R1", FILES CHANGED (5 new, 15 application files, 3 scripts, 4 tests, 2 docs)

TESTS:
- npx vitest run tests/unit/l10-*.test.ts : 8 files, 162 tests passed
- npx vitest run (no database env) : 527 files, 9,455 tests passed
- npx tsc --noEmit -p . : no output
- npx next build : exit 0, 229/229 static pages
- ./scripts/l10-ephemeral-db-test.sh : 6 migrations apply and re-apply; governed runner ledger 83 -> 89; preflight SQL 20 + 9 statements run, SELECT only; integration 170 passed, 0 failed
- Browser, HTTP E2E, DEV/Stage/Production : NOT_RUN

BLOCKERS:
NONE for the lane. Convergence is blocked on other lanes (see CROSS_LANE_DEPENDENCIES).

LOCK_REQUESTS:
NONE

CROSS_LANE_DEPENDENCIES:
- L2: CR-L10-01 (subject-aware gap aggregates; subject attribution for goals and AICE), CR-L10-08 (Student-visibility predicate; subject of review items)
- L8: CR-L10-03 (use getTeacherClassExamGaps for gaps, goals and AICE)
- L9: CR-L10-04 (enrollmentOf must use getClassEnrollmentState)
- L11: CR-L10-07 (review migration 20261120_1200)
- L7: CR-L10-05 (show OWN_EMAIL / ALREADY_LINKED)
- L5: run docs/orchestration/L10_MIGRATION_PREFLIGHT.md before any shared database migration

NEXT:
Orchestrator review of the R1 commit.

PROGRESS:
- L10_CORE: accepted at c2bcae9
- R1 items: D-1 rulings 3/3 implemented; revoked-Student HTTP done; enrolment SQL callers 0 on this branch, 1 incompatible reader on L9; preflight contract ready; L11 dependencies 2/2 implemented
- CR-L8-01: OPEN (0/2 external parts integrated)
- Unruled: D-2, D-3, D-4, D-5, D-7
- Convergence: NOT READY
