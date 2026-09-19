# F11-C2 — Current Skill Execution Assessment

Baseline: `origin/f11c1/concept-reinforcement-execution@f5276260782730ca8fa6e29fb44bead649d38eb0`, verified exact. Written before any source change, per the task's own gate.

## 1. F11-B target model (reconfirmed, unchanged)

`teacher_interventions.target_type IN ('CONCEPT','SKILL','COMPETENCY','LEARNING_OBJECTIVE')` with four nullable FK columns (`concept_id`, `skill_id`, `competency_id`, `learning_objective_id`) and a CHECK constraint requiring **exactly one** non-null, matching `target_type`. For `target_type='SKILL'`, `concept_id` is **structurally NULL** — a Skill intervention cannot simultaneously carry a stored concept context under the current, frozen schema. `assignTeacherIntervention` validates the target FK exists (catches `23503` → `TeacherInterventionInvalidTargetError`) but does **not** check `skills.status` — a `RETIRED` skill can currently be assigned. F11-C2 does not touch F11-B; this is handled by validating status at **execution start** instead (additive, non-invasive).

## 2. F11-C1 execution registry and orchestration (reconfirmed)

`teacher_intervention_executions.execution_type CHECK (execution_type IN ('TOPIC_PRACTICE'))` — must be extended additively to admit a second value. `startConceptReinforcementExecution`'s row-lock/idempotency/reconciliation pattern is fully generic already (locks `teacher_interventions`, checks `isOwner`, checks effective status, checks idempotency key) — only the **target-type dispatch and concept-resolution steps** are Concept-specific and need extending, not the surrounding architecture. `isOwner`, `getEffectiveStatus`, the reconciliation loop, and the routes are all reusable as-is.

## 3. F4 Skill/Concept graph (reconfirmed)

`skills` (id, name, skill_type, status CHECK IN (DRAFT,ACTIVE,RETIRED)). `canonical_concept_skills` (canonical_concept_id, skill_id) — many-to-many, Canonical-V2-scoped. Bridging to a **specific student's own** `concepts.id` requires `concept_catalog_mapping` + `resolveStudentConceptForCanonicalConcept(studentId, canonicalConceptId)` (F9's own function, reused read-only) — which can legitimately return `null` ("never fabricates a correspondence").

## 4. F5 Skill Evidence/State pipeline — the critical finding

`updateMastery()` (F5, real, unmodified, already called by F8 and the Practice engine) **already calls `projectSkillStateForNewEvidence(client, studentId, metadata)` inside its own transaction**, for every `updateMastery` call, unconditionally. That function reads `metadata.skillIds` (an array of skill UUID strings) and re-projects `learner_skill_state` for each — via `projectSkillState`, which reads qualifying evidence with `metadata -> 'skillIds' @> to_jsonb(skillId)` and applies the ACTIVE `aggregation_policy_versions` row for dimension `'SKILL'`.

**This pipeline is already fully wired and requires zero new F11-C2 code to trigger aggregation.** F11-C2's entire job for Skill State is: get `metadata.skillIds` populated correctly on a real `updateMastery` call. Nothing else.

`aggregation_policy_versions` **already has a seeded default row** for `SKILL` (`minimumEvidenceCount: 3`, `ON CONFLICT (dimension, version) DO NOTHING` in F5's own migration) — unlike `mastery_policies` (which F11-C1 had to seed manually in its cert script), no seeding gap exists here.

Competency projection (`projectCompetencyStateForNewEvidence`) reads a **completely separate** metadata key, `metadata.competencyIds` — never populated by anything F11-C2 writes. AC-C2-15 ("no Competency Evidence fabrication") therefore holds **by construction**, not by any defensive code F11-C2 needs to add.

## 5. Existing `skillIds`/`metadata.skillIds` producers (searched repo-wide)

Real producers found: `src/lib/teaching/evidence-integration.service.ts` (F8's `writeInterventionEvidence`, tags `metadata.skillIds = [params.skillId]` when a diagnosis names one), `src/lib/assessment/evidence-bridge.service.ts`/`generation-contract.service.ts`/`validation.service.ts` (F7, exam-attempt evidence), `src/lib/simulation/scoring.service.ts` (F9). **None of these are in the Practice/`generate-and-take` path.** The Practice engine (`quiz-generation.service.ts`, `quiz-persistence.service.ts`, and `generate-and-take/route.ts`'s submit handler) has **no existing mechanism at all** to carry a skillId from generation through to the `updateMastery` metadata object — confirmed by exhaustive grep (zero matches for `skillId`/`skillIds` anywhere in either quiz service file or the route).

## 6. Gap requiring an additive extension (the one real gap found)

Per task §9's own explicit permission ("if the existing service contract cannot propagate explicit activity metadata... make the smallest additive service-level extension necessary"), F11-C2 needs:

1. **One new nullable column** on `quiz_sessions`: `target_skill_ids uuid[]` (additive migration; `NULL`/absent for every existing row, including every F11-C1 `TOPIC_PRACTICE` quiz created before or after this change unless F11-C2 itself sets it).
2. **One new optional parameter** on `storeQuiz(...)`, defaulted to `undefined`/omitted — existing callers (the ordinary student-initiated Practice flow, and F11-C1's own `startConceptReinforcementExecution`) are never changed and never pass it, so their behavior is byte-identical.
3. **One new field** on the `QuizSession` interface / `getQuizSession`'s mapping (`targetSkillIds: string[] | null`), populated from the new column.
4. **One additive, conditional spread line** in `generate-and-take`'s submit handler's existing metadata object construction — `...(quizSession.targetSkillIds?.length && conceptId === quizSession.conceptId ? { skillIds: quizSession.targetSkillIds } : {})` — mirroring the file's own established pattern (every other optional metadata field in that object is already built with exactly this conditional-spread idiom). When the column is `NULL` (100% of pre-existing and all non-Skill-intervention quizzes), this line contributes nothing — metadata is byte-identical to today.

This is the **only** modification anywhere outside newly-created F11-C2 files, and it is additive/optional/default-safe by construction, matching every requirement in task §9.

## 7. Risk of accidentally deriving skillIds from the concept graph — and how the design avoids it

The one path that could accidentally leak graph-inferred skill tagging would be if concept-resolution logic (walking `canonical_concept_skills` to find a valid concept for a targeted skill) were reused in reverse to tag evidence for an **ordinary** Concept-targeted execution. It is not: `startConceptReinforcementExecution` (F11-C1, unmodified) never touches `canonical_concept_skills` and never sets `metadata.skillIds`; the new Skill-dispatch path is a **separate function** that only runs when `intervention.target_type === 'SKILL'`. A structural source guard (§10 of the implementation) proves the Concept path's call to `storeQuiz` never passes `skillIds`.

## Conclusion

No blocking gap. One small, additive, explicitly-sanctioned extension to the Practice persistence layer is required and scoped precisely above. Implementation may proceed.
