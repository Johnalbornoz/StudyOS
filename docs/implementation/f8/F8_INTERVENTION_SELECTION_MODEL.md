# F8 — Intervention Selection Model

## Table: `intervention_policy_versions`

```sql
CREATE TABLE intervention_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version int NOT NULL UNIQUE,
  rules jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','RETIRED')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_intervention_policy_versions_one_active ON intervention_policy_versions ((1)) WHERE status = 'ACTIVE';
```

Same versioning idiom as the diagnostic policy. Every `intervention_sessions` row stores the `intervention_policy_version_id` used (AC-F8-09).

## `rules` shape

```ts
type InterventionType = 'EXPLAIN' | 'WORKED_EXAMPLE' | 'GUIDED_PRACTICE' | 'CONTEXTUAL_HELP' | 'INDEPENDENT_PRACTICE' | 'PROVE';

interface InterventionPolicyRules {
  chains: Record<GapType, InterventionType[]>;   // ordered fallback chain per gap type
  insufficientEvidenceChain: InterventionType[];  // e.g. ['GUIDED_PRACTICE'] -- evidence-gathering only
  mixedTieBreakPriority: GapType[];               // used only to order the merged chain, never to hide a signal
}
```

Seed (version 1), matching task §13's conceptual examples exactly as data, not code:

```json
{
  "chains": {
    "KNOWLEDGE_GAP": ["EXPLAIN", "WORKED_EXAMPLE", "GUIDED_PRACTICE"],
    "SKILL_GAP": ["WORKED_EXAMPLE", "GUIDED_PRACTICE", "INDEPENDENT_PRACTICE"],
    "EXAM_TECHNIQUE_GAP": ["EXPLAIN", "WORKED_EXAMPLE", "GUIDED_PRACTICE"],
    "SPEED_FLUENCY_GAP": ["INDEPENDENT_PRACTICE"]
  },
  "insufficientEvidenceChain": ["GUIDED_PRACTICE"],
  "mixedTieBreakPriority": ["KNOWLEDGE_GAP", "EXAM_TECHNIQUE_GAP", "SKILL_GAP", "SPEED_FLUENCY_GAP"]
}
```

`PROVE` never appears in a chain by default — F8 may still accept a session explicitly requested as `PROVE` (e.g. the learner's own Canonical V2 state says PROVE is `EXECUTABLE`), but F8 never manufactures a PROVE recommendation from a gap diagnosis alone (PROVE readiness is Canonical V2's call, not F8's).

## Pure selection algorithm (`src/lib/teaching/intervention-selection.service.ts`)

```ts
function selectIntervention(diagnosis: GapDiagnosis, policy: InterventionPolicyRules): InterventionRecommendation

interface InterventionRecommendation {
  primary: InterventionType;
  chain: InterventionType[];       // full ordered fallback chain
  rationale: string[];             // reason codes copied from the diagnosis that justify this pick
  gapTypeConsidered: DiagnosisResultType;
}
```

- `KNOWLEDGE_GAP`/`SKILL_GAP`/`EXAM_TECHNIQUE_GAP`/`SPEED_FLUENCY_GAP` → look up `policy.chains[gapType]` directly.
- `MIXED` → union the chains for every `secondarySignal`, de-duplicated, ordered by first appearance walking `mixedTieBreakPriority`.
- `INSUFFICIENT_EVIDENCE` → `policy.insufficientEvidenceChain`, and `rationale` explicitly states this is an evidence-gathering recommendation, not a gap-driven one (never implies a diagnosis that wasn't made).

Pure function — no I/O, no AI, deterministic given `(diagnosis, policy)`.

## Session creation freezes the recommendation

`intervention_sessions.gap_type`, `.reason_codes`, `.intervention_type` are copied from the diagnosis/recommendation **at creation time** and never recomputed later — if the diagnosis or policy changes afterward, the historical session record is unaffected (same discipline as F7's `frozen_configuration`).

## PROVE handling — explicit non-scope decision

When `intervention_type = 'PROVE'` on a session (only reachable via an explicit, non-diagnosis-driven request — e.g. the learner clicking through from a Canonical-V2-surfaced "ready for Prove" state), F8's own attempt-recording endpoint refuses to accept a submitted attempt for that session and instead returns a pointer to the existing Prove launch surface (`canonical-session-launch.ts`/the existing quiz/canonical-prepared-activity flow). F8 never writes Prove evidence itself — this avoids any duplication of Canonical V2's own PROVE launch/authorization machinery (`quiz_sessions.canonical_activity_contract`, `canonical_prepared_activity`).
