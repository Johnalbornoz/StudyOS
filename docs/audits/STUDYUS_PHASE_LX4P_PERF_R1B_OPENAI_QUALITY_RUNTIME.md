# STUDYUS — LX-4P-PERF-R1 CONTINUATION
## HALF B1 — OPENAI RUNTIME + QUALITY GATE — REPORT & CERTIFICATION

Branch: `tmp/lx1`
Implementation commit: `777ed76`
Builds on: `ccac110` (PERF-R1 doc) / `7a8839c` (PERF-R1 partial).

LX-6 not started. Not deployed. Nothing pushed to `origin/main`.

---

## SCOPE — what this delivery is

Per B1's instruction ("implement everything that can be implemented
safely without provider credentials"): the **OpenAI quality-gated
runtime infrastructure** is built, typed, and unit-tested (30 cases).
The **service rewire** (routing the live `quiz.question_generation` /
teaching-content / localization / grading call sites onto Luna/Terra) is
**NOT in this commit** — see §3 for exactly why and the ready diff.

No live provider execution, no TTFI/quality/cost numbers — no
`OPENAI_API_KEY`, no auth, no deploy. Per B14, no such numbers are
invented.

---

## 1. AI ROUTING — BEFORE

(unchanged in the running code) — see the PERF-R1 report §1:
canonical PRACTICE + explanation + guided practice + grading + hint +
switch-only localization all on `claude-sonnet-5`; chunk / quick_check /
retention on `claude-haiku-4-5-20251001`.

## 2. AI ROUTING — AFTER (declared; not yet consumed by services)

`src/lib/ai/model-routing.ts` — `CAPABILITY_ROUTING` + `resolveModels(capability)`:

| capability | provider | primary | fallback | rationale |
|---|---|---|---|---|
| `QUESTION_GENERATION` | openai | **gpt-5.6-luna** | **gpt-5.6-terra** | high-volume structured generation; Terra on a failed quality gate |
| `CONTENT_GENERATION` | openai | gpt-5.6-luna | gpt-5.6-terra | explanation / worked example / guided practice / localization display text |
| `EXPLANATION_EVALUATION` | openai | **gpt-5.6-terra** | gpt-5.6-terra | semantic verification gates whether content reaches a learner |
| `GRADING` | openai | **gpt-5.6-terra** | gpt-5.6-terra | answer-correctness consequence — not routed to Luna for savings |
| `TRANSFER_EVALUATION` / `COGNITIVE_ANALYSIS` | openai | gpt-5.6-terra | gpt-5.6-terra | evaluation-grade |
| `CLASSIFICATION` / `TUTOR` / `OTHER` | openai | gpt-5.6-luna | gpt-5.6-terra | structured / conversational |
| `EMBEDDING` | openai | text-embedding-3-small | — | unchanged; handled by embedding.service |

Guards: `isAnthropicModel()`; a test asserts no `claude`/`sonnet`/`haiku`
string appears anywhere in the table, and every route's provider is
`openai`.

## 3. SONNET RUNTIME REMOVAL

**Still present — all of it.** The routing table above is not yet
consumed by the feature services. The rewire was implemented, then
**reverted** in this commit because it breaks **37 pre-existing tests**
across 6 files (`quiz-generation-*.test.ts`, `ai-high-risk-regression`,
`cognitive-level-generation`, `question-variant-equivalence`,
`quiz-hint-adaptive-teaching`) that mock `callAnthropicMessages` and
assert `provider: 'anthropic'` / `model: 'claude-sonnet-5'` /
`claude-haiku-4-5-20251001` — several are explicitly named "pinned to
pre-performance-refactor values". Rewriting all 37 requires knowing the
real Luna/Terra response + `usage` payload shapes so the mocks reflect
reality; doing it blind would ship green-but-fictional tests. The rewire
is a **mechanical diff** (swap `provider`/`model` literals to
`resolveModels(...)` + `callAnthropicMessages(...)` → `callModel(...)`
at 6 sites in `quiz-generation.service.ts` + 1 each in
`teaching-content` / `concept-explanation` / `question-localization`);
it must land in a provider-enabled environment alongside the 37 test
updates.

## 4. BEFORE / 5. AFTER CRITICAL PATH

