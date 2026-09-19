# F9 — Post-Exam Diagnosis

## Scoring integration (task §28, reusing F7's contract exactly)

`src/lib/simulation/scoring.service.ts::recordSimulationItemResponse`:
```ts
async function recordSimulationItemResponse(params: {
  examAttemptId: string; assessmentComponentId: string; learningObjectiveId?: string;
  itemSnapshot: Record<string, unknown>; studentAnswer: string; correctAnswer: string;
  questionForGrading: GeneratedQuestion;   // reused shape from quiz-generation.service.ts, never redeclared
}): Promise<{ responseId: string; evaluation: EvaluationResult }>
```
1. Chooses the appropriate existing grader by item shape — `gradeStructuredAnswer` (deterministic formats) or `gradeAnswer` (free-text/AI-graded) — exactly as F8's `recordInterventionAttempt` already does. No new grading logic anywhere in F9.
2. Maps the grader's result into F7's `EvaluationResult` shape (`{rawResponse, score, maxScore, criteriaBreakdown, feedback, evaluationModelVersion, provenance}`).
3. Calls F7's real, unmodified `recordExamAttemptItemResponse` to persist it — F9 never writes to `exam_attempt_item_responses` directly.

`getSimulationScoreSummary(examAttemptId)` is a pure read-time aggregation over `exam_attempt_item_responses` (`SUM(score)/SUM(max_score)`, grouped by `assessment_component_id` for `byComponent`) — no new stored column, no new write path.

## Evidence generation (task §31, first paragraph)

Each scored response also writes real `learning_evidence`, through the **same** evidence-integration discipline F8 already established (`writeInterventionEvidence`'s pattern, reused conceptually): `sourceType: 'EXAM_SIMULATION'` (the pre-existing F5 evidence source type F7's own evidence-bridge already uses — never a new source type), `metadata` populated only with genuinely-resolved keys (`skillIds` only if the target carried one and F6's bridge confirmed it, `framework`, `commandTermId`, `questionType`, `context: {examAttemptId, simulationType}`), and `ai_assistance_type: 'NONE'` (a simulation attempt is, by definition, independent evidence — no hint/scaffold path exists inside a timed or untimed exam attempt). This is the one and only evidence-writing path F9 uses; it never re-implements `updateMastery`'s caller contract from scratch.

## Post-exam F8 diagnosis (task §31, second paragraph — INV-F9-12)

`src/lib/simulation/post-exam-diagnosis.service.ts::runPostExamDiagnosis`:
```ts
async function runPostExamDiagnosis(examAttemptId: string): Promise<{
  diagnoses: StoredGapDiagnosis[];   // F8's own type, re-exported, never redeclared
  knowledgeGaps: string[]; skillGaps: string[]; examTechniqueGaps: string[]; speedFluencyGaps: string[];
  insufficientEvidenceAreas: string[];
}>
```
For every distinct (student concept, scope) touched by the attempt's responses, calls F8's real `runDiagnosis` unmodified — **never a second post-exam classifier** (task §31's explicit prohibition). The scope passed includes `examVersionId`/`assessmentComponentId`/`commandTermId` from the simulation plan, exactly as F8's own `DiagnosisScope` already supports — no extension to F8's diagnosis service is needed. Results are bucketed into the four gap lists plus `insufficientEvidenceAreas` purely by reading each diagnosis's own `primaryGapType`/`secondarySignals` — a pure read, not a reinterpretation.

## Boundary restated

F9 never calls `updateMastery` itself with an invented sourceType, never re-derives F8's classification thresholds, and never writes a second `learner_gap_diagnoses`-shaped table. Every gap named in a post-exam diagnosis result traces back to a real, independently-certified F8 diagnosis row.
