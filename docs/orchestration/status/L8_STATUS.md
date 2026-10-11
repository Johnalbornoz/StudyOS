LANE: L8_TEACHER
STATE: READY_FOR_ORCHESTRATOR_REVIEW
LAST_UPDATE: 2026-10-11T19:46Z
BASE_SHA: 4fb45b0 (L8); 4ada891 (L8-R1); fb5fe70 (final micro-remediation); a93b809 (fail-closed patch)
CURRENT_SHA: the commit on feat/l8-teacher-te1-te2 whose parent is a93b809 (git rev-parse --short feat/l8-teacher-te1-te2)

CURRENT_PHASE: STOP (fail-closed patch)

NOW_DOING: NONE -- lane stopped

COMPLETED:
- Baseline verified: fix/security-p1-remediation = 4fb45b0; worktree /Users/jalbornoz/PROYECTOS/studyos-l8-teacher, branch feat/l8-teacher-te1-te2
- TE-1: AssignInterventionForm mounted on the class-scoped Teacher learner page, picker limited to the learner's own topics of the class subject
- TE-2: class exam-insights view (new "Exámenes" tab), page and route on one teacher-only service
- Ruling applied: Coordinator gets 403 on GET /api/teacher/exam-insights and 404 on the page
- Tests, typecheck, build; report written; committed (4ada891)
- L8-R1: teacher-only exam-practice options read, exam-practice form on the learner page, subject-scope check on POST /api/teacher/interventions for EXAM targets; existing EXAM_PRACTICE model reused, no schema

CURRENT_FINDINGS:
- The lane branch now contains L10 (merge 26eef17 of 79b7f50): required to compile and test against getTeacherClassExamGaps. Brings L10's files, including its three unapplied migration files; none edited by L8
- Exam insights read only through getTeacherClassExamGaps; the view no longer shows area / objective totals, exam goals, AICE entries or the family filter (withheld by the entry point)
- POST /api/teacher/interventions: a concept must belong to the subject of the class it is assigned through (400 CONCEPT_NOT_IN_CLASS_SUBJECT); fails closed for unmapped concepts and subject-less classes
- SKILL / COMPETENCY targets have no governed subject relation (no subject column; only many-to-many links through concepts): the endpoint now refuses them, 400 TARGET_NOT_SUBJECT_SCOPED for an authorized teacher/class/learner, 403 otherwise
- CR-L8-01: L8 side closed; overall OPEN until L2's subject-aware aggregate patch

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
- Final: merge of L10 79b7f50 (all L10 files); src/lib/teacher/concept-assignment-scope.ts (new), src/lib/teacher/exam-insights.service.ts, src/app/dashboard/teacher/classes/[classId]/exam-insights/page.tsx, src/app/api/teacher/interventions/route.ts, src/lib/i18n/teacher-l8-messages.ts, tests/unit/l8-teacher-te1-te2.test.ts, tests/unit/l8r1-teacher-exam-practice.test.ts, tests/unit/f11b-teacher-intervention-api-routes-security.test.ts (fixture only)
- L8-R1: src/lib/teacher/exam-practice-options.service.ts (new), src/app/dashboard/teacher/students/AssignExamPracticeForm.tsx (new), tests/unit/l8r1-teacher-exam-practice.test.ts (new), src/app/api/teacher/interventions/route.ts, src/lib/i18n/teacher-l8-messages.ts
- docs/orchestration/status/L8_STATUS.md, docs/orchestration/reports/L8_REPORT.md

TESTS:
- vitest tests/unit/l8r1-teacher-exam-practice.test.ts: 46 passed; with the interventions route restored to a93b809, 3 failed (unscoped SKILL and COMPETENCY accepted; source guard)
- vitest tests/unit/l8-teacher-te1-te2.test.ts: 23 passed
- vitest full suite (no database): 530 files, 9,556 tests passed
- tsc --noEmit: exit 0
- next build: exit 0
- Browser / real database / HTTP E2E: NOT_RUN

BLOCKERS: NONE

LOCK_REQUESTS: NONE

CROSS_LANE_DEPENDENCIES:
- L10 79b7f50 is an ancestor of this branch: converge L10 first
- CR-L8-01 OPEN with L2 (subject-aware domain / objective aggregates, goals, AICE); L8 side closed
- CR-L10-03 (L8 uses the shared entry point, handles `withheld`): done

NEXT: Orchestrator review of the merge commit and the remediation commit

PROGRESS:
- L8_SHARED_ENTRY_POINT: implemented, tests pass
- TEACHER_INTERVENTION_SUBJECT_SCOPE: concept and exam targets scoped; skill and competency targets refused (fail closed); tests pass
- L8_SIDE_CR_L8_01: closed on the L8 side; CR-L8-01 OPEN (L2)
- 0 pushed, 0 merged into any integration branch
