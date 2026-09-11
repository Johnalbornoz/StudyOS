# STUDYUS — LX-4P-PERF OBSERVABILITY REPAIR

## PERF-R1G — USAGE & COST TELEMETRY

Continued on `tmp/lx1`. Builds on `30f87b2` (PERF-R1F — Structured Question
Response Compatibility, LIVE VERIFIED). Implementation commit: `f2130ae`.

### ROOT CAUSE

The provider usage pipeline was **not broken** — it was **never wired up**
for question generation. Since R1B, StudyUS already had:

- `parseProviderUsage(provider, raw)` (`src/lib/ai/usage.ts`) — correctly
  extracts `prompt_tokens` / `completion_tokens` /
  `prompt_tokens_details.cached_tokens` from an OpenAI raw response.
- `estimateCostUSD(...)` (`src/lib/ai/pricing.ts`) — correctly prices
  usage against `MODEL_PRICING`.
- `buildRuntimeEvent(...)` (`src/lib/ai/runtime-event.ts`) — correctly
  turns usage into an `[ai-runtime]` event.

But **nothing ever called `parseProviderUsage` at the one place the raw
response was actually available**: inside `executeAI`'s `call`/`validate`
closures, or the `validate` closures of `generateQuestionsForConcept` and
`verifyQuestionQuality`. Those functions returned only their **domain**
result (`GeneratedQuestion[]` / `QuestionQualityVerdict | null`) — the raw
response (and its `usage` object) was read for structural diagnostics
(`[ai-structure]`, R1F) and then discarded. `gated-question-generation.
service.ts`'s `emitGateEvent` then had no usage to pass to
`buildRuntimeEvent` and hardcoded `inputTokens: null, cachedInputTokens:
null, outputTokens: null` — exactly matching the live QA evidence
(`hasUsage: true` upstream, `inputTokens: null` downstream).

**Exact boundary where usage was lost:** the return statement of
`generateQuestionsForConcept`/`verifyQuestionQuality` — `raw` (and its
`.usage`) never survived past `validate()`.

### PROVIDER USAGE SHAPE

Traced end to end, input/output type at each boundary:

| Boundary | Input | Output |
|---|---|---|
| OpenAI HTTP response | — | `{choices:[{message,finish_reason}], usage:{prompt_tokens, completion_tokens, prompt_tokens_details:{cached_tokens}}}` |
| `callOpenAIChat` (adapter) | `OpenAIChatParams` | `OpenAIChatResult{text, raw}` — `raw` is the untouched provider JSON |
| `callModel` | `CallModelParams` | `CallModelResult{text, raw, provider, model}` — provider-neutral envelope |
| `executeAI`'s `call` | `AbortSignal` | `TRaw` (here, `CallModelResult`) |
| `executeAI`'s (new) `parseUsage` | `TRaw` | `ProviderUsage{inputTokens, cachedInputTokens, outputTokens}` |
| `executeAI`'s `validate` | `TRaw` | `AIValidationResult<TResult>` (domain result) — **usage was never threaded through here; it no longer needs to be** |
| `executeAI` return | — | `AIExecutionOutcome<TResult>{result, execution, provenance}` — `execution` now carries usage/cost (R1G) |
| `generateQuestionsForConcept` (new `onUsage`) | `execution.{input,cached,output}Tokens` | calls `options.onUsage?.(usage)` before returning `GeneratedQuestion[]` |
| `verifyQuestionQuality` (new `onUsage`) | `execution.{input,cached,output}Tokens` (success) or `err.execution.*` (`AIExecutionFailure`) | calls `input.onUsage?.(usage, model)` before returning `QuestionQualityVerdict \| null` |
| `applyQuestionQualityGate` | each `verifyQuestionQuality` call's `onUsage` | `{accepted, deterministicRejected, semanticRejected, semanticCalls: BillableCallUsage[]}` |
| `gateUnitWithTerraFallback` (optional `telemetry`) | `GateUnitTelemetry{lunaGenerationCalls, terraGenerationCalls, operationId}` + gate's `semanticCalls` | `[ai-runtime]` event(s) via `emitAggregateGateEvent`/`buildAggregateRuntimeEvent` |

### NORMALIZED USAGE CONTRACT

