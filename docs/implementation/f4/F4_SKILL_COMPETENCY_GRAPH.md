# F4 — Skill / Competency Graph

## Cardinalities (explicit, per task §12)

```
canonical_concepts  M ── N  skills                (canonical_concept_skills)
skills              M ── N  competencies           (skill_competencies)
canonical_concepts  M ── N  competencies           (canonical_concept_competencies, "where justified")
canonical_concepts  M ── N  canonical_concepts      (canonical_concept_prerequisites, self-referencing, acyclic)
contexts            standalone taxonomy, unwired this phase
```

No mandatory linear `Concept → Skill → Competency` chain exists or is enforced — a canonical
concept may have zero skills, a skill may belong to zero competencies, and a competency may be
reached without ever naming a specific skill (via the direct `canonical_concept_competencies`
link), matching task §2/§12 exactly.

## Fixture taxonomy (small, reviewed — task §9/§10, not a full production catalog)

### Transversal skills (8)
`interpret, compare, infer, analyze, justify, evaluate, model, communicate`

### Discipline-specific skills (3, Mathematics-scoped for this fixture)
`factor polynomial, balance equation, solve vectors`

### Competencies (10, fixed StudyUS taxonomy per task §10)
`C1 Recall, C2 Conceptual Understanding, C3 Application, C4 Analysis, C5 Problem Solving,
C6 Reasoning / Justification, C7 Evaluation, C8 Transfer, C9 Communication, C10 Metacognition`

### Contexts (5, per task §11)
`FAMILIAR, ALTERED, REAL_WORLD, UNFAMILIAR, CROSS_DOMAIN`

## Illustrative graph (seeded in the migration certification fixture, task §22 items J/K/L)

```
skill "factor polynomial"  ──▶ competency C3 Application
skill "factor polynomial"  ──▶ competency C5 Problem Solving   (one skill → 2 competencies, item L proof point)
skill "analyze"            ──▶ competency C4 Analysis

canonical_concept "Quadratic Factoring" ──▶ skill "factor polynomial"
canonical_concept "Quadratic Factoring" ──▶ skill "analyze"         (one concept → 2 skills, item J)
canonical_concept "Polynomial Division" ──▶ skill "factor polynomial" (skill reused across concepts, item K)
```

## Cycle prevention for canonical_concept_prerequisites

Cycle detection is application-level, run inside the same service function that performs the
insert (`assertNoPrerequisiteCycle(prerequisiteConceptId, conceptId)`):

```sql
WITH RECURSIVE reachable AS (
  SELECT concept_id AS id FROM canonical_concept_prerequisites
  WHERE prerequisite_concept_id = $1  -- starting from the proposed prerequisite
  UNION
  SELECT p.concept_id FROM canonical_concept_prerequisites p
  JOIN reachable r ON p.prerequisite_concept_id = r.id
)
SELECT 1 FROM reachable WHERE id = $2  -- would the proposed concept become reachable back to itself?
```

If proposing `A prerequisite-of B` would make `A` reachable starting a traversal from `B`'s
existing prerequisite edges (i.e. `B` is already, transitively, a prerequisite of `A`), the
insert is rejected before it reaches the database — proven in certification fixture item M
(`A → B → C → A` rejected at the final edge).

## Explicitly deferred (F5)

Learner-level skill state, learner-level competency percentages, and any inference of competency
completion from concept completion (INV-F4-09/10) — this document defines taxonomy and structural
relationships only; no learner ever has a "skill score" or "competency score" as of F4.
