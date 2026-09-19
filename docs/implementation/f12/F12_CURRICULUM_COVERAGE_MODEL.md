# F12 — Curriculum Coverage Model

## Four things kept separate (task section 15)

1. **Structure available** — `structureAvailable: true` once a `structureVersionId` resolves to a real, requested structure. Not a metric, a precondition.
2. **Mapping coverage** — `computeMappingCoverage` (F6, unmodified): FULL vs PARTIAL vs unmapped objective counts, PUBLISHED mappings only. **Never summed** — `fullyMappedCount` and `partiallyMappedCount` are always reported as two separate numbers (real-Postgres proven, Case M: 1 FULL + 1 PARTIAL + 1 unmapped = 3 total, and the PARTIAL one never contributes to `fullyMappedCount`).
3. **Content coverage** — `computeContentCoverage` (F6, unmodified): distinct objectives with >=1 PUBLISHED resource. Duplicate resources on the same objective never inflate the count (F6's own `COUNT(DISTINCT ...)`).
4. **Learner Evidence/mastery** — deliberately NOT part of `getInstitutionCoverage` at all. It lives in `getInstitutionLearnerSummary`/`getClassLearningSummary` instead — a completely separate function, separate population basis (learners, not curriculum objectives), so the two can never be silently blended into one "coverage+mastery" number.

Assessment coverage (F9's per-student blueprint evidence coverage) is explicitly NOT part of this function either — see below.

## Platform coverage gap vs learner weakness (INV-F12-10/11, task section 15)

`getInstitutionCoverage` never reads `students`, `class_enrollments`, `learning_evidence`, or any learner-scoped table — its SQL is scoped ENTIRELY to `structureVersionId` (a curriculum-content identifier). An institution with a coverage gap for a given structure sees the identical `unmappedCount`/`fullyMappedCount` numbers regardless of how many (or how capable) its learners are — real-Postgres proven: the fixture's unmapped objective (`F12-UNMAPPED`) has zero learners associated with it in the computation at all; the gap is reported purely as a fact about curriculum completeness.

## Why F9's per-student blueprint coverage is intentionally excluded here

F9's `classifyBlueprintTargetCoverage` is a genuinely different, PER-STUDENT question ("has THIS learner engaged with a SUPPORTED, mapped exam-blueprint target"), already documented as distinct in F9's own architecture (`blueprint-coverage.service.ts`'s own docstring: "Genuinely different from F6's coverage_policy_versions/computeMappingCoverage... never student-scoped"). Calling it once per learner at institution scale would be both an N+1 pattern (task section 45) and a conflation of two different coverage questions the task explicitly requires kept separate (task section 15's own worked example: "StudyUS does not yet cover this objective" vs. "Learners are struggling with this objective"). F12's `getInstitutionCoverage` answers only the first (curriculum/content completeness); F12's readiness intelligence (`F12_READINESS_INTELLIGENCE_MODEL.md`) separately exposes F9's own `BLUEPRINT_EVIDENCE_COVERAGE` readiness DIMENSION (per learner, per exam profile) without re-deriving it.

## Coverage denominators (task section 16)

Only `PUBLISHED` mappings count toward `fullyMappedCount`/`partiallyMappedCount` (F6's own `coverage_policy_versions.rules.countedMappingStatuses`); DRAFT/PROPOSED/IN_REVIEW/REJECTED/RETIRED never do, regardless of how many exist. This is F6's own, unmodified policy — F12 introduces no new denominator rule.
