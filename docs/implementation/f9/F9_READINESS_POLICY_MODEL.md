# F9 — Readiness Policy Model

## Table: `readiness_policy_versions`

```sql
CREATE TABLE readiness_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version int NOT NULL UNIQUE,
  rules jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','RETIRED')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_readiness_policy_versions_one_active ON readiness_policy_versions ((1)) WHERE status = 'ACTIVE';
```

Exactly the F5/F8 idiom: append-only, at most one `ACTIVE` row, `createReadinessPolicyVersion` retires the previous `ACTIVE` row in the same transaction. Every `readiness_snapshots` row stores the `readiness_policy_version_id` that produced it — historical snapshots are never reinterpreted when the policy changes (AC-F9-05/07, task §35).

## `rules` shape

```ts
interface ReadinessPolicyRules {
  gapBasedDimensions: {
    // shared thresholds for the four F8-diagnosis-derived dimensions
    minimumDiagnosedTargetsForConfidentStatus: number; // e.g. 2
  };
  coverage: {
    minimumEvidencedFractionForEarlyPreparation: number; // e.g. 0.2
    minimumEvidencedFractionForSimulationReady: number;  // e.g. 0.6
  };
  evidenceSufficiency: {
    minimumQualifyingEvidenceForSufficient: number; // e.g. 15
    minimumDistinctQuestionTypesForSufficient: number; // e.g. 3
    maxRecencyDaysForFresh: number; // e.g. 30
  };
  simulationPerformance: {
    minimumCompletedAttemptsForConfidentStatus: number; // e.g. 1
  };
}
```

## Seed policy (version 1)

Seeded by the F9 migration itself, matching the numbers above. `INSUFFICIENT_EVIDENCE` is the default outcome whenever a dimension's own minimum count/fraction is not met — thresholds can only make classification *more confident* given more evidence, never bypass the minimum gate (mirrors F8's INV-F8-04/05 discipline for readiness).

## Service: `src/lib/readiness/policy.service.ts`

```ts
export async function getActiveReadinessPolicy(client?): Promise<ReadinessPolicyVersion>
export async function getReadinessPolicyById(id: string, client?): Promise<ReadinessPolicyVersion | null>
export async function createReadinessPolicyVersion(rules: ReadinessPolicyRules): Promise<ReadinessPolicyVersion>
```

Identical transaction shape to `src/lib/diagnostics/policy.service.ts` — insert next version as `ACTIVE`, retire whatever was previously `ACTIVE`, never edit history.
