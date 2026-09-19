# F11-C3 — Current Competency Execution Assessment

Baseline: `origin/f11c2/skill-reinforcement-execution@d1b97eb0a0c0d2e2c7205cc2364f540dbdbc4c57`, verified exact. Written before any source change, per the task's own gate.

## 1. Existing Competency authority (F4/F5, read in full, not assumed)

`competencies` (F4): `id, code UNIQUE, name, description, sequence, status CHECK IN ('DRAFT','ACTIVE','RETIRED')`. Two real, existing mapping tables: `canonical_concept_competencies` (canonical_concept_id, competency_id — a **direct** Concept→Competency edge, F4's own migration comment: "does NOT require routing through a skill") and `skill_competencies` (skill_id, competency_id). Both confirmed to exist by reading the F4 migration directly.

## 2. The exact, real F5 Competency State projector contract — read in full, not assumed

`src/lib/learner-state/competency-state.service.ts` is **structurally identical** to `skill-state.service.ts` (F11-C2's own already-certified authority): `fetchQualifyingEvidence` reads `learning_evidence WHERE metadata -> 'competencyIds' @> to_jsonb(competencyId)`; `projectCompetencyState` calls the same pure `computeDimensionState` algorithm shared with Skill State; `projectCompetencyStateForNewEvidence(client, studentId, metadata)` is **already called unconditionally inside `updateMastery`'s own transaction**, exactly like `projectSkillStateForNewEvidence`. The metadata key is confirmed, by direct code inspection, to be **`competencyIds`** (plural array of competency UUID strings) — the exact naming convention Skill's `skillIds` already established, not assumed by analogy.

**This means F11-C3's entire job for Competency State aggregation is, again, zero new code**: get `metadata.competencyIds` populated correctly on a real `updateMastery` call, and F5's own existing, unmodified projector does everything else.

## 3. Whether Practice alone is sufficient — inspected, not assumed (task's own explicit demand)

**Yes, confirmed by reading `state-classification.ts` (the shared, pure classification algorithm) in full.** There is no context-diversity dimension, no multi-concept/multi-skill requirement, no reasoning-requirement field, no separate "Competency-specific" qualification rule anywhere in the current, real implementation. `computeDimensionState`'s only inputs are `{ id, result, independent, occurredAt }` per evidence row and `{ minimumEvidenceCount }` from the policy — the identical shape and algorithm used for Skill State. Grepped `contexts`/`context_id`/`contextId` across the entire `learner-state` module and `mastery.service.ts`: **zero matches** — F4's `contexts` table plays no role whatsoever in current evidence qualification. The task's own caution (§4/§8/§19 — "do not assume Practice is sufficient," "test context diversity") is a reasonable general caution, but **inspection proves the current, real F5 model does not require anything beyond what Practice (the same mechanism F11-C1/C2 already reuse) can produce.**

## 4. Aggregation policy — already seeded, already read dynamically

`aggregation_policy_versions` has an ACTIVE `COMPETENCY` row seeded by F5's own migration (`minimumEvidenceCount: 3`, same as SKILL) — no seeding gap. F11-C3's certification will read this value dynamically (`SELECT rules FROM aggregation_policy_versions WHERE dimension='COMPETENCY' AND status='ACTIVE'`), never hard-coding the threshold, per the task's explicit instruction.

## 5. Reusable execution contracts

Identical to F11-C2: `generatePracticeQuestions`, `storeQuiz`, `getQuizSession`, `completeQuiz` (Practice engine, frozen) are sufficient — confirmed by §3 above. No F7 assessment/evaluation, F8 activity, or F9 simulation contract is needed for F11-C3, since the qualifying-evidence contract Competency actually requires today is no richer than Skill's.

## 6. Concept-context resolution for a Competency target

Mirrors F11-C2's Skill resolution exactly, using the **direct** `canonical_concept_competencies` mapping (competency → canonical concept, no skill hop needed) + F9's existing `resolveStudentConceptForCanonicalConcept` (studentId, canonicalConceptId) — same deterministic "exactly one candidate, else fail controlled" rule, same non-fabrication guarantee.

## 7. Risks of oversimplifying Competency into one Concept — addressed, not ignored

The risk named in the task (forcing Competency into a one-Concept shape merely because C1/C2 used it) is real *in general*, but per §3's inspection, F5's *current* qualification rule genuinely does not distinguish "how many concepts were involved" — it counts *evidence rows* tagged with the competency id, full stop. Using one deterministically-resolved concept per execution (exactly like Skill) does not under-serve the real, current F5 contract; it would only under-serve a *hypothetical future* richer contract, which is explicitly out of scope to invent (task's own "do not lower thresholds merely to pass," inverted: do not *raise* complexity merely to anticipate a rule that does not exist yet).

## 8. Required minimal additive changes

Same shape as F11-C2, mirrored for Competency, with **its own separate** parameter/column (not reusing `targetSkillIds`, to keep Skill and Competency tagging independently traceable and to allow a future quiz to carry both without conflation):
1. `teacher_intervention_executions.execution_type` CHECK widened to add `'COMPETENCY_PRACTICE'`.
2. `quiz_sessions.target_competency_ids uuid[]` (new, nullable column).
3. `storeQuiz`'s new, optional, last parameter `targetCompetencyIds?: string[] | null`.
4. `QuizSession.targetCompetencyIds` field + `getQuizSession` mapping.
5. One additive conditional spread line in the submit handler's existing metadata construction, symmetric to the Skill one, mutually exclusive in practice (a Competency-targeted execution's quiz carries `target_competency_ids`, never also `target_skill_ids`, since `startCompetencyReinforcementExecution` never sets the latter).

## Conclusion

No blocking gap. Practice is sufficient (verified, not assumed). The required extension is the same small, additive, previously-established pattern, applied to Competency's own already-existing, already-wired metadata key. Implementation may proceed.
