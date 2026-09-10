# STUDYUS — LX-4P-PERF-R1 CONTINUATION
## PERF-R1C — COMPLETE THE OPENAI RUNTIME REWIRE — REPORT & CERTIFICATION

Branch: `tmp/lx1`
Implementation commit: `c72736a`
Builds on: `9b74347` (R1B doc) / `777ed76` (R1B infra) / `ccac110` (PERF-R1 doc) / `7a8839c` (PERF-R1 partial).

LX-6 not started. Not deployed. Nothing pushed to `origin/main`.
No `OPENAI_API_KEY`, no authenticated Clerk session, no Vercel deploy in
this environment — no live quality / TTFI / token / cost numbers are
stated or invented (C21).

---

## 0. HEADLINE

R1B built the OpenAI quality-gated **infrastructure** but left the feature
services still calling `callAnthropicMessages` / hard-coded `claude-*`
ids, so 37 tests were provider-pinned and the phase certified FAIL.

R1C **consumes** that infrastructure from the real services. After this
commit the canonical learner runtime carries **no Claude model id and no
Anthropic adapter import**; the ~3-question Practice path runs the
Luna-first Quality Gate; teaching content + hints route to Luna;
grading / semantic verification / transfer & cognitive evaluation route
to Terra; the `Continue → teaching launch` handoff computes the canonical
decision **once**. `tsc` is clean, **186 test files / 2746 tests pass**,
`next build` compiles.

