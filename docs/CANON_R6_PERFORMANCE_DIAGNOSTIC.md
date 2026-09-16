# CANON-R6-PERF-DIAG — canonical_prove generation latency diagnostic

**Diagnostic only. No code changed. No deploy. No database changes. No push to main.**

## LIVE EVIDENCE

Real Preview execution, provided by the user:

- `studentId: ec77cac5-841c-41cc-b959-af8ec69ccec5`, `conceptId: 1fb2b93c-0909-4127-9854-a91379825661`
- `session/start`: ~0.6s, correctly returns `stage=PROVE, actionState=EXECUTABLE, activityType=PROVE, launchStatus=READY, mode=canonical_prove, difficulty=3, maxQuestions=10`
- `POST /api/quizzes/generate-and-take`: **48.71s execution duration**
- Vercel reports **exactly 4 external POST calls**: 15.78s, 2.32s, 20.83s, 9.19s → **48.12s total external time**
- `48.12s / 48.71s ≈ 98.8%` of the whole request is external call time; only **~0.59s** is StudyUS's own code (canonical authorization, DB reads, quality-gate CPU work, persistence).
- Target: p50 < 5s, p95 ≤ 7s.

## CALL GRAPH

Traced from `src/app/api/quizzes/generate-and-take/route.ts` for `quizMode === 'canonical_prove'`, with exact line numbers as of this diagnostic (CANON-R6R1 HEAD).

```
generate-and-take (POST)
  -> requestedActivityType = 'PROVE' [local]                                          (route.ts:437)
  -> rawV1Marker = verifyV1PracticeLaunchMarker(...) [DB: evidence rows,               (route.ts:439-441,
       recognitions, misconception counts -- 3 reads via                                        via pedagogical-decision/*)
       getCanonicalPedagogicalDecision]
  -> v1Marker = cross-check(rawV1Marker.canonicalActivityType === 'PROVE') [local]     (route.ts:446-450)
  -> 403 guard if !v1Marker [local, not taken on this trace]                          (route.ts:453+)
  -> maxQuestions = v1Marker.itemCount.authorized = 10 [local]                         (route.ts:652)
  -> v1EffectiveDifficulty = v1Marker.difficulty.target = 3 [local]                    (route.ts:652-653 area)
  -> conceptIds = [conceptId]; perConceptCap = 10 [local]                              (route.ts:687)
  -> parentOperationId = randomUUID() [local]                                          (route.ts:695)
  -> Promise.all([                                                                     (route.ts:712)
       generateGatedQuestionBatch(conceptId, ..., { count: 10, difficulty: 3, ... })   <-- THE generation branch
         -> generateQuestionsForConcept(conceptId, ...) ["Luna generation"]
              -> retrieveContext(...) -> getChunksByConceptId(...) [DB, not external]
              -> executeAI({ capability: QUESTION_GENERATION, model: gpt-5.6-luna })
                   -> callModel -> ONE fetch() to api.openai.com/v1/chat/completions   *** EXTERNAL CALL A ***
         -> gateUnitWithTerraFallback(luna, { targetCount: 10, fallbackWhen: 'SHORT' }, ...)
              -> applyQuestionQualityGate(luna, ...)                                    [local: checkQuestionQualityDeterministic
                                                                                          per question -- PASS/FAIL/NOT_DETERMINISTICALLY_VERIFIED]
                   -> IF >1 candidate NOT_DETERMINISTICALLY_VERIFIED:
                        verifyQuestionQualityBatch(candidates) ["Terra semantic verify, batched"]
                             -> executeAI({ capability: EXPLANATION_EVALUATION, model: gpt-5.6-terra })
                                  -> callModel -> ONE fetch()                          *** EXTERNAL CALL B ***
                      (IF exactly 1 candidate needs it: verifyQuestionQuality -- same shape, still 1 external call.
                       IF 0 candidates need it: NO external call here.)
              -> enough = g1.accepted.length >= 10 ?
                   YES -> return (no fallback; generateGatedQuestionBatch ends here -- 1-2 external calls total)
                   NO  -> regenerateWithTerra() ["Terra regeneration of the WHOLE unit"]
                            -> generateQuestionsForConcept(conceptId, ..., { modelOverride: gpt-5.6-terra })
                                 -> executeAI({ capability: QUESTION_GENERATION, model: gpt-5.6-terra })
                                      -> callModel -> ONE fetch()                      *** EXTERNAL CALL C ***
                          -> applyQuestionQualityGate(terra, ...)                       [local, same deterministic pass]
                               -> IF candidates need semantic verify:
                                    verifyQuestionQualityBatch/verifyQuestionQuality    ["Terra semantic verify #2"]
                                         -> executeAI({ capability: EXPLANATION_EVALUATION, model: gpt-5.6-terra })
                                              -> callModel -> ONE fetch()              *** EXTERNAL CALL D ***
                          -> merge(luna.accepted, terra.accepted), dedupe, cap at 10
                          -> generateGatedQuestionBatch returns (up to 4 external calls total)
     ]) -- (askConfidenceFlags computed in parallel with the above -- local/DB, not external)
  -> questions = shuffleArray(...).slice(0, 10) [local]                                (route.ts:815)
  -> IF quizMode === 'canonical_prove': [CANON-R6R1 novelty block]                     (route.ts:835)
       -> priorFingerprints = loadPriorPracticeQuestionFingerprints(studentId, conceptId) [DB]  (route.ts:836)
       -> for attempt in 0..MAX_NOVELTY_REFILL_ATTEMPTS(=2):                            (route.ts:845+)
            -> filterExactDuplicates(candidates, excludeFingerprints) [local, pure]
            -> IF accepted.length >= 10 OR attempt === 2: break
            -> ELSE: candidates = await generateGatedQuestionBatch(conceptId, ..., { count: needed, ... })
                 -- i.e. THE ENTIRE SUB-GRAPH ABOVE (up to 4 more external calls), for `needed` questions
       -> questions = accepted.slice(0, 10); noveltyDiagnostics = {...} [local]        (route.ts:874-880)
  -> IF questions.length short of 10, or 0: return V1_PROVE_GENERATION_INCOMPLETE [local, not taken on this trace]
  -> v1MarkerToPersist = { ...v1Marker, novelty: noveltyDiagnostics } [local]          (route.ts:952)
  -> storeQuiz(...) [DB write]                                                        (route.ts:956)
  -> return 200 with 10 questions
```

