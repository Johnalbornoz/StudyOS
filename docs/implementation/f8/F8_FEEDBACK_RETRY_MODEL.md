# F8 — Feedback & Retry Model

## Feedback contract (task §19)

```ts
// src/lib/teaching/feedback.service.ts

type FeedbackCategory =
  | 'CORRECT'
  | 'KNOWLEDGE_ERROR'            // maps from GradingErrorType.CONCEPTUAL
  | 'SKILL_EXECUTION_ERROR'      // new -- an explicitly skill-tagged attempt, incorrect
  | 'COMMAND_TERM_MISMATCH'      // new -- exam-technique specific
  | 'STRUCTURE_INCOMPLETE'       // new -- required structure/procedure missing
  | 'RUBRIC_CRITERIA_MISSED'     // new -- semantic-pass flagged rubric non-compliance
  | 'CALCULATION_ERROR'          // maps from GradingErrorType.ARITHMETIC | UNIT
  | 'INCOMPLETE_ANSWER'          // maps from GradingErrorType.INCOMPLETE
  | 'UNSUPPORTED_CONCLUSION'     // new -- claim made without shown reasoning, from reasoningValid:false + non-conceptual errorType
  | 'CARELESS_ERROR'             // maps from GradingErrorType.CARELESS
  | 'MISREAD_QUESTION'           // maps from GradingErrorType.MISREADING
  | 'TIMING_ISSUE';              // only ever attached when a valid, supported Speed/Fluency diagnosis exists for this attempt's context

interface AttemptFeedback {
  category: FeedbackCategory;
  observedBehavior: string;       // references what happened, never a psychological claim (task §19)
  sourceGraderErrorType: GradingErrorType | null;
  technique: { commandTermId: string; expectedStructure: string | null; ruleViolated: string } | null;
}

function classifyFeedback(params: {
  graderResult: GradeAnswerResult | { correct: boolean; score: number; feedback: string };
  context: TeachingContentGenerationContext | null;   // null when no exam/framework context applies
  techniqueValidation: TeachingContentFailureCode[] | null;  // reserved for future response-side technique validation
}): AttemptFeedback
```

`classifyFeedback` is a pure mapping function:
1. If `graderResult.correct` → `CORRECT`.
2. Else if `graderResult` came from `gradeAnswer` and carries an `errorType`, map `CONCEPTUAL→KNOWLEDGE_ERROR`, `ARITHMETIC|UNIT→CALCULATION_ERROR`, `INCOMPLETE→INCOMPLETE_ANSWER`, `CARELESS→CARELESS_ERROR`, `MISREADING→MISREAD_QUESTION`, `PROCEDURAL→UNSUPPORTED_CONCLUSION` (when `reasoningValid === false`) or `SKILL_EXECUTION_ERROR` (when `context.diagnosis.primaryGapType === 'SKILL_GAP'` — i.e. this attempt is itself skill-scoped evidence).
3. If `context?.commandTerm` is set and the attempt was generated as an `EXAM_TECHNIQUE_GAP`-remediating intervention and the grader still marked it incorrect, prefer `COMMAND_TERM_MISMATCH`/`STRUCTURE_INCOMPLETE` over the generic content-error category (technique errors take precedence over content-error categories when the intervention itself targets technique — the whole point of the intervention was to test technique, not content, so a content-shaped error code would misattribute the failure).
4. `observedBehavior` is always a template filled from concrete facts already available (`"answer omitted the required steps for '${commandTerm}'"`, `"selected option differs from the correct option"`) — never a generated free-text psychological inference (task §19's "avoid unsupported psychological claims").

`GradingErrorType` (F0-era) is never modified — F8's `FeedbackCategory` is a superset mapping, additive, living in its own new type.

## Retry model (task §20)

Covered structurally in `F8_EXAM_SKILLS_MODEL.md` (`intervention_attempts`, append-only, `attempt_number` increment, no overwrite). This document adds the feedback-specific guarantee: **every** `intervention_attempts.feedback` column is the immutable `AttemptFeedback` computed at that attempt's grading time — a later policy or grader change never rewrites a past attempt's stored feedback (matches `learning_evidence`'s own immutability, task §15/INV-F8-15 extended to F8's derived data).

## Assistance semantics (task §21)

Already covered by reusing `ai_assistance_type` verbatim (`F8_EXAM_SKILLS_MODEL.md`). The specific guarantee this document states: `writeInterventionEvidence` (see `F8_EVIDENCE_INTEGRATION.md`) always sets `ai_assistance_type` to the session's `assistance_level`, and the diagnostic evidence-gate (`classification.algorithms.ts`) always filters to `ai_assistance_type === 'NONE'` before counting anything as "independent" — an assisted-correct `INDEPENDENT_PRACTICE`-session attempt (assistance_level `NONE`) counts toward independent evidence; a correct `GUIDED_PRACTICE`-session attempt (assistance_level `TUTOR_GUIDANCE`) never does, regardless of correctness (INV-F8-06/case L).
