# F8 — AI Teaching Contract

**Naming note**: `src/lib/adaptive-teaching-generation.ts` already exports a type literally named `TeachingGenerationContext`, belonging to the legacy Phase 5B `TeachingIntent` pipeline (a `Pick` of `TeachingIntent`'s fields). F8's own, unrelated context type is therefore named `TeachingContentGenerationContext` throughout — a real naming near-collision caught only while checking an actual call site during implementation, not during the original research pass. F8 does not reuse or extend `adaptive-teaching-generation.ts`; per the current-state assessment, F8 deliberately does not wire into the legacy `TeachingIntent`/`PrimaryBarrier` pipeline at all.

**Considered-and-declined reuse**: `src/services/teaching-content.service.ts` (`generateGuidedPractice`) already generates a "solve it together" step sequence, another precedent not surfaced by the original research pass and also caught only during implementation. Its own doc comment states its authority boundary "by omission": it never chooses the concept, framework, or evidence, and never writes `learning_evidence` — pure Socratic scaffolding, framework-unaware by design. F8's own generation contract is deliberately broader (framework-aware, command-term-aware, produces content whose learner *response* becomes real Evidence via `writeInterventionEvidence`), so it is not a narrowing/extension of that service — it is declined as a base, not silently duplicated past. If a future phase wants F8's `WORKED_EXAMPLE`/`GUIDED_PRACTICE` content generation to internally delegate its step-sequence *shape* to `generateGuidedPractice` for the framework-neutral case, that is a reasonable follow-up, not something this phase forces.

## Generation context (extends F7's `GenerationContext`, never duplicates it)

```ts
// src/lib/teaching/ai-teaching-contract.service.ts

interface TeachingContentGenerationContext {
  studentId: string;
  conceptId: string;
  canonicalConceptIds: string[];
  skillIds: string[];
  diagnosis: { primaryGapType: DiagnosisResultType; reasonCodes: string[]; confidence: number };
  interventionType: InterventionType;
  framework: FrameworkIdentity | null;             // from framework-context.service.ts, null = framework-neutral
  commandTerm: { id: string; term: string; expectedStructure: string | null; rubricNotes: string | null } | null;
  questionType: string | null;                      // reuses quiz-generation.service.ts's QuestionType
  reasoningRequirement: string | null;               // reuses ExpectedReasoningType
  difficulty: number;                                // 1-5
  proceduresRequired: boolean;                        // from assessment_components.procedure_required, false if no framework/component
  language: string;                                   // activity language, per task §29
  assistanceLevel: string;                             // ai_assistance_type domain value
}

async function resolveTeachingContentGenerationContext(params: {
  studentId: string; conceptId: string; diagnosisId: string; interventionType: InterventionType;
}): Promise<TeachingContentGenerationContext>
```

`resolveTeachingContentGenerationContext` composes existing resolvers only: `resolveFrameworkForStudentExamProfile`, `resolveActivityMetadataForObjective` (when the diagnosis scope carries a `learningObjectiveId`), `resolveCommandTermInterpretation`, and the diagnosis row itself. It performs no AI call and no new database writes.

## Output schema

```ts
interface TeachingContentPayload {
  canonicalConceptId: string;                          // MUST match one of context.canonicalConceptIds
  framework: { academicOrganizationId: string; academicProgrammeId: string } | null;  // MUST match context.framework or be null iff context.framework is null
  interventionType: InterventionType;                   // MUST match context.interventionType
  commandTermId: string | null;                          // MUST match context.commandTerm?.id ?? null
  language: string;                                       // MUST match context.language
  knowledge: { explanation: string; keyIdeas: string[] };                       // framework-agnostic section
  strategy: { guidance: string; workedExample?: { steps: string[]; finalAnswer: string }; commonFailurePatterns: string[] } | null;  // framework-specific section, null iff context.framework is null
  practiceItems: Array<{ prompt: string; expectedAnswer: string; difficulty: number }>;
}
```

Generated via `executeAI` (existing `src/lib/ai/gateway.ts`), `capability: 'CONTENT_GENERATION'`, routed through `resolveModels('CONTENT_GENERATION')` exactly as every existing generation call site does — no new capability value, no hardcoded model name.

## Validation — two-pass, mirroring the Quality Gate exactly (task §23)

### Pass 1 — deterministic (`checkTeachingContentDeterministic`, pure, no I/O)

```ts
type TeachingContentFailureCode =
  | 'SCHEMA_INVALID' | 'CONCEPT_MISMATCH' | 'FRAMEWORK_MISMATCH' | 'INTERVENTION_TYPE_MISMATCH'
  | 'COMMAND_TERM_MISMATCH' | 'LANGUAGE_MISMATCH' | 'DIFFICULTY_OUT_OF_RANGE'
  | 'MISSING_REQUIRED_PROCEDURE' | 'EMPTY_CONTENT' | 'STRATEGY_SECTION_MISSING_FOR_FRAMEWORK'
  | 'STRATEGY_SECTION_PRESENT_WITHOUT_FRAMEWORK';

function checkTeachingContentDeterministic(payload: unknown, context: TeachingContentGenerationContext): { status: 'PASS'|'FAIL'; failures: TeachingContentFailureCode[] }
```
Checks (all pure structural/value comparisons, same rigor as `validateItemForExamContext`):
1. Schema shape (required fields present, correct types) → `SCHEMA_INVALID`.
2. `payload.canonicalConceptId ∈ context.canonicalConceptIds` → else `CONCEPT_MISMATCH` (case J's "wrong concept" equivalent).
3. `payload.framework` matches `context.framework` (both null, or same ids) → else `FRAMEWORK_MISMATCH` (case J — "AI returns wrong framework" → blocked).
4. `payload.interventionType === context.interventionType` → else `INTERVENTION_TYPE_MISMATCH`.
5. `payload.commandTermId === (context.commandTerm?.id ?? null)` → else `COMMAND_TERM_MISMATCH`.
6. `payload.language === context.language` → else `LANGUAGE_MISMATCH` (task §29 — never silently mixed).
7. Every `practiceItems[].difficulty` within `[context.difficulty - 1, context.difficulty + 1]` bound (a policy-configured tolerance) → else `DIFFICULTY_OUT_OF_RANGE`.
8. If `context.proceduresRequired`, `payload.strategy?.workedExample?.steps` must be a non-empty array → else `MISSING_REQUIRED_PROCEDURE` (task §18).
9. `context.framework === null` ⟺ `payload.strategy === null` (strict equivalence — a framework-neutral request must not receive framework-flavored strategy content, and vice versa) → else `STRATEGY_SECTION_MISSING_FOR_FRAMEWORK`/`STRATEGY_SECTION_PRESENT_WITHOUT_FRAMEWORK`.
10. All text fields non-empty → else `EMPTY_CONTENT`.

**Any single failure blocks presentation** — never a partial/best-effort serve (task §23: "No malformed or mismatched AI output may be silently served").

### Pass 2 — semantic (only runs if Pass 1 is `PASS`)

`verifyTeachingContentSemantic(payload, context)` — one more `executeAI` call, `capability: 'EXPLANATION_EVALUATION'` (the exact same capability `question-quality-verifier.service.ts` routes through — its own registered rationale, "semantic verification gates whether content reaches a learner — run on the stronger model," applies verbatim here), which resolves to the Terra-only tier (`CAPABILITY_ROUTING.EXPLANATION_EVALUATION`, `primary: TERRA, fallback: TERRA`). Asks only what a deterministic check cannot: does `knowledge` avoid restating framework-specific mechanics, does `strategy` (when present) avoid restating the canonical definition, is the content factually consistent with the canonical concept. Returns a strict, schema-validated verdict; a malformed or low-confidence verdict fails closed (never approved) — same `VERIFY_ERROR`-style discipline as the Quality Gate. Both calls register their own new `PromptId`s (`f8.teaching_content_generation`, `f8.teaching_content_semantic_verify`) in `src/lib/ai/prompt-registry.ts`, following the registry's own "every capability gets an explicit id/version" discipline — no unregistered/ad-hoc prompt id is used.

## AI failure behavior (task §24)

Routed through the same `executeAI`/`AIExecutionError`/`AIErrorCode` machinery as every existing AI call site — timeout/4xx/5xx/malformed-JSON/schema-mismatch all surface as a typed `AIExecutionError`. **No fallback path invents teaching content.** On any failure (provider or validation), the intervention-generation call site returns a structured `{blocked: true, reason: AIErrorCode | TeachingContentFailureCode}` result and the API route surfaces a 502/422 — the student is told generation failed, never served guessed or malformed content. This mirrors `evaluateExplanation`'s no-fallback discipline rather than `gradeAnswer`'s fallback discipline, because inventing wrong teaching content is worse than a visible failure.

## Reuse discipline

No new `AICapability` value, no new adapter, no new question-generation logic — `TeachingContentPayload.practiceItems` are teaching-support items only (never persisted as `learning_evidence` themselves; only the learner's *response* to them, recorded via `writeInterventionEvidence`, becomes Evidence). `QuestionType`/`ExpectedReasoningType`/`CognitiveLevel` are imported from `quiz-generation.service.ts`, never redeclared.
