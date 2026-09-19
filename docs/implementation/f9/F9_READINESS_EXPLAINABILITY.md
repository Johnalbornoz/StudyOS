# F9 — Readiness Explainability & Snapshot Model

## Table: `readiness_snapshots` (append-only)

```sql
CREATE TABLE readiness_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id),
  exam_profile_id uuid NOT NULL REFERENCES student_exam_profiles(id),
  exam_version_id uuid NOT NULL REFERENCES exam_versions(id),
  readiness_policy_version_id uuid NOT NULL REFERENCES readiness_policy_versions(id),
  overall_status text NOT NULL CHECK (overall_status IN
    ('INSUFFICIENT_EVIDENCE','EARLY_PREPARATION','DEVELOPING','SIMULATION_READY','FULL_MOCK_ELIGIBLE')),
  dimensions jsonb NOT NULL,               -- array of DimensionReadinessResult (task §6)
  blueprint_coverage jsonb NOT NULL,        -- { totalTargets, byStatus: {...}, targets: [{targetId, status, reasonCodes}] }
  evidence_counts jsonb NOT NULL,           -- { total, independent, assisted }
  diagnostic_gap_references uuid[] NOT NULL DEFAULT '{}',  -- learner_gap_diagnoses ids this snapshot is built from
  simulation_history_used uuid[] NOT NULL DEFAULT '{}',    -- exam_attempts ids considered for SIMULATION_PERFORMANCE
  reason_codes text[] NOT NULL DEFAULT '{}',
  limitations text[] NOT NULL DEFAULT '{}',                -- e.g. "3 of 4 required domains unsupported by platform"
  score_projection_availability text NOT NULL CHECK (score_projection_availability IN
    ('AVAILABLE','NOT_AVAILABLE_NO_CALIBRATION','NOT_AVAILABLE_INSUFFICIENT_DATA','NOT_APPLICABLE')),
  calculated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_readiness_snapshots_profile ON readiness_snapshots (exam_profile_id, calculated_at DESC);
```

Never updated in place (INV-F9-15). A recomputation always inserts a new row (task §33).

## Readiness dimensions (task §5)

```ts
type ReadinessDimension =
  | 'KNOWLEDGE_READINESS' | 'SKILL_READINESS' | 'EXAM_TECHNIQUE_READINESS' | 'SPEED_FLUENCY_READINESS'
  | 'BLUEPRINT_EVIDENCE_COVERAGE' | 'SIMULATION_PERFORMANCE' | 'EVIDENCE_SUFFICIENCY';

type DimensionStatus = 'STRONG' | 'DEVELOPING' | 'WEAK' | 'INSUFFICIENT_EVIDENCE' | 'NOT_APPLICABLE';

interface DimensionReadinessResult {
  dimension: ReadinessDimension;
  status: DimensionStatus;
  detail: Record<string, unknown>;          // dimension-specific reproducible numbers (see below)
  reasonCodes: string[];
  evidenceIncludedIds: string[];             // learning_evidence / learner_gap_diagnoses ids that counted
  evidenceExcludedIds: string[];             // ids considered but excluded, with why in reasonCodes
  blueprintTargetsConsidered: string[];      // blueprint_objective_targets ids
  unsupportedPlatformAreas: string[];        // targets excluded because UNSUPPORTED_BY_PLATFORM, never counted as weakness
  whatWouldImproveConfidence: string;        // human-readable, generated from a fixed template per reasonCode, never free-text AI
}
```

### KNOWLEDGE_READINESS / SKILL_READINESS / EXAM_TECHNIQUE_READINESS / SPEED_FLUENCY_READINESS

All four share one pure classifier (`classifyGapBasedDimension`, `src/lib/readiness/dimension-classification.algorithms.ts`): given the set of F8 `StoredGapDiagnosis` rows the orchestrator collected for this snapshot (one per diagnosed blueprint target, see `F9_BLUEPRINT_EVIDENCE_COVERAGE.md`), count how many named the relevant `GapType` (directly as `primaryGapType`, or as a `secondarySignals` member of a `MIXED` diagnosis) versus how many did not.

- `< policy.gapBasedDimensions.minimumDiagnosedTargetsForConfidentStatus` diagnosed targets → `INSUFFICIENT_EVIDENCE`.
- `>= 1` diagnosis naming this gap type → `WEAK`.
- All diagnosed targets clear of this gap type, but at least one was itself `INSUFFICIENT_EVIDENCE` → `DEVELOPING` (some signal, not fully confident).
- All diagnosed targets clear and fully classified (no `INSUFFICIENT_EVIDENCE` diagnoses) → `STRONG`.

