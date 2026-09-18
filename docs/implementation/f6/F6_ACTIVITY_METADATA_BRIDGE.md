# F6 — Activity Metadata Bridge

## Purpose (task §27)

F6 is the first phase where published academic mapping *could* inform future activity/evidence
metadata. This document defines the read-only contract a future phase (F7/F8) will call — F6
itself calls nothing, writes nothing to `learning_evidence`, and modifies no historical row.

## The contract

```ts
interface ActivityMetadataResolution {
  learningObjectiveId: string;
  canonicalConceptIds: string[];   // from PUBLISHED objective_concept_mappings only
  skillIds: string[];              // from PUBLISHED objective_skill_mappings only
  competencyIds: string[];         // from PUBLISHED objective_competency_mappings only
  structureVersionId: string;
  frameworkContext: { organizationId: string; programmeId: string; subjectId: string };
}

function resolveActivityMetadataForObjective(learningObjectiveId: string): Promise<ActivityMetadataResolution | null>
```

Returns `null` when the objective has no `PUBLISHED` mappings at all — never a partial or guessed
result. `PARTIAL`/`PREREQUISITE`/`SUPPORTING` relation types are included in the concept/skill id
lists exactly as `FULL` ones are (this function resolves *relevance*, not *coverage* — coverage's
own FULL/PARTIAL distinction, per the coverage model doc, is a separate concern the caller must
apply itself if it matters for their use case).

## How F7/F8 would use this (not built in F6)

A future quiz/transfer-generation service, once it knows which `learning_objective_id` an
activity is meant to address, could call this function and feed the resulting
`canonicalConceptIds`/`skillIds`/`competencyIds` into F5's existing, unmodified evidence-tagging
contract (`learning_evidence.metadata.skillIds`/`competencyIds`/`contextCode`, established in
F5). **This wiring is explicitly not built in F6** (task's own instruction: "Do not begin
Assessment generation logic") — F6 only proves the lookup function itself works correctly against
real published mappings.

## What F6 explicitly does NOT do

- Does not modify `learning_evidence` or any F5 table.
- Does not retroactively tag any historical evidence row.
- Does not generate any activity, quiz, or assessment content.
- Does not decide which objective an activity "should" address — that remains a future F7/F8
  content-generation decision; F6 only answers "given an objective, what does it resolve to."

## Certified in F6

The real-Postgres certification calls `resolveActivityMetadataForObjective` directly against a
published PAA-Mathematics objective and asserts the returned concept/skill ids match exactly the
`PUBLISHED` mappings seeded for it, and returns `null` for an objective with only `DRAFT`/
`PROPOSED` mappings.
