# F6 — Curriculum Reconciliation Report

Source: real-Postgres certification (`f6-curriculum-mapping-migration-cert.sh` +
`f6-seed-pilot-dataset.ts` + `f6-lifecycle-cert-runner.ts`).

## Objects created in the certification run

| Object | Count |
|---|---|
| Organizations | 2 (ICFES, Cambridge International) |
| Programmes | 2 (PAA/ADMISSION_EXAM, Cambridge IGCSE/CURRICULUM) |
| Qualifications | 1 (IGCSE) |
| Subjects | 2 (PAA Mathematics, Cambridge Mathematics) |
| Structure versions | 3 (PAA v1 → SUPERSEDED, PAA v2 → PUBLISHED, Cambridge v1 → PUBLISHED) |
| Structure nodes | 4 (PAA v1 "Algebra", PAA v2 "Algebra" + "Linear equations" child, Cambridge "Number" + "Fractions and percentages") |
| Learning objectives | 6 (5 PAA, 1 Cambridge) |
| Concept mappings | 8 rows total across the workflow: 2 PUBLISHED (Linear PAA v2-replacement + Cambridge), 1 RETIRED (Linear PAA original, replaced), 1 PUBLISHED (Quadratic PARTIAL), 1 PUBLISHED (Quadratic Formula PREREQUISITE), 1 PUBLISHED (Vectors candidate A), 1 DRAFT (Vectors candidate B, never resolved), 1 IN_REVIEW (self-approval attempt, denied) |
| Academic resources | 5 total: 3 PUBLISHED (approved guide + 2 duplicate practice sets), 1 RETIRED (was PUBLISHED, then explicitly retired), 1 REJECTED (never published) |
| Resource-objective links | 5 |
| Editorial grants | 5 (2 EDITOR, 2 REVIEWER [one dual-granted], 1 PUBLISHER) |

## Coverage numerator/denominator (PAA structure v1, before the v2 supersession)

| Metric | Value |
|---|---|
| Total objectives | 5 |
| Fully mapped | 2 (Linear Equations, Vector Operations) |
| Partially mapped | 1 (Quadratic Graphs) |
| Unmapped | 2 (Quadratic Formula — PREREQUISITE-only counts as neither FULL nor PARTIAL — and Probability Distributions) |
| Objectives with an approved resource | 1 (Linear Equations — 3 PUBLISHED resources linked, still counts once) |

## F4 canonical concepts before/after

Before this certification run: 0 (fresh ephemeral instance). After: 4 (Linear Equations,
Quadratic Functions, Vectors ×2 deliberately ambiguous) — all created as this phase's own
certification fixture, never touched or duplicated by any F6 write. **0 canonical concept
duplication due to framework**: exactly one `canonical_concepts` row named "Linear Equations"
exists throughout, referenced by 3 different objective mappings across 2 different frameworks.

## F5 evidence before/after

Before and after this certification run: 0 `learning_evidence` rows (F6 never writes to this
table — confirmed structurally in `f6-canonical-v2-noninterference.test.ts` and empirically: the
certification script never calls `updateMastery` or any F5 projector). **0 Evidence rewritten, 0
learner state rewritten** — trivially and structurally true, since F6 has no code path capable of
writing to either.

## Private content

1 `content_sources`/`content_chunks` row created for the private-content isolation test. **0
private-content visibility changes**: `verifyContentSourceAccess` (F0-S, unmodified) returned
`true` for the owning learner and `false` for a different learner both before and after the
content's underlying concept was mapped to a canonical concept referenced by a published PAA
objective.

## Conclusion

Every reconciliation expectation in task §31 is met: 0 canonical concept duplication due to
framework, 0 Evidence rewritten, 0 learner state rewritten, 0 private-content visibility changes.
