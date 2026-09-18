# F6 — Coverage Model

## Coverage is computed on read, not persisted as a snapshot table

Following the Digital Learning Twin's own established philosophy (F5 assessment: "compute on
read every time, no caching, never a second source of truth"), coverage is a **pure, versioned
calculation** over the existing mapping/resource tables, invoked on demand — never a materialized
table that could drift from the mappings that produced it.

## `coverage_policy_versions`

Identical shape to F5's `aggregation_policy_versions` (same retire-and-insert discipline, same
"at most one ACTIVE row" partial unique index):

```json
{
  "version": 1,
  "rules": {
    "countedMappingStatuses": ["PUBLISHED"],
    "fullCoverageRelationTypes": ["FULL"],
    "partialCoverageRelationTypes": ["PARTIAL"],
    "note": "PREREQUISITE and SUPPORTING relation types never count toward coverage, full or partial"
  }
}
```

## What coverage distinguishes (task §20)

| Dimension | Computed as |
|---|---|
| STRUCTURE AVAILABLE | Does a `PUBLISHED` `structure_version` exist for this subject at all? |
| MAPPING AVAILABLE/APPROVED | Per objective: does at least one `objective_concept_mapping`/`objective_skill_mapping` with `status IN countedMappingStatuses` exist? |
| CONTENT COVERAGE | Per objective: does at least one `academic_resource` with `status = 'PUBLISHED'`, linked via `resource_objective_links`, exist? (Distinct **objective** count, never resource count — see the duplicate-resource rule below.) |
| ASSESSMENT COVERAGE | Explicitly **not implemented** in F6 (task's own instruction — Assessment Blueprint is a separate future authority; F6 only documents the boundary). |
| LEARNER MASTERY | Explicitly **not computed here** — F5's `learner_skill_state`/`learner_competency_state`/`concept_knowledge_state` remain the sole mastery authority (INV-F6-04). Coverage and mastery are two different result shapes returned by two different services; nothing in F6 combines them into one number. |

## The numerator rule (task §21, AC-F6-08/14, the most safety-critical part of this doc)

```
computeMappingCoverage(structureVersionId, policyVersion):
  objectives = all learning_objectives under this structure version
  for each objective:
    publishedMappings = objective_concept_mappings ∪ objective_skill_mappings
                         WHERE status IN policyVersion.rules.countedMappingStatuses
    if any publishedMapping.relation_type IN policyVersion.rules.fullCoverageRelationTypes:
      classify FULLY_MAPPED
    else if any publishedMapping.relation_type IN policyVersion.rules.partialCoverageRelationTypes:
      classify PARTIALLY_MAPPED
    else:
      classify UNMAPPED
  return { total, fullyMappedCount, partiallyMappedCount, unmappedCount, policyVersion }
```

**`fullyMappedCount` and `partiallyMappedCount` are always reported separately, never summed into
one "covered" number.** A caller that wants "how much is at least partially addressed" must
explicitly add them together themselves — the service never does this silently, so a PARTIAL
mapping can never be misread as proof of full coverage (AC-F6-08).

```
computeContentCoverage(structureVersionId):
  objectives = all learning_objectives under this structure version
  for each objective:
    approvedResourceCount = COUNT(DISTINCT academic_resource_id)
                             FROM resource_objective_links JOIN academic_resources
                             WHERE academic_resources.status = 'PUBLISHED'
    classify HAS_APPROVED_RESOURCE if approvedResourceCount > 0, else NO_RESOURCE
  return { total, withApprovedResourceCount, policyVersion }
```

**Duplicate resources never inflate coverage** (AC-F6-14): the classification is boolean per
objective (`HAS_APPROVED_RESOURCE`/`NO_RESOURCE`), never a count of resources. Three resources
linked to the same objective still contribute exactly one to `withApprovedResourceCount`, not
three.

**Rejected/DRAFT/unpublished content never counts** (task §21): the `WHERE academic_resources.status
= 'PUBLISHED'` filter is the only inclusion rule; a `DRAFT`/`PROPOSED`/`IN_REVIEW`/`REJECTED`
resource contributes zero.

**Retired content is excluded from new coverage but stays historically auditable** (task §21,
adversarial case G): `RETIRED` resources are also excluded from the `PUBLISHED`-only coverage
filter, but their rows and their `resource_objective_links` are never deleted — a query scoped to
"what did coverage look like as of resource X's active period" remains answerable by filtering on
timestamps, without needing coverage itself to persist history.

## Versioning (INV-F6-08, mirrors mapping versioning)

Coverage results always report which `coverage_policy_versions.version` and which
`structure_versions.id` (with its own status) produced them — a coverage number computed against a
`SUPERSEDED` structure version remains reproducible and distinguishable from one computed against
the current `PUBLISHED` version, exactly like F5's replay guarantee.