Unchanged from PERF-R1 (`7a8839c`): teach-first path already
parallelised (MODEL waits on 1 AI call, not 3). This half changes the
*provider/model/quality* of those calls, not their ordering. Once the
§3 rewire lands, the MODEL-path call becomes Luna (structured, budgeted)
instead of Sonnet.

## 6. TTFI ARCHITECTURE

Unchanged from PERF-R1. `[perf]` marks T0/T1/T4/T5/T6 in place.
**Numbers: NOT MEASURED.**

## 7. LEARNINGDECISION REUSE (B10)

**Not implemented.** Still 3× `getLearningDecisions` per journey (Concept
Mission / `/continue` / `/teaching-intent`), now parallel not serial.
B10's safe dedup ("`/continue` hands the resolved `TeachingExperience`
to the launch") needs a navigation handoff mechanism that isn't a
pedagogy cache; deferred with a recommended shape (single-use,
concept-matched, freshness-checked `sessionStorage` handoff written by
`ContinuationPanel` immediately before `router.push`, consumed + deleted
by the quiz page).

## 8. TEACHINGINTENT AUTHORITY

Unchanged from PERF-R1 R4: resolvable from `studentId + conceptId +
mode`; `EvidenceMode` from the canonical `evidenceModeForQuizMode`
taxonomy; `SupportLevel` only from the canonical `TeachingIntent`; React
computes nothing.

## 9. MODEL/GUIDE PARALLELISM

Unchanged from PERF-R1 R6: independent effects, MODEL never blocks on
GUIDE, `guidePending` never silently skipped.

## 10. PRACTICE BACKGROUND GENERATION

Unchanged from PERF-R1: `genState` machine + recoverable "Preparing your
practice" / retry.

## 11. OPENAI PROVIDER INTEGRATION (B1/B2)

- `src/lib/ai/adapters/openai.ts::callOpenAIChat` — added **Structured
  Outputs** (`response_format: { type: 'json_schema', json_schema: {
  name, strict: true, schema } }`), `max_completion_tokens`,
  `prompt_cache_key` (B8), `reasoning_effort` (B7). A strict-schema
  `message.refusal` is surfaced as `INVALID_RESPONSE`, never silent
  empty text.
- `src/lib/ai/adapters/call-model.ts::callModel({ provider, model, ... })`
  — one provider-neutral entry point; dispatches OpenAI (structured) vs
  Anthropic (text); returns the raw payload so usage can be read.
- Feature services get `callModel` + `resolveModels`, never a raw
  adapter — enforced by the §3 rewire pattern.

## 12. LUNA STRUCTURED OUTPUT (B2)

Adapter support done (above). A `GeneratedQuestion[]` JSON Schema for
`quiz.question_generation` and per-payload schemas for guided practice /
localization / verdict are **not authored** in this commit — they belong
with the §3 rewire (the schema must match the exact `GeneratedQuestion`
shape the parsers already validate). `generateWithQualityGate` takes a
`jsonSchema` param and passes it straight through.

## 13. QUESTION QUALITY CONTRACT (B3)

`src/lib/lx/question-quality-contract.ts::checkQuestionQualityDeterministic(q, req)`
→ `{ status, failures[], numericallyVerified, needsSemantic[] }`.

Deterministic checks: required fields; `ANSWER_FORMAT_BY_TYPE`
compatibility; `conceptId` match; `KNOWN_COGNITIVE_LEVELS` /
`KNOWN_EXPECTED_REASONING_TYPES` enum validity; `difficulty` ∈ [1,5]
integer; `correctAnswer` present + format-compatible; option ids unique
& non-empty; option text non-empty & non-duplicate; `single_choice` →
exactly one valid correct id; `multi_choice` → all correct ids valid;
narrow numeric recompute; line/bar visual validation.

`status`:
- `FAIL` — a hard defect.
- `NOT_DETERMINISTICALLY_VERIFIED` — no hard defect, but a correctness
  claim (free-text answer, distractor plausibility, non-recomputable
  numeric, raw SVG) still needs judgment → semantic verifier. **Never
  PASS by invention.**
- `PASS` — sound AND every checkable claim recomputed.

