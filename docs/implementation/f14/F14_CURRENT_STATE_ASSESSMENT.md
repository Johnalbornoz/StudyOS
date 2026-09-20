# F14 — Current State Assessment

Baseline: `origin/f13/ux-consolidation@39c825da84e061a0ddf72dfdb61ccf6519ad127f`, verified via `git rev-parse origin/f13/ux-consolidation` before any implementation. Branch `f14/experience-completion-readiness` created from that exact SHA in an isolated worktree; `git rev-parse HEAD` confirmed the match; local `main` untouched throughout.

This document records what real inspection (direct file reads, not assumptions from F13's own summaries) found before any F14 code was written. F13 itself documented that a prior automated-exploration pass had produced materially false claims about this codebase — the same discipline is applied here: every claim below was verified by reading the actual file.

## F9 Readiness / Simulation subsystem (the load-bearing discovery)

Two unrelated readiness systems exist in this codebase and must never be confused:

- **Legacy**: `src/services/exam-readiness.service.ts` (`calculateExamReadiness`/`getMultiSubjectReadiness`/`getOverallExamReadiness`) + `assessment_occurrences.exam_readiness` (a pre-F9, manually-set percentage column). Real consumers exist (`/api/exam-readiness/score`, the Student's own Mock Exam calibration display in `dashboard/quiz/page.tsx`, `exam-result.service.ts`'s post-hoc prediction-vs-actual comparison) — none of these are legacy UI floating unused, but none of them are F9 either, and none may be extended into new surfaces.
- **Canonical F9**: `src/lib/readiness/*` (`readiness.service.ts`, `dimension-classification.algorithms.ts`, `blueprint-coverage.service.ts`, `policy.service.ts`, `score-projection.service.ts`) + `src/lib/simulation/*` (`eligibility.service.ts`, `full-mock-eligibility.service.ts`, `plan.service.ts`, `attempt.service.ts`, `scoring.service.ts`, `post-exam-diagnosis.service.ts`, `next-action.service.ts`). `src/lib/readiness/types.ts`'s own header comment states it is "distinctly named throughout from the pre-existing, LIVE legacy `exam-readiness.service.ts`... never confused with, never extending it."

`OverallReadinessStatus = 'INSUFFICIENT_EVIDENCE' | 'EARLY_PREPARATION' | 'DEVELOPING' | 'SIMULATION_READY' | 'FULL_MOCK_ELIGIBLE'`. **No literal `PLATFORM_NOT_READY` or `NOT_READY` status exists anywhere in F9** (grep-confirmed against `src/lib/readiness/` and `src/lib/simulation/`). The platform-vs-learner distinction the task asks for is carried instead by two real, already-certified fields: `DimensionReadinessResult.unsupportedPlatformAreas` (per-dimension) and `SimulationEligibility.reasons` (structural, e.g. `NO_BLUEPRINT_FOR_EXAM_VERSION`, `OBJECTIVE_COMPONENT_UNSUPPORTED`) — the "platform cannot support this" signal already exists, just not surfaced by any UI before this phase. A working precedent for exactly this distinction already existed at `src/lib/parent/read-model.service.ts`'s `getParentExamPreparation` (F10), which derives `reasonCategory: 'PLATFORM_NOT_READY' | 'LEARNER_NOT_READY'` from `fullMock.structuralReadiness.ready` — confirmed real, F9-sourced, and (until this phase) never actually rendered by the Parent dashboard page.

`GET /api/readiness`, `GET /api/simulation/eligibility`, `POST /api/simulation/attempts` (+ pause/resume/complete/responses) all already exist and are all self-service-capable (`LEARNER_INTERVENTION_CREATE`/`LEARNER_PROGRESS_VIEW`, owner-only via `canAccessLearner`) — a genuinely complete backend with zero Student-facing UI before this phase. `SimulationType = 'TOPIC_EXAM'|'DOMAIN_EXAM'|'MINI_MOCK'|'FULL_MOCK'` and `examProfileId` (`src/lib/assessment/student-exam-profile.service.ts`, `GET/POST /api/exam-profiles`) are both real and student-self-managed.

One route existed with no exposed adapter: `abandonSimulationAttempt` (`attempt.service.ts`) had no API route at all — fixed this phase (`POST /api/simulation/attempts/[id]/abandon`).

## Intervention domain (Student-facing execution already exists)

`src/lib/teacher/intervention.service.ts` (F11-B) is assignment-only — it never executes anything, never writes to `learning_evidence`/mastery/readiness tables. `teacher_interventions` is the one canonical table shared by Teacher (assign) and Student (execute) — not Teacher-scoped.

`src/lib/student/teacher-intervention-execution.service.ts` (F11-C1..C4, 776 lines) is a complete, already-certified Student-facing execution orchestrator: `getStudentPendingTeacherInterventions`, `startTeacherInterventionExecution` (dispatches by intervention type to `startConceptReinforcementExecution`/`startSkillReinforcementExecution`/`startCompetencyReinforcementExecution`/`startExamReinforcementExecution`), and `reconcileCompletionsForStudent` (lazily reads back `quiz_sessions`/`simulation_attempts` status and transitions the intervention to `COMPLETED`). Routes `GET /api/student/teacher-interventions` and `POST /api/student/teacher-interventions/[id]/start` already exist and are already wired to this service. **Zero Student-facing UI consumed any of this before this phase.**

Critical correctness constraint found: `reconcileCompletionsForStudent` checks the *exact* `execution_reference` (a specific `quizId` or `simulationAttempt.id`) the execution service itself created — a student cannot complete a Teacher-assigned reinforcement by taking a *different*, freshly self-service-generated quiz; it must be the *same* quiz session. The existing self-service `/dashboard/quiz` page has no capability to re-open an existing `quizId` (its only flow is `subjectId`-driven generation); this required a new, small, additive read-only adapter (see F14_STUDENT_ASSIGNMENT_EXPERIENCE.md).

## Parent legacy readiness (F13's own flagged finding)

`src/app/dashboard/parent/page.tsx` (`'use client'`) rendered `Math.round(e.examReadiness)}%` sourced from `src/services/parent.service.ts::getChildOverview` → `assessment.service.ts::getUpcomingForStudent` → `assessment_occurrences.exam_readiness`. A real, F9-exclusive replacement **already existed and was never wired in**: `src/lib/parent/read-model.service.ts::getParentExamPreparation` + `GET /api/parent/learners/[studentId]/exam-prep` (F10), whose own header comment states it is "Sourced exclusively from F9's readiness/simulation engines... never the legacy exam-readiness.service.ts." This phase's "migration" is primarily *wiring the Parent page to backend work that had already been built for exactly this purpose*.

## Institution Intelligence (F12) — all five missing surfaces already have real backends

Contrary to the task's own framing ("Coverage and Readiness specifically need a real backend gap"), direct inspection of `src/lib/institution-intelligence/` found **all five** requested surfaces already fully implemented: `getInstitutionGrades`, `getInstitutionClasses` (paginated), `getInstitutionTeachers` (paginated, no ranking), `getInstitutionCoverage` (wraps F6's `computeMappingCoverage`/`computeContentCoverage`), `getInstitutionReadiness` (cohort distribution of F9's own `readiness_snapshots`, MIN_COHORT_POLICY-suppressible exactly like the existing Learners page). The actual gap is UI-only — F13 built pages for only 4 of 9 possible tabs.

## Teacher Exam Intervention error handling — the real architecture, corrected

The task assumed F9 `reasonCodes` are rejected at *assignment* time. Direct inspection of `assignTeacherIntervention` (F11-B) shows it performs **no eligibility check at all** — by design ("pedagogical intent + assignment ONLY, never the execution itself," per the file's own header). Eligibility (`getSimulationEligibility`) is checked only at *Student start time*, inside `startExamReinforcementExecution`, and its rejection message is already the real `reasons.join(', ')` — not a generic string. The actual, verified gap was narrower and different from the task's framing: (1) the *Teacher-side* assignment form discarded the server's real error body and always showed one generic string, and (2) one assignment-time error path (`TeacherInterventionExamProfileMismatchError`) was never mapped to a controlled response at all, falling through to a raw 500. Both are fixed this phase — see F14_TEACHER_EXAM_INTERVENTION_SEMANTICS.md.

## Date-drift tests

Both `validation-cycle.test.ts` and `decision-context-query-cost.test.ts` fixtures hard-code `validation_deadline: '2026-09-20T00:00:00.000Z'` intending "not yet overdue," but the functions under test (`isValidationCycleOverdue` inside `getConceptValidationState`, and the equivalent path inside `getDecisionContext`) default their `now` parameter to the real system clock (`new Date()`) when the caller omits it. The real system clock in this environment is `2026-09-20T00:35 UTC` — past the fixture's deadline. Root cause confirmed by direct execution (`date -u`, `node -e "console.log(new Date().toISOString())"`), not assumed. Fixed by pinning `vi.useFakeTimers()`/`vi.setSystemTime()` in the two affected tests only — no production code touched.

## Environment/Clerk discrepancy

See F14_ENVIRONMENT_PROVENANCE_REPORT.md for the full investigation. Summary: this F14 worktree has zero `.env*` file of any kind; a real, credential-bearing `.env.local` was found in a sibling worktree (`f0s-security`, the very first phase's own worktree from earlier in this session) under the same scratchpad parent directory. No dev server was started in this worktree to test resolution, per the same safety judgment F13 applied.

## Existing design-system primitives (reused, not replaced)

`StatusBadge`/`toneForInterventionStatus`/`toneForReadinessStatus` (F13) already anticipated F9's real enum values exactly — no changes needed. `EmptyState`, `MetricCard`, `PageHeader` reused as-is across every new F14 surface. One addition: `toneForDimensionStatus` (F9's per-dimension `DimensionStatus`, a status vocabulary F13 had not yet needed).
