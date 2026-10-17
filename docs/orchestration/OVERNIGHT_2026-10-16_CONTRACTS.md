# Overnight pilot convergence 2026-10-16: shared contracts

The operator prompt "STUDYUS PILOT — OVERNIGHT CONVERGENCE, HARDENING AND CERTIFICATION" is the authority. This file fixes the interfaces the parallel workstreams share, so they merge cleanly.

- **Base:** candidate `319f4e87`, DB `4baac799`, ledger 99.
- **Hard rules (apply to every workstream):**
  - Do not touch Preview, Stage or Production.
  - Do not invent policy.
  - Standardized exam runtime provider calls must stay at 0.
  - The Knowledge State must stay isolated from Exam Readiness.
  - Never delete evidence.

## 0. Already integrated on the base branch

- **Practice rule:** the window is the last 3 completed practices. READY_TO_PROVE needs `average(last 3) >= 80` AND `latest >= 80`. See `CANONICAL_POLICY.practice` (`windowSize`, `minimumWindowAveragePercent`, `latestMustPass`) and `engine.ts` `practiceWindowSatisfied`.
- **Sizing module:** `src/lib/subject-assessment/sizing.ts`.
  - `planSubjectMock`, `planSubjectTest` and `planGroupAssessment`, plus `subjectAssessmentScorePercent` (unanswered stays in the denominator) and the pass rule (>= 80 inclusive).
  - Every workstream uses these functions. None re-implements counts.

## 1. Engine evidence contracts (owner: ENGINE workstream; producers: LEARN and APPLY workstreams)

All new evidence is a `learning_evidence` row, read by `src/lib/pedagogical-shadow/evidence-fetch.ts`, mapped by `evidence-adapter.ts`, and replayed by `engine.ts`.

### 1.1 LEARN (guided understanding, 4–7 interactions, no percentage gate)

```
learning_evidence.metadata.activityType = 'LEARN_CHECK'          (existing canonical type, reused)
learning_evidence.metadata.learnSession = {
  version: 'learn-guided-v1',
  interactionCount: number,          // 4..7
  closedBy: 'AI' | 'CAP',            // AI closed between 4 and 7; CAP = reached 7
  weaknesses: string[],              // short, learner-safe descriptions of detected confusions (carried to PRACTICE)
  misconceptionIds?: string[]        // canonical misconception ids when the grader identified them
}
source_type 'LEARN_GUIDED' (new), evidence mode PRACTICE (assisted), never independent
```

- **Engine rule:** a LEARN_CHECK row with `learnSession`, `interactionCount` between 4 and 7, and `closedBy` AI (when count >= 4) or CAP (when count = 7) QUALIFIES. There is no score gate.
- **Legacy rows:** a LEARN_CHECK quiz row without `learnSession` qualifies when it was completed with `itemCount >= 4`. Its score no longer gates.
- **Policy fields:** `CANONICAL_POLICY.learn = { minInteractions: 4, maxInteractions: 7 }`. The `minimumScorePercent` and `itemCount` gates are removed.

### 1.2 APPLY (adaptive transfer ladder, 3–5 challenges)

```
learning_evidence.metadata.activityType = 'TRANSFER'
learning_evidence.metadata.transferLadder = {
  version: 'transfer-ladder-v1',
  challenges: [{ level: 'NEAR'|'MID'|'FAR', scorePercent: number, passed: boolean, certified: boolean, taskId: string, contextDomain: string|null }],
  highestLevelReached: 'NEAR'|'MID'|'FAR'|null    // highest level with a passed AND certified challenge
}
```

- **Pass threshold:** a challenge passes at `scorePercent >= 80`. There is no 70% gate and no overall mean.
- **Engine rule:**
  - `highestLevelReached` in (MID, FAR) → QUALIFIES (APPLY completed). The decision exposes `transferLevelReached` and `consolidationLevel` (MEDIUM for MID, HIGH for FAR).
  - `highestLevelReached` NEAR or null → DOES_NOT_QUALIFY with the new reason `TRANSFER_LEVEL_BELOW_CONSOLIDATION`. This is never a FAILED_ATTEMPT: no rollback, and no prior stage is lost. The concept stays at TRANSFER (APPLY in process) and may repeat APPLY.
  - The best level across attempts counts, so a later weaker attempt never lowers a level already reached.
  - Legacy 3-challenge NEAR/CONTEXTUAL/HIGHER rows: UNRESOLVED (no rollback, no qualification). No CONTEXTUAL/HIGHER → MID/FAR mapping is ever made.
