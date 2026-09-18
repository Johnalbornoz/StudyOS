# F5 — Aggregation Policy

## `aggregation_policy_versions`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| dimension | text CHECK (SKILL\|COMPETENCY\|TRANSFER_ANALYTICS) | Knowledge State is excluded — it reuses `mastery_policies`'s own existing versioning (assessment §4), never a second version table for the same dimension. |
| version | integer NOT NULL | |
| rules | jsonb NOT NULL | Explicit, inspectable configuration — see fixture below. |
| status | text CHECK (ACTIVE\|RETIRED) DEFAULT 'ACTIVE' | |
| effective_from | timestamptz DEFAULT now() | |
| created_at | timestamptz DEFAULT now() | |

Unique partial index: at most one `ACTIVE` version per `dimension`. A new version is a new row
(status `ACTIVE`); the previous row is flipped to `RETIRED` in the same transaction — mirroring
the migration ledger's own immutability convention (never edit `rules` on an existing row).

## Version 1 rules (conservative fixture, task §10/§14 — "conservative, explicit initial rules")

```json
{
  "dimension": "SKILL",
  "version": 1,
  "rules": {
    "minimumEvidenceCount": 3,
    "independentPredicate": "ai_assistance_type = NONE",
    "consistentIndependentRequires": "the 3 most recent qualifying evidence rows are all independent and correct"
  }
}
```

```json
{
  "dimension": "COMPETENCY",
  "version": 1,
  "rules": {
    "minimumEvidenceCount": 3,
    "independentPredicate": "ai_assistance_type = NONE",
    "consistentIndependentRequires": "the 3 most recent qualifying evidence rows are all independent and correct",
    "note": "competency evidence is never synthesized from skill evidence -- must be evidence explicitly tagged with this competency's own id"
  }
}
```

```json
{
  "dimension": "TRANSFER_ANALYTICS",
  "version": 1,
  "rules": {
    "note": "pure counting/tallying by contextCode -- no threshold, no state classification, purely descriptive counters"
  }
}
```

`minimumEvidenceCount: 3` is chosen for parity with the existing convention the assessment found
(`mastery_policies.minimum_evidence_count`/Help Dependency's reused sample gate) — not a new
number invented for this phase; it is the same conservative "at least a few, not one" bar already
established elsewhere in this codebase for exactly this kind of insufficient-evidence gate.

## State derivation (pure function, task §25)

```
computeSkillOrCompetencyState(qualifyingEvidence: EvidenceRow[], rules: Rules): {
  state: 'NO_EVIDENCE' | 'INSUFFICIENT_EVIDENCE' | 'EMERGING' | 'CONSISTENT_INDEPENDENT';
  evidenceCount: number;
  independentEvidenceCount: number;
  lastEvidenceAt: string | null;
}
```

Deterministic: `NO_EVIDENCE` if `qualifyingEvidence.length === 0`; `INSUFFICIENT_EVIDENCE` if
below `rules.minimumEvidenceCount`; else `CONSISTENT_INDEPENDENT` if the N most recent qualifying
rows are all independent and correct (N = `minimumEvidenceCount`), else `EMERGING`. Zero IO, zero
randomness, zero wall-clock dependency beyond the evidence timestamps already given as input —
same output for the same input every time (AC-F5-13).

## Never a progression gate (INV-F5-06/07/08)

No aggregation rule here reads or writes anything Canonical V2 consults. `CONSISTENT_INDEPENDENT`
is a descriptive label for the Digital Twin/admin surface — it does not unlock PROVE, RETAIN, or
TRANSFER, and no code path checks `learner_skill_state`/`learner_competency_state` before making
a Canonical V2 progression decision (verified structurally, same non-interference pattern as F3/F4).
