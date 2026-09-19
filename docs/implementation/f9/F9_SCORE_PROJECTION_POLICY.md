# F9 — Score Projection Policy

## Table: `score_conversion_models` (real, versioned, deliberately empty in this environment)

```sql
CREATE TABLE score_conversion_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_version_id uuid NOT NULL REFERENCES exam_versions(id),
  status text NOT NULL CHECK (status IN ('ACTIVE','RETIRED')),
  conversion_table jsonb NOT NULL,
  minimum_evidence_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_score_conversion_models_one_active_per_version ON score_conversion_models (exam_version_id) WHERE status = 'ACTIVE';
```

No seed data is inserted by the F9 migration — a real, calibrated official-score conversion model does not exist for any exam version in this environment (confirmed in the current-state assessment §9), and F9 does not fabricate one. This table exists so the gate below is real, callable, versioned code — not a hardcoded constant — and so a future phase that *does* obtain a calibrated model has a real place to register it via `createScoreConversionModel`/`activateScoreConversionModel` (same retire-and-insert idiom as every other versioned table in this codebase), never a schema change.

## The gate (task §29, INV-F9-16/17/20)

```ts
type ScoreProjectionAvailability = 'AVAILABLE' | 'NOT_AVAILABLE_NO_CALIBRATION' | 'NOT_AVAILABLE_INSUFFICIENT_DATA' | 'NOT_APPLICABLE';

async function getScoreProjectionAvailability(examVersionId: string, qualifyingEvidenceCount: number): Promise<ScoreProjectionAvailability>
```
1. No `ACTIVE` `score_conversion_models` row for this `examVersionId` → `NOT_AVAILABLE_NO_CALIBRATION`. **This is the only reachable result in the current environment**, and that is by design, not a bug — a missing calibration model is a valid controlled state (task §29's own explicit framing), never an implementation error to work around.
2. An `ACTIVE` row exists but `qualifyingEvidenceCount < row.minimum_evidence_count` → `NOT_AVAILABLE_INSUFFICIENT_DATA`.
3. An `ACTIVE` row exists and evidence is sufficient → `AVAILABLE` (never reachable today, but real, tested code — see the certification's case N, which registers a fixture conversion model for one exam version to prove the `AVAILABLE` path works, while a second, sibling exam version with no model correctly stays `NOT_AVAILABLE_NO_CALIBRATION`).
4. Called for a context where score projection was never a meaningful question (e.g. a Topic Exam, which was never a full-exam simulation to project a score from) → `NOT_APPLICABLE`.

`readiness_snapshots.score_projection_availability` always stores one of these four values — never a raw score dressed up as a projection, never silently omitted.

## Raw score vs. official score (INV-F9-17, task §28/§30)

`simulation/scoring.service.ts::getSimulationScoreSummary` (see `F9_POST_EXAM_DIAGNOSIS.md`) always returns the real `{rawScore, maxScore, byComponent}` from `exam_attempt_item_responses` — this is never gated by the projection availability check above. **Raw score is always available once an attempt is scored; an official scaled-score projection is a completely separate, usually-unavailable question.** A route surfacing simulation results always presents both fields distinctly, never substituting one for the other (task §30's own explicit requirement that readiness/raw-score/official-score/target-score/predicted-score/admission-threshold remain conceptually separate).

## Institution policy comparison (task §38)

```ts
type PolicyComparisonResult =
  | { status: 'POLICY_COMPARISON_UNAVAILABLE'; reason: string }
  | { status: 'COMPARABLE'; meetsThreshold: boolean; achievedRawScore: number; thresholdRules: Record<string, unknown> };

async function comparePolicyCompliance(params: { institutionExamPolicyId: string; examAttemptId: string }): Promise<PolicyComparisonResult>
```
Calls F7's real `evaluatePolicyCompliance` unmodified. `status: 'POLICY_PENDING'` (unverified) → `POLICY_COMPARISON_UNAVAILABLE`, reason `POLICY_NOT_VERIFIED` (task §38's own explicit requirement — "unverified institution policy" must never produce a compliance conclusion, matching adversarial case O). Only when `VERIFIED` does this function compare the attempt's real raw score against the policy's raw `thresholdRules` — a factual, versioned, reproducible yes/no on whether a *stated numeric threshold* was met. **It never computes, and the return type structurally cannot express, an admission probability** (INV-F9-19/20) — there is no `probability` field anywhere in `PolicyComparisonResult`, by construction, not by convention alone.
