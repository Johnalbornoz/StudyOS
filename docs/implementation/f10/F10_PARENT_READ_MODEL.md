# F10 — Parent Read Model

`src/lib/parent/read-model.service.ts`. Every method's first parameter is `actorUserId` (F1 canonical `users.id`, resolved server-side from the Clerk session — never client-supplied); every method that takes a `studentId` calls `canAccessLearner(actorUserId, studentId, 'LEARNER_PROGRESS_VIEW')` itself, as its own first action, and throws `ParentAccessDeniedError` if it fails. No caller is trusted to have checked already (task §29).

## Methods

### `getParentLearners(actorUserId): Promise<ParentLearnerSummary[]>`
No per-learner authorization needed (it derives the list *from* the relationship table itself, `status = 'accepted'`) — safe by construction, not by a separate check. Returns `{ studentId, name, activeSince }[]`. Zero-length array is a valid, first-class result (task §10 zero-child state).

### `getParentLearnerOverview(actorUserId, studentId): Promise<ParentLearnerOverview>`
Authorization-gated. Combines: learner-safe display name, subject count, latest F9 readiness snapshot status (not a raw score — see F10_PARENT_EXAM_PREP_MODEL.md), concept evidence-coverage summary (F5), count of areas needing attention (F8), most recent activity timestamp. Never reads `exam-readiness.service.ts` or `assessment_occurrences.exam_readiness`.

### `getParentSubjectProgress(actorUserId, studentId, subjectId?): Promise<ParentSubjectProgress[]>`
Per-subject: concept count, count with "qualifying evidence" (named metric, see F10_PARENT_PROGRESS_MODEL.md), skills with qualifying evidence, blueprint evidence coverage percentage (F9's own dimension, reused, not reinvented) when an exam profile exists for that subject.

### `getParentRecentActivity(actorUserId, studentId, limit = 20): Promise<ParentActivityItem[]>`
Sourced from `learning_evidence` timestamps (F4/F5) and `exam_simulation_attempts` (F9) only — never raw AI prompt/response content, never provider metadata. Each item: `{ kind: 'practice'|'concept_progress'|'assessment'|'simulation', occurredAt, subjectName, conceptName? }`.

### `getParentExamPreparation(actorUserId, studentId): Promise<ParentExamPrep | null>`
`null` when the learner has no active Exam Profile (task §17). Otherwise: framework/exam name, exam date, F9's 7 readiness dimensions (Knowledge/Skill/Technique/Speed/Fluency/Evidence Sufficiency/Blueprint Evidence Coverage), `fullMockStatus` (preserving F9's `NOT_READY` + reason, distinguishing `PLATFORM_NOT_READY` vs `LEARNER_NOT_READY` per task §18), `scoreProjection` (F9's `CAN_PROJECT_OFFICIAL_SCORE` gate verbatim, never substituted — task §19), completed/available simulation counts. Sourced exclusively from `src/lib/readiness/readiness.service.ts` and `src/lib/simulation/*`.

### `getParentAttentionAreas(actorUserId, studentId): Promise<ParentAttentionArea[]>`
From F5 (low/no-evidence concepts), F8 (open diagnostic gaps/interventions), F9 (readiness dimensions below threshold). Categories: `KNOWLEDGE_PRACTICE_NEEDED | SKILL_PRACTICE_NEEDED | TECHNIQUE_PRACTICE_NEEDED | FLUENCY_PRACTICE_NEEDED | MORE_EVIDENCE_NEEDED | PLATFORM_COVERAGE_INCOMPLETE`. Never a free-text or psychological label (task §20) — a fixed enum plus a certified-source explanation string (task §35).

## Non-goals

No method accepts a mutation parameter. No method combines two students' data. No method reads `exam-readiness.service.ts`.
