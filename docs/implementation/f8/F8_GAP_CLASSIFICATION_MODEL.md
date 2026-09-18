# F8 — Gap Classification Model

## Table: `learner_gap_diagnoses` (append-only)

```sql
CREATE TABLE learner_gap_diagnoses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  concept_id uuid NOT NULL,
  subject_id uuid,
  scope jsonb NOT NULL DEFAULT '{}',           -- { skillId?, learningObjectiveId?, examVersionId?, assessmentComponentId?, commandTermId? }
  primary_gap_type text NOT NULL CHECK (primary_gap_type IN
    ('KNOWLEDGE_GAP','SKILL_GAP','EXAM_TECHNIQUE_GAP','SPEED_FLUENCY_GAP','MIXED','INSUFFICIENT_EVIDENCE')),
  secondary_signals text[] NOT NULL DEFAULT '{}',
  confidence numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  supporting_evidence_ids uuid[] NOT NULL DEFAULT '{}',
  contradicting_evidence_ids uuid[] NOT NULL DEFAULT '{}',
  reason_codes text[] NOT NULL DEFAULT '{}',
  alternatives jsonb NOT NULL DEFAULT '[]',    -- [{gapType, supported, confidence, reasonCodes}] for every dimension considered
  policy_version_id uuid NOT NULL REFERENCES diagnostic_policy_versions(id),
  canonical_context jsonb,                      -- frozen READ-ONLY snapshot: {stage, actionState} from getCanonicalPedagogicalDecision, explanatory only
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_learner_gap_diagnoses_student_concept ON learner_gap_diagnoses (student_id, concept_id, computed_at DESC);
```

Never updated in place. A new diagnosis run always inserts a new row. Historical diagnoses are immutable (INV-F8-15 extended to F8's own output, mirroring Canonical V2's own discipline).

## Gap taxonomy

```ts
type GapType = 'KNOWLEDGE_GAP' | 'SKILL_GAP' | 'EXAM_TECHNIQUE_GAP' | 'SPEED_FLUENCY_GAP';
type DiagnosisResultType = GapType | 'MIXED' | 'INSUFFICIENT_EVIDENCE';

interface DimensionResult {
  gapType: GapType;
  supported: boolean;
  confidence: number;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  reasonCodes: string[];
}

interface GapDiagnosis {
  primaryGapType: DiagnosisResultType;
  secondarySignals: GapType[];
  confidence: number;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  reasonCodes: string[];
  alternatives: DimensionResult[];
}
```

## Reason codes (stable, enumerable)

`SINGLE_ATTEMPT_INSUFFICIENT`, `BELOW_MINIMUM_EVIDENCE_COUNT`, `MULTI_FORMAT_FAILURE_PATTERN`, `SINGLE_FORMAT_ONLY`, `SIMPLE_COMMAND_TERM_FAILURE`, `COMPLEX_COMMAND_TERM_ONLY_FAILURE`, `NO_QUALIFYING_SKILL_EVIDENCE`, `QUALIFYING_SKILL_EVIDENCE_FOUND`, `CONCEPT_SOUND_TECHNIQUE_FAILURE`, `TIMING_UNAVAILABLE`, `TIMING_EXPECTATION_UNAVAILABLE`, `TIMING_SAMPLE_INSUFFICIENT`, `KNOWLEDGE_GAP_BLOCKS_SPEED_DIAGNOSIS`, `CONSISTENT_LATENCY_ABOVE_EXPECTATION`, `ASSISTED_EVIDENCE_EXCLUDED`, `ACTIVE_MISCONCEPTION_PRESENT`, `MISCONCEPTION_ABSENT`.

## Classification algorithms (`src/lib/diagnostics/classification.algorithms.ts`, pure)

All four take `(evidence: EvidenceRow[], policy: DiagnosticPolicyRules, scope)` and return a `DimensionResult`. All are pure — no I/O, no AI, no randomness, no wall-clock reads beyond what's already in `evidence`/`scope`. Given the identical evidence array and policy object, they always return byte-identical results (INV-F8-17/AC-F8-07).

### Knowledge Gap (task §6)

1. Filter to independent evidence (`ai_assistance_type === 'NONE'`) for the concept.
2. If count < `policy.knowledge.minimumIndependentEvidenceCount` → `supported: false`, reason `BELOW_MINIMUM_EVIDENCE_COUNT` (a single wrong answer never reaches the threshold — case A).
3. Compute distinct forms (`activity_type`/`metadata.questionType`); if `< minimumDistinctForms` → still evaluated but reason `SINGLE_FORMAT_ONLY` is recorded (does not itself block support if evidence count is otherwise sufficient across repeated attempts of the *same* form, but multi-form failure is stronger evidence and raises confidence — `MULTI_FORMAT_FAILURE_PATTERN`).
4. Compute failure rate among qualifying rows. `supported = failureRate >= policy.knowledge.failureRateThreshold`.
5. Cross-check active misconceptions for the concept (`getActiveMisconceptionSignatureIdsForConcept`) — presence adds `ACTIVE_MISCONCEPTION_PRESENT` to `reasonCodes` and raises confidence; absence is neutral, not disqualifying.
6. Rows where `reasoningRequirement` is simple (`FACTUAL`/`PROCEDURAL`, or no command term at all) failing too → `SIMPLE_COMMAND_TERM_FAILURE`, a strong Knowledge Gap signal per task §6 ("failures even when command-term and technique requirements are simple").

