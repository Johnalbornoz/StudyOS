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
  difficulty: { mode: 'AUTO' } | { band: 'BASIC'|'INTERMEDIATE'|'ADVANCED'|'MIXED' },   // legacy rows: LOW|MEDIUM|HIGH, read as BASIC|INTERMEDIATE|ADVANCED
  difficultyPlan?: { counts: { BASIC, INTERMEDIATE, ADVANCED }, perConcept: Record<conceptId, [{ level, count }]>, method },
  schedule: { mode: 'NOW' } | { mode: 'SCHEDULED', date: 'YYYY-MM-DD', timezone: IANA, expiresAt: ISO /* 21:00 local of date */ },
  timezoneSource: 'STUDENT_AVAILABILITY'|'INSTITUTION'|null,
  timing: { timed: boolean, durationMinutes: number|null, startedAt?: ISO, deadlineAt?: ISO },
  feedbackPolicy: 'TEST_CORRECTNESS_ONLY'|'MOCK_NONE',
  maxAttempts?: number, frozenAt: ISO,
  completion?: { completedAt, reason, scorePercent, passed, knowledge?: KnowledgeProfile } }
// every frozen item (quiz_sessions.questions[]) carries plannedDifficultyLevel = the level it was generated at
```

- **Generation entry point the TEACHER workstream calls:** for a frozen group plan, call the same generation path with the explicit `{ conceptIds, distribution, difficulty, assignmentId, attemptNumber }`. The SUBJECT workstream exposes it as an exported service function `createSubjectAssessmentSession(params)` in `src/services/subject-assessment.service.ts`, and the route uses that function too.
- **Feedback:**
  - Test: after each answer, correct / incorrect only (no explanation, no hint, no answer).
  - Mock: no feedback during the attempt.
  - Both: full final feedback (score, per-concept, per-question correct / incorrect / unanswered, expected answer, explanation, concepts to reinforce).
- **Timing:**
  - A timed attempt has a wall-clock deadline `startedAt + duration`; connection loss does not pause it.
  - At zero, the attempt auto-submits on the server (lazy, on the next read/submit, plus the client countdown). Answered items are graded; unanswered are UNANSWERED and counted in the denominator.
  - The Mock is always timed. **APPROVED 2026-10-17:** the recommendation is the sum over the frozen items of `assessment-foundation/nominal-response-time.ts`, adjusted by each item's difficulty (the level it was generated at), rounded up to whole minutes: `recommendedMockDurationMinutes()`, `rule: 'NOMINAL_RESPONSE_TIME_SUM'`.
    - Before items exist, a planning estimate over the planned level counts is used (`recommendedDurationForPlan`, rule `NOMINAL_RESPONSE_TIME_SUM:PLANNED_ITEMS_DEFAULT_TYPE`).
    - The recommendation is advisory. The Teacher's chosen duration is authoritative, frozen on the assignment and in every attempt's setup, and never overwritten. Student-created mocks use the recommendation as is.
  - **Untimed Test inactivity (APPROVED 2026-10-17):** 45 minutes, reset by every saved answer. Past it the attempt is closed (EXPIRED), its saved responses are kept, and it cannot be resumed. A teacher-assigned attempt before the window close follows §3 (resume).
- **Difficulty (APPROVED 2026-10-17):** BASIC = level 2, INTERMEDIATE = 3, ADVANCED = 4. MIXED / Balanced = 30% Basic, 50% Intermediate, 20% Advanced of the question count, by largest remainder; the total is exact and ties / remainder prefer Intermediate, so Intermediate is the largest share (4 → 1/2/1, 5 → 1/3/1, 10 → 3/5/2, 14 → 4/7/3, 36 → 11/18/7, 50 → 15/25/10). Levels are assigned deterministically across concepts (`assignLevelsAcrossConcepts`: the items are laid out as round-robin slots over the concepts; an even-spread level sequence is merged in position order; slot i takes level i). Legacy LOW / MEDIUM / HIGH rows are read as BASIC / INTERMEDIATE / ADVANCED; new rows are written with the new names.
- **Knowledge buckets (APPROVED 2026-10-17, diagnostic only, never erase evidence):** for each completed attempt, `src/lib/subject-assessment/knowledge-bucket.ts` derives at read time from the frozen items and the recorded grades:
  - overallScore, basicScore, intermediateScore and advancedScore. A level score is null when the attempt has no item at that level.
  - highestDifficultyDemonstrated (the highest level scoring >= 80), conceptScore, and knowledgeBucket.
  - The profile is also persisted in `completion.knowledge`.
  - The buckets:
    - B1 CRITICAL_GAP: overall < 60.
    - B2 DEVELOPING: 60–79.
    - B3 COMPETENT: overall >= 80 AND intermediate >= 80.
    - B4 ADVANCED: overall >= 80 AND advanced >= 80.
    - null (UNCLASSIFIED): overall >= 80 with no qualifying level score. See §5.
  - The Teacher group view shows the B1..B4 distribution. The drill-down shows the bucket and the per-difficulty scores. The Student's final feedback shows the bucket label.
- **Student-created assessments:**
  - ONE attempt per assessment. Another attempt means a new assessment.
  - NOW starts immediately.
  - SCHEDULED may start early. **APPROVED 2026-10-17:** if it is not started by the selected date, it EXPIRES at 21:00 on that date (DST-correct) in the authoritative timezone.
    - The authority is `student_availability.timezone`. Failing that, it is the Student's institution timezone (`institutions.timezone` via active class enrollments, exactly one distinct value).
    - No authority → SCHEDULED is refused with `TIMEZONE_AUTHORITY_BLOCKER` (409) and a truthful UI message. There is no browser or UTC fallback. NOW still works.
    - A date whose 21:00 has already passed is refused (`SCHEDULE_DATE_IN_PAST`).
  - No reminders.
- **Evidence:** both write per-concept `learning_evidence` (Test: CUMULATIVE_ASSESSMENT; Mock: MOCK_EXAM, explicitly MOCK). Origin and assignment id go in metadata. They never write Exam Readiness.

## 3. Teacher assignments (owner: TEACHER workstream)

- **Extends `teacher_interventions`:** new `intervention_type` values SUBJECT_TEST and SUBJECT_MOCK (additive migration). The per-assignment config goes in a jsonb column: subject, conceptIds, difficulty band, the plan from `planGroupAssessment`, timed / duration, maxAttempts, window `startDate` / `endDate` (dates only), and `closesAt`.
  - `closesAt` = endDate 21:00 in `institutions.timezone` of the class's institution.
  - If that is null → refuse with `TIMEZONE_AUTHORITY_BLOCKER`.
- **Targeting:** one, several or a whole class, through `publishClassAssignment` (`studentIds` empty = class). One row per student, grouped by `assignment_group_id`.
- **Group equivalence:** every student shares the same plan (count, distribution, difficulty, scoring, window). Each attempt generates its own questions (different items), avoiding that student's previously seen fingerprints. Reuse is allowed only when supply is insufficient: least recently used, avoiding the previous attempt, and recorded.
- **Attempts:**
  - Up to `maxAttempts`, which is 1, 2 or 3 (**APPROVED 2026-10-17**). The UI offers 1 / 2 / 3, and the server rejects any other value (`MAX_ATTEMPTS_INVALID`). None is required.
  - The result is the LAST COMPLETED attempt; history is kept.
  - Retry after a pass is allowed.
  - Resume of an active attempt before close does not consume an attempt.
  - After close: an active attempt may be finished while the session lives, but cannot be resumed after exit, and no new attempt starts.
  - **Heartbeat (APPROVED 2026-10-17):** the runner sends a heartbeat every 30 s. The abandonment tolerance after the 21:00 close is 180 s: more than 180 s without activity after the close counts as left, and the attempt is closed as is with no resume. A reconnect before 21:00 may still resume.
  - Difficulty bands: see §2 (the UI's Básico / Intermedio / Avanzado / Mixto map to BASIC / INTERMEDIATE / ADVANCED / MIXED).
- **Feedback release:** immediate full feedback when the student versions are truly diverse (no shared item fingerprints across the group's sessions). Otherwise show score and general performance now, and hold answers and explanations until `closesAt`. This is computed from the actual items served.
- **Teacher results:**
  - Group: per-student score, average, distribution, per-concept performance, difficulty, high-error questions/areas, strongest and weakest concepts.
  - Drill-down: per-concept, per-question response, errors, explanation, concepts to reinforce.

## 4. Pilot exposure (owner: GATING workstream)

- **Hidden from Student surfaces when `STUDENT_CATALOG_EXPOSURE=PILOT`:** PISA, ICFES (Saber), unfinished IB (Challenge), and unconfirmed Cambridge qualifications.
- **Mechanism:** a pure module `src/lib/exam-core/student-exposure.ts`. It is applied at the objective lists, at `createObjectivePreparation`, in `listStructureFamilies` / `listStructureChildren` / `resolveExamLevel`, in the raw SQL of `exams/page.tsx`, and in `createExamInstance`.
- **History stays readable:** `objectiveByKey` is unchanged, and no data is deleted.
- **Revised 2026-10-17 (FINAL PRODUCT-DECISION DELTA, branch `fd/exposure`):** PISA and ICFES are no longer hidden families. Under `PILOT` they are restricted by allowlist to what is functional: PISA Mathematics (`pisa.2022.math`, practice) and Saber 11 Matematicas (`saber11.math`, practice + mock). PISA Reading, Science and the three-domain benchmark, and the other Saber areas, are not listed. AICE 9709 AS P1 / P2 / P4 / P5 stays offered. Challenge stays hidden for IB, Cambridge (AICE included), PISA and ICFES. Each sample shows its disclosure (`exam.sample.disclosure.*`, `src/lib/exam-core/sample-disclosure.ts`) in the exam launcher and on the preparation page. The env value is unchanged: `STUDENT_CATALOG_EXPOSURE=PILOT`.

## 5. Operator decisions recorded (not invented)

- **Mock duration recommendation:** APPROVED 2026-10-17. It is the sum of `nominal-response-time.ts` over the frozen items, adjusted by difficulty, with a planning estimate before the items exist. It is advisory: the teacher's duration is authoritative and frozen.
- **Self-scheduled expiry:** APPROVED 2026-10-17. The assessment expires at 21:00 on the scheduled date in the student or institution timezone. With no authority → `TIMEZONE_AUTHORITY_BLOCKER`.
- **Mock band beyond 15 concepts that are not the whole subject:** APPROVED 2026-10-17. OVER_15_PARTIAL: ~2/concept, max 50 (18 → 36, 22 → 44, 30 → 50). Every concept gets at least 1; the remainder is uniform.
- **Heartbeat / abandonment:** APPROVED 2026-10-17. The interval is 30 s and the tolerance after close is 180 s (it replaces 90 s).
- **Teacher max attempts:** APPROVED 2026-10-17. 1–3. The last completed attempt wins, a retry after a pass is allowed, and history is kept.
- **Difficulty bands and MIXED split:** APPROVED 2026-10-17. Level 2 / 3 / 4; MIXED is 30 / 50 / 20 by largest remainder, Intermediate first.
- **Knowledge buckets:** APPROVED 2026-10-17 (B1..B4, diagnostic).
- **Untimed Test inactivity:** APPROVED 2026-10-17. 45 min, reset on saved activity; then closed, responses kept, no resume.
- **OPERATOR_DECISION_REQUIRED (open):**
  - The knowledge bucket when overall >= 80 but neither intermediate >= 80 nor advanced >= 80. This covers intermediate below 80, and a Basic-only attempt with no intermediate or advanced items. It is labelled null / UNCLASSIFIED with `unclassifiedReason`, never invented.
  - Items generated at level 1 or 5 (AUTO difficulty only) count in the overall and concept scores but in no level score.
  - Teacher-assigned untimed attempts idle for more than 45 min before the window close are resumed (rule V, decision 4), not closed (decision 8). Decision 8 is applied to Student-created untimed Tests.
  - Several distinct institution timezones for one Student (no `student_availability.timezone`) → `TIMEZONE_AUTHORITY_BLOCKER` (`INSTITUTION_TIMEZONES_CONFLICT`).

## 6. Final micro-delta D69–D71 (APPROVED 2026-10-17)

- **D69 — insufficient difficulty evidence.**
  - When the overall score is >= 80 but neither B3 nor B4 can be shown, `knowledgeBucket` is null and `classificationStatus` is `INSUFFICIENT_DIFFICULTY_EVIDENCE` (label "Evidencia de nivel insuficiente"). That covers Basic-only attempts and attempts where Intermediate and Advanced are both below 80.
  - Such a result is never moved to B2 and never called Competent.
  - When B3 and B4 both qualify, B4 wins.
  - `unclassifiedReason` keeps the detail. The group distribution key is `INSUFFICIENT_DIFFICULTY_EVIDENCE`.
- **D70 — `timing.resumeAfterInactivity`.**
  - It exists only for a Teacher-assigned, untimed subject Test, and it is frozen in the assignment and in each attempt's `assignmentWindow`.
  - The default is false. After 45 minutes idle before the close, the attempt closes as is (`INACTIVITY_CLOSED`): saved progress is graded and kept, the same attempt never resumes, and a new attempt may start if attempts remain.
  - When true, the same attempt is revived before the close.
  - `true` never overrides the post-21:00 rule. A true value on a Mock or a timed Test is refused with `RESUME_AFTER_INACTIVITY_NOT_APPLICABLE`.
  - Student-created untimed Tests are unchanged.
- **D71 — timezone authority, per recipient.**
  - The order is: the student's own `student_availability.timezone`, then the class institution's timezone (for a Teacher assignment), else `TIMEZONE_AUTHORITY_BLOCKER`.
  - For Student-created assessments, the fallback is the single distinct timezone across the student's active institutions, and conflicting values block.
  - Each recipient row is frozen with its own window (00:00 / 21:00 in that zone, `timezoneSource` `STUDENT_AVAILABILITY` or `INSTITUTION`).
  - There is no browser, server or fixture default. QA Institution `America/Mexico_City` is `QA_FIXTURE_ONLY`.
