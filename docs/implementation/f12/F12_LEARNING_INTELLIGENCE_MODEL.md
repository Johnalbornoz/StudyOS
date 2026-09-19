# F12 — Learning Intelligence Model

## Three dimensions, never collapsed (task section 13, INV-F12-... spirit)

| Dimension | Source table | State taxonomy | Notes |
|---|---|---|---|
| Concept Knowledge | `concept_knowledge_state` | `UNKNOWN \| LEARNING \| DEVELOPING \| PROVISIONAL_MASTERY \| VALIDATED_MASTERY \| AT_RISK \| INTERVENTION_REQUIRED` | The oldest, pre-F5 classification, still the real Concept-level authority |
| Skill | `learner_skill_state` | `NO_EVIDENCE \| INSUFFICIENT_EVIDENCE \| EMERGING \| CONSISTENT_INDEPENDENT` | F5 Evidence & Learner State 2.0 |
| Competency | `learner_competency_state` | same taxonomy as Skill, separate table/population | F5 |

`getInstitutionLearnerSummary`/`getClassLearningSummary` return all three as SEPARATE `StateDistribution` objects, each with its own `distribution` map and `totalStatesRecorded` count. No function anywhere in the module sums or averages across these three into one score — real-Postgres proven: a population with real Skill evidence and zero Competency evidence shows a non-empty Skill distribution and an empty Competency distribution, reported side by side, never merged.

## Evidence sufficiency (task section 14, INV-F12-12)

`evidencePresenceSplit` reports `withEvidence`/`noEvidence` as a plain count split over `learning_evidence` — a learner with zero rows is `noEvidence`, a documented NEUTRAL fact, never interpreted as poor performance. Per-dimension `INSUFFICIENT_EVIDENCE`/`NO_EVIDENCE` states are already visible directly in the Skill/Competency distributions themselves (their own real, already-computed enum values) — F12 does not recompute or re-derive evidence sufficiency independently; it only surfaces what F5's own projectors already concluded.

## Class vs institution scope

`getClassLearningSummary` and `getInstitutionLearnerSummary(..., { classId })` share the same underlying `buildLearningSummary` function — a class-level view is not a second implementation, only a narrower `activeLearnerIdsForInstitution` population (an institution-scoped query with an additional `class_id` filter, both already-verified-authorized).

## Learner drill-down uses the SAME three distributions, unaggregated to n=1

`getLearnerDrillDown` calls the identical `conceptKnowledgeDistribution`/`skillStateDistribution`/`competencyStateDistribution` helper functions with a single-element `studentIds` array — no separate single-learner code path exists that could drift from the aggregate one.
