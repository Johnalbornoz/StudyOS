# F5 — Evidence Model

## Current shape (unchanged)

`learning_evidence` already expresses, per the assessment: learner (`student_id`), activity
(`source_type`, `activity_type`, `learning_mode`), concept (`concept_id`), score
(`result`/`score_percent`), assistance (`ai_assistance_type`, `hints_used`), difficulty
(`difficulty`), timestamp, and an open `metadata` jsonb already used for response-time telemetry,
transfer distance/novelty dimensions, and confidence. F5 changes none of this.

## Additive extension (task §7)

Three new **optional** `metadata` fields, populated only by a caller that explicitly knows an
activity measured a skill/competency/context — never inferred, never retrofitted onto historical
rows:

```ts
interface LearningEvidenceMetadataExtensionF5 {
  skillIds?: string[];        // canonical skills.id this activity explicitly exercised
  competencyIds?: string[];   // canonical competencies.id this activity explicitly measured
  contextCode?: 'FAMILIAR' | 'ALTERED' | 'REAL_WORLD' | 'UNFAMILIAR' | 'CROSS_DOMAIN';
}
```

Threaded through `updateMastery`'s existing `telemetry` parameter (`mastery.service.ts`), the
same additive path already used for `hintsUsed`/`aiAssistanceType`/response-timing — no new
column, no migration to `learning_evidence` itself.

## Canonical concept mapping at read time (task §23)

F5 never stores a canonical concept id on `learning_evidence` itself. When Transfer analytics
computes `learner_transfer_analytics.canonical_concept_id`, it looks up
`concept_catalog_mapping` at computation time and uses the mapped id **only if `status = 'MATCHED'`**
— never persisted onto the evidence row, always re-derived, so a later remapping (e.g. a human
review moves AMBIGUOUS → MATCHED) is picked up on the next recomputation without any evidence
rewrite.

## Knowledge Evidence (task §8) — no new classification needed

Knowledge State's existing `Understanding`/`Application` dimension classification
(`knowledge-state.service.ts::classifyUnderstanding`/`classifyApplication`) already encodes
"not every correct answer is equivalent evidence" — it already excludes DIAGNOSTIC/TRANSFER/
REMEDIATION sources from Understanding and requires specific assessment source types for
Application. F5 reuses this classification as-is for its Knowledge Evidence explainability
wrapper; it does not redefine what counts as knowledge evidence.

## Skill Evidence (task §9)

A `learning_evidence` row is Skill Evidence for skill `S` **if and only if**
`metadata.skillIds` contains `S`. The F4 `canonical_concept_skills` graph edge (concept → skill)
is never used to infer this — it only tells the aggregation *which skills are relevant to a given
concept* for catalog-browsing/admin purposes, never that an activity for that concept exercised
that skill (AC-F5-05).

## Competency Evidence (task §10)

A row is Competency Evidence for competency `C` **if and only if** `metadata.competencyIds`
contains `C` — never inferred from `skill_competencies`/`canonical_concept_competencies`, and
never inferred from "the learner has evidence for N of the M skills linked to this competency."
No validated policy for that kind of synthesis exists in this codebase, and F5 does not invent
one (AC-F5-04).

## Transfer/context evidence (task §11)

A row contributes to `learner_transfer_analytics`'s context-diversity counters if and only if
`metadata.contextCode` is set to one of the five F4 context values. This is entirely independent
of, and never conflated with, the existing `TransferDistance`/`TransferChallengeDepth`/
`TransferDepth`/novelty-dimension vocabularies documented in the assessment.

## Independence/assistance (task §12)

F5 reuses the raw ground predicate directly: a row is "independent" iff
`ai_assistance_type === 'NONE'` (matching Knowledge State's own Independence-dimension
convention, the second of the four predicates catalogued in the assessment — chosen because
Skill/Competency State's questions ("did the learner do this without help") are the same shape
as Knowledge State's Independence dimension, not the stricter Retention or stage-progression
variants). This is documented explicitly as F5's own, consciously-chosen predicate rather than a
silent fifth divergent definition.

## Difficulty (task §13)

`difficulty` is read and reported in every explainability response but is not used to gate
NO_EVIDENCE/INSUFFICIENT_EVIDENCE/EMERGING/CONSISTENT_INDEPENDENT classification in this phase —
no validated difficulty-weighting policy exists for Skill/Competency state (the assessment found
one only for Mastery's own delta formula, which F5 does not touch or reuse for a different
purpose). Difficulty is preserved and traceable, never invented into a formula prematurely
(task's own explicit instruction).

## Consistency (task §14)

Represented via `evidence_count`, `independent_evidence_count`, and `last_evidence_at` on each
state row, plus the full ordered evidence list in the explainability response — never a single
number claiming "consistency," which the task explicitly warns against fabricating.
