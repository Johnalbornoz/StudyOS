LANE: L8_TEACHER
STATE: READY_FOR_ORCHESTRATOR_REVIEW
LAST_UPDATE: 2026-10-11T18:00Z
BASE_SHA: 4fb45b0 (L8); 4ada891 (L8-R1)
CURRENT_SHA: the commit on feat/l8-teacher-te1-te2 whose parent is 4ada891 (git rev-parse --short feat/l8-teacher-te1-te2)

CURRENT_PHASE: STOP (L8-R1)

NOW_DOING: NONE -- lane stopped

COMPLETED:
- Baseline verified: fix/security-p1-remediation = 4fb45b0; worktree /Users/jalbornoz/PROYECTOS/studyos-l8-teacher, branch feat/l8-teacher-te1-te2
- TE-1: AssignInterventionForm mounted on the class-scoped Teacher learner page, picker limited to the learner's own topics of the class subject
- TE-2: class exam-insights view (new "Exámenes" tab), page and route on one teacher-only service
- Ruling applied: Coordinator gets 403 on GET /api/teacher/exam-insights and 404 on the page
- Tests, typecheck, build; report written; committed (4ada891)
- L8-R1: teacher-only exam-practice options read, exam-practice form on the learner page, subject-scope check on POST /api/teacher/interventions for EXAM targets; existing EXAM_PRACTICE model reused, no schema

CURRENT_FINDINGS:
- Exam practice is now assignable from the Teacher UI through the existing teacher_interventions EXAM target; options are the learner's own definition-based profiles on a PUBLISHED version, limited to the class subject
- Over HTTP a teacher can no longer assign FULL_MOCK, a mini mock of a multi-subject exam, or any EXAM target outside the class subject (400 EXAM_TARGET_OUT_OF_SCOPE); assignTeacherIntervention itself is unchanged
- Objective-first profiles are not offered (the existing execution path cannot start them)
- The teacher sees status but no score for an exam-practice task (listClassAssignments computes quiz results only); not changed
- CR-L8-01 OPEN: exam gaps are not filtered by the class subject (examGapsFor, not L8)

FILES_READ: control plane docs; L3R1 and L4R1 reports; src/app/dashboard/teacher/**; src/app/api/teacher/{exam-insights,interventions}; src/lib/teacher/**; src/lib/authorization/index.ts; src/lib/exam-core/{exam-gaps.service,route-auth}.ts; src/lib/i18n/*; related tests

FILES_MODIFIED:
- src/lib/teacher/exam-insights.service.ts (new)
- src/lib/teacher/individual-assignment.ts (new)
- src/app/dashboard/teacher/classes/[classId]/exam-insights/page.tsx (new)
- src/lib/i18n/teacher-l8-messages.ts (new)
- tests/unit/l8-teacher-te1-te2.test.ts (new)
- src/app/api/teacher/exam-insights/route.ts
- src/app/dashboard/teacher/classes/[classId]/students/[studentId]/page.tsx
- src/app/dashboard/teacher/classes/[classId]/TeacherClassSubNav.tsx
- src/app/dashboard/teacher/classes/[classId]/class-chrome.tsx
- src/app/dashboard/teacher/classes/[classId]/page.tsx
- src/app/dashboard/teacher/classes/[classId]/plan/page.tsx
- src/app/dashboard/teacher/classes/[classId]/students/page.tsx
- src/app/dashboard/teacher/classes/[classId]/assignments/page.tsx
- src/app/dashboard/teacher/classes/[classId]/progress/page.tsx
- tests/unit/aice-pisa-security.test.ts (fixture only)
- L8-R1: src/lib/teacher/exam-practice-options.service.ts (new), src/app/dashboard/teacher/students/AssignExamPracticeForm.tsx (new), tests/unit/l8r1-teacher-exam-practice.test.ts (new), src/app/api/teacher/interventions/route.ts, src/lib/i18n/teacher-l8-messages.ts
- docs/orchestration/status/L8_STATUS.md, docs/orchestration/reports/L8_REPORT.md

TESTS:
- vitest tests/unit/l8r1-teacher-exam-practice.test.ts: 28 passed; with the route restored to 4ada891, 7 failed (out-of-scope targets accepted; title)
- vitest tests/unit/l8-teacher-te1-te2.test.ts: 19 passed
- vitest full suite (no database): 521 files, 9,338 tests passed (an earlier run had load-induced 5 s timeouts and one real failure, b2b2-legacy-blueprint-readers, fixed by using the existing blueprint readers)
- tsc --noEmit: exit 0
- next build: exit 0
- Browser / real database / HTTP E2E / Student-side start: NOT_RUN

BLOCKERS: NONE

LOCK_REQUESTS: NONE

CROSS_LANE_DEPENDENCIES:
- CR-L8-01 (OPEN, hard dependency for Teacher E2E certification): L10_SHARED_FOUNDATION / learner-data-scope policy; subject restriction in examGapsFor, via L2 if Assessment Engine semantics are involved
- CR-L8-02: ruled -- Coordinator 403 on GET /api/teacher/exam-insights stays; SF-4 is L10's

NEXT: Orchestrator review of the L8-R1 commit; route CR-L8-01 to L10

PROGRESS:
- TEACHER_CONCEPT_ASSIGNMENT: implemented, tests pass
- TEACHER_EXAM_PRACTICE_ASSIGNMENT: implemented, tests pass (unit level)
- TEACHER_CLASS_SCOPE: implemented, tests pass
- COORDINATOR_TEACHER_ROUTE_BLOCK: implemented, tests pass
- CR_L8_01_SUBJECT_GAPS: OPEN
- 0 pushed, 0 merged