**On this specific live trace (exactly 4 external calls, 200 success, 10 questions returned), the evidence is consistent with exactly ONE of these two structurally-different real paths — see FOUR-CALL INTERPRETATION below for why the two cannot yet be distinguished from the data given:**

- **Path A**: the initial `generateGatedQuestionBatch` call alone produced all 4 external calls (Luna fell short of 10, triggering the full internal Terra fallback + its own semantic re-verification) — the CANON-R6R1 novelty refill loop never fired (zero/no exact duplicates against prior Practice).
- **Path B**: the initial `generateGatedQuestionBatch` call produced only 2 external calls (Luna succeeded, needed a semantic verify, no fallback), but 1+ exact duplicates against prior Practice triggered exactly ONE CANON-R6R1 refill, whose own `generateGatedQuestionBatch(count=needed)` call produced the other 2 external calls (regeneration + its own semantic verify, no further fallback).

## EXTERNAL CALL COUNT

For ONE `canonical_prove` `generate-and-take` request:

- **Minimum: 1.** If all 10 Luna-generated questions happen to be deterministically PASS-able (no `NOT_DETERMINISTICALLY_VERIFIED` items) and zero exact-duplicate novelty rejections occur, only the single Luna generation call fires — no semantic verification call, no Terra fallback, no novelty refill.
- **Realistic/expected floor: 2.** `canonical_prove`'s own generation guidance explicitly steers toward `short_answer, error_detection, justification, prediction` — every one of these deterministically triggers `needsSemantic` in `checkQuestionQualityDeterministic` (`question-quality-contract.ts:206-208`: `answerFormat === 'text'` and `['scenario','case_study','justification','comparison','prediction','error_detection'].includes(type)` both push to `needsSemantic`). This makes it **highly likely, by construction of the guidance itself**, that most or all of a canonical_prove batch needs semantic verification — so the realistic floor for ANY canonical_prove request is 2 external calls (Luna generation + one batched Terra semantic-verification call), not 1.
- **Maximum per single `generateGatedQuestionBatch` invocation: 4** (Luna gen, Luna-batch semantic verify, Terra regen, Terra-batch semantic verify) — this is `gateUnitWithTerraFallback`'s hard ceiling; it never attempts a 3rd generation call (per its own doc comment: "Never a 3rd model call per unit").
- **Maximum per `generate-and-take` request, accounting for CANON-R6R1's `MAX_NOVELTY_REFILL_ATTEMPTS = 2`: up to 3 total `generateGatedQuestionBatch` invocations** (the initial call + at most 2 refills), **each independently capable of up to 4 external calls → theoretical worst case of 12 external AI calls for one canonical_prove request.** A single novelty-duplicate rejection (`1 rejected -> request 1 missing question`) can, in the worst case, cost up to 4 additional external calls just to fill that ONE missing slot (see NOVELTY MULTIPLIER below).

