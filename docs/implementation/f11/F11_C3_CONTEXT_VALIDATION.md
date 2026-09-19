# F11-C3 — Context Validation

## What "context" means for a Competency execution

Since F11-B's own CHECK constraint makes `concept_id` structurally `NULL` for a `target_type='COMPETENCY'` row, F11-C3 never reads a stored concept context from the intervention itself — it always resolves one deterministically at execution-start time, exactly as F11-C2 does for Skill.

## Resolution algorithm (`resolveDeterministicConceptForCompetency`)

1. Read every `canonical_concept_id` from `canonical_concept_competencies` for the target `competency_id` — the DIRECT edge (never routed through `skill_competencies`).
2. For each candidate, call F9's existing `resolveStudentConceptForCanonicalConcept(studentId, canonicalConceptId)`, which returns this student's own matched `concepts.id` or `null` if unmatched — it never fabricates a correspondence.
3. Collect resolved concept ids into a set.
4. **Zero** results → `null` → controlled failure (`StudentInterventionNotStartableError`).
5. **More than one** result → `'AMBIGUOUS'` → controlled failure (same error type) — never an arbitrary or AI-chosen pick among the candidates.
6. **Exactly one** result → that concept id is used as the execution's concept context.

## Validated at execution-start time, inside the intervention's row lock

Both the Competency's own `status = 'ACTIVE'` check and the concept-context resolution happen as part of `startCompetencyReinforcementExecution`'s existing sequence — the status check inside the lock (fast, DB-only), the concept resolution after the lock is released (consistent with F11-C1/C2's "never hold a DB lock across the slower resolution/generation work" discipline).

## Real-Postgres proof (Case M)

A Competency with **zero** valid `canonical_concept_competencies` mappings for the student was constructed and assigned; starting it was proven to raise `StudentInterventionNotStartableError`, with **zero** `teacher_intervention_executions` rows created — no execution registry row, no quiz, no evidence, matching the same controlled-failure contract F11-C2 established for Skill's mismatched case.

## Real-Postgres proof (Case G, positive)

The happy-path Competency execution (Case F/G/H) resolves to the student's own matched concept (the one seeded via `concept_catalog_mapping` against the canonical concept the target Competency directly maps to) — verified by asserting `quizSession.conceptId` equals that exact concept id, never a different or AI-inferred one.

## Why this is not "forcing a one-Concept shape" (task §8)

Task §8 required inspecting whether Competency evidence genuinely needs more than one Concept, multiple Skills, context diversity, or transfer context before assuming the one-Concept-per-execution shape F11-C1/C2 used. That inspection (documented in `F11_C3_CURRENT_COMPETENCY_EXECUTION_ASSESSMENT.md` and `F11_C3_COMPETENCY_EXECUTION_ARCHITECTURE.md`) found, by reading F5's real `computeDimensionState` algorithm, that the current Competency aggregation policy counts qualifying evidence *rows*, not distinct concepts, skills, or contexts. One deterministically-resolved concept per execution therefore does not under-serve the real, current contract — repeated independent executions (each producing one evidence row) is exactly what the real policy requires to reach `CONSISTENT_INDEPENDENT`/past `INSUFFICIENT_EVIDENCE` (proven in Cases I/J). If F5's policy is ever extended with a context-diversity or multi-concept dimension, this resolution algorithm would need re-evaluation — flagged in the Residual Risk Register, not assumed away.
