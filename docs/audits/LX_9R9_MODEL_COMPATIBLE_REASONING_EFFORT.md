# LX-9R9 — MODEL-COMPATIBLE REASONING EFFORT

## STATUS

**PASS.** StudyUS can no longer send a `reasoning_effort` value an OpenAI model rejects. The proven live defect (`question_generation_slot`'s `'minimal'`) is fixed at its source, two more budgets carrying the same invalid value (`contextual_help`, `question_localization`) were found and fixed in the same pass, and a shared, model-aware compatibility authority now guards every OpenAI request StudyUS constructs — not just quick_check's.

`npx tsc --noEmit`, `npx vitest run` (230 files / 3875 tests), and `npm run build` are all clean on the implementation commit.

---

## LIVE ROOT CAUSE

```
HTTP 400  invalid_request_error
param:    reasoning_effort
message:  Unsupported value: 'reasoning_effort' does not support 'minimal'
          with this model. Supported values are: 'none', 'low',
          'medium', 'high', and 'xhigh'.
model:    gpt-5.6-luna
```

`SOLO_CHECK`/quick_check generation failed **before inference** — a deterministic, StudyUS-side request-shape defect, not a provider outage, billing issue, schema problem, or anything downstream of generation (the spec was explicit that those were not the cause, and this audit did not investigate them).

## CURRENT INVALID CONFIG

Before this phase, `src/lib/ai/token-budgets.ts` declared:

```ts
reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';   // 'minimal' never valid for any routed model
...
question_generation_slot: { ..., reasoningEffort: 'minimal' },   // quick_check
contextual_help:          { ..., reasoningEffort: 'minimal' },   // hint generation
question_localization:    { ..., reasoningEffort: 'minimal' },   // question localization
```

`'minimal'` was never in the provider's own documented vocabulary (`none`/`low`/`medium`/`high`/`xhigh`) — it was invented locally and never validated against any routed model's actual support.

---

## COMPLETE REASONING-EFFORT AUDIT

Every `reasoningEffort`/`reasoning_effort` occurrence in `src/` was located (`grep -rn`). All of them ultimately trace back to `TOKEN_BUDGETS` (`src/lib/ai/token-budgets.ts`) — no call site hardcodes a reasoning-effort literal outside that one table. 10 budget keys are declared; 8 carry a `reasoningEffort`. GRADING, TRANSFER_EVALUATION, COGNITIVE_ANALYSIS, and CLASSIFICATION capabilities were also audited (`concept-extraction.service.ts`, `localization.service.ts`, `topic-hierarchy.service.ts`, `ai.service.ts`, `transfer.service.ts`, `concept-graph.service.ts`, `misconception.service.ts`, `error-intelligence.service.ts`, `explain-defend.service.ts`) — **none of them pass `reasoningEffort` at all**, so their `callModel` calls omit the parameter entirely and were never at risk.

## MODEL COMPATIBILITY MATRIX

Every capability in `CAPABILITY_ROUTING` (`src/lib/ai/model-routing.ts`) resolves to OpenAI `gpt-5.6-luna` (primary) → `gpt-5.6-terra` (fallback), except `EMBEDDING` (a different model, never takes `reasoningEffort`) and the evaluation-grade capabilities (`EXPLANATION_EVALUATION`/`GRADING`/`TRANSFER_EVALUATION`/`COGNITIVE_ANALYSIS`), which route Terra→Terra. Both Luna and Terra are gpt-5.6-family models and — per the live provider error — share the identical supported set.

| Capability | Budget | Primary | Fallback | Configured effort (before) | Supported by primary? | Supported by fallback? | Fixed |
|---|---|---|---|---|---|---|---|
| QUESTION_GENERATION | `question_generation_practice` | Luna | Terra | `low` | ✅ | ✅ | n/a (already valid; also not currently wired to any call site — see note below) |
| QUESTION_GENERATION | `question_generation_chunk` | Luna | Terra | `low` | ✅ | ✅ | n/a |
| QUESTION_GENERATION | `question_generation_slot` (quick_check) | Luna | Terra | **`minimal`** | ❌ | ❌ | **`none`** |
| CONTENT_GENERATION | `concept_explanation` | Luna | Terra | `low` | ✅ | ✅ | n/a |
| CONTENT_GENERATION | `guided_practice` | Luna | Terra | `low` | ✅ | ✅ | n/a |
| CONTENT_GENERATION | `interactive_formula` | Luna | Terra | `low` | ✅ | ✅ | n/a |
| OTHER (`quiz.question_hint`) | `contextual_help` | Luna | Terra | **`minimal`** | ❌ | ❌ | **`none`** |
| CONTENT_GENERATION (`quiz.question_localization`) | `question_localization` | Luna | Terra | **`minimal`** | ❌ | ❌ | **`none`** |
| EXPLANATION_EVALUATION | `semantic_verification` | Terra | Terra | `low` | ✅ | ✅ | n/a |
| TUTOR | `tutor_reply` | Luna | Terra | `low` | ✅ | ✅ | n/a |
| GRADING / TRANSFER_EVALUATION / COGNITIVE_ANALYSIS / CLASSIFICATION | — (no budget passes `reasoningEffort`) | Terra/Luna | Terra/Terra | not set | n/a | n/a | not applicable — never sends the parameter |

**Note on `question_generation_practice`**: its `reasoningEffort: 'low'` field is declared but never actually read by any current call site (`quiz-generation.service.ts:447` only reads its `maxContextChars`; the ~3-question canonical Practice batch routes through `generateGatedPracticeBatch`, which does not consult this budget's `reasoningEffort`). It is already a valid value, so this is not a defect — noted here for completeness of the audit, not fixed (out of this phase's scope, which is model-compatibility, not dead-config cleanup).

---

## CANONICAL BUDGET FIX

`src/lib/ai/token-budgets.ts`'s `TokenBudget.reasoningEffort` type now reads from the new canonical `ReasoningEffort` union (`src/lib/ai/model-compatibility.ts`): `'none' | 'low' | 'medium' | 'high' | 'xhigh'` — **`'minimal'` is no longer a member of the type anywhere in the codebase**, so a future budget cannot reintroduce this exact defect and still pass `tsc`. The three affected budgets were changed at the source of truth:

```ts
question_generation_slot: { maxOutputTokens: 2400, maxContextChars: 4000, reasoningEffort: 'none' },
contextual_help:          { maxOutputTokens: 700,  maxContextChars: 3000, reasoningEffort: 'none' },
question_localization:    { maxOutputTokens: 2000, maxContextChars: 0,    reasoningEffort: 'none' },
```

**Why `'none'`, not `'low'`:** all three purposes were deliberately configured for low latency/cost and do not require deep chain-of-thought reasoning — `question_generation_slot` is quick_check's single-slot generation, whose *quality* is independently protected downstream by the Question Quality Gate (deterministic contract + semantic verification, LX-9R8), never by generation-time reasoning depth; `contextual_help` produces a short hint; `question_localization` performs a structured mapping task. `'none'` is the **lowest** value gpt-5.6 actually supports, so it is the closest available match to each budget's original "spend as little reasoning as possible" intent — choosing `'low'` instead would have silently spent *more* reasoning than the original configuration intended, which is not a neutral choice. No explicit policy in this codebase currently distinguishes `'none'` from `'low'` beyond this reasoning, matching the spec's own fallback instruction ("prefer the lowest supported effort consistent with the capability's quality requirements").

---

## PROVIDER BOUNDARY GUARD

`src/lib/ai/model-compatibility.ts` (new) is the one shared authority:

```ts
export const REASONING_EFFORT_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORT_LEVELS)[number];

export function resolveReasoningEffort(params: {
  model: string;
  requestedEffort: string | undefined;
}): ReasoningEffortResolution   // 'UNCHANGED' | 'NORMALIZED' | 'UNRESOLVABLE'
```

- **`undefined`** (no effort requested) → always `UNCHANGED`; omitting the parameter is always safe.
- **A value already in the target model's registered supported set** → `UNCHANGED`, sent verbatim. This is the expected outcome for every canonical budget after the fix above (proven by the PART K contract test below).
- **A value with a known-safe legacy alias for that model** (currently: `minimal → none`) → `NORMALIZED`; a `[ai-model-compat] { model, parameter: "reasoning_effort", requestedValue, effectiveValue, reason }` line is logged and the normalized value is sent.
- **Anything else — including a value for a model this module has no registered compatibility entry for** → `UNRESOLVABLE`. An unregistered model is treated as *unknown*, never assumed compatible; a genuinely unmapped value is never guessed.

`src/lib/ai/adapters/openai.ts`'s `callOpenAIChat` — **the one place StudyUS constructs a request to OpenAI's Chat Completions API** — calls `resolveReasoningEffort` immediately after the API-key check and **before** building the request body or calling `fetch`. `UNRESOLVABLE` throws `AIExecutionError('CONFIGURATION_ERROR', ...)` — a provider request is never spent to discover an incompatibility StudyUS could know locally. This is defense in depth on top of the canonical budget fix, not a replacement for it: every configured budget should already resolve `UNCHANGED`, and the PART K contract test enforces that as a standing invariant.

---

## QUICK_CHECK

### BEFORE

```
model: gpt-5.6-luna, reasoning_effort: 'minimal'
-> HTTP 400 invalid_request_error (unsupported_value, param: reasoning_effort)
```

### AFTER

```
model: gpt-5.6-luna, reasoning_effort: 'none'
-> valid Chat Completions request (verified via the real request builder, fetch mocked -- required tests 2/3)
```

Everything else about quick_check is untouched — verified by source audit and the unmodified, still-green existing test suite: the 6 parallel slots, the exact-6-or-fail contract (`QUICK_CHECK_SLOT_COUNT`), the slot-recovery path, Structured Output (`GENERATED_QUESTION_BATCH_SCHEMA`, `strict: true`), the LX-9R8 Question Quality Gate (deterministic contract + semantic verification + rejection histogram), difficulty calibration (`describeDifficultyTier`), cross-chunk novelty dedupe, and `operationId` telemetry.

---

## OTHER AFFECTED CAPABILITIES

`contextual_help` (the `quiz.question_hint` capability, `OTHER` → Luna/Terra) and `question_localization` (`quiz.question_localization`, `CONTENT_GENERATION` → Luna/Terra) both carried the identical `'minimal'` defect and were fixed the same way, in the same commit — never left as a second hidden 400 waiting to reproduce in a different capability. `question_localization_verify`'s own budget (`semantic_verification`) was already `'low'` and needed no change.

---

## PRIMARY/FALLBACK COMPATIBILITY

`SUPPORTED_REASONING_EFFORTS_BY_MODEL` in `model-compatibility.ts` registers Luna and Terra with the **identical** supported set (`REASONING_EFFORT_LEVELS`), verified structurally rather than assumed. This matters concretely: `generatePracticeQuestions`'s chunk retry and `generateGatedQuestionBatch`'s Terra recovery both pass the **same** budget object to both the Luna attempt and the Terra fallback attempt (e.g. `question_generation_chunk`'s `reasoningEffort` is read once and reused for both `model` values in `quiz-generation.service.ts`) — if Luna and Terra had different supported sets, a value valid for one could 400 on the other exactly the way `'minimal'` did for Luna. Required tests 2 and 3 independently exercise the real request builder for both models against the same budget and confirm both requests carry the same, valid value.

---

## OUTBOUND REQUEST CONTRACT

Verified with `fetch` mocked and the real `callOpenAIChat` request builder (no mock of the compatibility layer itself):

- Luna + `question_generation_slot`'s budget → outbound JSON `reasoning_effort: "none"`, never `"minimal"`.
- Terra + the same budget → outbound JSON `reasoning_effort: "none"`, identical to Luna's.
- An unresolvable configuration (an unknown value, or an unregistered model) → `callOpenAIChat` rejects with `code: 'CONFIGURATION_ERROR'` and `fetch` is **never called** — confirmed via `expect(global.fetch).not.toHaveBeenCalled()`.
- A normalized legacy value (`'minimal'`) still reaches the provider as its safe equivalent (`'none'`) and emits the `[ai-model-compat]` log line with the exact required shape (`model`, `parameter: "reasoning_effort"`, `requestedValue`, `effectiveValue`, `reason`).

---

## REGRESSION SAFETY

Part K's standing contract test (`LX-9R9 12`) iterates over every model any `CAPABILITY_ROUTING` entry can route to (excluding `EMBEDDING`) crossed with every `TOKEN_BUDGETS` entry that declares a `reasoningEffort`, and asserts `resolveReasoningEffort` resolves every pair as `UNCHANGED` — not merely "resolvable," but requiring zero silent normalization to be load-bearing in production configuration. This fails the build the moment any of the following happens without an explicit, deliberate update: a model is swapped in `model-routing.ts`, a new budget is added with an incompatible effort, routing changes which model serves a capability, or a fallback model's supported set diverges from its primary's.

One pre-existing test needed updating, not because its invariant changed but because it asserted the literal (buggy) live contract: `tests/unit/lx9r7-provider-error-classification-contract.test.ts`'s outbound-payload test sent `reasoningEffort: 'minimal'` and asserted `reasoning_effort === 'minimal'` in the outbound body — updated to send and assert `'none'`, the corrected value, preserving the test's actual intent (the outbound Chat Completions contract shape) rather than its incidental, now-fixed literal.

---

## TESTS

20 required tests across two new files:

- **`tests/unit/lx9r9-reasoning-effort-compat.test.ts`** (29 tests) — the pure `resolveReasoningEffort` authority, the audit/fix assertions on `TOKEN_BUDGETS`, the PART K provider-capability contract-matrix test, the retry-classification regression, and source-audit regression checks for quick_check/Structured Output/Quality Gate/difficulty calibration/novelty/canonical progression.
- **`tests/unit/lx9r9-r1-outbound-request-contract.test.ts`** (5 tests) — the real outbound HTTP request shape for Luna and Terra (`fetch` mocked, everything else real), and the "no provider call on an unresolvable configuration" proof.

| # | Requirement | Test file |
|---|---|---|
| 1 | quick_check no longer configures unsupported `minimal` | `lx9r9-reasoning-effort-compat.test.ts` §1 |
| 2 | actual Luna request uses a supported value | `lx9r9-r1-...ts` §2 |
| 3 | actual Terra fallback request uses a supported value | §3 |
| 4 | resolve helper is deterministic | `lx9r9-reasoning-effort-compat.test.ts` §4 |
| 5 | supported values pass unchanged | §5 |
| 6 | invalid-but-compatible legacy value normalizes safely | §6 |
| 7 | unsafe/unknown value fails locally | §7 |
| 8 | no provider call for an unresolvable mismatch | `lx9r9-r1-...ts` §8 |
| 9 | `question_generation_slot` stays low-latency oriented | `lx9r9-reasoning-effort-compat.test.ts` §9 |
| 10 | `contextual_help` audited | §10 |
| 11 | `question_localization` audited | §11 |
| 12 | every configured (model, effort) pair validates | §12 |
| 13 | HTTP 400 remains non-retryable | §13 |
| 14 | quick_check exact-6 contract unchanged | §14 |
| 15 | Structured Output unchanged | §15 |
| 16 | quality gate unchanged | §16 |
| 17 | difficulty calibration unchanged | §17 |
| 18 | novelty unchanged | §18 |
| 19 | canonical progression unchanged | §19 |
| 20 | all existing tests green | see below |

**Verification, run on the implementation commit:**

```
npx tsc --noEmit   -> clean, 0 errors
npx vitest run     -> 230 test files, 3875 tests, all passed
npm run build       -> clean production build
```

---

## COMMITS

Implementation: `3f11781` — `fix(lx-9r9): validate reasoning_effort against the actual routed model before every OpenAI call`

This report: separate docs commit, immediately following.

Branch: `tmp/lx1` (git worktree only — never `origin/main`, nothing deployed).

**DO NOT start LX-10.**
