# F15 — Exam-Taking Experience (Workstream A)

## The real gap (corrected from F14's own framing)

F14 assumed the missing piece was "the UI." Direct inspection this phase found the gap was one level deeper: `SimulationPlanTarget` (the frozen exam blueprint's per-item spec — component/question-type/difficulty range) had **no wiring anywhere in the codebase** to actual question content. No route, service, or plan-builder ever called the AI question generator or the (real, but entirely dormant and empty) item bank (`approved_items`/`item-bank.service.ts`) for a simulation target. Building only a UI on top of this would have had nothing real to render.

## What was built — reusing three already-certified systems, never a second exam engine

`src/lib/simulation/item-resolution.service.ts` (new orchestrator):

```
BlueprintObjectiveTarget (F7, via getObjectiveTarget)
  → resolveActivityMetadataForObjective (F6 -- PUBLISHED objective_concept_mappings only,
     the SAME function recordSimulationItemResponse already uses for evidence-writing)
  → resolveStudentConceptForCanonicalConcept (F9's own reverse-lookup, already used by scoring.service.ts)
  → generatePracticeQuestions (the existing AI engine every self-service Practice quiz already uses)
  → toClientQuestion (the existing sanitizer -- strips the answer key before anything reaches the browser)
```

- `getNextSimulationItem(actorUserId, attemptId)` — resolves (generating if needed) the current item. **Idempotent**: a repeated call for the same target index returns the SAME server-held question (persisted in `simulation_attempts.navigation_state`, a real column F9 initialized at attempt-start but never advanced before this phase) rather than silently regenerating a different one on a page refresh or a resumed session.
- `submitSimulationItemAnswer(actorUserId, attemptId, studentAnswer, idempotencyKey?)` — grades via the real, unmodified `recordSimulationItemResponse` (F9), using the **server's own held copy** of the question, never a client-supplied one (a client only ever sends its answer string).
- `skipUnavailableSimulationItem(actorUserId, attemptId)` — advances past a target the platform genuinely could not generate content for, without recording any response — never a fabricated grade, never a permanently stuck exam.

Two new API routes: `GET/POST /api/simulation/attempts/[id]/next-item` (get/submit/skip), both owner-only, both rate-limited (see F15_SECURITY_HARDENING_REPORT.md).

New UI: `ItemRunner.tsx` (client component) wired into the existing `/dashboard/exam-prep/attempt/[attemptId]` page for `ACTIVE` attempts, replacing F14's "deferred" notice. Reuses the exact same answer controls and encoding as F14's Assignment Practice runner via two new shared modules (`src/components/quiz/QuestionAnswerFields.tsx`, `src/lib/quiz/client-answer-encoding.ts`) — `PracticeRunner.tsx` was refactored to use them too, eliminating what would otherwise have been a second copy of ~120 lines of per-answer-format rendering logic.

## Platform-not-ready vs. a wrong answer (task's own explicit requirement)

An `ITEM_UNAVAILABLE` result (no curriculum mapping, no matched concept, or generation genuinely failed) renders as a distinct, honest state with a **Skip** action — never scored, never presented as an incorrect answer, never silently faked as a question. The three reasons (`NO_CURRICULUM_MAPPING`, `CONCEPT_NOT_MATCHED`, `NO_ITEM_GENERATED`) are each rendered with their own specific copy, not one generic message.

## Completion

The existing, real, unmodified `POST /api/simulation/attempts/[id]/complete` (F9 — real scoring, F8 post-exam diagnosis, F9 readiness recomputation) is called once the student has worked through every target — no new completion/scoring logic was written.

## What was deliberately NOT built

- **Timed exams**: `timingMode` (`TRAINING_TIMED`/`OFFICIAL_SIMULATION_TIMED`) is accepted at attempt-start (unchanged from F9/F14) but `ItemRunner` does not enforce or display a countdown — a real, disclosed scope limit. `UNTIMED` attempts (the only mode exercised by this phase's own testing) work fully.
- **Question review after grading**: the runner shows the grader's own `feedback` string after each submission but does not build a full end-of-exam review screen (correct answer, explanation, per-item breakdown) — `getSimulationScoreSummary`'s `byComponent` breakdown is real and available for a future phase to surface.
- **Non-text item types**: only the answer formats the existing quiz-generation engine already produces (`single_choice`/`multi_choice`/`text`/`matching`/`ordering`/`classification`) are supported — no new, unsupported type was invented to fill a gap.

## Verification

11 new deterministic unit tests (`tests/unit/f15-simulation-item-resolution.test.ts`) — ownership/IDOR enforcement, active-status enforcement, idempotent generation, unavailable-item handling, skip-without-grading, and that grading delegates verbatim to the real `recordSimulationItemResponse`. `tsc --noEmit` clean; `next build` clean; full suite 352/352 files, 5632/5632 tests passing.