## PROVIDERS

All routing is centrally declared in `src/lib/ai/model-routing.ts` (`CAPABILITY_ROUTING`) — no feature file carries a literal model name.

| Call | Capability | Provider | Model | Why it fires | Timeout | Retry policy | Fallback trigger |
|---|---|---|---|---|---|---|---|
| Luna generation | `QUESTION_GENERATION` | openai | `gpt-5.6-luna` (`LUNA`) | Always, for every unit `generateGatedQuestionBatch` is asked to fill | `DEFAULT_AI_TIMEOUT_MS` = 30_000ms (no override at this call site) | **None** — `executeAI` calls `opts.call(signal)` exactly once (`gateway.ts:182`); `callModel`/the OpenAI adapter make exactly one `fetch()` (`openai.ts:85`) with no internal retry loop | n/a (this IS the primary) |
| Terra semantic verification (single or batched) | `EXPLANATION_EVALUATION` | openai | `gpt-5.6-terra` (`TERRA`) | Whenever `checkQuestionQualityDeterministic` returns `NOT_DETERMINISTICALLY_VERIFIED` for ≥1 candidate | 30_000ms (no override) | None (same single-attempt shape) | n/a — this is itself an evaluation call, not a generation fallback |
| Terra regeneration ("fallback") | `QUESTION_GENERATION` | openai | `gpt-5.6-terra` (via `modelOverride: TERRA`) | `gateUnitWithTerraFallback`'s `enough` check is false: `g1.accepted.length < targetCount` (10) for `fallbackWhen: 'SHORT'`, the mode `generateGatedQuestionBatch` always uses | 30_000ms (no override) | None | Luna's gated output has fewer than 10 accepted survivors |
| Terra semantic verification of the Terra-regenerated batch | `EXPLANATION_EVALUATION` | openai | `gpt-5.6-terra` | Same trigger as row 2, applied to the Terra-regenerated candidates | 30_000ms | None | n/a |

**CONFIRMED** (all four rows, via direct source read of `model-routing.ts`, `gateway.ts`, `openai.ts`, `gated-question-generation.service.ts`, `question-quality-verifier.service.ts`).

## SERIAL DEPENDENCIES

**Every external call in this path is strictly serial. There is zero concurrency anywhere in the canonical_prove generation flow today.**

- Within one `generateGatedQuestionBatch` call: `const luna = await generateQuestionsForConcept(...)` (line 550) must resolve before `gateUnitWithTerraFallback(luna, ...)` (line 574) can even be called, because the gate operates on Luna's output. Inside `gateUnitWithTerraFallback`, `const g1 = await applyQuestionQualityGate(luna, req)` (line 407) must resolve before the `enough` check (line 430) can decide whether to fall back; `const terra = await regenerateWithTerra()` (line 445) only runs after that decision, and `const g2 = await applyQuestionQualityGate(terra, req)` (line 446) only runs after `terra` resolves. This is a strict A → B → C → D chain by construction — the fallback's own existence depends on knowing the primary attempt's gated result.
- Across CANON-R6R1's novelty refill loop (`route.ts:845-871`): a plain `for` loop with `candidates = await generateGatedQuestionBatch(...)` inside it — each iteration's `needed` count depends on the PRIOR iteration's `accepted.length`, so refills are also strictly serial, never `Promise.all`'d.
- `askConfidenceFlags` computation runs concurrently WITH the question-generation `Promise.all` array (route.ts:712), but it is a DB-only lookup with no external call, so it contributes nothing to the 4-call total and doesn't shorten the AI-call critical path.
- The RAG context retrieval (`retrieveContext` → `getChunksByConceptId`) inside `generateQuestionsForConcept` is a DB query, not an external call, and happens serially before the Luna `fetch()` — but its cost is negligible (a single indexed Postgres lookup) next to a 15-20s provider call.

