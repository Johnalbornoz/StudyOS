# F7 — Generation Contract

## Configuration + validators are authority, never the prompt (task §25)

F7 does **not** call the AI. It defines the **input-resolution contract** a future generation
call site (F8+) would use, and the **validation contract** any output must pass — both pure,
deterministic, and independent of any specific prompt wording.

```ts
interface GenerationContext {
  learnerContext: { studentId: string };
  examVersionId: string;
  assessmentComponentId: string;
  blueprintObjectiveTargetId: string;
  learningObjectiveId: string;
  canonicalConceptIds: string[];   // from F6's resolveActivityMetadataForObjective, PUBLISHED only
  skillIds: string[];              // same
  competencyIds: string[];         // same -- may be empty; never fabricated
  questionType: string | null;     // from the blueprint target, or null = any supported type
  difficultyRange: { min: number; max: number } | null; // 1-5 scale, reused
  reasoningRequirement: string | null;
  commandTerm: { id: string; term: string } | null;
  toolContext: { status: 'CONFIGURED' | 'NOT_CONFIGURED'; rules: Record<string, unknown> | null };
  timingContext: { status: 'CONFIGURED' | 'NOT_CONFIGURED'; durationMinutes: number | null };
}
```

`resolveGenerationContext(blueprintObjectiveTargetId, studentId)` builds this by:
1. Reading the `blueprint_objective_targets` row and its parent `assessment_blueprints`/
   `exam_versions`/`assessment_components`.
2. Calling F6's **unmodified** `resolveActivityMetadataForObjective(learningObjectiveId)` —
   INV-F7-06/16: only `PUBLISHED` mappings are ever resolved; `AMBIGUOUS`/`UNRESOLVED`/`DRAFT`/
   `RETIRED` mappings are invisible to this function by construction (F6's own filter, reused
   verbatim, never re-implemented).
3. Copying `toolContext`/`timingContext` directly from the component's `tool_rule_status`/
   `timing_status` — **never defaulting an unconfigured status to a guessed rule** (INV-F7-08/09).

If the objective has zero `PUBLISHED` mappings, `resolveGenerationContext` returns a context with
empty `canonicalConceptIds`/`skillIds`/`competencyIds` — the caller (a future generation call
site) must treat this as "cannot generate a mapped item for this target," never proceed with a
guessed concept.

## Why this does not duplicate the existing generation pipeline

`quiz-generation.service.ts`'s own prompt-building and Quality Gate remain completely untouched.
`GenerationContext` is designed to be the **new** input a future call site passes *in addition to*
today's existing inputs (concept RAG context, activity type) — it never replaces
`buildQuestionGenerationPrompt`'s own logic, and F7 makes no change to that file.
