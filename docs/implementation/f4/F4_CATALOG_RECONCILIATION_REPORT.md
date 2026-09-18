# F4 — Catalog Reconciliation Report

Source: `scripts/operations/f4-learning-architecture-migration-cert.sh` +
`scripts/operations/f4-lifecycle-cert-runner.ts`, run against a real, ephemeral, local-only
PostgreSQL instance (never Preview/Production — remote isolation could not be proven from this
environment, per task §24; see Preview certification doc for the disposition of remote
application).

## Catalog objects created (fixture taxonomy, seeded by the migration itself)

| Object | Count |
|---|---|
| Skills | 11 (8 transversal, 3 discipline-specific) |
| Competencies | 10 (C1–C10) |
| Contexts | 5 (FAMILIAR, ALTERED, REAL_WORLD, UNFAMILIAR, CROSS_DOMAIN) |

## Catalog objects created (certification-only adversarial fixture, not shipped as production data)

| Object | Count |
|---|---|
| Canonical subjects | 1 (Mathematics) |
| Canonical concepts | 5 (Linear Functions; Derivative Rules ×2, deliberately same name/different scope; Quadratic Factoring; Polynomial Division) |
| `canonical_concept_skills` links | 3 |
| `skill_competencies` links | 2 |
| `canonical_concept_prerequisites` edges | 2 created, 1 rejected (would have closed a cycle) |

## Existing learner data present in the certification run

| Object | Count |
|---|---|
| Learners (students) | 2 |
| Subjects | 2 (one per learner) |
| Concepts | 7 (2 pre-existing before the F4 migration ran, 5 created after to exercise the adversarial matrix) |

## Mapping outcomes (`concept_catalog_mapping`, one row per concept, task §7/§21)

| Status | Count | Which concepts |
|---|---|---|
| MATCHED | 2 | Learner 1 "Linear Functions", Learner 2 "Linear Functions" — independently matched to the SAME canonical concept, never compared to each other |
| AMBIGUOUS | 1 | Learner 1 "Derivative Rules" — matched 2 canonical concepts (same name, different scope); both candidates recorded, neither auto-picked |
| UNRESOLVED | 4 | 2 pre-existing concepts (migration ran before any canonical catalog existed to match against), Learner 1 "Straight Line Equations" (differently-named, possibly-equivalent — correctly left unresolved), Learner 1 "Completely Novel Idea" |
| PROPOSED | 0 | Not exercised in this certification (single-candidate-awaiting-confirmation state; MATCHED is reached automatically for the single-exact-match case per the algorithm — PROPOSED is reserved for future AI-assisted, non-exact-match candidate suggestions, explicitly out of scope for F4's deterministic backfill) |

**Total: 7 mappings for 7 concepts — 1:1, zero unmapped, zero duplicated (enforced by
`concept_catalog_mapping.learner_concept_id UNIQUE`).**

## Data integrity

| Check | Result |
|---|---|
| Duplicates (two mapping rows for the same concept) | 0 — structurally impossible (UNIQUE constraint) |
| Orphaned mapping rows (FK violation) | 0 — all FKs enforced by Postgres at insert time |
| Cycles in `canonical_concept_prerequisites` | 0 created; 1 attempted and rejected before any write |
| Private-content references touched by mapping | 1 (`content_sources`/`content_chunks` row on the MATCHED "Linear Functions" concept) — confirmed still inaccessible to the other learner after mapping |

## Historical data — before vs. after every mapping operation in the certification run

| Table | Before | After | Delta |
|---|---|---|---|
| `learning_evidence` | 1 | 1 | 0 |
| `mastery_records` | 1 | 1 | 0 |
| `concept_knowledge_state` | 1 | 1 | 0 |
| `concept_memory_state` (retention) | 1 | 1 | 0 |
| `concept_transfer_state` | 1 | 1 | 0 |
| `content_sources` (private content) | 1 | 1 | 0 |
| `quiz_sessions` | 0 | 0 | 0 (not exercised by this fixture — no quiz-session data existed to preserve) |

**0 historical Evidence lost. 0 ownership changed. 0 private content exposed. 0 attempts lost.
0 learner records silently merged.** Every number above was captured and asserted
programmatically in `f4-lifecycle-cert-runner.ts`, not hand-computed.

## Expected real-world outcome (not measured here — no production catalog seeded yet)

Per the current-architecture assessment, zero prior canonical catalog exists in production, so
applying this migration to a real dataset would produce a near-100% `UNRESOLVED` rate initially
(exactly the "no comparable label" / "zero candidates" branches exercised above for the two
pre-existing concepts) — this is the expected, correct outcome per task §21, not a defect.
