# CANON-R6-PERF-R1 — Concurrent chunking for canonical Prove

**Structural latency repair. CODE PASS only — p95 ≤ 7s is a separate, later live certification.**

## STATUS

**CODE PASS.** Behavior for every mode other than `canonical_prove` is byte-identical (verified: zero diff in `src/lib/pedagogical-engine/`, `src/lib/ai/`, migration files, DB schema, or the Quality Gate's own deterministic/semantic rule files). Exact-10, D3-D4, independence, the Quality Gate, semantic verification, exact-duplicate novelty, the v1 evidence contract, and fail-closed semantics are all preserved — none weakened. `tsc --noEmit`, the full `vitest` suite, and `npm run build` are all clean. **LIVE PASS is NOT claimed** — this is a structural repair verified by source and unit tests only; actual wall-clock improvement must be measured on the next Preview run.

## LIVE ROOT CAUSE

CANON-R6-PERF-I1's own live summary (real Preview run) definitively confirmed **Path A**: ONE monolithic `generateGatedQuestionBatch(count=10)` invocation, never a novelty refill (`noveltyRefillCount: 0`, `noveltyFilterMs: 0`).

| Phase | Duration |
|---|---|
| Total request | 64.747s |
| `generationPrimaryMs` (the one invocation) | 64.362s |
| — Luna generation (requested 10, returned 6) | 14.334s |
| — Terra semantic verification (6 generated, 6 accepted) | 2.275s |
| — accepted 6 < target 10 → `fallbackReasonCode: SHORT` | — |
| — Terra fallback generation (returned 8) | 26.721s |
| — Terra semantic verification (7 accepted, 1 rejected) | 20.608s |
| Final merge | 10 questions |

All four external calls were strictly **serial**, inside the SAME invocation's own `gateUnitWithTerraFallback` chain — confirmed structurally in CANON-R6-PERF-DIAG and now confirmed empirically. The problem was never novelty refill; it was one monolithic exact-10 unit's own serial SHORT-fallback chain.

## OLD CALL GRAPH

```
generate-and-take (canonical_prove)
  -> generateGatedQuestionBatch(conceptId, ..., { count: 10, fallbackWhen: 'SHORT' })
       -> Luna generation (count=10, maxTokens=10,500)          -- SERIAL
       -> gate (deterministic + semantic verify if needed)       -- SERIAL, after Luna
       -> IF accepted < 10: Terra fallback generation (count=10) -- SERIAL, after gate verdict
       -> gate the fallback batch too                            -- SERIAL, after Terra
  -> (CANON-R6R1) novelty filter -> IF short: refill (up to 2x, EACH refill re-running
     the ENTIRE chain above) -- never actually needed on the live trace
```

## NEW CALL GRAPH

```
generate-and-take (canonical_prove)
  -> generateConcurrentChunkedBatch(conceptId, ..., { count: 10 })
       -> chunkPlan = planChunks(10)                             -- e.g. [4, 3, 3]
       -> Promise.all(chunkPlan.map(chunkSize => {
            -> Luna generation (count=chunkSize, e.g. maxTokens=5,100 for 4)   -- CONCURRENT across chunks
            -> gate (fallbackWhen: 'EMPTY' -- Terra fires ONLY if this
               chunk's own output is completely empty, never merely short)     -- CONCURRENT across chunks
          }))
       -> AI-free cross-chunk exact-text dedup -> aggregate accepted
  -> loadPriorPracticeQuestionFingerprints (ONCE, unchanged from CANON-R6R1)
  -> filterExactDuplicates(aggregate, priorFingerprints)          -- INITIAL novelty pass
  -> IF accepted < 10:
       -> deficit = 10 - accepted.length
       -> recoveryRequestedCount = min(8, deficit + 1)
       -> generateBoundedRecoveryBatch(conceptId, ..., { count: recoveryRequestedCount })
            -> ONE Terra generation call -> ONE gate pass (no internal fallback)  -- SERIAL, but ONCE, and only when needed
       -> filterExactDuplicates(recovery.accepted, accumulatedFingerprints)       -- RECOVERY novelty pass
  -> questions = accepted.slice(0, 10)  -- exactly 10 or fails closed, unchanged choke point
```

## CHUNK PLAN

Reuses `planChunks` (`quiz-generation.service.ts`, unmodified) directly — no Prove-only hardcoded array. For `targetCount = 10`: `planChunks(10)` → `[4, 3, 3]` (chunkCount = `ceil(10/4) = 3`; base = `floor(10/3) = 3`; remainder `1` chunk gets `base+1`). Verified by unit test that `planChunks(10)` sums to exactly 10 and every chunk size is ≤ `MAX_QUESTIONS_PER_CHUNK` (4, unchanged, unmodified).

Every chunk receives the identical canonical `difficulty` (`v1EffectiveDifficulty ?? validated.difficulty ?? resolvedDifficulty?.level ?? 3` — the same defensive fallback chain style every other call site in this route already uses; `v1EffectiveDifficulty` is always defined for a genuinely authorized `canonical_prove` request), the same `guidance`/`activityType`/`quizMode`/`ibContext`/`language`/`visualAidRate` — verified by a unit test asserting every chunk-level `generateQuestionsForConcept` call receives the SAME difficulty value passed to `generateConcurrentChunkedBatch`.

## CONCURRENCY

`generateConcurrentChunkedBatch` fires `Promise.all(chunkPlan.map(async (chunkSize) => {...}))` — structurally, every chunk's own async function body starts executing (and issues its own Luna `generateQuestionsForConcept` call) before `Promise.all` awaits any of them. Verified two ways: (1) source audit confirming the concurrency primitive is `Promise.all(chunkPlan.map(...))`, never a `for`/`while` loop; (2) a functional test where every mocked generation call blocks until ALL chunks have already been invoked, proving no chunk's completion is a prerequisite for another chunk's own call to fire. One chunk's own provider latency (e.g. a slow Luna call, or a chunk that needed its own narrow EMPTY-fallback) runs concurrently with its siblings, never serially blocking them.

## QUALITY GATE

Retained unchanged for both chunks and recovery — never bypassed for speed. Each chunk still runs `checkQuestionQualityDeterministic` (PASS/FAIL/NOT_DETERMINISTICALLY_VERIFIED) followed by `verifyQuestionQuality`/`verifyQuestionQualityBatch` (Terra) for anything not deterministically verified, via the SAME `gateUnitWithTerraFallback`/`applyQuestionQualityGate` primitives `generateGatedQuestionBatch` itself uses — no new, weaker, or bypassed gate path was introduced. `generateBoundedRecoveryBatch`'s own single gate pass is the identical `applyQuestionQualityGate` call, not a lighter check. Verified by unit tests confirming the semantic verifier fires for both `generateConcurrentChunkedBatch` and `generateBoundedRecoveryBatch` when a candidate needs it.

## AGGREGATE RECOVERY

**Deliberately does NOT chunk-level SHORT-fallback.** Each chunk uses `fallbackWhen: 'EMPTY'` (Terra fires only if a chunk's own gated output is completely empty, never merely short of its own chunk target) — reusing exactly the semantics `generatePracticeQuestions`'s own >4-question chunked path has used since LX-4P-PERF-R1C-R1, specifically to avoid "3 chunks × full Terra fallback chains" (Part 5's own stated risk). A chunk that returns 3 of its own requested 4 questions still contributes those 3 — it is never discarded, unlike `generateGatedQuestionBatch`'s own all-or-nothing (`fallbackWhen: 'SHORT'`) contract, which is why chunks are NOT implemented by reusing `generateGatedQuestionBatch` itself (that function's `insufficientCount => []` discard is the wrong semantics for a partial-tolerant chunk).

Only AFTER aggregating every chunk's own survivors, cross-chunk deduping, and running the novelty filter is the TRUE deficit known. If (and only if) that deficit is real, exactly ONE `generateBoundedRecoveryBatch` call fires — one Terra generation + one gate pass, no nested fallback. **Recovery sizing deliberately reuses `generatePracticeQuestions`'s own proven surplus formula** (`Math.min(MAX_QUESTIONS_PER_CHUNK * 2, deficit + 1)`) rather than the spec's own illustrative "request exactly the deficit": that existing formula was itself tuned (RET-R2) against real observed Quality-Gate rejection rates, which showed an unpadded deficit request is materially more likely to still fall short — and since Part 12 permits only ONE recovery round (never a second chance), under-requesting is a real risk this reuse avoids. For a deficit of 1 (accepted 9/10): requests 2. For a deficit of 3 (accepted 7/10): requests 4. For a deficit of 10 (worst case): capped at 8 (`MAX_QUESTIONS_PER_CHUNK * 2`), never unbounded.

## NOVELTY

Exact-duplicate novelty remains fully authoritative, reusing `filterExactDuplicates`/`loadPriorPracticeQuestionFingerprints` unchanged. Order, per Part 7's own preferred flow: (A) concurrent chunks generate and self-deduplicate (AI-free, exact-text) → (B) prior-Practice fingerprints loaded ONCE per request (verified: exactly one `loadPriorPracticeQuestionFingerprints` call inside the canonical_prove block, never per-chunk) → (C) the chunks' own aggregate is filtered against those fingerprints (the `INITIAL` novelty pass) → (D) the TRUE deficit (if any) determines the ONE recovery request → (E) the recovery round's own output is filtered against the FULL accumulated fingerprint set (prior Practice + everything already accepted from the chunks) — never an isolated, chunk-local exclusion set. Verified by a unit test confirming `filterExactDuplicates(recovery.accepted, excludeFingerprints)` runs strictly after, and against the set produced by, the initial filter pass.

## CALL-COUNT BOUND

Finite and non-recursive by construction: **exactly one concurrent-chunk round** (`Promise.all`, no loop) plus **at most one aggregate-recovery round** (`if (accepted.length < maxQuestions)`, never inside a loop, never re-entered). Verified by source audit: `generateConcurrentChunkedBatch`'s own body contains exactly 2 call sites of `generateQuestionsForConcept` (a chunk's own Luna call + its own conditional EMPTY-fallback Terra call), both inside the single `Promise.all`, never inside a retry loop; `generateBoundedRecoveryBatch`'s own body contains exactly 1 `generateQuestionsForConcept` call and never references `gateUnitWithTerraFallback` (no internal fallback-within-recovery); the route's own recovery block contains exactly one `generateBoundedRecoveryBatch(` call site and exactly one `if (accepted.length < maxQuestions)` deficit check. If the final result is still short after this one recovery round, the pre-existing, unmodified choke-point guard fails the whole request closed with `V1_PROVE_GENERATION_INCOMPLETE` — never 8 or 9 questions administered.

**Theoretical worst-case external AI call count** for one canonical_prove request under the new architecture: 3 chunks × up to 2 calls each (Luna + EMPTY-fallback Terra, if a chunk came back completely empty) = 6, + up to 2 semantic-verification calls (one per gate pass that needed it, at most one per chunk) = up to 6 + 3 semantic ≈ 9, + the recovery round's own up to 2 calls (generation + its own semantic verify) = **worst case ≈ 11**, vs. the OLD architecture's worst case of 12 (3 novelty refills × 4 calls each) — a similar theoretical ceiling, but critically, the NEW architecture's calls are **concurrent** for the chunk round (wall time ≈ the slowest chunk, not the sum of all chunks) and **smaller** (see TOKEN-SIZE EFFECT below), whereas the OLD architecture's calls were 100% serial regardless of count.

## TOKEN-SIZE EFFECT

The actual `maxTokens` sent to the provider is `Math.min(16000, 900 * count + 1500)` (unchanged formula, not altered per Part 10's own instruction):

| Request | count | maxTokens |
|---|---|---|
| OLD monolithic canonical_prove batch | 10 | **10,500** |
| NEW chunk (size 4) | 4 | **5,100** |
| NEW chunk (size 3) | 3 | **4,200** |
| NEW recovery, deficit 1 (requests 2) | 2 | **3,300** |
| NEW recovery, deficit 3 (requests 4) | 4 | **5,100** |
| NEW recovery, worst case (capped at 8) | 8 | **8,700** |

Every chunk's own generation request is now 40-60% smaller than the old monolithic request, and even the worst-case recovery round (8,700) stays below it. The semantic-verification side scales similarly (`Math.min(16000, 300 + candidates.length * 900)`): a 4-candidate chunk's own worst-case verification batch is 3,900 tokens vs. the old monolithic batch's worst-case ~9,300 for up to 10 candidates. No change to either token-budget formula itself — the benefit comes naturally from requesting smaller counts per call, exactly as instructed.

## OBSERVABILITY

Extends CANON-R6-PERF-I1's `CANONICAL_PROVE_GENERATION_SUMMARY` event (never removed, only evolved):

- **New**: `chunkPlan` (e.g. `[4,3,3]`), `chunkCount`, `generationConcurrentMs` (wall-clock time of the `Promise.all` round), `initialAcceptedCount` (novel questions after the INITIAL filter, before any recovery), `aggregateRecoveryUsed`, `aggregateRecoveryRequestedCount`, `aggregateRecoveryMs`.
- **`invocations`** now holds one record per concurrent chunk (`invocationType: 'CHUNK'`, tagged with its own `chunkIndex`) plus, at most, one `invocationType: 'AGGREGATE_RECOVERY'` record (`chunkIndex: null`) — replacing the old `PRIMARY`/`NOVELTY_REFILL_1`/`NOVELTY_REFILL_2` model, since there is no longer a single "primary" invocation nor a multi-attempt refill loop.
- **`noveltyPasses`** now uses `'INITIAL' | 'RECOVERY'` (replacing `'INITIAL' | 'REFILL_1' | 'REFILL_2'`).
- **Preserved for schema continuity, always `null` now**: `generationPrimaryMs` (superseded by `generationConcurrentMs`/`chunkPlan`), `noveltyRefill1Ms`/`noveltyRefill2Ms` (superseded by `aggregateRecoveryMs`) — each field's own doc comment in `canonical-prove-generation-observability.ts` states this explicitly, so a consumer of historical summary lines is never confused about a silently-disappeared field.
- `externalAiCallCount`/`fallbackCount`/`semanticVerificationCount`/`generationInvocationCount` are pure sums/counts over `invocations` and continue to work unchanged by the model swap.
- `noveltyRefillCount` is now `aggregateRecoveryUsed ? 1 : 0` — the same underlying concept ("did an extra generation round beyond the first happen"), now correctly bounded to at most 1.

## LEGACY COMPATIBILITY

`quick_check`/`topic_practice`/`review`/`cumulative_assessment`/`exam_simulation`/`diagnostic_check` are **completely untouched** — `canonical_prove` no longer falls through to the generic multi-concept `Promise.all(conceptIds.map(...))` branch at all (it has its own new, dedicated branch, inserted before that generic branch); the generic branch's own source is byte-identical to before this phase (verified: it still calls `generateGatedQuestionBatch` exactly as before, contains zero reference to `onInvocationDiagnostics` or the observability module). `handleSubmitQuiz` (canonical Results, evidence write, rollback, Retention transition) was not touched at all — verified by source audit that neither `generateConcurrentChunkedBatch` nor `generateBoundedRecoveryBatch` is referenced anywhere in that function.

## TESTS

New file: `tests/unit/canon-r6-perf-r1-concurrent-chunking.test.ts` — 26 tests covering the required matrix: chunk plan correctness and reuse of `planChunks` (1/3), concurrency via source audit + a functional blocking test (2), canonical (never per-chunk-adapted) difficulty (4/9-related), cross-chunk exact-duplicate removal (6), Quality Gate retention for both chunks and recovery (17), no speculative/unconditional Terra call (18), recovery-duplicate rejection (13), prior-Practice history loaded once (5), the `accepted >= target` skip path (8), the exact recovery-sizing formula for deficits of 1/3/10 (9/10), unchanged v1-marker/persistence/canonicalResults wiring (19/22), the call-count bound with no retry loop (12/16), and the legacy firewall (quick_check/the generic multi-concept branch unchanged). Four pre-existing test files were updated to reflect the intentional architecture replacement (CANON-R6R1's refill loop → this phase's aggregate recovery) — not regressions, since the underlying guarantees (exact-10-or-fail, novelty authority, bounded retries) are preserved, only the mechanism achieving them changed:
- `tests/unit/canon-r6-prove-v1-exact10-independent-assessment.test.ts` (canonical_prove's dedicated branch, not a generic-branch fallthrough)
- `tests/unit/canon-r6r1-prove-novelty-and-results-single-authority.test.ts` (the refill-loop tests rewritten for the one-shot recovery mechanism)
- `tests/unit/canon-r6-perf-i1-canonical-prove-observability.test.ts` (PRIMARY/REFILL tagging → CHUNK/AGGREGATE_RECOVERY tagging)
- `tests/unit/lx9r6-canonical-quiz-generation-reliability.test.ts` (the `planChunks` import addition)

## FULL REGRESSION

- `npx tsc --noEmit`: clean.
- `npx vitest run`: **252 test files, 4564 tests, all passing** (251 files / 4538 tests before this phase, +1 new file / +26 new tests, 4 pre-existing files updated for the intentional mechanism replacement, zero test weakened).
- `npm run build`: clean, all routes compiled.

## PREVIEW LIVE PLAN (not executed — no live DB/Preview access in this environment)

1. Re-run the exact `canonical_prove` `generate-and-take` request against the same fixture that produced the 64.747s trace.
2. Pull the `CANONICAL_PROVE_GENERATION_SUMMARY` line and read `chunkPlan`, `generationConcurrentMs`, each chunk's own `durationMs`/`fallbackUsed`, `aggregateRecoveryUsed`/`aggregateRecoveryMs`, and `totalMs`.
3. Compare `generationConcurrentMs` (the new concurrent round's wall time) against the old `generationPrimaryMs` (64.362s) — expect it to be materially closer to the SLOWEST single chunk's own duration than to their sum, confirming concurrency actually reduced wall-clock time in production, not just in this diagnostic's own reasoning.
4. Record whether `aggregateRecoveryUsed` fired, and if so, its own `aggregateRecoveryMs` — this is new information the OLD architecture's own single-invocation model couldn't separate out.
5. Repeat across multiple requests before drawing any p50/p95 conclusion — this phase does not, and cannot, certify p95 ≤ 7s from source review alone (per Part 18's own instruction: "Do not fabricate expected seconds").
6. Only after a real, repeated measurement should Options 2 (pre-generation/caching) or 3 (speculative parallel fallback) from CANON-R6-PERF-DIAG be revisited, if the concurrent-chunking repair alone still leaves p95 above target.

## FILES CHANGED

Implementation:
- `src/services/gated-question-generation.service.ts` — new exports `generateConcurrentChunkedBatch`, `generateBoundedRecoveryBatch`; `planChunks` import added.
- `src/app/api/quizzes/generate-and-take/route.ts` — `canonical_prove` now has its own dedicated generation branch (concurrent chunking + aggregate recovery), replacing both the old monolithic `generateGatedQuestionBatch(count=10)` call and CANON-R6R1's own up-to-2-refill loop; `MAX_QUESTIONS_PER_CHUNK` import added; observability wiring updated to match.
- `src/lib/lx/canonical-prove-generation-observability.ts` — summary/invocation/novelty-pass types evolved (CHUNK/AGGREGATE_RECOVERY, new fields, deprecated-but-preserved old fields).

Tests (updated for the intentional CANON-R6R1 → CANON-R6-PERF-R1 mechanism replacement):
- `tests/unit/canon-r6-prove-v1-exact10-independent-assessment.test.ts`
- `tests/unit/canon-r6r1-prove-novelty-and-results-single-authority.test.ts`
- `tests/unit/canon-r6-perf-i1-canonical-prove-observability.test.ts`
- `tests/unit/lx9r6-canonical-quiz-generation-reliability.test.ts`

Tests (new):
- `tests/unit/canon-r6-perf-r1-concurrent-chunking.test.ts`

## COMMITS

- `feat(canon-r6-perf-r1): concurrent chunking for canonical Prove generation` — implementation + all test changes.
- This docs commit (report only).

## REMAINING PERFORMANCE RISK

1. **p95 ≤ 7s is not certified by this phase** and cannot be from source review alone — CANON-R6-PERF-DIAG's own FEASIBILITY finding stands: a single external AI call can independently exceed several seconds due to provider-side latency variance, so even a well-chunked, concurrent architecture cannot GUARANTEE the target the way removing generation from the synchronous request path (pre-generation/caching, deliberately NOT implemented this phase per its own instruction) can. Live, repeated measurement is required before any p95 claim.
2. **The aggregate-recovery round, when it fires, is still a real serial addition** to the concurrent round's own wall time (Terra generation + one gate pass) — if the concurrent chunks' own novelty-filtered aggregate frequently falls short in production, this recovery round's own latency becomes the next thing worth measuring and, if material, optimizing.
3. **No speculative Terra call was added** (per this phase's own explicit instruction) — if live data eventually shows the per-chunk EMPTY-fallback or the aggregate recovery fires often enough to matter, CANON-R6-PERF-DIAG's Option 3 (speculative parallel fallback) remains available for a future phase, contingent on real fallback-rate data this diagnostic still does not have.
4. **This repair is Prove-specific in its current call site** (the route's own new branch), even though `generateConcurrentChunkedBatch`/`generateBoundedRecoveryBatch` were written activity-agnostic specifically so a future Learning Activity Generation Layer (Retention/Transfer/Learn) can adopt them without a second implementation — that generalization itself was deliberately NOT built this phase, per its own instruction.
