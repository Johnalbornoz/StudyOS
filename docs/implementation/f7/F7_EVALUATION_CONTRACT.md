# F7 — Evaluation & Validation Contract

## Validation layer (task §26) — additive checks alongside the existing Quality Gate

`validateItemForExamContext(item, context: GenerationContext): ValidationResult` checks only what
the **existing** Quality Gate/semantic verifier cannot know about (answerability and schema
validity remain their job, untouched):

| Check | Fails when |
|---|---|
| Question type compatibility | `context.questionType` is set and `item.type` doesn't match it |
| Difficulty bounds | `item.difficulty` falls outside `context.difficultyRange` |
| Command term compatibility | A command term is configured but the item's stem doesn't reflect it (a lightweight presence check, never a semantic judgment — that remains the AI verifier's job if ever wired in) |
| Tool rules | `context.toolContext.status === 'NOT_CONFIGURED'` — an item cannot be validated as "correctly using the configured tool rules" when none exist (INV-F7-08, adversarial case D/G) |
| Mapping compatibility | `context.canonicalConceptIds` is empty — nothing published to generate against |
| Exam version / component compatibility | The objective target's component has `support_status = 'UNSUPPORTED'` |

**FAIL CONTROLLED** (task §26): any failure returns a structured `{valid: false, reasons:
string[]}` — the item is never presented, and no exception/500 is the failure mode; a clear,
enumerable reason list is.

## Evaluation contract (task §27)

`recordExamAttemptItemResponse(...)` is the one envelope every response type flows through,
**wrapping** (never replacing) the four existing graders:

```ts
interface EvaluationResult {
  rawResponse: unknown;
  score: number;
  maxScore: number;
  criteriaBreakdown: Record<string, unknown> | null;  // rubric/mark-scheme detail, when applicable
  feedback: string | null;
  evaluationModelVersion: string | null;               // set only when an AI grader was used
  provenance: Record<string, unknown> | null;           // aiExecutionId etc., when applicable
}
```

For a selected-response item, the service delegates to the existing `gradeStructuredAnswer()`; for
open response, to `gradeAnswer()` — F7 never reimplements grading logic, only persists the result
in this common shape inside `exam_attempt_item_responses` (task §27's exact required fields: raw
response, score, max score, criteria/mark breakdown, feedback, model/version, provenance — all
present).

## Procedure / worked reasoning (task §17)

`exam_attempt_item_responses.reasoning_trace` is a nullable jsonb column — populated only when the
`assessment_components`/blueprint target explicitly requires procedure capture (a
`procedure_required` flag on the component). Most items never populate it — task §17's explicit
instruction ("do not assume procedure is required for all items") is enforced by this being an
opt-in, not a default-on, column.