## 14. DETERMINISTIC VALIDATORS (B4/B10-of-the-spec)

**VALIDATED DETERMINISTICALLY** (in `checkQuestionQualityDeterministic`):
schema, required fields, answer-format compatibility, enum membership
(cognitiveLevel / expectedReasoningType), difficulty range, option-id
uniqueness / non-empty / non-duplicate text, single-choice exactly-one,
multi-choice id validity, line/bar chart `labels.length ===
values.length` + finite values + supported chart type, and a **narrow
numeric recompute**: a stem containing `A <op> B` (`+ - * / × ÷`) with a
numeric `correctAnswer` is recomputed and compared (rel-tol 1e-4).

**SEMANTICALLY VALIDATED** (not deterministic — routed to the verifier):
concept fit beyond id equality, free-text answer correctness, distractor
plausibility, ambiguity/contradiction in prose, any numeric answer
outside `A op B`, generated SVG semantics, scenario/reasoning
appropriateness.

No CAS. Support is claimed only for the explicit subset above.

## 15. TERRA FALLBACK (B5/B6)

`src/lib/ai/quality-runtime.ts::generateWithQualityGate<T>(spec)`:

```
Luna (route.primary)
  -> executeAI(callModel structured, strict schema) -> spec.parse
  -> spec.deterministicGate  (fail & non-retryable? escalate)
  -> spec.semanticVerify?    (fail? escalate)
  -> ACCEPT { routing: { model: LUNA, fallbackUsed: false, qualityGateResult: 'PASS' } }
ANY failure ->
Terra (route.fallback), ONCE
  -> same pipeline
  -> ACCEPT { model: TERRA, fallbackUsed: true, fallbackReason }
     | REJECT { fallbackUsed: true, fallbackReason, qualityGateResult: 'REJECTED' }
```

- **Never a 3rd attempt.** **Never a Claude/Anthropic fallback** — the
  routing map only names `openai`; a missing key surfaces as
  `fallbackReason: 'PROVIDER_UNCONFIGURED'` (B24), asserted by test, and
  `callOpenAIChat` throws `CONFIGURATION_ERROR` (not a silent
  fallthrough), asserted by test.
- `fallbackReason` values observed: `PROVIDER_UNCONFIGURED`,
  `SCHEMA_INVALID`, the deterministic gate's own `reason`, the semantic
  verifier's `reason`, `SEMANTIC_VERIFY_ERROR: …`.
- Every attempt emits an `[ai-runtime]` event (§24).

Tests: Luna-passes → no fallback, one call; Luna-gate-fail → one Terra
attempt, `fallbackReason` recorded; Terra-also-fails → `REJECTED`, two
calls, no third; semantic-fail → escalate then fail closed.

## 16. SONNET QUALITY BASELINE (B12)

**Not established** — needs provider calls. `src/services/quality-benchmark.ts`
provides the runner; `BASELINE_SOURCE_NOTE` documents seeding it from
**anonymized `quiz_sessions.questions`** (historical Sonnet output) so no
fresh Sonnet spend is required.

## 17. QUALITY COMPARISON (B13)

