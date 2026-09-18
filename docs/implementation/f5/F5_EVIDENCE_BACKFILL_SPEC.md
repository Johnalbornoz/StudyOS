# F5 — Evidence Backfill Spec

Written before any backfill implementation, per task §20.

## Classification of historical `learning_evidence`

| Category | Definition | Historical count (expected) |
|---|---|---|
| SAFE_TO_REUSE_DIRECTLY | Evidence already has everything a dimension needs with no new metadata (applies to Knowledge State only — it needs no F5 change at all, per the target architecture). | All historical rows, for Knowledge State only |
| SAFE_WITH_EXPLICIT_EXISTING_METADATA | Evidence explicitly carries `metadata.skillIds`/`metadata.competencyIds`/`metadata.contextCode`. | **Zero** — confirmed by the assessment: no writer has ever populated these fields |
| INSUFFICIENT_METADATA | Evidence exists for the concept but without the new tags, and no safe inference exists (this is the Concept→Skill graph trap the task explicitly forbids exploiting). | Effectively all historical Skill/Competency/context-tagged evidence |
| NOT_APPLICABLE | Evidence whose `source_type`/`activity_type` structurally cannot carry skill/competency/context meaning (e.g. a structural mastery-record stub, non-response rows). | Any zero-attempt structural rows |

## Backfill decision

**There is no backfill to run for Skill State, Competency State, or Transfer analytics.**
Every historical `learning_evidence` row falls into `INSUFFICIENT_METADATA` for these three
dimensions, by the assessment's own finding (zero prior tagging). Fabricating a
`learner_skill_state`/`learner_competency_state` row via the F4 concept→skill/competency graph
would be exactly the retroactive-assignment INV-F5-... and AC-F5-05 forbid. The correct backfill
action is therefore: **create no rows** — every (student, skill) and (student, competency) pair
simply has no `learner_skill_state`/`learner_competency_state` row at all, which reads as
`NO_EVIDENCE` by absence (matching `concept_catalog_mapping`'s own "explicit UNRESOLVED row"
philosophy would suggest inserting a row — but here, since the table is per-(student, skill)
and there is no bounded enumeration of "every skill every student should have a state for" the
way every *concept* got exactly one F4 mapping row, an absent row is the correct sparse
representation, exactly as task §19 anticipates: "The platform must tolerate sparse state.")

For Knowledge State: **no backfill needed at all** — `concept_knowledge_state` already exists,
already covers all historical evidence, and F5 changes nothing about it.

For Transfer analytics (`learner_transfer_analytics`): same disposition as Skill/Competency — no
row is created for a (student, concept) pair until at least one `contextCode`-tagged evidence row
exists for it going forward. No historical row is backfilled.

## Reconciliation counts (recorded in the reconciliation report)

- SAFE_TO_REUSE_DIRECTLY: all historical `learning_evidence` rows (Knowledge State, unchanged)
- SAFE_WITH_EXPLICIT_EXISTING_METADATA: 0
- INSUFFICIENT_METADATA: all historical rows, for the Skill/Competency/Transfer-analytics dimensions
- NOT_APPLICABLE: any structural zero-evidence rows (none exist in `learning_evidence` itself —
  the "structural stub" pattern applies to `mastery_records`, not evidence)

## What the migration actually does

Creates the new tables (`aggregation_policy_versions`, `learner_skill_state`,
`learner_competency_state`, `learner_transfer_analytics`) and seeds exactly the three version-1
policy rows from the aggregation policy doc. It does **not** iterate over `learning_evidence` at
all — there is nothing safe to compute from it yet. This is the honest, disclosed outcome of
introducing these dimensions where no measurement infrastructure existed before, not a deferred
task.
