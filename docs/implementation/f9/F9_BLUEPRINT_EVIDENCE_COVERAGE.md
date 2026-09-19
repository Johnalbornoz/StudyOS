# F9 — Blueprint Evidence Coverage

Genuinely different concept from F6's `coverage_policy_versions`/`computeMappingCoverage` (confirmed in the current-state assessment §10): F6 asks "of this curriculum structure's objectives, how many are mapped to canonical concepts/skills, or have an approved resource?" — entirely canonical/content-side, no student involved. F9 asks "of this blueprint's objective targets, does *this student* have real evidence?" — always student-scoped. Both are versioned, read-time computations following the same architectural pattern; this document uses "Blueprint Evidence Coverage" throughout, never bare "coverage," to keep the two unambiguous.

## Classification (task §10)

```ts
type BlueprintTargetCoverageStatus =
  | 'SUPPORTED_AND_EVIDENCED' | 'SUPPORTED_BUT_UNEVIDENCED' | 'UNSUPPORTED_BY_PLATFORM' | 'UNMAPPED' | 'NOT_REQUIRED';

interface BlueprintTargetCoverage {
  targetId: string;
  status: BlueprintTargetCoverageStatus;
  reasonCodes: string[];
  studentConceptId: string | null;    // the resolved per-student concept, if any (see below)
  diagnosisId: string | null;          // the F8 diagnosis run for this target, if evidence existed
}
```

`classifyBlueprintTargetCoverage(target, studentId)` (`src/lib/readiness/blueprint-coverage.service.ts`), in order:

1. Load the target's `assessment_component` (F7's `getComponent`). `supportStatus !== 'SUPPORTED'` → `UNSUPPORTED_BY_PLATFORM`, reason `COMPONENT_UNSUPPORTED`. **Stop here — never evaluated further, and never counted as learner weakness (INV-F9-05).**
2. Resolve `canonicalConceptIds`/`skillIds` via F6's `resolveActivityMetadataForObjective(target.learningObjectiveId)` (verbatim, never re-queried). `null` or both empty → `UNMAPPED`, reason `NO_PUBLISHED_MAPPING`.
3. Resolve the student's own matched concept for each `canonicalConceptId` via `resolveStudentConceptForCanonicalConcept(studentId, canonicalConceptId)` (new, see below). None resolve → `SUPPORTED_BUT_UNEVIDENCED`, reason `NO_MATCHED_STUDENT_CONCEPT` (the platform supports this target; the student simply hasn't engaged with content bucketed to it yet — never a fabricated "unmapped" or "weak" claim).
4. Fetch `learning_evidence` for the resolved student concept id(s). Zero rows → `SUPPORTED_BUT_UNEVIDENCED`, reason `NO_EVIDENCE_YET`.
5. Otherwise → `SUPPORTED_AND_EVIDENCED`. The orchestrator then invokes F8's real `runDiagnosis` for this (student, concept, scope) — see `F9_TARGET_READINESS_ARCHITECTURE.md`'s flow diagram — and stores the resulting `diagnosisId` on this coverage record for the dimension classifiers to consume.

`NOT_REQUIRED` exists in the enum but is never emitted by this classifier in F9 — there is no real signal today (e.g. an institution-policy-driven "this component is optional for you") that would justify it. Documented explicitly as a reserved, currently-unused state rather than removed, so a future phase extends the enum's *meaning* instead of inventing a competing one (matching the discipline task §10 itself asks for: "or equivalent explicit states," never fewer states than the real distinctions require).

### `resolveStudentConceptForCanonicalConcept` (new, small, read-only)

```ts
async function resolveStudentConceptForCanonicalConcept(studentId: string, canonicalConceptId: string): Promise<string | null>
```
```sql
SELECT c.id FROM concepts c
JOIN subjects s ON s.id = c.subject_id
JOIN concept_catalog_mapping ccm ON ccm.learner_concept_id = c.id
WHERE s.student_id = $1 AND ccm.canonical_concept_id = $2 AND ccm.status = 'MATCHED'
LIMIT 1
```
(Table/column names confirmed against `database/migrations/20260922_1000_f4_learning_architecture_2.sql`: `concept_catalog_mapping.learner_concept_id`/`canonical_concept_id`/`status`, not `catalog_mappings.concept_id` — corrected during implementation from an initial doc-drafting slip.)
The reverse of F4's `ensureCatalogMapping` (which proposes/confirms a match starting from the student's own concept). Never fabricates a correspondence — `null` means "not yet matched," handled as step 3 above, never guessed.

## Percentage exposure (task §8)

The only percentage this document introduces is: **"N of M blueprint objective targets have `SUPPORTED_AND_EVIDENCED` status"**, where `M` excludes `UNSUPPORTED_BY_PLATFORM`/`NOT_REQUIRED` targets from the denominator (a target the platform cannot even offer, or that isn't required, can never count against the learner — INV-F9-05/08 combined). Every percentage carries this exact, reproducible denominator in `readiness_snapshots.blueprint_coverage`; there is no other place in F9 that emits a percentage without an equally explicit, named denominator (INV-F9-08, task §8's own requirement).