Reused the **existing** R1B contract as-is — no new shape introduced:

```ts
interface ProviderUsage {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
}
```

`parseProviderUsage` was already correct and untouched. Never infers,
never calculates from text, never fabricates a zero — absent fields stay
`null` (Tests 2, 3, R2 suite).

### EXECUTION TELEMETRY

`AIExecutionMetadata` (`src/lib/ai/types.ts`) gained 5 optional fields:
`inputTokens`, `cachedInputTokens`, `outputTokens`, `estimatedCostUSD`,
`costComplete`. `executeAI` (`src/lib/ai/gateway.ts`) gained an optional
`parseUsage?: (raw: TRaw) => ProviderUsage` hook on `ExecuteAIOptions`,
invoked **exactly once**, immediately after `call` resolves and **before**
`validate` runs. The extracted `usage`/`cost` are captured in closure
variables read by `finish()` on **every** exit path — success, a thrown
`validate`, or a rejected `validation.valid` — so a StudyUS-side rejection
can never erase usage the provider already returned (Tests 1, 4, 5, 6, 8).
`parseUsage` itself is wrapped in try/catch: a buggy extractor degrades to
`null` usage, never crashes the real operation.

`[ai]` (`logAIExecution`) and `[ai-runtime]` (`recordRuntimeEvent`) keep
their pre-existing, distinct ownership, now made explicit:
- **`[ai]`** = one line per **provider execution** (every `executeAI`
  call), including its own usage/cost when `parseUsage` was supplied.
- **`[ai-runtime]`** = one line per **question-generation attempt**
  (Luna's attempt, and Terra's fallback attempt if any), aggregating
  every `[ai]`-level call that attempt made.

Provider refusal (R3's "if usage exists" case): `callOpenAIChat` today
throws synchronously on `choice.refusal` **before** returning `raw` at
all, so the live OpenAI adapter path has no raw response for `parseUsage`
to read on a refusal — fixing that means changing the adapter's refusal
control flow, which risks the R1F-certified refusal contract/tests
(explicitly out of scope, R16). This is a **documented scope exception**:
the gateway layer itself has no such gap (proven by test 7, which feeds a
refusal-shaped raw response straight to `executeAI` and confirms its
usage survives), but a live OpenAI refusal today still logs `usage: null`
until the adapter is separately revisited.

### QUESTION OPERATION AGGREGATION

`generateGatedQuestionBatch`/`generateGatedPracticeBatch` (the path
matching the live QA evidence exactly — canonical ≤4 Practice, cumulative,
exam) now:

1. Generates one `operationId = randomUUID()` per operation.
2. Passes an `onUsage` callback into its Luna `generateQuestionsForConcept`
   call, collecting the result into `lunaGenerationCalls`.
3. Passes a **different** `onUsage` into the Terra regeneration closure
   (only invoked if a fallback actually fires), collecting into
   `terraGenerationCalls`.
4. Passes `{lunaGenerationCalls, terraGenerationCalls, operationId}` as
   `gateUnitWithTerraFallback`'s new optional 4th parameter.

`gateUnitWithTerraFallback`, when given `telemetry`, emits an
**operation-level** `[ai-runtime]` event via the new
`buildAggregateRuntimeEvent`/`emitAggregateGateEvent`, aggregating
`totalInputTokens`/`totalCachedInputTokens`/`totalOutputTokens`/
`estimatedCostUSD`/`costComplete` across every real call that attempt
made — while **preserving** `acceptedCount`/`rejectedCount`/
`fallbackUsed`/`qualityGateResult` exactly as before (Tests 7, 20).

### SEMANTIC VERIFICATION ACCOUNTING

`verifyQuestionQuality` gained an optional `onUsage?: (usage, model) =>
void` — invoked on **every** outcome: an accepted verdict, a rejected/
malformed verdict (`AIExecutionFailure`, caught internally, still fires
`onUsage` from `err.execution`), or a validation-failure return of `null`.
`applyQuestionQualityGate` collects one entry per `needsSemantic` question
into a new `semanticCalls: BillableCallUsage[]` field on its return —
**exactly one entry per Terra call**, proven by Test 15 (two questions
needing semantic verification → `semanticCalls.length === 2`). These are
folded into whichever attempt's aggregate event ran them (Luna's own
`semanticCalls` into the Luna event; Terra's own into the Terra event) —
they are never treated as "free" because they're "part of the gate"
(R9; Tests 14, 16).

### FALLBACK ACCOUNTING

When Luna's gated output is empty/short and Terra regenerates, **two**
separate `[ai-runtime]` events are still emitted (preserving the
pre-existing, test-certified cardinality asserted by
`tests/unit/lx4p-perf-r1c-r1-gate-primitives.test.ts`'s
`expect(h.record).toHaveBeenCalledTimes(2)`), but now:

- Both events share the same `operationId`.
- The Luna event carries Luna's **own** real usage/cost (generation +
  its own semantic verifications) — **never zeroed out** just because
  Terra was ultimately needed (Test 17/18: `lunaEvent.inputTokens` stays
  the real value Luna consumed).