The only work that now remains is measurement that physically requires a
provider key or a browser (C21's explicit list). Certification therefore
moves FAIL → **PASS_WITH_CONDITIONS**.

---

## 1. AI ROUTING — BEFORE (running code at `9b74347`)

| call site | model (before) |
|---|---|
| canonical PRACTICE (`generatePracticeQuestions`, count ≤ 4) | `claude-sonnet-5` via legacy `generateQuestionsForConcept` batch |
| PRACTICE / review chunks (count > 4) | `claude-haiku-4-5-20251001` |
| `quick_check` 6-slot fast path | `claude-haiku-4-5-20251001` |
| `retention_check` chunks | `claude-haiku-4-5-20251001` |
| concept explanation (MODEL) | `claude-sonnet-5` |
| guided practice (GUIDE) | `claude-sonnet-5` |
| contextual help / hint | `claude-sonnet-5` |
| free-text grading | `claude-sonnet-5` |
| question localization (display text) | `claude-sonnet-5` |
| localization semantic verify | `claude-sonnet-5` |
| transfer generation / evaluation | `claude-sonnet-5` |
| explain-defend prompt / rubric eval | `claude-sonnet-5` |
| error-intelligence guidance | `claude-sonnet-5` |
| misconception classification | `claude-sonnet-5` |

Transport in every case: `callAnthropicMessages({ messages: [...] })`.

## 2. AI ROUTING — AFTER (running code at `c72736a`)

Every site resolves through `resolveModels(capability)`
(`src/lib/ai/model-routing.ts`) and transports through
`callModel({ provider, model, user, … })`
(`src/lib/ai/adapters/call-model.ts`).

| capability (registry) | route | primary | fallback |
|---|---|---|---|
| `QUESTION_GENERATION` | generation | **gpt-5.6-luna** | **gpt-5.6-terra** |
| `CONTENT_GENERATION` (explanation, guided practice, localization text) | generation | **gpt-5.6-luna** | gpt-5.6-terra |
| `OTHER` (hint) | default | **gpt-5.6-luna** | gpt-5.6-terra |
| `GRADING` (free-text grading) | evaluation | **gpt-5.6-terra** | gpt-5.6-terra |
| `EXPLANATION_EVALUATION` (localization equivalence, question-quality verdict, explain rubric) | evaluation | **gpt-5.6-terra** | gpt-5.6-terra |
| `TRANSFER_EVALUATION` | evaluation | **gpt-5.6-terra** | gpt-5.6-terra |
| `COGNITIVE_ANALYSIS` (misconception) | evaluation | **gpt-5.6-terra** | gpt-5.6-terra |

No entry is `anthropic`. `resolveModels` has no Claude branch.
`isAnthropicModel()` is used only by guards/tests to *prove the absence*.

---

## 3. REQUIREMENT-BY-REQUIREMENT

### C1 — rewire the actual services — **DONE**
`quiz-generation.service.ts` (4 generation `executeAI` sites + `gradeAnswer`
+ `generateQuestionHint`), `concept-explanation.service.ts`,
`teaching-content.service.ts`, `question-localization.service.ts` (both
`localizeGeneratedQuestion` and `verifyLocalizationEquivalence`),
`transfer.service.ts` (2 generation + 1 eval), `explain-defend.service.ts`
(prompt gen + rubric eval), `error-intelligence.service.ts`,
`misconception.service.ts` — all now `resolveModels(...)` + `callModel(...)`.
No feature service in the canonical runtime imports
`adapters/anthropic` or references a `claude-*` literal
(`lx4p-perf-r1c-openai-rewire.test.ts` → “SONNET IN CANONICAL RUNTIME =
NONE”, one assertion per service).

### C2 — provider-pinned tests refactored (not a blocker) — **DONE**
37 tests across 10 files moved off `vi.mock('@/lib/ai/adapters/anthropic')`
/ `provider: 'anthropic'` / model-literal / `.messages[0].content`
assertions onto the **internal contract**: mock `callModel`, assert the
provider-neutral `.user` message, assert the *routed* model
(`gpt-5.6-luna` / `gpt-5.6-terra`), assert `budgetFor(...)` values reach
`callModel`. End-to-end tests that let the real gateway+adapter run
(`ai-high-risk-regression`, `cognitive-level-generation`,
`question-variant-equivalence`) now stub `OPENAI_API_KEY` and return the
OpenAI Chat Completions wire shape. No fictional “Luna corpus” was
created to make tests green.

### C3 — OpenAI adapter contract tests — **DONE**
`tests/unit/openai-adapter-contract.test.ts` (10 cases, no network):
normal structured response → `{text, raw}`; strict `json_schema` +
`max_completion_tokens` + `reasoning_effort` + `prompt_cache_key` on the
wire; `message.refusal` → `INVALID_RESPONSE`; malformed body → empty text
(rejected downstream); non-2xx → `AIExecutionError`; unset key →
`CONFIGURATION_ERROR` synchronously; `parseProviderUsage` fresh / cached /
missing; `callModel` OpenAI dispatch → `{text, raw, provider:'openai', model}`.

### C4 — the real strict JSON Schemas — **DONE**
`src/lib/ai/schemas.ts`: `GENERATED_QUESTION_BATCH_SCHEMA` (object-rooted
`{questions:[…]}`, every nested object `additionalProperties:false`, all
properties `required`, optionals as `["T","null"]`),
`GUIDED_PRACTICE_SCHEMA`, `LOCALIZATION_PAYLOAD_SCHEMA`,
`SEMANTIC_VERDICT_SCHEMA`, `QUESTION_QUALITY_VERDICT_SCHEMA`. Tested for
strict-mode shape in `lx4p-perf-r1c-openai-rewire.test.ts` (C4 block).

### C5 — Question Quality Gate wired — **DONE**
`src/services/gated-question-generation.service.ts`
`applyQuestionQualityGate`: per question →
`checkQuestionQualityDeterministic` (drop `FAIL`, keep `PASS`,
`verifyQuestionQuality` + `evaluateQuestionQualityVerdict` on
`NOT_DETERMINISTICALLY_VERIFIED`).

### C6 — semantic question-quality verifier — **DONE**
`src/services/question-quality-verifier.service.ts` — an **independent**
Terra call (`resolveModels('EXPLANATION_EVALUATION')`,
`budgetFor('semantic_verification')`, `QUESTION_QUALITY_VERDICT_SCHEMA`,
prompt `quiz.question_quality_verify` v1). `evaluateQuestionQualityVerdict`
is pure and fails on any false dimension / confidence < 0.7 / malformed
verdict (fail-closed).

### C7 — direct Practice routing — **DONE**
`generatePracticeQuestions`, `plan.length === 1` (canonical ≈3) now calls
`generateGatedPracticeBatch` — Luna `generateQuestionsForConcept` → gate →
if empty, **one** Terra retry (`modelOverride: TERRA`) → gate → if empty,
recoverable `[]`. Never a 3rd model call, never Claude. The legacy
20-question path was **not** restored. Covered by
`lx4p-perf-r1c-gated-practice.test.ts` (6 cases: PASS short-circuit,
deterministic-FAIL→Terra, semantic-FAIL→Terra, Terra-FAIL→[],
no-third-call, generator-throw→fail-closed) and the reworked
`quiz-generation-practice-chunking.test.ts` count≤4 block (first call =
Luna `QUESTION_GENERATION` v3; ≤ 2 generation calls, never a 5× fan-out).

### C8 — larger batches — **PRESERVED**
`count > 4` (cumulative / exam and any explicit large request) keeps the
balanced parallel `planChunks` fan-out and partial-tolerant merge,
unchanged, now on the Luna `QUESTION_GENERATION` route with per-chunk
`budgetFor('question_generation_chunk')`. Quick Check (6-slot) and
Retention counts and all-or-nothing / partial semantics are untouched
(`quiz-generation-quick-check` / `-retention` suites green).
Per-chunk quality gating for the large path is **deferred** — it is not on
the canonical first-touch critical path and needs live provider signal to
tune; noted as a remaining condition.

### C9 — teaching content routing — **DONE**
Explanation + guided practice → `resolveModels('CONTENT_GENERATION')`
(Luna primary, Terra as the single quality fallback — *not*
unconditionally). Contextual help / hint → Luna, `contextual_help` budget
(700 out-tokens, `minimal` reasoning). Terra is never placed automatically
on every teaching request.

### C10 — evaluation routing — **DONE**
`gradeAnswer` → `GRADING` (Terra, `HIGH_RISK`);
`verifyLocalizationEquivalence` + `verifyQuestionQuality` →
`EXPLANATION_EVALUATION` (Terra); `evaluateTransferResponse` →
`TRANSFER_EVALUATION` (Terra); `classifyMisconception` →
`COGNITIVE_ANALYSIS` (Terra). Asserted at the service boundary
(`lx4p-perf-r1c-openai-rewire.test.ts` C10) and end-to-end
(`ai-high-risk-regression` → `aiProvider === 'openai'`).

### C11 — localization — **DONE, LX-4P-R2 / R2R1 preserved**
Translation (`localizeGeneratedQuestion`) → Luna route +
`LOCALIZATION_PAYLOAD_SCHEMA` + `question_localization` budget
(`maxContextChars: 0` — no RAG). Structural reconciliation
(`reconcileLocalization`) unchanged. Independent semantic-equivalence
verification (`verifyLocalizationEquivalence`) → Terra +
`SEMANTIC_VERDICT_SCHEMA`; unit-integrity gate and fail-closed behaviour
from R2R1 unchanged. No localization / verify call runs on the initial
launch (R21 assertion still green).

### C12 — decision de-duplication — **DONE**
- `src/services/learning-continuation.service.ts`: `resolveContinuation`
  now calls `deriveLaunchTeachingExperience(studentId, decision, session)`
  for both LAUNCH results, reusing the **Phase-4 / first-touch
  `LearningDecision` it already resolved** — `getTeachingIntent(decision)`
  (not a second `getBestLearningDecisionForConcept`) +
  `deriveTeachingExperience` + the canonical `EvidenceMode` the session
  engine already fixed (`LearningSession.evidenceMode`). Best-effort:
  failure → `null`.
- `src/lib/lx/continuation.ts`: the `LAUNCH` variant carries
  `teachingExperience?: TeachingExperienceView | null`.
- `src/lib/lx/launch-teaching-handoff.ts` (new, pure): `write…` /
  `consume…` — transport + **validate only** (never derives). A handoff
  is honoured only for the same concept, the same launch `mode`, within
  `LAUNCH_TEACHING_MAX_AGE_MS` (60 s, and not future-dated), and a
  structurally intact `TeachingExperienceView` at
  `TEACHING_EXPERIENCE_CONTRACT_VERSION`. Consume-once: the key is always
  cleared on read.
- `ContinuationPanel.tsx`: writes `{conceptId, mode, teachingExperience,
  ts}` to `sessionStorage['lx.launchTeaching']` immediately before
  `router.push` — it never calls `deriveTeachingExperience`.
- `quiz/page.tsx` `startCanonicalActivity`: `consumeLaunchTeachingHandoff`
  first; a valid hit becomes `tiP = Promise.resolve(view)` and the
  `/api/learning/teaching-intent` round-trip is skipped; anything
  missing / stale / mismatched / forged → the canonical fetch, exactly as
  before. Still issued in parallel with wave B, still never awaited before
  the teach-first render.

**Before / after — `Continue → teaching launch`:**

| | canonical decision computations across the handoff | client → server round-trips |
|---|---|---|
| before | **2** — `resolveContinuation` (Phase-4 decision + `startLearningSession`), then quiz page `GET /api/learning/teaching-intent` (`getBestLearningDecisionForConcept` + `getTeachingIntent` + `deriveTeachingExperience`) | 2 (`POST /continue`, `GET /teaching-intent`) |
| after | **1** — `resolveContinuation` derives the decision **and** the `TeachingExperienceView` in one request; the client transports it | 1 (`POST /continue`); the `GET /teaching-intent` is skipped on a valid handoff |

Concept Mission’s own independent read is unchanged. `getTeachingIntent`
runs the same number of times overall — it just moves server-side into
the `/continue` request instead of a second HTTP hop, and the teach-first
UI no longer waits on it. Forgery: the transported view is
presentation-only (help availability / evidence mode / scoring are all
still re-gated server-side by `ai-permission-policy` /
`active-evidence-guard` regardless of what the client hands in); a forged
`sessionStorage` entry must additionally be a fully-intact view at the
current contract version, for the exact concept + mode, within 60 s — and
even then it can only cosmetically restage one activity.
`lx4p-perf-r1c-openai-rewire.test.ts` C12 block (7 cases) covers accept +
consume-once, wrong concept, wrong mode, stale, forged/malformed (×5),
absent.

### C13 — bounded RAG reuse — **DONE (truncation half)**
`fitContextChunks(context.chunks, budgetFor(key).maxContextChars)` applied
at all four `quiz-generation.service.ts` generation sites
(`question_generation_practice` / `_chunk` / `_slot`),
`concept-explanation.service.ts` (`concept_explanation`), and
`teaching-content.service.ts` (`guided_practice`). Whole chunks only,
never below one chunk. A single shared `LearningContextPackage` across the
three parallel producers is **not** in this commit — noted as a remaining
condition; the oversized-context truncation it was meant to prevent is
covered here.

### C14 — token budgets live in services — **DONE**
Each rewired capability passes its `budgetFor(...)` `maxOutputTokens` and
`reasoningEffort` into `callModel` (generation chunk/slot, concept
explanation, guided practice, contextual help, localization, semantic
verification). Asserted at the service boundary (hint test executes the
`call` closure and checks `callModel`’s `maxTokens` / `reasoningEffort`
equal `budgetFor('contextual_help')`).

### C15 — pricing config — **DONE**
`src/lib/ai/pricing.ts`: `gpt-5.6-luna` `{in 0.20, cachedIn 0.02, out
1.20}` /M; `gpt-5.6-terra` `{in 2.00, cachedIn 0.20, out 12.00}` /M;
claude ids remain `0`. `estimateCostUSD` → `complete: true` only when
priced **and** both token counts are present; usage is never fabricated
(`parseProviderUsage` returns `null`, not `0`, when a field is absent).

### C16 — Sonnet-in-canonical-runtime audit — **NONE**
Canonical learner runtime (question generation, teaching content,
contextual help, grading, localization + verify, transfer/explain
evaluation, misconception, error-intelligence): **0** Claude ids, **0**
Anthropic adapter imports (per-service assertions).
Documented **non-canonical** Sonnet users, unchanged and out of scope:
`concept-extraction` / `topic-hierarchy` (ingestion), `concept-graph`
(offline analysis), `localization.service` (concept/topic *label*
translation), `tutor.service` (separate Tutor chat surface),
`ai.service` + `/api/quizzes/generate` (legacy endpoint; the canonical
flow is `generate-and-take`).

### C17 — performance half A preserved — **YES**
`lx4p-perf-r1-parallel-runtime.test.ts` green (one source assertion
updated for the C12 handoff-or-fetch shape — wave A is still issued in
parallel with wave B and never awaited before the teach-first render).
Parallel teach-first runtime, TeachingIntent decoupling, R20 activity-
language rule, R21/R22 all intact.

### C18 — language rule preserved — **YES**
R20 (entire active learning surface follows the activity/question
language), LX-4P-R1 activity-language lock + explicit restart, LX-4P-R2
same-item localization — all suites green. `callModel` carries the same
`language`-derived prompt text the Anthropic path did.

### C19 — evidence authority preserved — **YES**
No change to Knowledge State / LearningState / LearningDecision authority /
TeachingIntent authority / SupportLevel / EvidenceMode / mastery
thresholds / `ResponseEvidenceContract` / Retention / Transfer /
`learning_evidence` write authority. The C12 handoff transports a
*presentation* view only; `deriveTeachingExperience` is pure and every
downstream gate is still server-enforced. LX-4R R8 canonical
question-count logic in `generate-and-take` untouched.

### C20 — tests — **DONE**
New: `openai-adapter-contract.test.ts` (10),
`lx4p-perf-r1c-openai-rewire.test.ts` (26),
`lx4p-perf-r1c-gated-practice.test.ts` (6). Plus the 37 refactored
provider-neutral assertions. Total suite: **186 files / 2746 tests
pass**. The 27 required scenarios are covered as: canonical Practice →
Luna (chunking + gated-practice suites); no canonical Practice Sonnet path
(C16 per-service + gated-practice); explanation/guided/hint → Luna
(rewire C9 + C14); evaluation/grading → Terra (rewire C10 +
`ai-high-risk-regression`); strict schema for question + guided (C4);
malformed Luna output rejected (adapter refusal/malformed +
gated-practice deterministic-FAIL); gate PASS → no Terra / det-FAIL →
Terra / sem-FAIL → Terra / Terra-FAIL → fail-closed / no third attempt /
no Anthropic fallback (gated-practice + R1B B5/B6/B24); budgets consumed
by services (C14); usage telemetry provider-neutral (adapter C3);
language / localization-fidelity / Response Contract / EvidenceMode /
LX-5 continuation / teach-first parallelism invariants (existing suites,
C17–C19); direct Practice functioning + large-batch parallel preserved
(chunking suite); decision handoff not forgeable into pedagogy + invalid
handoff falls back (C12 block).

### C21 — no fake certification — **HONOURED**
No claim of quality ≥ Sonnet, real Luna correctness, TTFI p50/p95, token-
or cost-reduction %, or real fallback rate. Those require a provider key
and are listed under REMAINING CONDITIONS.

---

## 4. REQUIRED OUTPUT

1. **AI routing before/after** — §1 / §2.
2. **Every canonical call site + its route** — §2 table + §3 C1/C9/C10.
3. **Anthropic adapter / claude-id references in canonical runtime** —
   none (§3 C16; per-service test).
4. **Strict JSON Schemas authored** — 5 (§3 C4).
5. **Quality Gate wiring for canonical Practice** — §3 C5–C7;
   `generateGatedPracticeBatch`.
6. **Semantic question-quality verifier** — §3 C6; independent Terra call,
   fail-closed.
7. **Larger-batch behaviour** — preserved, Luna route, per-chunk gating
   deferred (§3 C8).
8. **Teaching content / contextual help routing** — §3 C9.
9. **Evaluation routing** — §3 C10.
10. **Localization (R2 / R2R1 preserved)** — §3 C11.
11. **Decision de-dup before/after call behaviour** — §3 C12 table
    (2 → 1 canonical decision computations; 2 → 1 round-trips).
12. **Bounded RAG reuse** — §3 C13; `fitContextChunks` at 6 sites.
13. **Token budgets live in services** — §3 C14; service-boundary test.
14. **Pricing config** — §3 C15.
15. **Sonnet canonical-runtime audit** — NONE (§3 C16); non-canonical
    users listed.
16. **Performance half A / language / evidence preservation** — §3
    C17–C19; suites green.
17. **New + refactored tests** — §3 C20; 42 new cases, 37 refactored,
    2746 total pass.
18. **tsc / vitest / build** — `tsc --noEmit` clean; `vitest run` 186/186
    files, 2746/2746 tests; `next build` compiles.
19. **Implementation commit** — `c72736a` (+ this report commit).
20. **Remaining conditions** — §5.

---

## 5. REMAINING CONDITIONS (require a provider key or a browser)

1. Deploy to **preview** with `OPENAI_API_KEY`; confirm Luna/Terra accept
   the 5 strict schemas and return `usage` (incl.
   `prompt_tokens_details.cached_tokens`) as parsed.
2. **Sonnet quality baseline** from anonymized `quiz_sessions.questions`;
   Sonnet vs Luna vs Luna+Terra comparison; **accepted quality ≥
   baseline** before LX-6.
3. **TTFI** live: ≥ 10 teach-first + ≥ 10 direct-Practice launches;
   per-run TTFI / tokens / cost + p50 / p95 / max; production p50 < 5 s /
   p95 ≤ 7 s.
4. **Token / cost reduction %** and **prompt-cache hit rate** from real
   `usage`.
5. **Real fallback rate** (Luna → Terra) under production load; tune the
   deterministic + semantic gate thresholds against live signal.
6. **Per-chunk quality gating** for the `count > 4` path (C8) — tune with
   live provider signal.
7. **Shared `LearningContextPackage`** across the three parallel producers
   (C13 second half).
8. Full authenticated regression matrix against a real provider + browser
   (language, localization fidelity, evidence integrity, LX-5
   continuation, focus-mode).

---

## LX-4P-PERF-R1C — OPENAI RUNTIME REWIRE CERTIFICATION

- **Service rewire (C1):** COMPLETE — no `claude-*` id, no Anthropic
  adapter import in the canonical learner runtime.
- **Provider-pinned tests (C2):** REFACTORED to provider-neutral
  internal-contract assertions; no fabricated Luna corpus.
- **Adapter contract tests (C3):** ADDED (10).
- **Strict JSON Schemas (C4):** AUTHORED (5).
- **Quality Gate + semantic verifier for canonical Practice
  (C5–C7):** WIRED; Luna → deterministic gate → semantic verify → one
  Terra → fail-closed `[]`; never a third call, never Claude.
- **Teaching / contextual-help / evaluation routing (C9–C10):** DONE —
  Luna for content, Terra for evaluation.
- **Localization (C11):** DONE; LX-4P-R2 / R2R1 preserved.
- **Decision de-duplication (C12):** DONE — `Continue → teaching launch`
  = 1 canonical decision computation; handoff is transport-only,
  validated, forge-resistant, falls back canonically.
- **Bounded RAG (C13) / live token budgets (C14) / pricing (C15):** DONE
  (C13 truncation half; shared context package deferred).
- **Sonnet in canonical runtime (C16):** NONE.
- **Performance half A / language / evidence (C17–C19):** PRESERVED.
- **Tests (C20):** tsc clean; 186 files / 2746 tests pass; build compiles.
- **No fake certification (C21):** HONOURED — no quality / TTFI / token /
  cost / fallback-rate claims.

### STATUS: **PASS_WITH_CONDITIONS**

All provider-independent runtime wiring is complete. Every remaining item
(§5) physically requires `OPENAI_API_KEY`, an authenticated session, a
deploy, or a browser — exactly the measurement class C21 permits to
remain. Per the spec: with PASS_WITH_CONDITIONS and only live
measurements outstanding, the next step is to deploy to **preview** with
`OPENAI_API_KEY` and run the quality / performance benchmark and the
authenticated regression matrix.

Do NOT start LX-6 until: production TTFI verified (p50 < 5 s / p95 ≤ 7 s);
accepted-question quality ≥ Sonnet baseline; token / cost reduction
measured; language + evidence + localization regressions pass on a real
provider.

Implementation commit: `c72736a` on `tmp/lx1` (after `9b74347`).
Not deployed. Nothing pushed to `origin/main`.

STOP.
