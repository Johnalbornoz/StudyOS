# F7 — Assessment Framework Engine — Next Phase Handoff

Date: 2026-09-18
Certified SHA: `0b31e6021aa9e1099ea4a66bbc8459a2b10f379e` on `f7/assessment-framework-engine` (pushed to `origin`)
Preview deployment: `https://study-r4mpb1tjq-study-so.vercel.app` (`target: null`)

## What F7 delivered

A single, configurable Assessment Framework Engine (never a per-exam-family bespoke engine):
- `exam_definitions` → `exam_versions` (retire-and-insert versioning, same pattern as F5/F6) → `assessment_components` (timing/tool-rules with schema-enforced NOT_CONFIGURED consistency) → `assessment_blueprints` → `blueprint_objective_targets` (referencing F6's `learning_objectives`, never curriculum-tree order).
- `command_terms` reference data (data-driven framework flavoring, generalizing the existing IB precedent).
- `approved_item_families`/`approved_items` — an independent item-bank workflow, structurally complete, currently unpopulated (see R3 in the risk register).
- `student_exam_profiles`/`preparation_goals`, `institution_exam_policies` (verification-gated threshold rules).
- Generation, validation, and evaluation contracts wrapping (not replacing) the existing 4 scattered grading shapes and the existing Quality Gate/verifier/novelty filter.
- An evidence bridge into F5's real `updateMastery()` — proven end-to-end against real Postgres with a real learner.
- A Full Mock readiness guard that reports readiness without building the simulator.
- A PAA (Admission Exam) vertical with 2 independent institution policies, and a Cambridge IGCSE contrast vertical sharing a canonical concept with PAA but a different exam family — proving the engine is genuinely one configurable system.

## What the next phase should NOT re-litigate

- The exam_definitions→exam_versions→components→blueprints→objective_targets schema shape — it is certified against the adversarial matrix and should be extended, not redesigned.
- The generic `QuestionType`/difficulty/`CognitiveLevel`/`ExpectedReasoningType` vocabulary — F7 deliberately did not duplicate it; neither should any future phase.
- The evidence bridge's requirement that callers already supply a per-student `conceptId` — this is a deliberate boundary (see R7), not an oversight to "fix" by adding auto-resolution.
- The Full Mock Guard vs. Full Mock Simulator boundary — the guard is intentionally read-only/advisory.

## Recommended next-phase candidates (not a commitment — for the user's review)

1. **Full Mock Simulator** (the natural F8): consumes `canFullMockBeOffered` and, when ready, actually assembles and times a full exam attempt using `startExamAttempt`/`exam_attempt_item_responses`. This is the highest-value next step since F7 already proves every prerequisite piece works.
2. **Real item generation wiring**: connect `resolveGenerationContext`/`validateItemForExamContext` to an actual AI generation call, populating `approved_items` for at least the PAA vertical, so the item bank stops being structurally-complete-but-empty (R3).
3. **Institution policy verification workflow**: design who verifies a policy and on what evidence (R4) before any pilot claims an institution's policy as "verified" in a way a real learner or institution would see.
4. **A third exam family smoke test** (e.g. IB or SAT) purely to further validate the "one engine, not bespoke per family" invariant at slightly greater breadth (R5) — lower priority than 1–3.

## Explicit constraints carried forward (per task §52 and this session's standing rules)

- Do not merge `f7/assessment-framework-engine` to `main` without the user's explicit instruction.
- Do not deploy to Production, and do not modify Production environment variables, under any future phase's certification process — every phase's certification, including F7's, targets Preview only.
- Do not begin F8 or F9 automatically. This handoff document exists so a future session can pick up context quickly, not to imply authorization to proceed.
- Any future phase must re-run the full non-interference test pattern (`f<N>-canonical-v2-noninterference.test.ts`) extended to cover its own new files, exactly as every phase from F1 through F7 has done.