- The Terra event carries Terra's own real usage/cost (generation + its
  own semantic verifications), tagged `fallbackUsed: true`.
- No call ever appears in both events (Test 22: Luna's and Terra's token
  counts are disjoint, never summed into each other).

A reader who wants the operation's single true total sums the two
`operationId`-correlated events (R7/R8) — a design decision made
explicitly to avoid breaking the certified 2-event cardinality while
still satisfying R7's "truthful aggregate" and R10's "aggregate BOTH
attempts" without ever double-counting a provider call (R7's explicit
"do not count a provider execution twice").

### CACHE ACCOUNTING

`aggregateCost` (new `src/lib/ai/usage-aggregation.ts`) computes
`cacheHitRatio = totalCachedInputTokens / totalInputTokens`, only when
`totalInputTokens > 0` and both totals are known — never inferred from
latency (R11). Exposed on `AIRuntimeEvent.cacheHitRatio` via the new
`buildAggregateRuntimeEvent`. `buildRuntimeEvent` (single-call, unchanged)
does not compute a ratio — cache observability is an aggregate-event
feature, matching where it's actually useful (comparing Luna's own
cache-hit behavior across an operation).

### COST CALCULATION

Centralized entirely through the **existing** R1B `estimateCostUSD` /
`MODEL_PRICING` — no ad hoc prices added anywhere, including
`quiz-generation.service.ts` (R5). `aggregateCost` prices **each call
against its own model** (`estimateCostUSD({model: call.model, ...})`) and
sums the resulting **dollar amounts** — it never blends Luna's and
Terra's very different per-token rates into one combined token count
before pricing (Test 16 asserts the aggregate equals the sum of each
call's independently-computed cost). Added one guard to
`estimateCostUSD` itself: `cachedInputTokens > inputTokens` now returns
`{usd: null, complete: false}` instead of silently computing a negative
"fresh input" figure (R5's explicit invariant; Test 13).

### costComplete SEMANTICS

Unchanged single-call semantics (`estimateCostUSD`): `complete: true`
only when the model has non-zero configured pricing **and** both
`inputTokens`/`outputTokens` are known (Tests 9, 10, 11). Aggregate
semantics (`aggregateCost.costComplete`): `true` **only** when **every**
constituent call's own cost was itself complete — one call with unknown
usage or unpriced model makes the whole aggregate `costComplete: false`,
never a partial number silently presented as whole (Test 16's positive
case, Test 21's negative case). Unknown cost is never `$0` — it is
`usd: null` (Test 8, 11).

### PRIVACY

No new logging surface was added beyond the 5 numeric/boolean fields on
`AIExecutionMetadata`/`AIRuntimeEvent` (token counts, dollar estimate,
`costComplete` boolean, `operationId`/`billableCalls` counters). No
question text, answer, explanation, prompt, or RAG content is read,
stored, or forwarded by any of the new code
(`usage-aggregation.ts`/`runtime-event.ts` never import `GeneratedQuestion`
or reference `.explanation`/`.correctAnswer`/`.question`). Source-contract
tests (R14, Test 23) assert this both structurally (the emitted event
object's keys) and via static source inspection (grep for forbidden
field references in the two new/modified files) and via a live
`logAIExecution` call whose serialized output is checked for forbidden
substrings.

DB persistence (`postgresAIExecutionAuditSink`'s existing but unused
`metadata` column) was **deliberately not touched** — this repair is
scoped to console telemetry (`[ai]`/`[ai-runtime]`) only, per R12's
"Telemetry only... no dashboard needed."

### PERFORMANCE IMPACT

Zero new AI calls (R15) — `parseUsage`/`onUsage`/`aggregateCost` are all
pure, synchronous, local computations over data already in memory from
calls that were happening anyway. No new synchronous work was added to
MODEL/GUIDE (neither path touches question generation). `randomUUID()`
for `operationId` is the same primitive `executeAI` already calls once
per execution — negligible. Build (`npm run build`) succeeded with no
new warnings attributable to this change.

### TESTS

New file: `tests/unit/lx4p-perf-r1g-usage-cost-telemetry.test.ts` — 30
tests covering all 28 numbered requirements (two are split into an `a`/`b`
pair for clarity: 14→14/14b, 23→23a/23b/23c). Existing
`tests/unit/lx4p-perf-r1c-gated-practice.test.ts` updated only to add
`buildAggregateRuntimeEvent` to its `@/lib/ai/runtime-event` mock (the
canonical Practice path now always routes through the aggregate event
builder) — no assertion on generator call counts or Terra-fallback
behavior was weakened or removed.

Tests 25–28 (R1F strict-response / R1E MODEL-GUIDE-independence /
evidence-mastery / activity-language contracts) are satisfied by the
**full existing suite remaining green** — none of those files were
touched by this phase:

```
npx tsc --noEmit        # clean, 0 errors
npx vitest run          # 194 files, 2898 tests, all passed
npm run build           # succeeded, Turbopack production build
```

(2898 = 2868 pre-existing + 30 new; 193 pre-existing test files stayed
byte-for-byte in outcome, 1 file received the mock addition above.)

### COMMIT

`f2130ae` — `fix(lx): LX-4P-PERF-R1G -- OpenAI usage & cost telemetry propagation`

---

## PERF-R1G — USAGE / COST OBSERVABILITY

**STATUS: PASS**

A live-compatible gated question-generation operation (Luna generation →
deterministic gate → parallel Terra semantic verification(s) → optional
Terra generation fallback) retains real provider usage through every
stage — provider response → adapter → gateway → generator → semantic
Quality Gate → optional fallback → runtime summary — without fabricating
any missing figure (absent usage/cost always resolves to `null`/
`costComplete: false`, never a guessed number or a fake `$0`) and without
double-counting any provider call (each `[ai-runtime]` event sums only
the calls its own attempt made; Luna's and Terra's token counts are
proven disjoint by Test 22).

Two explicit, honestly-documented scope boundaries remain (not required
by this phase's own R16 "do not change R1F", and each independently
verified not to regress anything certified):

1. A live OpenAI **refusal** still logs `usage: null`, because
   `callOpenAIChat` throws before returning `raw` on `choice.refusal` —
   fixing this requires adapter-level changes this phase intentionally
   did not make, to avoid touching the R1F-certified refusal contract.
2. Full aggregate-usage wiring (`onUsage`/`operationId`/aggregate events)
   covers `generateGatedQuestionBatch`/`generateGatedPracticeBatch` only
   — the >4 practice-chunk path, `quick_check`'s fast path, and
   retention's gate call all continue to emit the pre-existing
   hardcoded-null `[ai-runtime]` event (via the unchanged `emitGateEvent`/
   `buildRuntimeEvent`, reached whenever `telemetry` is omitted), matching
   this phase's live QA evidence exactly and leaving those paths'
   behavior byte-for-byte unchanged.

Do NOT claim live success yet — this is a code-level PASS backed by unit
tests and a clean build, not a live QA run.

---

## NEXT STEP IF CODE PASS

Push PERF-R1G to `preview/openai-perf`, then run ONE canonical Practice
generation in QA. Expect the final `[ai-runtime]` event's
`inputTokens`/`cachedInputTokens`/`outputTokens`/`estimatedCostUSD` to
change from `null` to real provider-reported values (`costComplete: true`
if Luna's pricing and all returned token fields are present), and the
successful operation's cost to include Luna generation + both Terra
semantic-verification calls, without a Terra generation fallback unless
one is genuinely triggered by the gate.

Do NOT push to main. Do NOT start LX-6.