- **Unchanged:** an active critical misconception still overrides (REINFORCE).
- **CONSOLIDATED:** requires TRANSFER >= MID.

### 1.3 Internal assessment revalidation (subject Test and Mock, any origin)

- **Adapter:** `metadata.activityType` CUMULATIVE_ASSESSMENT (subject test) and MOCK_EXAM (subject mock) map to the new canonical activity type `INTERNAL_ASSESSMENT`, one item per (session, concept) with that concept's `scorePercent`. DIAGNOSTIC_CHECK stays unsupported.
- **Engine:** applies only when Practice is satisfied (the concept is past PRACTICE). Items are replayed in time order, so test and mock and every origin share one counter.
  - Score < 60 → revalidation. Practice, Prove, Retain and Transfer are no longer satisfied, the practice window resets, and the rollback is `INTERNAL_ASSESSMENT_REVALIDATION` → PRACTICE with REINFORCE. LEARN is kept.
  - Score 60–79 → alert. The consecutive-alert counter increments; at 2 consecutive alerts, the same revalidation applies.
  - Score >= 80 → the counter resets to 0.
  - An internal assessment never satisfies any stage.
  - The decision exposes `internalAssessmentAlertCount` and `revalidationRequired`.
- **Policy:** `CANONICAL_POLICY.internalAssessment = { strongContradictionBelow: 60, alertBelow: 80, consecutiveAlertsForRevalidation: 2 }`.

## 2. Subject Test / Mock sessions (owner: SUBJECT workstream; consumer: TEACHER workstream)

- **Substrate:** the legacy subject quiz modes in `/api/quizzes/generate-and-take`: `cumulative_assessment` (Test) and `exam_simulation` (Mock). The frozen setup lives in `quiz_sessions.subject_assessment_setup` jsonb.
- **Server-side planning:** the server computes count and distribution with `sizing.ts`. The client never sends `maxQuestions` for these modes; the old 1–20 clamp no longer applies to them (max 50).
- **Setup shape** (extends the existing jsonb; additive):

```
{ kind: 'SUBJECT_CUMULATIVE_TEST'|'SUBJECT_MOCK_EXAM', origin: 'STUDENT'|'TEACHER', assignmentId?: string, attemptNumber?: number,
  selectedConceptIds: string[], questionCount: number, distribution: Record<conceptId, number>, rule: string,
  difficulty: { mode: 'AUTO' } | { band: 'LOW'|'MEDIUM'|'HIGH'|'MIXED' },
  schedule: { mode: 'NOW' } | { mode: 'SCHEDULED', date: 'YYYY-MM-DD', timezone: IANA, expiresAt: ISO },
  timing: { timed: boolean, durationMinutes: number|null, startedAt?: ISO, deadlineAt?: ISO },
  feedbackPolicy: 'TEST_CORRECTNESS_ONLY'|'MOCK_NONE',
  maxAttempts?: number, frozenAt: ISO }
```

- **Generation entry point the TEACHER workstream calls:** for a frozen group plan, call the same generation path with the explicit `{ conceptIds, distribution, difficulty, assignmentId, attemptNumber }`. The SUBJECT workstream exposes it as an exported service function `createSubjectAssessmentSession(params)` in `src/services/subject-assessment.service.ts`, and the route uses that function too.
- **Feedback:**
  - Test: after each answer, correct / incorrect only (no explanation, no hint, no answer).
  - Mock: no feedback during the attempt.
  - Both: full final feedback (score, per-concept, per-question correct / incorrect / unanswered, expected answer, explanation, concepts to reinforce).