### Skill Gap (task §7)

1. `scope.skillId` must be present — otherwise this dimension is `supported: false`, reason `NOT_APPLICABLE` (no skill was scoped for this diagnosis run).
2. Filter to evidence where `metadata -> 'skillIds' @> to_jsonb(skillId)` — F5's exact predicate, reused verbatim. The F4/F6 concept→skill graph is never consulted (INV-F8-08/case D — graph existing without qualifying evidence produces `NO_QUALIFYING_SKILL_EVIDENCE`, never a fabricated Skill Gap).
3. If qualifying count < `policy.skill.minimumQualifyingEvidenceCount` → not supported.
4. `supported = failureRate(qualifying) >= policy.skill.failureRateThreshold`, reason `QUALIFYING_SKILL_EVIDENCE_FOUND` when supported.

### Exam Technique Gap (task §8)

1. "Simple form" rows = independent evidence with no command term or a command term whose `expected_reasoning_type` is `FACTUAL`/`PROCEDURAL`. "Complex/technique form" rows = independent evidence with a command term present whose linked `command_term_interpretations` marks it non-trivial, OR `expected_reasoning_type` is `METACOGNITIVE`/`CONCEPTUAL` with a specific `commandTermId` tagged in `metadata`.
2. Require both `minimumSimpleFormEvidenceCount` and `minimumComplexFormEvidenceCount` met — otherwise not supported (insufficient).
3. `supported = simpleSuccessRate >= knowledgeSoundThreshold AND complexFailureRate >= failureRateThreshold`. This is the operational form of task §8's "learner knows the underlying concept but repeatedly fails on command-term interpretation / structure / rubric / procedure."
4. Framework/version/component awareness: the technique classifier receives `scope.examVersionId`/`scope.assessmentComponentId`/`scope.commandTermId` and restricts "complex form" rows to that scope when supplied — a technique gap on PAA's command terms is diagnosed independently from Cambridge's (case I).

### Speed/Fluency Gap (task §9)

1. Filter to rows with `metadata.behavior.responseTimes` entries whose `quality === 'VALID'`, matched to a comparable `difficulty` band. Anything else (`MISSING`/`INVALID`/`CLOCK_SKEW`/`OUTLIER`, or no timing entry at all) is excluded, not treated as a zero.
2. If valid-sample count < `minimumValidTimingSampleCount` → not supported, reason `TIMING_SAMPLE_INSUFFICIENT`.
3. If `policy.speed.expectedResponseTimeMsByDifficultyBand[band]` is `null`/absent → not supported, reason `TIMING_EXPECTATION_UNAVAILABLE` (case H — official timing rule unavailable blocks the diagnosis entirely, it is never guessed).
4. Compute correctness among the same valid-timing rows; if `< minimumCorrectnessBaseline` → not supported, reason `KNOWLEDGE_GAP_BLOCKS_SPEED_DIAGNOSIS` (case F — slow-but-wrong is a knowledge signal, not a speed signal; the Knowledge Gap dimension is left to independently pick this up).
5. `supported = (avgResponseTimeMs / expectedMs) >= latencyRatioThreshold`, reason `CONSISTENT_LATENCY_ABOVE_EXPECTATION`.

## Combiner (`combineDiagnosis`, pure)

```ts
function combineDiagnosis(dims: DimensionResult[], policy: DiagnosticPolicyRules): GapDiagnosis
```
- If no dimension is `supported` → `primaryGapType: 'INSUFFICIENT_EVIDENCE'`, `confidence` = 0, `reasonCodes` = union of all dimensions' blocking reasons, `alternatives` = all four `DimensionResult`s (task §11 — "what alternative diagnosis was considered" is always answerable, even for INSUFFICIENT_EVIDENCE).
- If exactly one dimension is `supported` → that `GapType` is `primaryGapType`, its own `confidence`/evidence ids/reason codes are promoted; `secondarySignals = []`.
- If more than one dimension is `supported` → `primaryGapType: 'MIXED'`, `secondarySignals` = all supported `GapType`s ordered by `policy.mixedGapPriority`, `confidence` = the *lowest* of the supported dimensions' confidences (a MIXED verdict is never reported more confidently than its weakest supporting signal), `reasonCodes`/evidence ids = union.
- `alternatives` always contains every `DimensionResult` computed, supported or not — this is the entire explainability contract (task §11).

## Determinism / replay (task §38, AC-F8-07)

`diagnosis.service.ts::runDiagnosis` fetches evidence via one deterministic, timestamp-ordered SQL query, fetches the policy (active, or an explicit `policyVersionId` for replay), and calls the pure functions above. `replayDiagnosis(evidenceSnapshot, policyVersionId)` is exposed purely for certification/testing — it accepts the exact evidence id list and re-fetches those specific immutable rows, guaranteeing the same output as the original run. Nothing in this path calls an AI model; AI is only ever used downstream, in teaching-content generation, never in classification (task §38: "AI is not allowed to decide the diagnostic category").
