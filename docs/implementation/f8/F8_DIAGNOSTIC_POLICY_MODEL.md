# F8 — Diagnostic Policy Model

## Table: `diagnostic_policy_versions`

```sql
CREATE TABLE diagnostic_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version int NOT NULL UNIQUE,
  rules jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','RETIRED')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_diagnostic_policy_versions_one_active ON diagnostic_policy_versions ((1)) WHERE status = 'ACTIVE';
```

Exactly the F5 `aggregation_policy_versions` idiom: append-only, at most one `ACTIVE` row (partial unique index), `createDiagnosticPolicyVersion` retires the previous ACTIVE row in the same transaction it inserts the new one. Every `learner_gap_diagnoses` row stores the `policy_version_id` that produced it — historical diagnoses are never silently reinterpreted when the policy changes (task §10/INV-F8-16).

## `rules` shape

```ts
interface DiagnosticPolicyRules {
  knowledge: {
    minimumIndependentEvidenceCount: number;   // e.g. 4
    minimumDistinctForms: number;               // e.g. 2 (distinct activity_type/questionType)
    failureRateThreshold: number;                // e.g. 0.6
  };
  skill: {
    minimumQualifyingEvidenceCount: number;      // e.g. 3, evidence explicitly tagged metadata.skillIds
    failureRateThreshold: number;                // e.g. 0.6
  };
  technique: {
    minimumSimpleFormEvidenceCount: number;      // e.g. 3
    minimumComplexFormEvidenceCount: number;     // e.g. 3
    knowledgeSoundThreshold: number;             // simple-form success rate required, e.g. 0.7
    failureRateThreshold: number;                // complex/command-term-tagged failure rate required, e.g. 0.6
  };
  speed: {
    minimumValidTimingSampleCount: number;       // e.g. 5
    minimumCorrectnessBaseline: number;          // e.g. 0.7 - must be correct to even consider speed
    latencyRatioThreshold: number;                // actual/expected, e.g. 1.5
    expectedResponseTimeMsByDifficultyBand: Record<'1'|'2'|'3'|'4'|'5', number | null>; // null = no expectation configured -> blocked
  };
  mixedGapPriority: Array<'KNOWLEDGE_GAP'|'SKILL_GAP'|'EXAM_TECHNIQUE_GAP'|'SPEED_FLUENCY_GAP'>; // tie-break / ordering only, never suppresses a signal
  confidence: {
    baseConfidenceAtMinimumEvidence: number;     // e.g. 0.55
    confidenceGainPerExtraEvidenceItem: number;  // e.g. 0.05, capped at 0.95
  };
}
```

All thresholds live in this JSON, never as inline constants in the classification algorithms — a policy change is a new row, not a code change (task §10/AC-F8-06).

## Seed policy (version 1)

Seeded by the F8 migration itself (data, not code): conservative defaults matching the numbers above. `INSUFFICIENT_EVIDENCE` is the default outcome whenever any dimension's minimum count is not met — the policy can only make gap detection *more* permissive by raising confidence given more evidence, never bypass the minimum-count gate (INV-F8-04/05).

## Service: `src/lib/diagnostics/policy.service.ts`

```ts
export async function getActiveDiagnosticPolicy(client?): Promise<DiagnosticPolicyVersion>
export async function getDiagnosticPolicyById(id: string, client?): Promise<DiagnosticPolicyVersion | null>
export async function createDiagnosticPolicyVersion(rules: DiagnosticPolicyRules): Promise<DiagnosticPolicyVersion>
```

`createDiagnosticPolicyVersion` runs in one transaction: insert new row with next `version`, `status='ACTIVE'`; retire whatever was previously `ACTIVE`. Never edits history.
