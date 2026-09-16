# CANON-R6-PERF-I1 — canonical_prove generation observability

**Instrumentation only. No performance behavior changes. No deploy. No database changes. No push to main. No chunking.**

## STATUS

**CODE PASS.** Behavior is unchanged (verified: zero diff in the pedagogical engine, migration, AI routing/provider selection, token budgets, prompts, Quality Gate rules, novelty behavior, fallback rules, or DB schema; every existing test — including every `[gated_batch]`/`[ai-runtime]` log-shape assertion — still passes unmodified). No additional external calls are introduced (the new `onInvocationDiagnostics` hook is a local callback invoked with already-computed data, never a new network/DB call). `tsc --noEmit`, the full `vitest` suite, and `npm run build` are all clean.

## INSTRUMENTATION MAP

| Phase | Where timed | New field |
|---|---|---|
| Canonical authorization | `route.ts`, around `verifyV1PracticeLaunchMarker`'s call | `canonicalAuthorizationMs` |
| Prior Practice history load | `route.ts`, around `loadPriorPracticeQuestionFingerprints` | `priorHistoryMs` |
| Primary generation | `generateGatedQuestionBatch`'s own `durationMs`, surfaced via `onInvocationDiagnostics` | `generationPrimaryMs` (= the PRIMARY invocation's `durationMs`) |
| Novelty filter (local, pure) | `route.ts`, around each `filterExactDuplicates` call, accumulated across all passes | `noveltyFilterMs` |
| Novelty refill 1 / 2 | Same `onInvocationDiagnostics` mechanism, tagged by which loop iteration triggered it | `novelty_refill_1_ms` / `novelty_refill_2_ms` |
| Persistence | `route.ts`, around `storeQuiz` | `persistenceMs` |
| Whole request | `route.ts`, from function entry to summary emission | `totalMs` |