- **Timing:**
  - A timed attempt has a wall-clock deadline `startedAt + duration`; connection loss does not pause it.
  - At zero, the attempt auto-submits on the server (lazy, on the next read/submit, plus the client countdown). Answered items are graded; unanswered are UNANSWERED and counted in the denominator.
  - The Mock is always timed. There is NO governed recommendation formula.
    - The only existing algorithm is the per-item planned time of `assessment-foundation/nominal-response-time.ts` (already used for blueprint time budgets).
    - The recommendation is therefore the sum of the frozen items' nominal seconds, rounded up to whole minutes. It is exposed as `recommendedMockDurationMinutes()` with `rule: 'NOMINAL_RESPONSE_TIME_SUM'` and reported as OPERATOR_DECISION_REQUIRED for confirmation.
    - Teacher mocks start from it and the teacher may adjust it. Student-created mocks use it as is.
- **Student-created assessments:**
  - ONE attempt per assessment. Another attempt means a new assessment.
  - NOW starts immediately.
  - SCHEDULED may start early. If not taken on the selected date (end of that local date in the student's timezone `student_availability.timezone`), it EXPIRES.
  - No reminders.
- **Evidence:** both write per-concept `learning_evidence` (Test: CUMULATIVE_ASSESSMENT; Mock: MOCK_EXAM, explicitly MOCK). Origin and assignment id go in metadata. They never write Exam Readiness.

## 3. Teacher assignments (owner: TEACHER workstream)

- **Extends `teacher_interventions`:** new `intervention_type` values SUBJECT_TEST and SUBJECT_MOCK (additive migration). The per-assignment config goes in a jsonb column: subject, conceptIds, difficulty band, the plan from `planGroupAssessment`, timed / duration, maxAttempts, window `startDate` / `endDate` (dates only), and `closesAt`.
  - `closesAt` = endDate 21:00 in `institutions.timezone` of the class's institution.
  - If that is null → refuse with `TIMEZONE_AUTHORITY_BLOCKER`.
- **Targeting:** one, several or a whole class, through `publishClassAssignment` (`studentIds` empty = class). One row per student, grouped by `assignment_group_id`.
- **Group equivalence:** every student shares the same plan (count, distribution, difficulty, scoring, window). Each attempt generates its own questions (different items), avoiding that student's previously seen fingerprints. Reuse is allowed only when supply is insufficient: least recently used, avoiding the previous attempt, and recorded.
- **Attempts:**
  - Up to `maxAttempts`, and none is required.
  - The result is the LAST COMPLETED attempt; history is kept.
  - Retry after a pass is allowed.
  - Resume of an active attempt before close does not consume an attempt.
  - After close: an active attempt may be finished while the session lives, but cannot be resumed after exit, and no new attempt starts.
- **Feedback release:** immediate full feedback when the student versions are truly diverse (no shared item fingerprints across the group's sessions). Otherwise show score and general performance now, and hold answers and explanations until `closesAt`. This is computed from the actual items served.
- **Teacher results:**
  - Group: per-student score, average, distribution, per-concept performance, difficulty, high-error questions/areas, strongest and weakest concepts.
  - Drill-down: per-concept, per-question response, errors, explanation, concepts to reinforce.

## 4. Pilot exposure (owner: GATING workstream)

- **Hidden from Student surfaces when `STUDENT_CATALOG_EXPOSURE=PILOT`:** PISA, ICFES (Saber), unfinished IB (Challenge), and unconfirmed Cambridge qualifications.
- **Mechanism:** a pure module `src/lib/exam-core/student-exposure.ts`. It is applied at the objective lists, at `createObjectivePreparation`, in `listStructureFamilies` / `listStructureChildren` / `resolveExamLevel`, in the raw SQL of `exams/page.tsx`, and in `createExamInstance`.
- **History stays readable:** `objectiveByKey` is unchanged, and no data is deleted.

## 5. Operator decisions recorded (not invented)

- **Mock duration recommendation:** no governed recommendation formula exists. The existing per-item planning algorithm (`nominal-response-time.ts`) is used as the sum over the frozen items, never a new formula. OPERATOR_DECISION_REQUIRED (confirm or replace).
- **Self-scheduled expiry:** interpreted as the end of the selected local date (the date boundary, not an invented clock time). Reported for confirmation.
- **Mock band beyond 15 concepts that are not the whole subject:** OVER_15_PARTIAL (~2/concept, max 50). Reported for confirmation.
