LANE: L9_INSTITUTION
STATE: READY_FOR_ORCHESTRATOR_REVIEW
LAST_UPDATE: 2026-10-11T17:50Z
BASE_SHA: 4fb45b0
CURRENT_SHA: 7e2bc29 (implementation); this status and the report are one commit on top

CURRENT_PHASE: STOP

NOW_DOING: NONE. Lane stopped.

COMPLETED:
- Read CONTROL_PLANE.md, LOCKS.md, OBSERVABILITY.md, L3R1_REPORT.md, L4R1_REPORT.md.
- Worktree /Users/jalbornoz/PROYECTOS/studyos-l9-institution, branch feat/l9-institution-in1-in3, from 4fb45b0.
- IN-1: bulk add from an email list (students to a class, teachers to the institution), through the existing single adds.
- IN-3: a Student leaves a class (own ACTIVE enrolment -> ENDED through the existing endClassEnrollment).
- Tests, typecheck, build. Commit 7e2bc29. Report written.

CURRENT_FINDINGS:
- No tasks/L9_INSTITUTION.md in the control plane; contract = launch message + L3R1 sections 3 and 7.
- Bulk never re-opens a closed relation (DECLINED / ENDED enrolment; PENDING / REJECTED / REVOKED / SUSPENDED teacher relation). L3R1 required only DECLINED; the rest is this lane's decision (report Finding 2).
- The leave control is visible only where InstitutionalContextCard renders: STUDENT_JOURNEY_V2=UX and a class with a subject (src/app/dashboard/profile/page.tsx:48-58). CR-L9-01.
- The single add can still re-activate an ENDED or DECLINED enrolment directly (enrollActive). Not changed. CR-L9-02.
- No notification when a student leaves (type list is outside the lane). CR-L9-03.

FILES_READ:
- src/lib/institution/**, src/services/institution.service.ts, src/lib/authorization/index.ts, src/lib/auth.ts (requireStudentId), src/lib/notifications/role-notifications.service.ts, src/lib/exam-journey/institutional-context.ts
- src/app/api/institutions/[id]/{students,teachers}/**, src/app/api/student/class-invitations/**
- src/app/dashboard/institution/[institutionId]/{OpsActions.tsx,students,teachers,classes/[classId]}, src/app/dashboard/profile/{page.tsx,InstitutionalContextCard.tsx}
- database/migrations (class_enrollments status CHECK, academic_governance_events actor_scope CHECK) -- read only
- tests/unit/track-a-*.test.ts, journey-ux-entry.test.ts, journey-j2-shadow.test.ts, l4r1-object-ownership-idor.test.ts

FILES_MODIFIED:
- src/app/api/institutions/[id]/students/bulk/route.ts (new)
- src/app/api/institutions/[id]/teachers/bulk/route.ts (new)
- src/app/api/student/class-enrollments/route.ts (new)
- src/app/api/student/class-enrollments/[id]/leave/route.ts (new)
- src/app/dashboard/institution/[institutionId]/BulkAddForms.tsx (new)
- src/app/dashboard/institution/[institutionId]/students/page.tsx
- src/app/dashboard/institution/[institutionId]/teachers/page.tsx
- src/app/dashboard/institution/[institutionId]/classes/[classId]/page.tsx
- src/app/dashboard/profile/InstitutionalContextCard.tsx
- src/app/dashboard/profile/StudentClassMemberships.tsx (new)
- src/lib/institution/institution-operations.service.ts
- src/lib/institution/email-list.ts (new)
- src/lib/institution/student-class-membership.ts (new)
- src/lib/i18n/institution-roster-messages.ts (new)
- tests/unit/l9-in1-bulk-add.test.ts (new)
- tests/unit/l9-in3-student-leave-class.test.ts (new)
- tests/unit/l9-roster-fake-db.ts (new)
- docs/orchestration/status/L9_STATUS.md (new)
- docs/orchestration/reports/L9_REPORT.md (new)

TESTS:
- vitest tests/unit/l9-*.test.ts: 2 files, 30 passed.
- Same with three guards removed: 7 of 30 failed; restored, 30 passed.
- tsc --noEmit: no output.
- Full vitest: 521 files, 9313 passed, 7 failed (all 5000ms timeouts in 5 files this lane did not touch, machine under load). Those 5 files alone: 93 passed.
- track-a-*, journey-*, f2-institution-membership, ai-request-metrics: 20 files, 467 passed.
- next build: exit 0, 229/229 static pages, four new routes listed.
- Browser, HTTP E2E, DEV / Stage / Production: NOT_RUN.

BLOCKERS: NONE

LOCK_REQUESTS: NONE

CROSS_LANE_DEPENDENCIES:
- L7 (holder of src/app/dashboard/profile/page.tsx in Wave 0): CR-L9-01 asks for one mount line there so the leave control is not flag-gated.
- L10: acknowledge the Student as a new actor on ACTIVE -> ENDED (CR-L9-04); rule on CR-L9-02.

NEXT: Orchestrator review of 7e2bc29.

PROGRESS:
- baseline verified
- ownership verified
- IN-1 implemented, 18 tests
- IN-3 implemented, 12 tests
- typecheck clean
- build exit 0
- report written
- browser check not run