Also emitted per request (all additive, all local derivations from data already computed): `quizMode`, `canonicalStage`, `targetItemCount`, `difficultyTarget`, `priorPracticeFingerprintCount`, `rejectedExactDuplicateCount`, `acceptedNovelQuestionCount`, `noveltyRefillCount`, `generationInvocationCount`. **No question text is ever logged** — confirmed by source audit (`OBSERVABILITY_SRC` contains no `question:`/`correctAnswer` field, and the route's own summary-building block never spreads `questions`/`question.question` into the payload).

## CORRELATION MODEL

Reuses the existing `parentOperationId` (already minted once per request via `randomUUID()` before this phase) as the request-level correlation id — no parallel correlation model was introduced. The summary's own `operationId` and `parentOperationId` fields both carry this same value, so every `CanonicalProveGenerationInvocationRecord` in the summary's `invocations` array (each of which also carries its own `operationId`/`parentOperationId`, unchanged from the existing `[gated_batch]` convention) joins back to the ONE request-level event trivially. This also means the new summary correlates directly with the pre-existing `[gated_batch]`/`[ai]`/`[quality_gate_summary]` log lines for the same request without any schema change to those.

## REQUEST SUMMARY

Exactly one `CANONICAL_PROVE_GENERATION_SUMMARY` event is emitted per `canonical_prove` `generate-and-take` request, from exactly 3 call sites in `route.ts`: the SUCCESS return (1), the two pre-existing INCOMPLETE choke-point guards (1 each, both reusing the existing `V1_PROVE_GENERATION_INCOMPLETE` reason code as the summary's `errorCode` — no new reason code was invented), and a best-effort ERROR path in the outer `catch` block. Confirmed by source-audit test: exactly 1 SUCCESS call, 2 INCOMPLETE calls, 1 ERROR-result call exist in the route source. `emitCanonicalProveSummary` itself is a no-op (`if (validated.quizMode !== 'canonical_prove') return;`) for every other `quizMode` — verified this returns immediately for `quick_check`/`topic_practice`/every other mode, so Practice and legacy behavior render zero observable difference (same response bodies, same non-canonical-prove log lines, two extra `Date.now()` calls internally that are never read or logged for those modes).

The summary payload includes: `operationId`/`parentOperationId`, `studentIdHash` (never the raw id — see PRIVACY), `conceptId`, `quizMode`, `canonicalStage`, `targetItemCount`, `difficultyTarget`, every phase timer above, `totalMs`, `generationInvocationCount`, `externalAiCallCount`, `fallbackCount`, `semanticVerificationCount`, `noveltyRefillCount`, `priorPracticeFingerprintCount`/`rejectedExactDuplicateCount`/`acceptedNovelQuestionCount` (reused directly from the existing CANON-R6R1 `noveltyDiagnostics` object, not re-derived), `finalQuestionCount`, the full `invocations`/`noveltyPasses` arrays, and `result: 'SUCCESS' | 'INCOMPLETE' | 'ERROR'` (plus `errorCode` when applicable).

## GENERATION INVOCATIONS

Each `generateGatedQuestionBatch` invocation now reports, via the new optional `onInvocationDiagnostics` callback (same additive-hook pattern already established by `onUsage`/`onNonRetryableError` in this same file): `requestedCount`, `acceptedCount`, `durationMs`, `fallbackUsed`, `fallbackReasonCode`, `generationCalls`, `recoveryCalls`, `semanticVerificationUsed`, `semanticCallCount`, `semanticCandidateCount`, `semanticAcceptedCount`, `semanticRejectedCount`, `externalAiCallCount` (= `generationCalls + semanticCallCount`, the key metric for resolving CANON-R6-PERF-DIAG's own open question), `insufficientCount`, `operationId`, `parentOperationId`. This fires on **every** return path inside `generateGatedQuestionBatch` — success, insufficient-after-fallback, non-retryable provider error, and the outer unexpected-error catch — verified by 7 direct unit tests exercising each path with the AI layer mocked.

`route.ts` labels each invocation by WHICH call site triggered it — `generateGatedQuestionBatch` itself has no notion of "primary" vs. "refill":
- The initial call (inside the `conceptIds.map(...)` branch, canonical_prove's own single-concept generation) is tagged `PRIMARY`.
- The CANON-R6R1 novelty refill loop's own `generateGatedQuestionBatch` call is tagged `NOVELTY_REFILL_1` when triggered by loop iteration `attempt === 0`, and `NOVELTY_REFILL_2` when triggered by `attempt === 1` (the loop's own bound, `MAX_NOVELTY_REFILL_ATTEMPTS = 2`, unchanged, means at most these two refills can ever fire).

## AI CALL CORRELATION

The existing `[ai]` log line (`src/lib/ai/logging.ts`) was **not modified** — it already carries `executionId`/`capability`/`model`/`durationMs`/`success` per real provider call, and this phase adds no correlating field to it (per Part 4's own instruction: "If already present: do not duplicate it. Only add missing correlation metadata."). The missing piece was never the `[ai]` line itself — it was that nothing at the request level aggregated WHICH generation invocation each `[ai]` line belonged to. The new summary's `invocations` array (each entry carrying `operationId`/`parentOperationId`, identical to the values `[gated_batch]` and the underlying `[ai-runtime]` events already use for that same invocation) closes that gap without touching `[ai]`'s own shape.

## QUALITY GATE

`applyQuestionQualityGate`'s return type gained two additive fields: `semanticCandidateCount` (how many candidates in this ONE gate call needed a semantic judgment — previously computed internally as `needsSemantic.length` and only logged, never returned) and `semanticAccepted` (the semantic survivors count, previously only in the `[quality_gate_summary]` log line). `gateUnitWithTerraFallback` aggregates these across both its gate passes (`g1`, and `g2` if the fallback fired) into `semanticVerificationUsed`/`semanticCallCount`/`semanticCandidateCount`/`semanticAcceptedCount`/`semanticRejectedCount` on its own return value. Verified by 7 direct unit tests: 0 candidates needing semantic verification, >1 candidates (batched call), exactly 1 candidate (single call), and the aggregation across a fallback where both passes independently needed semantic verification (`semanticCallCount === 2`).

## FALLBACK

`GateUnitResult` gained `fallbackReasonCode: 'SHORT' | 'EMPTY' | null` — a closed enum companion to the existing free-form `fallbackReason` message string (kept unchanged, still used by `[ai-runtime]` events), set to `req.fallbackWhen` when the fallback fires and `null` otherwise. `generateGatedQuestionBatch` always requests `fallbackWhen: 'SHORT'` (unchanged), so for `canonical_prove` this will always read `'SHORT'` when a fallback fires. `primaryAcceptedCount`/`fallbackAcceptedCount` are already available as the pre-existing `lunaAccepted`/`terraAccepted` fields (unchanged, not renamed) — the new fields are additive alongside them, not a replacement.

## NOVELTY

Each novelty-filter pass (`route.ts`'s existing CANON-R6R1 loop) now pushes a `CanonicalProveNoveltyPassRecord` — `noveltyPass: 'INITIAL' | 'REFILL_1' | 'REFILL_2'`, `candidateCount`, `acceptedCount`, `rejectedExactDuplicateCount`, `remainingNeeded` — labeled by loop iteration (`attempt === 0` filters the INITIAL batch, `attempt === 1` filters whatever REFILL_1 produced, `attempt === 2` filters whatever REFILL_2 produced). Combined with the `invocations` array's own `NOVELTY_REFILL_1`/`NOVELTY_REFILL_2`-tagged entries, one live request can now show EXACTLY how many questions were rejected as exact duplicates on each pass, and whether that triggered a real refill generation call or not — directly answering Part 7's own question ("prove whether the live 4-call trace was Path A or Path B").

## ERROR PATHS

`GENERATION_INSUFFICIENT`/`GENERATION_FAILED` (canonical_prove's `V1_PROVE_GENERATION_INCOMPLETE`): both existing choke-point guards now also call `emitCanonicalProveSummary('INCOMPLETE', questions.length, 'V1_PROVE_GENERATION_INCOMPLETE')` before returning — the existing HTTP response is completely unchanged (same status, same body); only an additional log line is emitted. A provider failure or quality-gate failure inside `generateGatedQuestionBatch` itself never throws (unchanged, pre-existing contract) — it resolves to `[]`, which naturally reaches one of the two INCOMPLETE guards above, so those failure modes are covered by the same INCOMPLETE summary path. A genuinely unexpected error reaching `handleGenerateQuiz`'s own outer `catch` (something failing outside `generateGatedQuestionBatch`'s resilience — e.g. `storeQuiz` itself throwing) emits a best-effort `result: 'ERROR'` summary, gated on the RAW, unvalidated `body.quizMode` (since `validated`/`primaryConceptId`/`parentOperationId`/`v1Marker` are declared inside the `try` block and are — deliberately, to avoid touching their existing scoping and every closure that narrows them — out of scope in the `catch`). This error-path summary uses a freshly minted `operationId` (since the real per-request one may not have existed yet if the error occurred very early) and reports `0` for every call-count field it cannot honestly know rather than guessing — documented explicitly as a known limitation, not fabricated data. Existing HTTP error behavior (the ZodError 400, the rethrow to the top-level `POST` handler's own 500) is completely unchanged.

## PRIVACY

Never the student's real id, never question text, never prompts, never correct answers. `hashStudentId` (SHA-256, truncated to 16 hex chars) provides a deterministic, one-way, non-reversible per-student tag purely for a human to recognize "this is our known test student" across log lines in Preview — it is a correlation convenience, not a security boundary, and is never treated as a lookup key back to the real id. Verified by source audit (the observability module's own source contains no `question`/`correctAnswer`/`prompt` field) and by a unit test confirming the route's summary-building block never spreads `questions`/`question.question` into the emitted payload.

## TESTS

New file: `tests/unit/canon-r6-perf-i1-canonical-prove-observability.test.ts` — 30 tests, covering the required matrix:

- **1-2 (summary emission / scoping)**: canonical_prove emits the request summary; `emitCanonicalProveSummary` is a structural no-op for every other `quizMode`; the `onInvocationDiagnostics` callback is spread into the generation options object ONLY when `quizMode === 'canonical_prove'`, so `quick_check`/`topic_practice`/every other mode's options object (and therefore its behavior) is byte-identical to before this phase.
- **3 (Practice unchanged)**: same no-op guard, plus the full regression suite (below) re-confirms zero behavioral drift.
- **4/5/6 (invocation classification)**: PRIMARY/NOVELTY_REFILL_1/NOVELTY_REFILL_2 tagging verified both by direct unit tests on `generateGatedQuestionBatch`'s own diagnostics callback and by source audit of the route's labeling logic.
- **7/8 (fallback true/false)**: `gateUnitWithTerraFallback` tested for both the "enough" (no fallback) and "SHORT"/"EMPTY" fallback-fired branches, confirming `fallbackReasonCode` and the aggregated semantic counts in each case.
- **9 (semantic verification count)**: `applyQuestionQualityGate`'s new `semanticCandidateCount`/`semanticAccepted` fields tested for 0/1/N-candidate shapes (batched vs. single-call), plus `generateGatedQuestionBatch`-level tests confirming `externalAiCallCount` correctly adds the semantic call on top of the generation call.
- **10 (novelty rejected count captured)**: covered by the existing CANON-R6R1 `noveltyDiagnostics` reuse (unchanged) plus the new `noveltyPasses` records' `rejectedExactDuplicateCount` field.
- **11 (final item count)**: `finalQuestionCount` passed directly from `questions.length` at each emission site (source-audited).
- **12 (incomplete generation summary)**: both INCOMPLETE choke-point emission call sites verified to exist exactly once each.
- **13 (no question text)**: source audit of the observability module and the route's summary-building block.
- **14 (no extra external calls)**: `onInvocationDiagnostics` is a plain synchronous callback invoked with already-computed local values — source-audited to confirm no `fetch`/`axios`/`http.request`/DB import in the observability module, and confirmed functionally by the unit tests themselves (the mocked AI layer is called the identical number of times whether or not the callback is passed — see "a caller that does NOT pass onInvocationDiagnostics sees no change at all").
- **15 (full regression green)**: see below.

## FULL REGRESSION

- `npx tsc --noEmit`: clean.
- `npx vitest run`: **251 test files, 4538 tests, all passing** (250 files / 4508 tests before this phase, +1 new file / +30 new tests; zero pre-existing test was weakened, only 3 pre-existing source-audit regexes were updated to match the now-larger, but behaviorally identical, `V1_PROVE_GENERATION_INCOMPLETE` occurrence count — 2 pre-existing occurrences in JSON error bodies + 2 new occurrences where the SAME existing code is also passed as the summary's `errorCode`).
- `npm run build`: clean, all routes compiled.

## FILES CHANGED

- `src/lib/lx/canonical-prove-generation-observability.ts` (new) — summary/record types, `hashStudentId`, `logCanonicalProveGenerationSummary`.
- `src/services/gated-question-generation.service.ts` — additive `onInvocationDiagnostics` hook on `GatedPracticeOptions`; additive `semanticCandidateCount`/`semanticAccepted` on `applyQuestionQualityGate`'s return; additive `fallbackReasonCode`/`semanticVerificationUsed`/`semanticCallCount`/`semanticCandidateCount`/`semanticAcceptedCount`/`semanticRejectedCount` on `GateUnitResult`; `generateGatedQuestionBatch` invokes the new callback on every return path.
- `src/app/api/quizzes/generate-and-take/route.ts` — per-phase timers, invocation/novelty-pass record collection, the `emitCanonicalProveSummary` closure and its 4 call sites (SUCCESS, 2×INCOMPLETE, ERROR), all additive and scoped to `canonical_prove`.

Tests (updated for the intentional, behavior-preserving occurrence-count change):
- `tests/unit/canon-r6-prove-v1-exact10-independent-assessment.test.ts`
- `tests/unit/canon-r6r1-prove-novelty-and-results-single-authority.test.ts`
- `tests/unit/lx9r6-canonical-quiz-generation-reliability.test.ts`

Tests (new):
- `tests/unit/canon-r6-perf-i1-canonical-prove-observability.test.ts`

## COMMITS

- `feat(canon-r6-perf-i1): canonical_prove generation observability` — implementation + all test changes.
- This docs commit (report only).

## LIVE PREVIEW PLAN (not executed — no live DB/Preview access in this environment)

1. Re-run the exact `canonical_prove` `generate-and-take` request from CANON-R6-PERF-DIAG's own live trace (same student/concept fixture).
2. Pull the Vercel function logs for that invocation and find the ONE `CANONICAL_PROVE_GENERATION_SUMMARY` line.
3. Read `generationInvocationCount` and `invocations`:
   - `generationInvocationCount === 1` with that one invocation's own `fallbackUsed: true` → **confirms Path A** (a single gated-batch Terra fallback).
   - `generationInvocationCount === 2` (one `PRIMARY`, one `NOVELTY_REFILL_1`), each with `fallbackUsed: false` → **confirms Path B** (an initial batch plus one novelty refill).
4. Sum each invocation's `externalAiCallCount` and confirm it equals Vercel's own reported external-POST count (4, on the traced run) — this is the cross-check that the new instrumentation's arithmetic matches observed reality.
5. Compare `generationPrimaryMs` (+ `novelty_refill_1_ms`/`novelty_refill_2_ms` if present) against the previously reported 15.78s/2.32s/20.83s/9.19s to map each duration to its actual role for the first time with real evidence rather than the CANON-R6-PERF-DIAG report's own LIKELY/UNKNOWN hedges.
6. Only after this is done should CANON-R6-PERF-DIAG's ARCHITECTURAL OPTIONS be revisited to choose and scope an actual repair — this phase deliberately implements none of them.