**Not run.** `runQualityBenchmark({ corpus, arms, generate, score })` —
pure orchestration over `BASELINE | LUNA_FIRST_PASS | LUNA_TERRA_PIPELINE`,
computing per-arm accepted count, fallback rate, latency p50/p95/max,
input/output token p50/p95/total, total est. cost (+ `complete` flag),
and quality means (correctness, concept alignment, ambiguity, schema-
valid rate, reasoning-type / cognitive-level valid rate, distractor
quality, visual-valid rate). `generate`/`score` injected → deterministic
with stubs, live with a provider. Subjective dimensions carry a `judge`
field (B13: "do not auto-score subjective dimensions without documenting
the judge").

## 18. VISUAL QUESTION CONTRACT (B11)

Audited: current `visualAid` = `{ kind: 'diagram'|'chart', svg?,
chartData?: { chartType: 'line'|'bar', labels, values, xLabel?, yLabel? },
caption? }`, rendered by `MiniChart` (line/bar) + inline SVG.
**Strengthened, not expanded** — the deterministic gate now rejects:
unsupported `kind`, unsupported `chartType`, `labels.length !==
values.length`, non-finite chart values; and flags a raw generated
`svg` (no `chartData`) as needing semantic review. `FORCE_DIAGRAM` /
`FUNCTION_GRAPH` / `GEOMETRY_DIAGRAM` / `CIRCUIT_DIAGRAM` etc. are **not**
introduced — no deterministic renderer/validator exists for them.

## 19. RAG REUSE (B9)

**Not implemented.** `retrieveContext(conceptId)` still runs per producer
(DB fast-path, one query each). `fitContextChunks(chunks, maxChars)`
(bounded, deterministic, never below one chunk) is provided for the
truncation half of B9; the shared `LearningContextPackage` threaded
across the three parallel producers is deferred (invasive plumbing
across separate endpoints).

## 20. PROMPT / TOKEN OPTIMIZATION (B7/B8)

- **B7 budgets:** `TOKEN_BUDGETS` — `question_generation_practice`
  4200 / `_chunk` 5100 / `_slot` 2400; `concept_explanation` 2200;
  `guided_practice` 1600; `contextual_help` **700** (short);
  `question_localization` 2000; `semantic_verification` **900**
  (verdict only, `maxContextChars: 0`). `budgetFor(key)` +
  `reasoningEffort` hint (minimal/low). Wired into the runtime; the
  service call sites pick these up with the §3 rewire.
- **B8 caching readiness:** `callOpenAIChat` accepts `prompt_cache_key`;
  `GatedGenerationSpec` separates `systemPrompt` (stable: rules + schema
  + quality rules, ordered first) from `buildUserMessage()` (dynamic:
  concept / context / state) and carries an optional `promptCacheKey`.
  **Cache hit rate: NOT MEASURED** (no provider). No hit-rate claimed.

## 21. COST COMPARISON (B12/B23)

`estimateCostUSD({ model, inputTokens, cachedInputTokens, outputTokens })`
= ACTUAL usage (`parseProviderUsage`) × the **configured** `MODEL_PRICING`
table, returning `{ usd, complete, note }`. The table ships at `$0` for
every model with a note to configure it, so `complete` is `false` and no
figure is asserted. **All B23 KPIs: NOT MEASURED.**

## 22. ACTIVITY LANGUAGE REGRESSION (B16)

Preserved from PERF-R1 R20: the entire active learning surface
(MODEL/GUIDE/PRACTICE chrome + content) follows the activity/question
language; global shell → `interface_language`. Same-item localization +
semantic fidelity unchanged. (Tests green.)

## 23. EVIDENCE / MASTERY REGRESSION (B17)

**None.** No service behaviour changed in this commit. No grading /
evidence / mastery-policy / EvidenceMode / Response-Contract / retention
/ transfer change. Knowledge State / LearningState / LearningDecision /
TeachingIntent authority untouched. Full suite green.

## 24. OBSERVABILITY (B12)

`AIRuntimeEvent` (`src/lib/ai/runtime-event.ts`), logged as
`[ai-runtime]` alongside `executeAI`'s existing `[ai]` line, carries:
`capability, provider, model, promptId, promptVersion, reasoningEffort,
inputTokens, cachedInputTokens, outputTokens, latencyMs, fallbackUsed,
fallbackReason, qualityGateResult, estimatedCostUSD, costComplete`. Token
counts are the parsed provider values or `null` — never fabricated. No
learner content is logged. Emitted per attempt inside
`generateWithQualityGate`.

## 25. TESTS (B-list, at least)

```
npx tsc --noEmit    clean
npx vitest run      183 files / 2702 passed
                    (+ tests/unit/lx4p-perf-r1b-openai-runtime.test.ts, 30:
                     B1 routing (all openai, Luna/Terra split, no claude id) ·
                     B7 budgets + fitContextChunks · B12 usage parsing (OpenAI +
                     Anthropic + empty) + cost estimate ($0 table -> not
                     complete; configured price -> real number) ·
                     B3/B4/B11 deterministic quality gate (missing field,
                     format mismatch, bad enums, difficulty range, concept
                     mismatch, single-choice exactly-one, duplicate option,
                     numeric MATCH/MISMATCH, unsupported visual, chart
                     inconsistency) · B12 runtime event carries cost ·
                     B5/B6 fail-closed pipeline (Luna pass / Luna-fail->Terra /
                     both-fail REJECTED / no 3rd attempt / semantic escalation) ·
                     B24 no anthropic path + callOpenAIChat throws
                     CONFIGURATION_ERROR + runtime imports no anthropic adapter)
npm run build       ✓ compiled; 96/96 static pages
```

Spec test items **1, 4, 5, 6, 7, 8, 9, 20, 21, 23, 25** are covered by
the new file. Items **2, 3, 10–19, 22, 24** require the §3 service
rewire and/or a live provider and are **not** covered here.

## 26. LIVE PROVIDER BENCHMARK

**NOT RUN — credentials unavailable.** Harness (`quality-benchmark.ts`)
is deterministic with stubs and ready to execute against a provider.

## 27. FILES CHANGED

**New**
- `src/lib/ai/model-routing.ts`
- `src/lib/ai/adapters/call-model.ts`
- `src/lib/ai/token-budgets.ts`
- `src/lib/ai/usage.ts`
- `src/lib/ai/pricing.ts`
- `src/lib/ai/runtime-event.ts`
- `src/lib/ai/quality-runtime.ts`
- `src/lib/lx/question-quality-contract.ts`
- `src/services/quality-benchmark.ts`
- `tests/unit/lx4p-perf-r1b-openai-runtime.test.ts`

**Modified**
- `src/lib/ai/adapters/openai.ts` — Structured Outputs +
  `max_completion_tokens` + `prompt_cache_key` + `reasoning_effort` +
  refusal handling.
- `src/lib/ai/index.ts` — barrel exports for the new modules.

No migration. No service behaviour change.

## 28. REPAIR COMMIT

`777ed76` — `feat(ai): LX-4P-PERF-R1B (infra) -- OpenAI quality-gated
runtime modules`.

---

# LX-4P-PERF-R1B — OPENAI QUALITY RUNTIME CODE CERTIFICATION

## STATUS

**FAIL** — substantial architecture remains unimplemented in the running
code (the service rewire; the OpenAI schemas; RAG/decision dedup; and
every measurement). The infrastructure is built and tested; it is not
yet on the learner's path. Per B14, a `FAIL` (not `PASS_WITH_CONDITIONS`)
because the remaining work is more than "live measurement only".

## VERIFIED MODEL IDS

`gpt-5.6-luna`, `gpt-5.6-terra` — encoded in `CAPABILITY_ROUTING`
(`LUNA` / `TERRA` constants).

## OPENAI PROVIDER ROUTING

`resolveModels(capability)` → `{ provider: 'openai', primary, fallback,
rationale }`. Generation/content → Luna→Terra; evaluation/grading →
Terra. No `claude` id anywhere (tested). **Declared, not yet consumed by
the feature services.**

## SONNET CANONICAL RUNTIME

**PRESENT — all of it.** No service call site moved off Sonnet/Haiku in
the running code (§3). Exceptions target: NONE — not achieved.

## LUNA PRIMARY CAPABILITIES

`QUESTION_GENERATION`, `CONTENT_GENERATION`, `CLASSIFICATION`, `TUTOR`,
`OTHER` — in the routing map. Not wired to services.

## TERRA FALLBACK CAPABILITIES

All of the above (fallback slot) + `EXPLANATION_EVALUATION`, `GRADING`,
`TRANSFER_EVALUATION`, `COGNITIVE_ANALYSIS` (primary). Not wired.

## STRUCTURED OUTPUTS

Implemented in the OpenAI adapter + `callModel` + `generateWithQualityGate`
(`jsonSchema` passthrough, `strict: true`, refusal → `INVALID_RESPONSE`).
Per-payload JSON Schemas **not authored** (belong with the rewire).

## QUESTION QUALITY GATE

`checkQuestionQualityDeterministic` — deterministic; `PASS` / `FAIL` /
`NOT_DETERMINISTICALLY_VERIFIED`; never PASS by invention. Not yet
invoked from generation.

## DETERMINISTIC VALIDATION

The explicit subset in §14 — schema/enum/format/range/option/visual +
narrow `A op B` numeric recompute. No CAS.

## SEMANTIC VALIDATION

`generateWithQualityGate.semanticVerify?` hook — invoked after the
deterministic gate where judgment is required; a failure escalates to
Terra then fails closed. No verifier prompt authored for question
generation yet (the existing `quiz.question_localization_verify` is the
pattern).

## FAIL-CLOSED BEHAVIOR

`generateWithQualityGate` — Luna → gate(s) → ACCEPT, else ONE Terra →
gate(s) → ACCEPT/REJECT. Never a 3rd attempt, never Anthropic. `REJECTED`
carries the composed `fallbackReason`. Tested.

## QUESTION VISUAL CONTRACT

Existing line/bar + inline SVG; deterministic gate rejects unsupported
kind/chartType, label/value mismatch, non-finite values; flags raw SVG
for semantic review. No new renderers.

## TOKEN BUDGETS

`TOKEN_BUDGETS` per purpose (§20); `contextual_help` 700,
`semantic_verification` 900 verdict-only. Applied by the runtime; picked
up by services with the rewire.

## RAG REDUCTION

`fitContextChunks` bounded truncation provided. Shared context package
across producers **not implemented**.

## DECISION CALL COUNT

3× per journey (parallel, not serial). B10 dedup **not implemented**.

## OBSERVABILITY

`AIRuntimeEvent` / `[ai-runtime]` with usage + fallbackReason +
qualityGateResult + configured-price cost estimate. Token counts are
actual-or-null.

## PARALLEL TTFI ARCHITECTURE

Preserved from PERF-R1 `7a8839c` (MODEL not blocked by questions or
GUIDE; recoverable background-generation failure). Not regressed.

## LANGUAGE INTEGRITY

**GLOBAL APP → `interface_language`**;
**ACTIVE LEARNING EXPERIENCE → activity/question language** (chrome +
content). Preserved. Same-item localization intact.

## EVIDENCE INTEGRITY

Unchanged — no service behaviour touched. Full prior suites green.

## TESTS

tsc clean · vitest 183 files / 2702 passed
(`lx4p-perf-r1b-openai-runtime.test.ts` 30) · build 96/96.

## LIVE PROVIDER BENCHMARK

NOT RUN — credentials unavailable.

## REMAINING CONDITION

Items that genuinely require real provider / authenticated runtime:
1. **Service rewire** (§3) + the 37 provider-pinned test updates —
   needs real Luna/Terra response + `usage` shapes to mock correctly.
2. Per-payload OpenAI **JSON Schemas** for `quiz.question_generation`,
   guided practice, localization, and a question-generation semantic
   verifier prompt.
3. **B10** decision-snapshot reuse from `/continue`; **B9**
   `LearningContextPackage` shared across producers.
4. **Sonnet quality baseline** (from anonymized `quiz_sessions.questions`)
   + Sonnet vs Luna vs Luna+Terra comparison; **accepted quality ≥
   baseline** (B12/B13).
5. **Prompt-cache hit rate**, **token/cost KPIs** (B8/B23) — real usage.
6. **Live benchmark**: ≥10 teach-first + ≥10 direct-Practice launches,
   per-run TTFI/tokens/cost + p50/p95/max; production TTFI vs
   p50 < 5 s / p95 ≤ 7 s (B24).
7. Full 36-case regression matrix against a real provider + browser.

## IMPLEMENTATION COMMIT

`777ed76` (infra) — on `tmp/lx1` after `7a8839c` (PERF-R1 partial).

## NEXT STEP

Code is **not** complete (more than live measurement remains). In a
provider-enabled environment:
1. Land the service rewire + JSON schemas + verifier prompts, and
   rewrite the 37 provider-pinned tests against real Luna/Terra shapes.
2. Configure `MODEL_PRICING`; run the offline Sonnet-baseline +
   comparison; confirm accepted quality ≥ baseline.
3. Deploy to **preview** with `OPENAI_API_KEY`; run the live benchmark
   (§26) and the authenticated regression matrix; verify production TTFI.

Do NOT start LX-6 until: production TTFI verified; accepted-question
quality ≥ Sonnet baseline; cost/token measurements available; evidence
and language regressions pass on a real provider.

STOP.