`detail` always includes `{diagnosedTargetCount, gapNamedCount, totalConsideredTargetCount}` — a reproducible denominator (AC-F9-08 applied to every dimension, not just coverage). `SKILL_READINESS`/`EXAM_TECHNIQUE_READINESS` only ever consider targets that actually carry a `skillId`/`commandTermId` respectively — a target with neither is `NOT_APPLICABLE` for that dimension's count, never silently treated as a pass.

### BLUEPRINT_EVIDENCE_COVERAGE

See `F9_BLUEPRINT_EVIDENCE_COVERAGE.md` in full. `detail = {totalTargets, supportedAndEvidenced, supportedButUnevidenced, unsupportedByPlatform, unmapped, notRequired}`. Status: `STRONG` if `supportedAndEvidenced / (totalTargets - unsupportedByPlatform - notRequired) >= policy.coverage.minimumEvidencedFractionForSimulationReady`; `DEVELOPING` if `>= minimumEvidencedFractionForEarlyPreparation`; else `WEAK` — but WEAK here means "coverage is thin," never "the learner is weak" (INV-F9-05/task §10's own explicit prohibition is enforced by never emitting a reason code that blames the learner for an `UNSUPPORTED_BY_PLATFORM`/`UNMAPPED` target; those are excluded from the fraction's denominator entirely, per the formula above).

### SIMULATION_PERFORMANCE

Reads real `exam_attempts` (via `simulation_attempts`, F9's own extension table) with `status = 'COMPLETED'` for `(studentId, examVersionId)`. `< policy.simulationPerformance.minimumCompletedAttemptsForConfidentStatus` completed attempts → `INSUFFICIENT_EVIDENCE`. Otherwise `detail = {completedAttemptCount, averageScorePercent, byComponent: [...]}`, status derived from `averageScorePercent` against the same coverage-style thresholds (reused, not reinvented, since both are "fraction of a reproducible denominator" questions).

### EVIDENCE_SUFFICIENCY

A meta-dimension, per task §9's explicitly tracked factors: `detail = {totalQualifyingEvidenceCount, independentEvidenceCount, distinctQuestionTypeCount, distinctContextCount, mostRecentEvidenceAgeDays, frameworkAligned: boolean}`. `STRONG` (labelled `SUFFICIENT` internally is avoided — the shared `DimensionStatus` vocabulary is reused, not a sixth ad-hoc label) only when count, diversity, and recency thresholds are all met; otherwise `INSUFFICIENT_EVIDENCE`. This dimension never turns any *other* dimension's `INSUFFICIENT_EVIDENCE` into a stronger claim — it is purely informational, telling the caller "here is why confidence is capped," matching task §34's "what additional evidence would improve confidence."

## Overall status combiner (task §7, pure, versioned)

```ts
function combineOverallReadinessStatus(dimensions: DimensionReadinessResult[], fullMockReady: boolean, policy: ReadinessPolicyRules): OverallReadinessStatus
```
1. If `BLUEPRINT_EVIDENCE_COVERAGE.status === 'INSUFFICIENT_EVIDENCE'` or evidenced fraction below the "early" threshold → `INSUFFICIENT_EVIDENCE`.
2. Else if any of the four gap-based dimensions is `WEAK` → `DEVELOPING`.
3. Else if coverage fraction is below the "simulation ready" threshold → `EARLY_PREPARATION`.
4. Else if no `WEAK` dimension and coverage clears the "simulation ready" threshold → `SIMULATION_READY`.
5. Else if step 4 holds **and** F7's `canFullMockBeOffered(examVersionId).ready === true` → `FULL_MOCK_ELIGIBLE`.

Never a marketing label (task §7's explicit prohibition) — every transition is a named, reproducible rule over already-computed dimension statuses and F7's own structural guard, nothing invented ad hoc.

## Determinism / replay (task §46, AC-F9-06)

`readiness.service.ts::computeReadinessSnapshot` is deterministic given: the exact set of `learning_evidence` rows visible at call time (immutable), the active (or an explicit historical) `readiness_policy_version_id`, and F8's own diagnosis determinism (itself proven in F8's certification). `replayReadinessSnapshot(evidenceSnapshotIds, diagnosisIds, policyVersionId)` is exposed purely for certification, mirroring F8's own `replayDiagnosis` pattern. AI is never involved anywhere in this path (task §46/47 — AI may not determine readiness).