**Precise conclusion: total external latency = A + B + C + D (a sum), not `max(A,B,C,D)`. This is exactly consistent with `15.78 + 2.32 + 20.83 + 9.19 = 48.12s ≈ 48.71s` observed — the ~0.59s gap is StudyUS's own serial local/DB work (canonical authorization reads, novelty fingerprint load, deterministic quality checks, persistence write).**

## QUALITY GATE

Per the spec's own taxonomy (Part 5): the real pattern is **B — generation, then separate AI validation** (batched, never per-question), with an additional, INDEPENDENT wrinkle: **the whole unit can be regenerated once (not repaired) if it falls short.**

- **Not A** ("one generation of 10" with no validation) — `applyQuestionQualityGate` always runs.
- **Confirmed B** — `verifyQuestionQualityBatch` sends ALL candidates needing semantic judgment in ONE Terra call (`question-quality-verifier.service.ts:287-330`), explicitly to avoid "N separate ones" (doc comment, `gated-question-generation.service.ts:191-198`). This is a genuine cost optimization already in place — the alternative (C) would be far worse.
- **Not C** ("per-question validation") — confirmed structurally: `verifyQuestionQualityBatch` is called exactly once per gate pass regardless of how many candidates (>1) need verification; only when exactly 1 candidate needs it does the single-candidate `verifyQuestionQuality` run (also exactly once).
- **Not D** ("generation + repair")** — `question-quality-verifier.service.ts`'s own system prompt states explicitly: "You do NOT rewrite, fix or improve it -- you only judge." There is no AI-driven repair anywhere in this pipeline; `repairInvalidJsonEscapes`/`isLatexCorrupted` are pure, local, string-level operations (JSON-escape fixing and corruption filtering), never AI calls.
- **Quality Gate DOES create external model calls** — every semantic-verification pass is itself a real, billable Terra call (rows 2 and 4 of the PROVIDERS table). It is not a free, local check.

**Token-budget finding (CONFIRMED, not previously documented)**: the actual `maxTokens` sent to the provider for question generation is computed inline as `Math.min(16000, 900 * count + 1500)` (`quiz-generation.service.ts:499`), **not** from `TOKEN_BUDGETS.question_generation_practice.maxOutputTokens` (4200 — that field is unused at this call site; only its `reasoningEffort: 'low'` is read). For `count=10` (canonical_prove), this yields **`maxTokens = 10,500`** — 2.5× the ~4,200 a 3-question canonical Practice request has ever exercised at this same call site. Similarly, `verifyQuestionQualityBatch`'s own `maxTokens = Math.min(16000, 300 + candidates.length * 900)` (`question-quality-verifier.service.ts:296`) scales with candidate count — for up to 10 candidates needing verification, that's **`maxTokens = 9,300`** on Terra. **Both the generation AND the verification calls are asked to produce roughly 2.5× the completion volume anything in this codebase has exercised at this call site before CANON-R6/R6R1 introduced exact-10 canonical_prove.** This is a plausible, source-grounded, independent contributor to the observed per-call durations, separate from and additive to the serial-chaining problem above.

## NOVELTY MULTIPLIER

Traced exactly, using `route.ts`'s CANON-R6R1 refill loop and `filterExactDuplicates`:

