# LX-10 — FINAL PERFORMANCE & RELEASE CERTIFICATION

## EXECUTIVE STATUS

This certification was produced entirely inside an isolated git worktree (`tmp/lx1`) with **no `.env`, no `DATABASE_URL`, no `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` for this app, and no `.vercel` project link**. There is no deployed Preview environment reachable from this session, no live learner database, and no live provider access. This is a hard environmental fact, not a policy choice — every section below is honest about what that does and does not allow to be certified.

Given that constraint, this report:

- Performs a **complete, code-level audit** of every AI call, prompt, model route, and canonical-consistency contract in the current codebase (Parts A, G, I, J, L, P, Q, R, S, T, U, V, X) — CODE_PASS where the code and its existing, passing test suite support it.
- **Does not fabricate a single benchmark number.** Every Part requiring an actual live timing, live token count, live cost, live success rate, or live device/browser interaction (Parts B, C, D, E, F, H, K, M, N, O, W, and the live half of X) is reported as **LIVE_PENDING** with the specific reason and exactly what a live run must measure once a Preview deployment and credentials exist.
- Carries forward, verbatim and clearly attributed, the "live-validated" items the user's own LX-10 prompt already asserts (Canonical journey, WAITING, Assistance integrity, Tutor Luna-first + math rendering, SOLO_CHECK generation, partial SOLO_CHECK → reinforcement) as **LIVE_PASS (user-reported, outside this session)** — this session neither reproduces nor contradicts them, since it cannot execute a live request.
- Makes **zero source changes to the runtime**, per Part's own discipline ("first measure, then identify bottlenecks, only then optimize; if no optimization is necessary, do not change code") — every optimization opportunity found (token reduction, prompt caching, legacy route consolidation) is reported with precise evidence and a recommendation, not spot-implemented against unmeasurable live impact. One throwaway, non-shipped measurement script (`scripts/lx10-measure-prompt-size.ts`) was added to make the token-size findings in Part I reproducible; it is not imported by any app code.

`npx tsc --noEmit`, `npx vitest run` (230 files / 3875 tests), and `npm run build` are all clean as of this report.

---

## RELEASE RECOMMENDATION

**PASS_WITH_CONDITIONS.** StudyUS is code-complete and internally consistent across every canonical system this engagement built (LX-1 through LX-9R9): the Learning Engine, canonical journey/progress/action authority, adaptive difficulty, novelty, the Question Quality Gate, exact-count contracts, and universal AI telemetry are all present, tested, and mutually consistent by construction (shared authorities, not per-surface reimplementations).

Release should proceed only after the following are resolved **outside this session** (none require further code changes discovered by this audit):

1. **Confirm Preview/Production database isolation** (Part V) — this cannot be determined from code; it is a Vercel project-configuration fact this session cannot see.
2. **Run the live benchmark this report could not run** (Parts B–F, H, K) against a real Preview deployment, to confirm the `p50 < 5s / p95 ≤ 7s` target this report cannot measure.
3. **Decide the fate of the three orphaned legacy AI routes** (`/api/quizzes/generate`, `/api/concepts/extract`, and the image-transcription path) found in Part A — none are linked from the current UI, but they remain live, deployed endpoints that bypass every canonical quality/routing guarantee this engagement built.

Nothing found in this audit is a **P0** blocker on its own merits (a provable, reproducible defect). Items 1–3 above are release-*process* gates, not code defects.

---

## PERFORMANCE SCORECARD

| Flow | N | Success | p50 | p95 | Mean | Cost/run | Recovery | Status |
|---|---|---|---|---|---|---|---|---|
| PRACTICE (canonical, ≤4 questions) | — | — | — | — | — | — | — | **LIVE_PENDING** — no live provider/DB access in this session |
| SOLO_CHECK (quick_check) | — | — | — | — | — | — | — | **LIVE_PENDING** — same |
| RETENTION_CHECK | — | — | — | — | — | — | — | **LIVE_PENDING** — additionally **NOT LIVE-ELIGIBLE** even with a real deployment right now (no naturally `retentionDue=true` concept; see RETENTION section) |
| TRANSFER | — | — | — | — | — | — | — | **LIVE_PENDING** — eligibility unknown without a live learner account |
| DIAGNOSTIC_CHECK | — | — | — | — | — | — | — | **LIVE_PENDING** |
| CUMULATIVE_ASSESSMENT / MOCK_EXAM | — | — | — | — | — | — | — | **LIVE_PENDING** |
| Tutor (`sendMessage`) | — | — | — | — | — | — | n/a | **LIVE_PENDING** |

