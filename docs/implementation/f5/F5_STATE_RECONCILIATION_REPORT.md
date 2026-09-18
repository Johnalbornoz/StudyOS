# F5 — State Reconciliation Report

Source: `scripts/operations/f5-learner-state-migration-cert.sh` +
`scripts/operations/f5-lifecycle-cert-runner.ts`, run against a real, ephemeral, local-only
PostgreSQL instance via the real `updateMastery()` production function (never mocked). Remote
application status: see Preview certification doc (`DEFERRED_TO_INTEGRATED_PREVIEW_GATE`).

## Evidence and existing-authority tables — before/after this certification's own activity

| Table | Before this run | After this run | Delta | Notes |
|---|---|---|---|---|
| `learning_evidence` | 0 | 14 | +14 | Every row created by an explicit `updateMastery()` call in the certification (10 call sites, 2 of which loop 3 times each = 14 total calls); none pre-existed (fresh ephemeral DB) and none were lost or duplicated. |
| `mastery_records` | 0 | 5 | +5 | One per (student, concept) pair touched — 4 for Learner 1's concepts, 1 for Learner 2's. |
| `concept_knowledge_state` | 0 | 5 | +5 | One per (student, concept) pair, recalculated correctly after every evidence write, confirmed non-null and internally consistent for every concept including the UNRESOLVED-mapped one. |
| `concept_memory_state` (retention) | 0 | 5 | +5 | Untouched by F5's own code — written by the pre-existing Phase 6 projector, unaffected by anything F5 added. |
| `concept_transfer_state` | 0 | 0 | 0 | Never touched — no evidence in this certification used `sourceType: 'TRANSFER'`, and F5's own Transfer analytics deliberately never reads or writes this table. |
| `pedagogical_requirement_recognition` | 0 | 0 | 0 | Canonical-V2-owned; asserted to remain exactly 0 throughout. |
| `canonical_prepared_activity` | 0 | 0 | 0 | Canonical-V2-owned; asserted to remain exactly 0 throughout. |

**0 Evidence lost. 0 Evidence duplicated. 0 ownership changed. 0 Canonical stage changed because
of migration** (the migration itself creates zero rows in any evidence/state table — see the
backfill spec's own "no backfill" conclusion; every row above was created by this
certification's own explicit evidence-generation activity, not by the migration).

## New F5 tables

| Table | Rows created | Notes |
|---|---|---|
| `aggregation_policy_versions` | 3 (seeded by the migration itself) | SKILL v1, COMPETENCY v1, TRANSFER_ANALYTICS v1 — all `ACTIVE`. |
| `learner_skill_state` | 3 | `factor polynomial` (Learner 1, CONSISTENT_INDEPENDENT), `analyze` (Learner 1, EMERGING), `compare` (Learner 1, computed for the UNRESOLVED-mapped concept). Learner 2 has zero rows despite sharing a canonical concept with Learner 1. |
| `learner_competency_state` | 0 | Deliberately zero — no evidence was ever tagged with `metadata.competencyIds` in this certification, and none may be fabricated from the skill graph (task 28-D, AC-F5-04). This is the correct, asserted outcome, not a gap. |
| `learner_transfer_analytics` | 2 | Learner 1's MATCHED concept (2 FAMILIAR + 1 UNFAMILIAR) and Learner 1's AMBIGUOUS concept (1 REAL_WORLD, `canonical_concept_id = NULL`). Learner 2 and Learner 1's UNRESOLVED concept both have zero rows (no context-tagged evidence submitted for either). |

## Backfill categories (per `F5_EVIDENCE_BACKFILL_SPEC.md`, applied to this certification's own pre-migration state)

| Category | Count |
|---|---|
| SAFE_TO_REUSE_DIRECTLY (Knowledge State) | N/A — no pre-existing evidence in this fresh instance |
| SAFE_WITH_EXPLICIT_EXISTING_METADATA | 0 |
| INSUFFICIENT_METADATA | 0 (fresh instance) |
| NOT_APPLICABLE | 0 |

No historical production data exists in this ephemeral certification environment to backfill —
consistent with the spec's own conclusion that no backfill runs for Skill/Competency/Transfer
analytics regardless of environment, since no historical evidence was ever tagged for it.

## Duplicates / orphans

- **Duplicates**: 0 — every new F5 table has a `UNIQUE(student_id, dimension_id)` constraint,
  making a duplicate row structurally impossible, and the certification's own repeated calls
  (e.g. 3 separate `updateMastery` calls tagging the same skill) correctly aggregated into a
  single upserted row rather than 3 separate ones.
- **Orphans**: 0 — every FK in every new table is `NOT NULL ... REFERENCES`, enforced by Postgres.

## Conclusion

Every reconciliation expectation in task §29 is met: zero Evidence lost, zero Evidence
duplicated, zero ownership changed, zero Canonical stage changed by migration, and zero
fabricated Skill/Competency evidence anywhere in this certification.