- **Zero duplicates**: `filterExactDuplicates(candidates, priorFingerprints)` returns `accepted.length === 10` on the first pass. The loop's `if (accepted.length >= maxQuestions || attempt === MAX...) break;` fires immediately. **No refill, no extra external calls.**
- **One duplicate**: `accepted.length === 9`. `needed = 10 - 9 = 1`. The loop calls `generateGatedQuestionBatch(conceptId, ..., { count: 1, ... })` — **this is the FULL gated pipeline, not a lightweight top-up.** `generateGatedQuestionBatch` has no reduced-cost mode for small counts; it runs the identical Luna → gate → (Terra fallback if short) → gate sequence, just with `target = 1`. Confirmed: **yes, the refill invokes the entire gated generation pipeline again.** In the worst case (Luna's single candidate needs semantic verification AND gets rejected, triggering its own Terra fallback + re-verification), **one missing question can cost up to 4 additional external calls** — doubling the request's total external-call count from a hypothetical 2 (initial, clean) to 6.
- **Several duplicates**: same mechanism, `needed` scales with the deficit, but the call-count ceiling per refill attempt is unchanged (still capped at 4 external calls per `generateGatedQuestionBatch` invocation, regardless of how many questions that invocation is asked for — the ceiling is per-INVOCATION, not per-QUESTION).
- With `MAX_NOVELTY_REFILL_ATTEMPTS = 2`, at most 2 refill attempts occur, each independently up to 4 external calls, on top of the initial attempt's own up to 4 — **theoretical ceiling: 3 × 4 = 12 external calls for one canonical_prove request**, as stated in EXTERNAL CALL COUNT above.

## FOUR-CALL INTERPRETATION

| Conclusion | Confidence |
|---|---|
| The request made exactly 4 external AI calls, all serial | **CONFIRMED** (Vercel's own report; consistent with the serial architecture traced above) |
| All 4 calls used OpenAI, models `gpt-5.6-luna` and/or `gpt-5.6-terra` | **CONFIRMED** (only providers/models this code path can call) |
| Total external time (48.12s) accounts for ~98.8% of the request | **CONFIRMED** (arithmetic from the given numbers) |
| The 4 calls came from a SINGLE `generateGatedQuestionBatch` invocation whose Luna output fell short of 10, triggering its own internal Terra fallback + re-verification (**Path A**) | **LIKELY** — this is the only way `gateUnitWithTerraFallback` itself produces exactly 4 calls, and requires zero CANON-R6R1 refill activity |
| The 4 calls instead came from an initial clean 2-call `generateGatedQuestionBatch` success PLUS exactly one CANON-R6R1 novelty refill (also a clean 2-call success) (**Path B**) | **LIKELY** — equally consistent with "exactly 4 calls," and arguably better matches the DIFFERENT magnitudes among the 4 durations (a refill for only 1-2 missing questions has a much smaller `maxTokens` request than the initial full-10 batch, plausibly explaining why two of the four durations, e.g. 2.32s and 9.19s, are much shorter than the other two) |
| Which specific duration (15.78s / 2.32s / 20.83s / 9.19s) corresponds to which named call (Luna gen / Terra verify / Terra regen / etc.) | **UNKNOWN** — cannot be determined from call count + duration alone; requires the actual `[ai]`/`[gated_batch]` log lines for this specific request (see REQUIRED INSTRUMENTATION) |
| Vercel's reported call ORDER matches chronological execution order | **UNKNOWN** — not verified against raw log timestamps in this diagnostic; assumed likely given the architecture is fully serial, but not confirmed |

**This ambiguity is a genuine, honest gap in this diagnostic** — it does not change the headline finding (the architecture is fully serial and the sum of a small number of individually-slow calls dominates total latency), but it does mean the specific repair target (fix the Terra-fallback path vs. fix the novelty-refill path vs. both) cannot yet be prioritized with certainty. Both paths funnel through the exact same `generateGatedQuestionBatch` function, so **the fix identified in ARCHITECTURAL OPTIONS below addresses both interpretations simultaneously** — this is not a blocking ambiguity for choosing a direction, only for explaining precisely what happened on this one specific run.

## 7-SECOND FEASIBILITY

**No. The current fully-synchronous, fully-serial architecture cannot realistically meet p95 ≤ 7s for canonical_prove, and this is not a tuning problem.**

Reasoning, without weakening or redefining the target:

1. A SINGLE external call in the live trace took 20.83s, and another took 15.78s. Either one alone, in isolation, already exceeds the ENTIRE 7-second budget by 2-3×. No amount of local optimization (parsing, DB queries, persistence) can claw back time that is spent inside a single provider round-trip StudyUS does not control the duration of.
2. The architecture is 100% serial (see SERIAL DEPENDENCIES) — total latency is a SUM, not a MAX, across up to 4 (worst case 12) external calls. Even if every individual call were reliably fast, summing 2-4 sequential provider round-trips (each with its own real network/inference variance) makes a 7s p95 fragile at best.
3. Individual AI provider call latency has irreducible variance (model load, prompt/output size, provider-side queuing) that StudyUS's code does not control. Even a well-architected SINGLE call can occasionally exceed several seconds. Any design that keeps generation fully synchronous with the learner's own HTTP request therefore carries an inherent risk of missing a strict p95, no matter how much of the "avoidable" serial chaining is removed.
4. Therefore: reducing the NUMBER of serial calls and their SIZE (chunking, avoiding unnecessary fallback chains) can substantially improve p50 and probably p95 in the common case, but **cannot deterministically guarantee ≤7s** as long as generation happens synchronously inside the learner-facing request. Only removing generation from that request's critical path (a cache-hit / pre-generated read) can make the guarantee unconditional.

This assessment does not touch or redefine "load time" — it is about whether the CURRENT architecture, generating fresh AI content synchronously inside the request the learner is waiting on, can structurally meet the stated target. It cannot, reliably, without an architectural change of the kind described below.

## ARCHITECTURAL OPTIONS

All four preserve exact-10, D3-D4 difficulty, independence, canonical authority, novelty (exact-duplicate exclusion), and the evidence contract exactly as CANON-R6/R6R1 established them — none weaken any of those.

### Option 1 — Concurrent chunking (reuse the existing, already-proven pattern)

`generatePracticeQuestions` already does exactly this for `topic_practice`/`review` when `count > MAX_QUESTIONS_PER_CHUNK` (4): `planChunks(10)` → N parallel Luna calls (`Promise.all`) → N parallel `gateUnitWithTerraFallback` calls (each chunk's own Terra fallback, if needed, fires independently and concurrently with its siblings) → ONE bounded aggregate recovery call only if the total still falls short after all chunks' own gates. `retention_check`'s RET-R2 design uses the same shape (2 concurrent initial Luna calls). Applying this to canonical_prove's exact-10 requirement means the SLOWEST branch determines wall-clock time, not the SUM.
- **Latency**: total time ≈ `max` across concurrent chunks' own (smaller, per-chunk) serial chains, rather than the sum across all 10 questions. Each chunk's own `maxTokens` also shrinks (a 3-4 question chunk vs. a 10-question batch), independently reducing per-call duration.
- **Pedagogical integrity**: unchanged — same deterministic + semantic gate, same models, same acceptance bar, per chunk.
- **Exact-10 preservation**: requires reconciling with Prove's own all-or-nothing contract; the natural design mirrors Practice's own EMPTY-tolerant-per-chunk + ONE bounded aggregate recovery round (proven, not novel).
- **Novelty preservation**: the fingerprint-exclusion set must be a single accumulator shared across chunks (local, cheap) rather than per-chunk-isolated, so cross-chunk duplicates are still caught.
- **Implementation complexity**: moderate — generalizes an existing pattern rather than inventing one; the riskiest part is correctly threading the shared novelty-exclusion accumulator through concurrent chunk gates.
- **Operational cost**: roughly unchanged total AI spend in the common case (same total questions requested); more calls of smaller size rather than fewer calls of larger size.
- **Risks**: does NOT, by itself, provide a deterministic guarantee of p95 ≤ 7s (see FEASIBILITY) — a chunk's own worst-case fallback chain can still be slow, just less often and less severely than today's single 10-question chain.

### Option 2 — Pre-generation / background replenishment ahead of the learner's click

`session/start` already knows, ~0.6s before `generate-and-take` is ever called, that this concept is `PROVE/EXECUTABLE`. Trigger canonical_prove's generation (the full Option-1-improved pipeline) as a background job at that moment (or even earlier — right when a canonical Practice pass qualifies), cache the accepted 10-question set, and have `generate-and-take` become a fast cache read + re-validation (re-check novelty against the freshest prior-Practice fingerprints at click-time, since more Practice could occur between pre-generation and the actual click) rather than a live generation.
- **Latency**: the only option that can DETERMINISTICALLY guarantee learner-facing latency independent of AI provider variance, since generation is off the synchronous critical path entirely.
- **Pedagogical integrity**: unchanged, IF the cached batch is re-validated (contract compliance, novelty) at consumption time rather than trusted blindly from generation time.
- **Exact-10 preservation**: unchanged — same generator, same gate, just run earlier.
- **Novelty preservation**: requires a genuine re-check at click time (not merely at pre-generation time), since the "already-Practiced" set can grow in between.
- **Implementation complexity**: highest of the four — needs a background job/queue, a cache/storage layer, cache-invalidation policy (student re-Practices, content changes, concept edits), and a defined cold-cache fallback path (which still needs Option 1's improvements, since a cache miss reverts to live generation).
- **Operational cost**: higher — generation may happen for students who never actually click through, and infra (queue/cache) has its own cost.
- **Risks**: cold-cache UX (a student who reaches Prove readiness and clicks within seconds still hits live generation); staleness/invalidation bugs are a real, non-trivial risk class.

### Option 3 — Speculative parallel fallback (trade cost for latency)

Fire the Terra "fallback" generation call CONCURRENTLY with the primary Luna call (and its semantic verification), rather than only after determining Luna fell short — i.e., always request both, use Luna's result if it clears the gate, discard Terra's redundant generation if not needed.
- **Latency**: removes the serial A→C dependency (Terra regen currently only starts after Luna's gate result is known); worst case becomes closer to `max(Luna path, Terra path)` instead of their sum.
- **Pedagogical integrity**: unchanged — same gate, same models; only WHEN Terra's generation call starts changes, not what either model is asked to produce or how survivors are chosen.
- **Exact-10 / novelty**: unchanged, same merge/dedupe logic already in `gateUnitWithTerraFallback`.
- **Implementation complexity**: moderate — mostly a control-flow change in `gateUnitWithTerraFallback`, but changes a currently-conditional cost into an unconditional one.
- **Operational cost**: meaningfully higher — every request now pays for a generation call that is USUALLY thrown away (since Luna succeeding is presumably the common case); needs real production data on how often the fallback actually fires today to judge whether this trade is worth it.
- **Risks**: normalizes a "waste a call to save time" pattern that should be justified by real fallback-rate data, not assumed.

### Option 4 (longer-term, Part 10's actual target) — a reusable Learning Activity Generation Layer

Generalize `generateGatedQuestionBatch` + `planChunks` + `gateUnitWithTerraFallback` (already shared infrastructure, already used differently by Practice's chunk-fast-path, quick_check, retention_check's RET-R2, cumulative/exam, and now canonical_prove) into ONE explicit layer parameterized by: target item count, per-chunk size, fallback semantics (`EMPTY` for partial-tolerant activities, `SHORT` for all-or-nothing ones like Prove/Retention), and a novelty-exclusion policy hook. This is NOT a new architecture — it is naming and completing the generalization these files are already most of the way toward, so LEARN/PRACTICE/PROVE/RETAIN/TRANSFER each declare their own contract against ONE layer rather than five bespoke call sites.
- Combine with Option 1 (chunking) as the layer's own default execution strategy, and treat Option 2 (pre-generation) as a caching layer that sits IN FRONT of it for activities where learner-facing latency is strict (Prove today; potentially others later).
- This is explicitly the direction Part 10 gestures at, and is the recommended EVENTUAL shape — but is a larger, cross-cutting change than "the next repair scope" below.

## RECOMMENDED DIRECTION

1. **Immediate**: implement Option 1 (concurrent chunking) for canonical_prove specifically, since it reuses an already-proven pattern and requires no new infrastructure — but instrument it first (see below) to get real per-chunk latency data before claiming it meets p95 ≤ 7s.
2. **Do not claim p95 ≤ 7s is achieved by Option 1 alone** until real chunked-latency data exists — per FEASIBILITY, only removing generation from the synchronous critical path (Option 2) can make the guarantee unconditional.
3. **Track Option 2 (pre-generation) as the durable fix**, scoped initially to Prove (where the spec's own strict learner-facing target applies), designed from the start as the first concrete instance of Option 4's shared layer rather than a Prove-only cache hack — so Retain/Transfer/Learn can adopt the same mechanism later without a second redesign.
4. **Option 3 (speculative parallel fallback)** is worth real fallback-rate data (how often does `gateUnitWithTerraFallback`'s Terra path actually fire for canonical_prove in practice?) before deciding whether the cost trade is justified — this diagnostic did not have access to that aggregate data.

## REQUIRED INSTRUMENTATION

**Important finding: most of the needed instrumentation ALREADY EXISTS in the code, but this diagnostic did not have access to the raw Vercel function logs for the traced request — only the aggregate "4 external POST calls" panel.**

Confirmed-present, per-call structured logging (would already answer most open questions if pulled for this specific request):
- `[ai]` (`src/lib/ai/logging.ts:50`) — one line per `executeAI` call, with `executionId`, `capability` (`QUESTION_GENERATION` vs `EXPLANATION_EVALUATION`), `model` (`gpt-5.6-luna` vs `gpt-5.6-terra`), `durationMs`, `success`. This alone would map each of the 4 durations to its actual role.
- `[gated_batch]` (`gated-question-generation.service.ts:61`) — `GATED_BATCH_GENERATION_STARTED`/`..._INITIAL_GENERATION_COMPLETE`/`..._RECOVERY_STARTED`/`..._RECOVERY_COMPLETE`/`..._GENERATION_SUCCEEDED`/`..._INSUFFICIENT`, each carrying `operationId`, `parentOperationId`, `generationCalls`, `recoveryCalls`, and a cumulative `durationMs`. **Two separate `operationId`s sharing the same `parentOperationId` would directly confirm Path B (a novelty refill fired); a single `operationId` whose own line shows `recoveryCalls: 1` would directly confirm Path A.**
- `[quality_gate_summary]` / `[quality_gate_rejection]` (`gated-question-generation.service.ts:113-136, 75-94`) — semantic-check counts and per-candidate rejection reasons, without exposing question content.

**Recommended NEW instrumentation** (since none of the above currently correlates into ONE per-request timeline, and route.ts itself has zero timers today):

A single structured summary line emitted once, at the end of the canonical_prove branch in `route.ts`, using the field names the phase itself suggested:

```
canonical_authorization_ms   -- verifyV1PracticeLaunchMarker (DB reads)
prior_history_ms             -- loadPriorPracticeQuestionFingerprints (DB)
generation_primary_ms        -- the initial generateGatedQuestionBatch call's own durationMs
  luna_generation_ms         -- (new, requires threading a per-call timer) the Luna fetch itself
  quality_gate_ms            -- (new) time spent in applyQuestionQualityGate excluding its own semantic call
  semantic_verify_ms         -- (new) the Terra verification call's own duration
  fallback_generation_ms     -- (new) the Terra regeneration call's own duration, present only if fallbackUsed
  fallback_semantic_verify_ms -- (new) present only if the fallback batch also needed verification
novelty_filter_ms            -- filterExactDuplicates (local, should be ~0)
novelty_refill_1_ms          -- present only if a first refill fired; same sub-breakdown as generation_primary_ms
novelty_refill_2_ms          -- present only if a second refill fired
persistence_ms               -- storeQuiz
total_ms                     -- the whole route handler
operationId / parentOperationId -- to correlate with existing [ai]/[gated_batch] lines
```

This does not replace the existing granular logs — it adds ONE line that makes the NEXT Preview run's Vercel timing panel directly attributable without manual cross-referencing.

## NEXT REPAIR SCOPE

Not scoped or estimated in this diagnostic phase (per its own instruction: diagnostic only). The natural next phase, once this report is reviewed, would implement: (1) the instrumentation above, (2) a live Preview re-run to disambiguate Path A vs. Path B and capture real per-call-type latency distributions, THEN (3) Option 1 (chunking) as the first structural fix, explicitly designed as an instance of Option 4's shared layer rather than a Prove-only change — with Option 2 (pre-generation) scoped as a separate, subsequent phase once real chunked-latency data shows whether it's actually required to hit p95 ≤ 7s or whether chunking alone gets close enough to be worth shipping first.

**STOP — diagnostic + report only, per phase instructions. No code changed. No deploy. No database changes. No push to main.**