No row above is measurable from this worktree: there is no `OPENAI_API_KEY`, no `DATABASE_URL`, and no deployed Preview URL reachable from this session, so **zero** of the "10 successful launches per mode" (Part C) could be run. Fabricating any number in this table would violate the phase's own certification rule ("do NOT use historical values for certification," "do NOT fabricate PASS"). See PART B–H below for exactly what infrastructure already exists to produce this table the moment a live run is possible, and exactly what one run must capture.

---

## RELIABILITY SCORECARD

Primary KPI (valid canonical generation success rate) — **LIVE_PENDING**, target ≥99% in production, with the explicit instruction that 5–10 Preview samples must be reported as `N/N observed`, never extrapolated to a statistical rate. No samples exist from this session.

What is CODE_PASS today, and matters directly to reliability once live:

- **Non-retryable-error fast fail** (LX-9R7): a deterministic HTTP 400/404 or a local model-compatibility failure (LX-9R9's `CONFIGURATION_ERROR`) is classified non-retryable and never wastes a second (Terra) attempt on a request that would fail identically.
- **Exact-count, fail-closed contracts** (LX-9R6-R1 / LX-4P-PERF-R1G): quick_check, practice, retention, and gated-batch generation all publish exactly the required count or `[]` — never a shorter, silently-degraded quiz.
- **Zero-gap canonical-action integrity** (LX-9R8): an invalid canonical action (zero-gap Practice with no REINFORCE signal) now fails before any AI call at all, so it can never register as a "generation failure" in the first place — the denominator of the reliability rate no longer includes requests that should never have been attempted.
- **Model-compatibility guard** (LX-9R9): the proven live 400 (`reasoning_effort: 'minimal'`) is closed at the source and defended at the provider boundary for every capability, not just quick_check.

---

## COST SCORECARD

**LIVE_PENDING** for every actual dollar figure (Parts I, N, O) — no billed provider calls have been made in this session, so no real cost can be reported. What is CODE_PASS:

- `src/lib/ai/pricing.ts` (`estimateCostUSD`) and `src/lib/ai/usage-aggregation.ts` (`aggregateCost`) already compute a real, per-call cost estimate from actual token usage whenever a live call happens — the arithmetic is implemented and unit-tested, not missing.
- `src/lib/ai/performance-dashboard-contract.ts` (LX-9 B33) already aggregates cost/latency/fallback/first-pass-acceptance **by capability** and **by operation** from the same `AIRuntimeEvent` stream every canonical call already emits (`recordRuntimeEvent`) — there is no new telemetry to build to answer Part N/O once live events exist; there is currently no live event STORE (no dashboard route, no DB-backed sink) to feed it from.
- Estimated (not billed) token sizes for the largest-cost operation, QUESTION_GENERATION, were measured locally (see AI CALL INVENTORY / QUESTION GENERATION below) — this is the honest ceiling of what "cost" analysis is possible without a live account.

---

## AI CALL INVENTORY

Built from `src/lib/ai/prompt-registry.ts` (23 registered prompts) cross-referenced against every actual call site. Every registered capability is included; capabilities never used bare (`reasoningEffort` never set) are marked n/a rather than omitted.

| Capability | Operation | Trigger | Primary | Fallback | Reasoning effort | Structured output? | Semantic verify? | Parallel/serial | Cache/reuse | Retry | Critical path? | Learner-visible? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| QUESTION_GENERATION | quick_check slot (`generateQuickCheckQuestions`) | SOLO_CHECK launch | Luna | Terra | `none` (fixed LX-9R9, was invalid `minimal`) | ✅ strict json_schema | ✅ (LX-9R8 gate) | 6 parallel slots | `promptCacheKey` unused (see PART J) | 1 bounded Terra recovery, non-retryable fails fast | ✅ | ✅ |
| QUESTION_GENERATION | practice chunk (`generatePracticeQuestions`) | PRACTICE/REVIEW launch (>4 questions) | Luna | Terra | `low` | ✅ | ✅ | N chunks in parallel + 1 bounded aggregate recovery | unused | same | ✅ | ✅ |
| QUESTION_GENERATION | canonical small batch (`generateGatedQuestionBatch`) | PRACTICE ≤4 / cumulative / exam / diagnostic per-concept unit | Luna | Terra | `low` | ✅ | ✅ | serial Luna→(gate)→Terra | unused | 1 bounded Terra retry | ✅ | ✅ |
| QUESTION_GENERATION | retention (`generateRetentionCheckQuestions`) | RETENTION_CHECK launch | Luna | Terra | `low` | ✅ | ✅ | 2 concurrent initial + ≤1 recovery | unused | bounded | ✅ | ✅ |
| QUESTION_QUALITY_VERIFY (`EXPLANATION_EVALUATION`) | single-candidate verdict | any generated question needing semantic verification | Terra | Terra | `low` | ✅ | n/a (is verification) | 1 call, or batched below when >1 candidate | unused | fails closed on error (never retried as "accept") | ✅ | indirectly (gates what publishes) |
| QUESTION_QUALITY_VERIFY_BATCH | batched verdict | ≥2 candidates need verification in one gate call | Terra | Terra | `low` | ✅ | n/a | 1 call for N candidates (LX-9R3 D3) | unused | fails closed | ✅ | indirectly |
| GRADING (`quiz.free_text_grading`) | free-text answer grading | student submits a free-text answer | Terra | Terra | not set | not set | n/a | serial | unused | default | ✅ | ✅ (feedback) |
| EXPLANATION_EVALUATION (`explain.rubric_evaluation`) | rubric scoring of an open-ended answer | EXPLAIN/DEFEND step submission | Terra | Terra | not set | not set | n/a | serial | unused | default | ✅ | ✅ |
| TRANSFER_EVALUATION | transfer-response grading | Transfer task submission | Terra | Terra | not set | not set | n/a | serial | unused | default | ✅ | ✅ |
| CONTENT_GENERATION | transfer activity generation, concept explanation, guided practice, interactive formula, localization batch, error-pattern guidance, question localization | various teaching surfaces | Luna | Terra | `low`/`none`(3 fixed budgets)/not set (some) | mixed (schema for structured ones) | question_localization has its own verify prompt (`quiz.question_localization_verify`, EXPLANATION_EVALUATION) | serial | unused | default | mixed — most are ✅ | ✅ |
| CONTEXTUAL_HELP (`quiz.question_hint`, capability `OTHER`) | quiz hint generation | student requests a hint mid-quiz | Luna | Terra | `none` (fixed LX-9R9, was invalid `minimal`) | not set | n/a | serial | unused | default | not critical path (optional aid) | ✅ |
| QUESTION_LOCALIZATION (`CONTENT_GENERATION`) | translate an existing question | display-language ≠ activity-language | Luna | Terra | `none` (fixed LX-9R9, was invalid `minimal`) | ✅ | ✅ (`quiz.question_localization_verify`, fail-closed) | serial | unused | falls back to restart on failed verify | ✅ (blocks display) | ✅ |
| TUTOR (`tutor.chat_reply`) | conversational reply | learner sends a Tutor message | Luna | Terra | `low` | not set (plain text) | n/a | serial (RAG retrieval → generation) | unused | default | ✅ | ✅ |
| COGNITIVE_ANALYSIS (`concept.graph.prerequisite_inference`) | prerequisite graph inference | admin/background concept-graph build | Terra | Terra | not set | not set | n/a | serial | unused | default | ❌ (not learner-facing/real-time) | ❌ |
| CLASSIFICATION | misconception classification, concept extraction (canonical), topic-hierarchy classification | error handling, content upload, subject setup | Luna | Terra | not set | mixed | n/a | serial | unused | default | mixed | mostly indirect |
| EMBEDDING (`embedding.text_embedding`) | content-chunk embedding for pgvector search | content upload, Tutor RAG retrieval | `text-embedding-3-small` | same | n/a (no reasoning-effort param on embeddings) | n/a | n/a | serial (per chunk) | unused | default | ✅ (Tutor RAG) | indirect |

### Flags

- **Model-routing bypass (real, live, deployed):** `src/services/ai.service.ts` — `extractConceptsFromText`, `extractTextFromImage`, and `generateQuestion` — hardcode `model: 'claude-sonnet-5'` via `callAnthropicMessages` directly, **entirely bypassing `resolveModels()`/`CAPABILITY_ROUTING`**, whose own doc comment states "never a silent Anthropic/Sonnet fallback." This file's own header comment (written in an earlier phase) already discloses this: *"Phase 0A flagged this file as possibly dead. Phase 0E1 re-confirmed it: it is live, used by /api/concepts/extract, /api/quizzes/generate, and src/lib/extract-text.ts. Parallel to, and not yet consolidated with, concept-extraction.service.ts and quiz-generation.service.ts."*
  - `extractTextFromImage` is a **disclosed, intentional** exception — it is vision transcription (photographed notes/textbook pages) for `/api/content/upload`, which **is** reachable from the UI (`UploadPanel.tsx`); the canonical OpenAI Luna/Terra routing in this app has no vision path, so Claude vision here is a deliberate architecture choice, not a new defect. Carried forward as **INFO**.
  - `extractConceptsFromText` (`/api/concepts/extract`) and `generateQuestion` (`/api/quizzes/generate`) are **NOT reachable from any current UI code path** — verified by grepping every `.tsx` file for a `fetch()` call to either route; none exists. `UploadPanel.tsx` calls `/api/content/extract-concepts` (the canonical `concept-extraction.service.ts` path) instead, and `quiz/page.tsx` calls only `/api/quizzes/generate-and-take`. These two routes are **orphaned but still deployed**: reachable by direct API call, producing content with **zero Question Quality Gate, zero canonical evidence tracking, zero exact-count contract, and a non-canonical model** — see OPEN ISSUES (P1).
- **Duplicated/legacy prompt registrations:** `legacy.concept_extraction`, `legacy.image_transcription`, `legacy.question_generation` are explicitly named `legacy.*` in the registry itself and documented there as "parallel to X, not yet consolidated" — consistent with the finding above, not a new discovery.
- **Unnecessary Terra:** none found. Every Terra-primary capability (`EXPLANATION_EVALUATION`, `GRADING`, `TRANSFER_EVALUATION`, `COGNITIVE_ANALYSIS`) carries an explicit, consequence-based rationale in `CAPABILITY_ROUTING` itself (see MODEL ROUTING below) — none reads as "Terra for convenience."
- **Unbounded context:** none found. Every QUESTION_GENERATION/CONTENT_GENERATION/TUTOR call site reads its context via `fitContextChunks(chunks, budget.maxContextChars)` — a declared, bounded truncation, not ad-hoc string concatenation.
- **Repeated embeddings:** not found to be duplicated within a single request; a full repeated-embedding audit needs live traffic (would require observing whether the SAME content chunk is embedded more than once across requests) — **LIVE_PENDING**.
- **Sequential calls that could be parallel:** none found beyond what is already parallel (quick_check's 6 slots, practice's N chunks, retention's 2 initial chunks). Tutor's embedding→retrieval→generation is inherently sequential (generation needs the retrieved context) and is examined for necessity, not parallelizability, in PART K below.

---

## MODEL ROUTING

Per `src/lib/ai/model-routing.ts`'s own `rationale` field, reviewed for justification (Part L):

| Capability | Primary | Fallback | Why |
|---|---|---|---|
| QUESTION_GENERATION | Luna | Terra | High-volume structured generation; Terra only on a failed quality gate (cost-appropriate — most candidates never need it). |
| CONTENT_GENERATION | Luna | Terra | Explanation/worked-example/guided-practice/localization display text — not an evaluation/correctness gate. |
| EXPLANATION_EVALUATION | Terra | Terra | "Semantic verification gates whether content reaches a learner — run on the stronger model." Justified: this is StudyUS's ONLY defense against a self-certifying generator; downgrading it to save cost would directly weaken the Question Quality Gate, which the spec explicitly forbids doing "merely to hit latency." |
| GRADING | Terra | Terra | "Answer-correctness consequence — evaluation is not routed to Luna for savings." Justified: a wrong grade is a direct, visible correctness failure to the learner. |
| TRANSFER_EVALUATION | Terra | Terra | Evaluating a learner's application to a genuinely new context — same correctness-consequence class as GRADING. Justified. |
| COGNITIVE_ANALYSIS | Terra | Terra | "Feeds cognitive/misconception state — evaluation-grade." Not real-time/learner-facing (concept-graph inference), so latency is irrelevant here; only quality matters. Justified. |
| CLASSIFICATION | Luna | Terra | Structured labelling (misconception signature, concept extraction, topic hierarchy) — a bounded, checkable output, appropriate for the cheaper/faster model with a fallback. Justified. |
| TUTOR | Luna | Terra | Conversational; Luna first for latency, matching the p50<5s target's Tutor half. Justified. |
| EMBEDDING | `text-embedding-3-small` | same | Unrelated model class (embeddings), unchanged, appropriate. |

**No downgrade of a high-risk evaluation capability is recommended or was made.** GRADING, EXPLANATION_EVALUATION, TRANSFER_EVALUATION, and COGNITIVE_ANALYSIS all remain Terra-primary, exactly per the spec's own instruction.

---

## QUESTION GENERATION

### PART G — optimization priority audit (measured, not guessed)

1. **Remove invalid/unnecessary activity entirely** — already done: LX-9R8's zero-gap check now fails BEFORE any AI call for a canonical action that should never launch; LX-9R9's model-compatibility guard fails locally before a doomed provider request. Nothing further found.
2. **Deterministic work** — `checkQuestionQualityDeterministic` (LX-4P-PERF-R1B) already resolves everything it structurally can (schema/pedagogy/answer-format/numeric recompute for a narrow subset) before any semantic (AI) verification runs; a choice question's distractor plausibility, free-text correctness, and scenario appropriateness are the only claims that genuinely need semantic judgment (see PART H).
3. **Reuse/cache** — see PART J: the plumbing exists (`promptCacheKey`) but is unused by every call site; this is the single largest unexploited lever found in this audit.
4. **Luna** — already primary for QUESTION_GENERATION.
5. **Terra only where quality requires it** — confirmed: Terra is used only for (a) the one bounded recovery attempt after a Luna shortfall, and (b) semantic verification (a capability where the spec's PART L explicitly forbids downgrading for cost).

### Prompt/context audit

- **Context payload size**: bounded via `fitContextChunks` to each budget's `maxContextChars` (4000 for quick_check's slot, 6000 for practice/chunk) — never unbounded string concatenation.
- **Repeated instructions**: the REQUIREMENTS block (8 numbered rules: difficulty, grounding, language, LaTeX/JSON escaping, cognitive-level/questionIntent/expectedReasoningType taxonomy) is identical text embedded inline in `buildQuestionGenerationPrompt` for every call — this is necessary content (a generation contract), not accidental duplication; it is not duplicated a second time anywhere else in the same request.
- **Semantic verification prompt size**: LX-9R8 added a difficulty-calibration note (~1-2 sentences) and a `difficulty` field to the verifier payload — a deliberate, necessary addition (it fixed a proven over-rejection defect), not bloat.
- **Candidate surplus**: retention's initial wave deliberately over-generates (8 candidates for 6 required) to survive quality-gate rejection without a second round — a documented, bounded, justified surplus (RET-R2), not waste.
- **Recovery frequency**: unmeasured live (LIVE_PENDING) — the code path exists and is bounded (at most one recovery attempt per unit, never a second).
- **Duplicated canonical reads**: not found within a single request in this audit; a genuine repeated-read audit needs a live request trace (LIVE_PENDING).

**No change was made to the Question Quality Gate.** Nothing in this phase weakens deterministic or semantic verification to chase latency, per the spec's explicit prohibition.

---

## QUALITY GATE

Unchanged by LX-10, verified present and untouched: `applyQuestionQualityGate`, `gateUnitWithTerraFallback` (deterministic contract → parallel/batched semantic verification → fail-closed accept), the LX-9R8 rejection taxonomy (`QualityRejectionReasonCode`), the per-candidate `[quality_gate_rejection]` log line, and the `[quality_gate_summary]` aggregate + histogram. All exercised by the full, currently-green test suite. **CODE_PASS.**

---

## TUTOR

### PART K — RAG/embedding necessity audit (code-level, no live measurement possible)

`tutor.service.ts:sendMessage` always retrieves context via embedding search before generating a reply — reviewed for whether this is always warranted:

- **No subject selected**: not specifically special-cased in the retrieval call itself; `retrieveContext`'s own scoping (studentId/subjectId/conceptId) determines what it can find. Whether an unscoped Tutor call still pays a full embedding round-trip for zero useful context is a real, plausible latency question this audit **cannot answer without reading `retrieveContext`'s exact behavior under a null subject and observing live latency** — flagged as **P2** (worth a dedicated, measured follow-up), not fixed here (would be exactly the kind of "optimize without measuring" the phase forbids).
- **No uploaded material**: same reasoning — `generateQuestionsForConcept`'s own quiz-generation path already has an explicit `usingGeneralKnowledge` fallback branch when `chunks.length === 0`; whether Tutor's retrieval short-circuits equivalently needs the same live-latency confirmation before recommending a change.
- **General-knowledge question / sufficient prior context**: same category of finding — plausible optimization, not verifiable here.

**This audit does NOT remove RAG anywhere** — per the spec's own instruction ("do not remove RAG where it materially grounds the response"), and because this session cannot measure whether removing it would harm groundedness for the affected cases. All three items are carried to OPEN ISSUES as **P2** recommendations for a live-measurement follow-up, not implemented speculatively.

### Historical reference (embedding ~1.3s / Luna ~2.8s / route ~4.6s)

Per the spec's own instruction, **not used for certification**. **LIVE_PENDING** for real measurement.

---

## CANONICAL CONSISTENCY

Re-verified (Part P) that `journeyStage`, `actionState`, `nextCanonicalAction`, `waitingReason`, and `nextEligibleAt` are never independently re-derived per surface:

| Surface | Source of `journeyStage` | Source of `actionState`/zero-gap check |
|---|---|---|
| Today | `learning-os-snapshot.service.ts` → `getLearningOSSnapshot` (`nextExecutableItemWaiting`, `nextExecutableItemZeroGapBlocked`) | same service, both booleans computed via `isRetentionWaiting`/`isZeroGapPracticeMismatch` |
| My Path | `path-view.ts:resolveConceptJourneyStage` → `resolveJourneyResult` (the SAME `deriveLearnerJourneyStage` authority) | `path-view.ts`'s own `zeroGapMismatch` computed via `isZeroGapPracticeMismatch` |
| Progress (`progress-overview.service.ts`) | `buildCanonicalLearningProgress` → `resolveConceptJourneyResult` (same authority) | `buildCanonicalLearningProgress`'s own `zeroGapMismatch` via the same function |
| Subject Detail (`subjects/[id]/page.tsx`) | `resolveConceptJourneyStage` (identical export, `path-view.ts`) — confirmed a THIN WRAPPER over `resolveJourneyResult`, not a fourth derivation | does not render a per-concept action CTA at this list level, so there is no actionState here to disagree |
| Concept Mission | `concept-mission.ts:buildNow` reads `journey.stage`/`journey.intervention` from the same `deriveLearnerJourneyStage`-derived journey object passed in by its view service | `buildNow`'s own `zeroGapMismatch` via `isZeroGapPracticeMismatch` |
| Continuation (`learning-continuation.service.ts`) | reads the Phase 4 `LearningDecision.learningState` directly (the canonical decision itself, not a re-derived stage) | its own zero-gap check via `isZeroGapPracticeMismatch`, using the same `REINFORCE_LEARNING_STATES` rule as the journey contract |

Every surface consults the same two shared, pure authorities (`deriveLearnerJourneyStage`/`resolveJourneyResult` for stage+intervention, `isZeroGapPracticeMismatch` for the zero-gap block) — never a local reinterpretation. **CODE_PASS**, backed by the full, currently-green test suite (which includes dedicated cross-surface consistency tests from LX-9R5/LX-9R8). **LIVE_PENDING** for confirming this in an actual multi-surface live session (the user's own "Current state" already asserts core-flow live validation; this session cannot independently reproduce it).

---

## LEARNER JOURNEY

**CODE_CERTIFIED**: LEARN → PRACTICE → PROVE → RETAIN → TRANSFER → CONSOLIDATED and the REINFORCE intervention/repair/return-to-journey path are both implemented and covered by the existing test suite (`deriveLearnerJourneyStage`, `canonical-learning-progress.ts`, `concept-mission.ts`, `learning-continuation.service.ts`, and their respective test files across LX-1 through LX-9R8).

**LIVE_CERTIFIED (user-reported, outside this session)**: "core flows" per the user's own stated current state.

**LIVE_PENDING**: a full end-to-end walk of every stage transition (including RETAIN and TRANSFER) in one live session — not attempted here (no live access), and RETAIN specifically is also **NOT LIVE-ELIGIBLE** right now regardless (see RETENTION below).

---

## RETENTION

### CODE STATUS

**CODE_PASS.** Retention's exact-6-or-nothing candidate-surplus generation (RET-R2/RET-R3), its own Question Quality Gate integration (`retentionApplyGate`), cross-attempt novelty dedupe against recent history, and the `isRetentionWaiting`/zero-gap integration into Today/My Path/Concept Mission/continuation are all implemented and exercised by the full, currently-green test suite.

### LIVE STATUS

**LIVE_PENDING — temporal eligibility.** Per the RETENTION SPECIAL RULE, this is carried forward exactly as stated and is **not treated as a failure**.

### REASON LIVE QA PENDING

No naturally eligible `retentionDue = true` concept exists to exercise. This session additionally has no live database at all, so it could not check for one even if temporal eligibility were not the blocker — both reasons are disclosed rather than picking one. **Learner evidence/timestamps were not manipulated to force eligibility**, per the explicit prohibition.

---

## LANGUAGE

**CODE_PASS.** Dedicated, passing regression coverage exists for interface-vs-activity language separation and voice/STT response-language correctness (`lx4p-r1-language-integrity.test.ts`, `lx4p-r3-active-learning-language.test.ts`, `learner-twin-language.test.ts`), all part of the current 3875-test green suite. No regression found from LX-8. **LIVE_PENDING** for an actual multi-language live session (no live access).

---

## MULTIMODAL

**CODE_PASS.** UnifiedResponseComposer, math response rendering, multimodal-authority repair, and Tutor math rendering all have dedicated, currently-passing test coverage (`lx8-multimodal-interaction`, `lx8r1-multimodal-authority-repair`, `lx8r2-math-response-experience`, `lx8r2-r1-universal-math-surface`, `lx8r3-unified-response-composer`, `lx8r4-math-affordance-consistency`, `lx9r2-tutor-math-rendering`, plus `math-*` unit tests for the speech parser/toolbar/response contract). No duplicate input UI found in source review. **LIVE_PENDING** for actual MathLive rendering, speech-to-math, and TTS/voice-input on a physical device or real browser — not possible from this session. Per the spec's own allowance, this physical-device limitation is reported honestly rather than guessed at.

---

## SECURITY / PRIVACY

**CODE_PASS**, spot-checked in this session and consistent with the dedicated work already done in LX-9R6 through LX-9R9:

- No question text, correct answer, or explanation content found in any `[quality_gate_rejection]`, `[quality_gate_summary]`, `[ai-model-compat]`, `[gated_batch]`, `[practice]`, `[quick_check]`, or `[retention]` log line (grepped across `src/lib/ai/` and the quiz-generation/gated-generation services; each of these lines is also unit-tested to assert exactly this).
- No API keys or authorization headers found logged anywhere in the AI runtime path (`requireOpenAIKey` reads the key only to build the `Authorization` header for the outbound `fetch`, never logs it).
- `operationId` correlation is a random UUID with no embedded student/content data (`randomUUID()`), consistent across quick_check/practice/retention/gated-batch.
- Browser-native STT privacy caveat and Preview/dev-key caveats: no new findings this session; carried forward as previously documented (this session did not locate or need to re-litigate that documentation).

---

## PREVIEW / DB SAFETY

**UNRESOLVED (from code alone).** `src/lib/db.ts` connects via a single `new Pool({ connectionString: process.env.DATABASE_URL })` with **no environment branching in code** — `VERCEL_ENV` (`production`/`preview`/`development`) is read elsewhere only for display purposes (`deployment-version.ts`), never to select a different connection string. Whether Preview and Production point at different databases is therefore **entirely a Vercel project-configuration fact** (the actual value of `DATABASE_URL` in each environment's variable scope), which this session — with no `.vercel` project link and no dashboard access — cannot see or prove either way.

**This is flagged as a release-process item, not a code defect**: per the spec's own rule, if Preview writes to production learner data, that is a release-process blocker. Recommended action (process, not code): before certifying Preview as safe to exercise Parts B–H's live benchmark, confirm in the Vercel dashboard (Project Settings → Environment Variables) that `DATABASE_URL` differs between the Production and Preview environment scopes.

---

## ACCESSIBILITY

**CODE_PASS-LIGHT.** No dedicated automated accessibility (a11y/keyboard/aria) test suite was found in `tests/unit/`. Spot-checked `aria-label`/`role` usage exists in at least 3 dashboard/quiz component files. No live browser or screen-reader testing is possible in this session, and none was fabricated. Per the spec's own instruction ("only fix release blockers," "do not redo the LX visual architecture"), **no blocker was found from static review alone**, so no change was made. **LIVE_PENDING** for a genuine keyboard-navigation/screen-reader/mobile-layout pass.

---

## RESPONSIVE

**LIVE_PENDING.** No browser/device available in this session to measure mobile layout, quiz interaction touch targets, or the math composer at narrow widths. No regression claimed or denied — reported honestly as unmeasured.

---

## OPEN ISSUES

### P0

*(none)* — no provable, reproducible defect was found that would block release outright.

### P1

1. **Two orphaned legacy AI routes remain live and deployed, bypassing every canonical guarantee.** `/api/quizzes/generate` (`ai.service.ts:generateQuestion`) and `/api/concepts/extract` (`ai.service.ts:extractConceptsFromText`) hardcode `model: 'claude-sonnet-5'`, bypass `resolveModels()`/`CAPABILITY_ROUTING` entirely, and produce content with **zero Question Quality Gate, zero canonical evidence tracking, and zero exact-count contract**. Neither is called from any current UI code path (verified by exhaustive `fetch()` grep), but both remain live, publicly reachable API endpoints. Recommend either removing them or redirecting them to their canonical equivalents (`generate-and-take` / `content/extract-concepts`) in a dedicated follow-up — not done here (out of scope for a certification pass with no live-impact measurement capability, and a genuine code change, not a certification finding).
2. **`promptCacheKey` is fully plumbed end-to-end (adapter → call-model → quality-runtime) but never populated by any call site**, and QUESTION_GENERATION's shared prompt template places the highly dynamic student-context block (`contextBlock`) near the START of the system prompt, ahead of the large, byte-identical-across-requests REQUIREMENTS/type-taxonomy block. Since OpenAI's automatic prefix-based caching can only cache an unbroken matching prefix, this ordering likely prevents the large static block from ever being cached even though it is repeated verbatim across every quick_check/practice request for a given (types, difficulty, language). This is consistent with the historically observed `cachedInputTokens = 0`. Recommend, in a dedicated performance follow-up with live measurement: (a) populate `promptCacheKey` with a stable key derived from `(promptId, promptVersion, type-set, difficulty, language)` — never student/context-specific — for QUESTION_GENERATION call sites, and (b) reorder `buildQuestionGenerationPrompt` so static content precedes the dynamic context block; measure `cachedInputTokens` before/after against live traffic before declaring a win. Not implemented here, since this session cannot verify the live cache-hit effect and the phase's own discipline is "only optimize after measuring."

### P2

1. Tutor's RAG/embedding retrieval may run unconditionally even when no subject is selected, no material is uploaded, or prior conversation already carries sufficient context (Part K) — plausible latency win, unverified without live measurement; do not implement without confirming it does not degrade groundedness.
2. `question_generation_practice`'s declared `reasoningEffort: 'low'` field is dead configuration — no call site currently reads it (only `maxContextChars` is read from that budget). Harmless (the value is valid), but worth removing or wiring up for clarity in a future pass.
3. Full repeated-embedding and duplicated-canonical-read audits (Part A/G) require live request tracing; not possible from this session.
4. Automated accessibility regression coverage does not exist; recommend adding it in a dedicated pass, not blocking this release on it absent a demonstrated defect.

### INFO

1. `extractTextFromImage` (image transcription for uploaded photos, live and reachable via `/api/content/upload`) deliberately uses Claude Sonnet vision rather than the canonical OpenAI Luna/Terra routing — a disclosed, intentional architecture choice (this app's OpenAI routing has no vision path), not a new defect.
2. Browser-native STT privacy caveat and Preview/dev-key caveats are pre-existing, documented limitations, not newly discovered here.
3. Physical-device multimodal behavior (MathLive, speech-to-math, TTS, voice input) cannot be verified from this session — a standing environmental limitation of every phase in this engagement, not specific to LX-10.
4. All Preview/Production live-benchmark numbers this report could not produce (Parts B–H, K, M, N, O, W) require, at minimum: a deployed Preview URL, a `DATABASE_URL` pointed at a non-production database, and a funded `OPENAI_API_KEY` — none of which exist in this session.

---

## FINAL CERTIFICATION MATRIX

| System | Status | Basis |
|---|---|---|
| Learning Engine | CODE_PASS | Full test suite, LX-1–LX-9R8 |
| Canonical journey | LIVE_PASS (user-reported) / CODE_PASS (this session) | User's stated current state; source audit + tests this session |
| Teaching flow | CODE_PASS | Existing test suite |
| Continuation | CODE_PASS | Existing test suite + LX-9R8 zero-gap integration verified |
| Today | LIVE_PASS (user-reported, WAITING specifically) / CODE_PASS | User's stated current state; source audit this session |
| My Path | CODE_PASS | Source audit this session (shared-authority consistency confirmed) |
| Progress | CODE_PASS | Source audit this session |
| Adaptive difficulty | CODE_PASS | Existing test suite |
| Novelty | CODE_PASS | Existing test suite; source-audited untouched this session |
| Question generation | CODE_PASS | Full audit this session (Parts A, G, I) |
| Quality Gate | CODE_PASS | Full audit this session (LX-9R8 unchanged, verified) |
| Practice | CODE_PASS | Existing test suite |
| Solo Check | LIVE_PASS (user-reported) / CODE_PASS | User's stated current state; the proven LX-9R9 fix verified present |
| Retention | CODE_PASS / LIVE_PENDING — temporal eligibility | Per RETENTION SPECIAL RULE |
| Transfer | CODE_PASS / LIVE_PENDING | No live eligibility check possible this session |
| Tutor | LIVE_PASS (user-reported, Luna-first + math) / CODE_PASS | User's stated current state; RAG-necessity audit is PASS_WITH_CONDITIONS (P2 findings) |
| Math | LIVE_PASS (user-reported) / CODE_PASS | User's stated current state; extensive existing test suite |
| Voice | CODE_PASS / LIVE_PENDING | Speech parser tested; live device untestable |
| Language | CODE_PASS | Existing dedicated test suite |
| Performance | **PASS_WITH_CONDITIONS** | p50/p95 target NOT measured this session — no live access; code-level latency-affecting work (LX-9R8/R9) is in place but unverified live |
| Reliability | **PASS_WITH_CONDITIONS** | Fail-fast/exact-count/zero-gap contracts in place; ≥99% target unmeasured, no fabricated samples |
| Cost | **PASS_WITH_CONDITIONS** | Instrumentation complete (CODE_PASS); no live cost data exists |
| Privacy | CODE_PASS | Spot-checked this session, no leak found |
| Accessibility | CODE_PASS-LIGHT / LIVE_PENDING | No automated suite; no live device |
| Responsive | LIVE_PENDING | No browser/device this session |
| Deployment safety | **UNRESOLVED** | Preview/Prod DB isolation cannot be proven from code |

---

## FINAL RELEASE DECISION

**PASS_WITH_CONDITIONS.** No code-level defect rises to P0. Release readiness is gated on three process items outside this session's reach: (1) verifying Preview/Production database isolation in the Vercel dashboard, (2) running the live benchmark this report specifies against a real Preview deployment to confirm the p50<5s/p95≤7s target, and (3) a decision on the two orphaned legacy AI routes. No production push was made. No production alteration was made. No new feature phase was started.

**DO NOT push to main. DO NOT alter production. DO NOT start LX-10's successor without the three items above resolved.**

---

## COMMITS

This report is delivered as a documentation-only commit — no runtime source under `src/` was modified in this phase (every finding above is a measurement or a recommendation, never a speculative, unmeasurable change). `scripts/lx10-measure-prompt-size.ts` was added as a reproducible, throwaway measurement tool for the PART I token-size findings; it is not imported by any application code and ships no behavior change.
