# F8 — Evidence Integration

## `writeInterventionEvidence` (`src/lib/teaching/evidence-integration.service.ts`)

```ts
async function writeInterventionEvidence(params: {
  studentId: string;
  conceptId: string;
  subjectId: string;
  interventionSessionId: string;
  interventionType: InterventionType;
  result: 'correct' | 'incorrect' | 'partial';
  scorePercent: number;
  difficulty: number;
  skillId?: string;                    // only when the session's diagnosis scope carried a qualifying skillId
  framework: FrameworkIdentity | null;
  commandTermId: string | null;
  questionType: string | null;
  reasoningRequirement: string | null;
  assistanceLevel: string;             // ai_assistance_type domain
  hintsUsed: number;
  timing?: { questionPresentedAt: string; answerSubmittedAt: string };
  diagnosisId: string;
  attemptNumber: number;
}): Promise<MasteryUpdateResult>
```

Maps `interventionType` to an existing `EvidenceSourceType` (`src/lib/algorithms/mastery.ts`) — no new source type is introduced:

| `interventionType` | `sourceType` |
|---|---|
| `EXPLAIN` | `EXPLANATION` |
| `WORKED_EXAMPLE` | `REMEDIATION` |
| `GUIDED_PRACTICE` | `GUIDED_EXERCISE` |
| `CONTEXTUAL_HELP` | `GUIDED_EXERCISE` |
| `INDEPENDENT_PRACTICE` | `PRACTICE_QUESTION` |
| `PROVE` | not applicable — F8 never calls this for PROVE sessions (see `F8_EXAM_SKILLS_MODEL.md`) |

Calls `updateMastery()` (F5, unmodified) with:
- `evidence: { sourceType, result, difficulty, scorePercent }`
- `telemetry: { activityType: interventionType, learningMode: 'AI_NATIVE', hintsUsed, aiAssistanceType: assistanceLevel }`
- `metadata`: only populated keys, never empty placeholders — `skillIds: [skillId]` (only if `skillId` present — never fabricated, INV-F8-12), `framework: {...}` (only if `framework !== null`), `commandTermId`, `questionType`, `reasoningRequirement`, `context: { interventionSessionId, diagnosisId, attemptNumber }`, and `behavior: withBehaviorMetadata(...)` (only if `timing` is present and its computed `quality` is meaningful — `normalizeResponseTiming` is always called when timing is supplied, and its result, including a `MISSING`/`INVALID` quality, is stored as-is, never discarded, so a later Speed/Fluency diagnosis can see *why* a sample was excluded).

**Never writes `competencyIds`** — F8 introduces no new competency-attachment path (INV-F8-12/AC-F8-23); if a future evidence source qualifies competency evidence, that remains F7's evidence-bridge's job, not F8's.

## Evidence-gate reads (`src/lib/diagnostics/evidence-gate.service.ts`)

```ts
async function fetchEvidenceForDiagnosis(studentId: string, conceptId: string, scope: DiagnosisScope): Promise<EvidenceRow[]>
```

One deterministic SQL query (ordered by `timestamp`, then `id`, to guarantee stable ordering for replay) selecting `id, result, ai_assistance_type, hints_used, difficulty, score_percent, timestamp, activity_type, metadata` from `learning_evidence WHERE student_id = $1 AND concept_id = $2`. This includes evidence written by F8's own interventions *and* pre-existing evidence from quizzes/explain/transfer routes — a diagnosis is never scoped to "only F8-produced evidence," since the whole point is diagnosing from the learner's real history. Skill-scoped and technique-scoped filtering (the `metadata -> 'skillIds' @>`/command-term predicates) happens in the pure classification functions, not in this query, so the same fetched set can be reused across all four dimension classifiers in one diagnosis run without four separate round-trips.

## Immutability guarantee

Nothing in F8 ever issues an `UPDATE` or `DELETE` against `learning_evidence`. The structural non-interference test (`f8-canonical-v2-noninterference.test.ts`, extended per F5/F7's own pattern) asserts this at the source level across every F8 lib file, exactly as every prior phase's own non-interference test does for its own files.
