# F11-C3 — Next Phase Handoff

## What F11-C3 delivered

- `startCompetencyReinforcementExecution` + one new branch in the existing `startTeacherInterventionExecution` dispatcher, in the same orchestration file F11-C1/C2 established, reusing the same Student routes, the same Practice engine, the same idempotency/lifecycle/reconciliation patterns.
- One additive, optional second tagging parameter on `storeQuiz`/`getQuizSession`/the submit route's metadata construction (`targetCompetencyIds`, kept structurally separate from F11-C2's `targetSkillIds`).
- Real, certified proof that F5's Competency Evidence/State pipeline is already fully automatic once `metadata.competencyIds` is populated correctly — no F11-C3 code triggers aggregation directly.
- Real, certified proof of BOTH non-inference directions: Concept→Competency (Case D) and Skill→Competency (Case E, "one of C3's highest-priority assertions") — and the reverse direction, Competency→Skill (Case T).
- Real, certified proof of the two additional Competency-specific semantics F11-C1/C2 never had to prove: insufficient-evidence-before-threshold (Case I) and assisted-evidence honesty under aggregation (Case L).

## What F11-C4 (Exam) should know

1. **Follow the exact same dispatcher pattern.** Add `startExamReinforcementExecution` to the same orchestration file; extend `startTeacherInterventionExecution`'s dispatch condition with one more `if` branch; do not create new routes, new registries, or new lifecycles.
2. **Do not assume Practice is sufficient for Exam, and inspect first.** F11-C3 had to verify (by direct code reading, not assumption) that F5's Competency policy has no context-diversity dimension before committing to Practice as the adapter. Exam's actual execution mechanism is very likely F9's `TOPIC_EXAM` simulation (`getSimulationEligibility`/`plan.service.ts`), not `generatePracticeQuestions`/`storeQuiz` — confirm this by reading F9's real contract before designing anything, exactly as this phase's own task §4 required for Competency.
3. **Exam's execution registry entry will likely need a different reference shape.** `quiz_sessions`-based `execution_reference` (an id into that table) may not fit an Exam simulation attempt at all — F11-C4 will likely need its own `execution_type` value (e.g. `'TOPIC_EXAM_SIMULATION'`) with a different reference target table (an `exam_attempts`/simulation-attempt id, not `quiz_sessions.id`), and must additionally handle the "student has no active Exam Profile" zero-state, which Concept/Skill/Competency never needed to.
4. **If a future phase needs to tag one quiz with more than one dimension simultaneously** (e.g. both a Skill and a Competency in the same execution), revisit the `targetSkillIds`/`targetCompetencyIds` two-separate-columns decision deliberately rather than adding a third parallel column by default — see `F11_C3_RESIDUAL_RISK_REGISTER.md` item 6.
5. **Check the positional-index test pattern proactively, again.** Any future `storeQuiz` signature change should re-run `canon-r5r1-quiz-session-v1-marker.test.ts`, `canon-r6-prove-v1-exact10-independent-assessment.test.ts`, `lx9-final-transfer-recovery-canonical-progress.test.ts`, and `quiz-persistence-evidence-mode.test.ts` first, in isolation, before the full suite — this is now a confirmed recurring pattern across two consecutive phases.
6. **The optional F8 remediation adapter** (Teacher Intervention → F8 `intervention_session`) remains explicitly deferred, unchanged from F11-C2's own note.

## What F11-C4 should NOT do

- Do not create a second Student pending-intervention list or a second start route.
- Do not create a second idempotency mechanism — reuse `UNIQUE(teacher_intervention_id, idempotency_key)`.
- Do not derive Exam-objective evidence from any graph traversal after the fact — the explicit-target-only discipline this phase established for Competency (and F11-C2 established for Skill) must hold for Exam too.
- Do not assume the same one-Concept-per-execution shape without first checking whether F9's actual Exam contract requires something broader (multiple concepts, a full section, a timed constraint) — the same "do not force into a shape merely because prior phases used it" discipline this phase applied to Competency applies again here.
