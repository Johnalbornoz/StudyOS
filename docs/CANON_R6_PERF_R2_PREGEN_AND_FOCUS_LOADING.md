# CANON-R6-PERF-R2 — Selective canonical Prove pre-generation + focus loading UX

**Cost-aware. Preview-first. CODE PASS. Not a p95 certification.**

## STATUS

**CODE PASS.** `tsc --noEmit`, the full `vitest` suite, and `npm run build` are all clean (254 test files, 4616 tests). Nothing pushed to main, nothing deployed, no live database touched — the new migration is written but **not applied** (no live DB access in this environment). Behavior for every mode other than `canonical_prove` is unchanged (verified by source audit and full regression). The canonical engine remains the sole authority: every consumption path independently re-verifies a fresh canonical decision (`v1Marker`) before ever looking at a prepared activity.

## WHY SELECTIVE PROVE ONLY

CANON-R6-PERF-R1's own live evidence (`chunkPlan=[4,3,3]`, `generationConcurrentMs=14.887s`, `aggregateRecoveryUsed=true`, `aggregateRecoveryMs=11.809s`, `totalMs=27.111s`) proved concurrent chunking cut latency ~58% but confirmed CANON-R6-PERF-DIAG's own finding still holds: **provider-call latency variance makes p95 ≤ 7s structurally unguaranteed while generation stays inside the learner-facing click.** The only architecture that removes this variance from the critical path is pre-generation. This phase scopes it to Prove alone because: (1) Prove is the ONE activity with a real, predictable trigger moment (a Practice pass) that precedes the actual click by a meaningful, usually-nonzero interval; (2) Prove's contract is exact-10, fixed-difficulty, and independent — the least likely canonical activity to need re-adaptation between prep and click; (3) we have zero real cost/waste-rate data yet (Part 30: "Do not expand pre-generation beyond PROVE until we have real data"). Learn/Practice/Retain/Transfer keep their existing, unmodified generation paths entirely.

## TOKEN/COST MODEL

Pre-generation reuses the IDENTICAL certified pipeline (`generateCanonicalProveQuestions`, see PRE-GENERATION TRIGGER below) — its token cost per prepared batch is therefore the SAME as one live cold-cache canonical_prove request (documented in CANON-R6-PERF-R1's own report: ~4,200-5,100 tokens per chunk, worst-case recovery capped at 8,700). The NEW cost this phase introduces is **waste**: a prepared batch generated but never consumed (the learner never clicks Prove, or clicks after the 2-hour TTL). Part 12/30's own required metrics (`preparedCount`, `consumedPreparedCount`, `unusedPreparedCount`, `wasteRate`, `costPerConsumedPreparedActivity`) are the way to quantify this in production — this phase deliberately does not estimate a number for it (no real usage data exists yet), only implements the logging needed to compute it later (see COST METRICS below).

## PRE-GENERATION TRIGGER

`generate-and-take/route.ts`'s `handleSubmitQuiz`, immediately after the existing canonical re-fetch succeeds (`canonicalResultsStatus = 'OK'`, unchanged from CANON-R5R1): if the FRESH decision (`fresh.decision`, already independently computed by the pre-existing, unmodified `getCanonicalPedagogicalDecision` call) shows `stage === 'PROVE' && actionState === 'EXECUTABLE'` with a real `activityContract`, schedules `prepareCanonicalProveActivity(...)` via `after()`. The trigger reads only already-computed values (`fresh.decision`, `resolveAuthorizedItemCount` — the same helper `v1-practice-launch-marker.ts` already uses) — no new canonical logic, no new authority.

## BACKGROUND EXECUTION MODEL

Audited first (Part 3): this repository has no queue, no job table, no cron infrastructure (confirmed by grep — zero hits for `queue`/`Queue`/`BackgroundJob`/`cron` outside one unrelated match, and no `vercel.json`/`vercel.ts`). Next.js 16.3.1 (the installed version) ships `after()` from `next/server` as its own stable, documented mechanism for exactly this: scheduling work to run once the response is sent, backed by Vercel's own `waitUntil` primitive when deployed there (confirmed via `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`). This is the minimum-safe, already-supported mechanism for the current hosting architecture — no new external queue platform was introduced. `after(() => prepareCanonicalProveActivity(...).catch(...))` is never awaited by the response path; the `.catch()` inside the scheduled callback means a background failure can never produce an unhandled rejection.

## PREPARED ACTIVITY STORAGE

A new table, `canonical_prepared_activity` (migration: `database/migrations/20260916_1000_canon_r6_perf_r2_canonical_prepared_activity.sql`), matches the `CanonicalPreparedActivity` shape the phase itself specified: `id`, `student_id`, `concept_id`, `stage`, `pedagogical_policy_version`, `canonical_revision`, `activity_contract` (JSONB snapshot), `status` (`PREPARING`/`READY`/`CONSUMED`/`INVALIDATED`/`FAILED`), `questions` (JSONB, `NULL` until READY), `novelty_policy`, `prior_practice_fingerprint_basis`, `created_at`/`ready_at`/`expires_at`/`consumed_at`, `consumed_by_quiz_id`. **A prepared row is never a learner attempt** — `prepareCanonicalProveActivity` never writes `learning_evidence` or `quiz_sessions` (verified by a unit test scanning every `db.query` call it makes); `consumed_by_quiz_id` is the ONLY link to a real attempt, populated exactly once, at the moment of real consumption.

Named generically (`canonical_prepared_activity`, `stage` CHECK-constrained to `'PROVE' | 'RETAIN' | 'TRANSFER'`) per Part 32's own instruction — this phase's own writers activate ONLY `'PROVE'`; a future phase could add Retain/Transfer preparation onto the SAME table without a second migration.

## DEDUPLICATION

The real guarantee is a **partial unique index**, not application logic: `idx_canonical_prepared_activity_one_active ON canonical_prepared_activity (student_id, concept_id, stage, pedagogical_policy_version) WHERE status IN ('PREPARING', 'READY')`. `prepareCanonicalProveActivity` does a single `INSERT ... ON CONFLICT DO NOTHING RETURNING id`; a losing insert (another active preparation already exists, or a concurrent request wins a genuine race) returns zero rows and the function returns immediately, never calling the generator. `canonical_revision` is deliberately **excluded** from this key (Part 9: a revision bump unrelated to the Prove contract must never force a redundant second preparation while a perfectly compatible one is already active).

## TTL

`PREPARED_ACTIVITY_TTL_MS = 2 hours`, set on every insert. Rationale: a prepared batch is only useful for the SAME study session that just passed Practice — a much longer TTL would keep generated content (and its own novelty basis, which goes stale the moment the learner does ANY more Practice) around for no realistic benefit, while risking staler compatibility checks. Never indefinite (Part 13's own explicit requirement). No sweep/cron job removes expired rows in this phase — `revalidatePreparedActivity`'s own expiry check (`expiresAt < now`) makes an expired row functionally inert at consumption time regardless; a future phase could add a cleanup job without changing this contract.

## CANONICAL REVALIDATION

`isPreparedActivityContractCompatible(prepared, current)` compares ONLY the fields that actually govern what gets administered — `canonicalActivityType`, `itemCount.{min,max,authorized}`, `difficulty.{min,max,target}`, `independence`, `supportLevel`, `minimumScorePercent` — never raw `canonicalRevision` (Part 9's own explicit instruction: "do not require raw canonicalRevision equality blindly"). Verified by a unit test asserting the function's own source never even references `canonicalRevision`. `revalidatePreparedActivity` runs this AFTER the cheap, local checks (`status === 'READY'`, not expired) and BEFORE the genuinely expensive one (a real DB read for fresh novelty).

## NOVELTY REVALIDATION

Part 8's own explicit instruction ("re-check exact novelty against CURRENT prior Practice fingerprints") is implemented literally: `revalidatePreparedActivity` calls `loadPriorPracticeQuestionFingerprints` FRESH (never trusting the stored `prior_practice_fingerprint_basis` hash to decide validity — that hash is diagnostic-only, for a human to see "did the basis change" without re-deriving it) and runs `filterExactDuplicates(prepared.questions, freshFingerprints)`. **Any single collision invalidates the WHOLE prepared batch** — Part 8 never asks for partial patching, and doing so would risk serving fewer than 10 novel questions; the cold-cache path generates a genuinely fresh replacement instead.

## ATOMIC CONSUMPTION

`consumePreparedActivity(id, quizId)` is exactly one SQL statement: `UPDATE canonical_prepared_activity SET status = 'CONSUMED', consumed_at = NOW(), consumed_by_quiz_id = $2 WHERE id = $1 AND status = 'READY' RETURNING questions`. Two concurrent requests racing against the SAME row can only ever have one succeed — the loser's `WHERE status = 'READY'` no longer matches (the winner already flipped it), so it affects zero rows and the function returns `null`, and route.ts's own cache-hit branch falls through to cold generation on that outcome. The real quiz id isn't minted until `storeQuiz` runs (after the ternary resolves), so consumption uses a provisional placeholder id at the moment of atomic use and reconciles `consumed_by_quiz_id` onto the real id immediately after `storeQuiz` returns (best-effort; a reconciliation failure never affects the learner's already-created quiz).

## CACHE HIT

route.ts's `canonical_prove` branch, after `v1Marker` (the fresh, independently-verified canonical authorization) is already established: `findActivePreparedActivity` → if `READY`, `revalidatePreparedActivity` (contract + fresh novelty) → if valid, `consumePreparedActivity` → on success, `preparedCacheStatus = 'HIT'` and the consumed questions are used directly, **zero AI calls**. On ANY other outcome (no active row, still `PREPARING`, invalid/incompatible/stale, or a lost atomic race), falls through to the identical `generateCanonicalProveQuestions` cold-cache call CANON-R6-PERF-R1 already certified.

## COLD MISS

Unchanged from CANON-R6-PERF-R1/R2's own shared pipeline — concurrent chunks, Quality Gate, semantic verification, exact-duplicate novelty, at most one bounded aggregate recovery, exactly 10 or fail closed via the pre-existing choke point. The client sees `ProveFocusLoading`'s own full focused experience once the wait crosses 2s (see FOCUS LOADING UX).

## FOCUS LOADING UX

`src/components/ProveFocusLoading.tsx`, rendered ONLY for `canonical_prove` at the exact spot the quiz page already showed a generic `"generating..."` card (`phase === 'setup' && isCanonicalFlow`) — every other canonical mode is byte-unchanged. Three internal stages, driven by local timers (Part 21): `instant` (0-800ms, renders `null` — no flash on a fast cache hit), `minimal` (800ms-2s, one calm line), `full` (>2s: title "Preparing your Prove", subtitle, the frozen Prove contract shown as four static chips — 10 questions / Independent / Difficulty 3-4 / No hints — an indeterminate 3-dot pulsing animation, and a curated static reminder rotating every 6s). **No fake progress**: no percentage, no countdown, no per-stage checkmarks — this client has no real backend-step signal for the single `generate-and-take` POST it's waiting on (confirmed: no polling endpoint is wired into this component), so Part 18's own "use neutral rotating states rather than fake checkmarks" was followed literally rather than fabricating a multi-step progress illusion. Ready transition: no new gating screen or required click was added — `startCanonicalActivity`'s own existing `.then()` still owns the `setPhase('quiz')` transition, unchanged; `ProveFocusLoading` itself never calls `setPhase`.

## ACCESSIBILITY

`role="status"`/`aria-live="polite"` on the text that actually changes (the title in the minimal stage; the rotating reminder in the full stage) — the decorative pulsing dots are `aria-hidden="true"`, never announced per animation frame. `usePrefersReducedMotion` (a `matchMedia` hook) disables both the dot animation and the reminder's opacity transition when the OS preference is set. No information is conveyed by animation alone — the dots are purely decorative; the actual status is always in the text.

## LANGUAGE

`ProveFocusLoading` accepts `at` (the caller's ACTIVITY_LANGUAGE-scoped translator, `getMessages(quizLanguage)` — the SAME variable `quiz/page.tsx` already uses for every other v1 canonical string) as a prop and never imports its own translator, so it structurally cannot use the wrong language source. 10 new message keys × 5 locales (es/en/de/fr/pt) — title, subtitle, 4 contract-chip labels, 4 curated tips — all static, human-authored copy (Part 19's own explicit instruction: never AI-generated tips).

## OBSERVABILITY

A new `CANONICAL_PROVE_CACHE_SUMMARY` event (`canonical-prove-generation-observability.ts`), emitted for EVERY `canonical_prove` request (hit, miss, preparing, or invalid) alongside — never instead of — the existing `CANONICAL_PROVE_GENERATION_SUMMARY` (which continues to describe cold-cache generation exactly as CANON-R6-PERF-I1/R1 built it, unchanged). Fields: `preparedCacheStatus` (`HIT`/`MISS`/`PREPARING`/`INVALID`/`EXPIRED`/`FAILED`), `canonicalAuthorizationMs`, `preparedLookupMs`, `preparedValidationMs`, `sessionCreationMs`, `totalReadyHitMs` (only non-null on a `HIT`). `prepareCanonicalProveActivity` also emits its own structured lines (`prove_pregeneration_started`/`_ready`/`_failed`/`_skipped_duplicate`), and consumption emits `prove_pregeneration_consumed`/`prove_pregeneration_invalidated` — matching Part 12's own required event names exactly.

## COST METRICS

Not aggregated/dashboarded this phase (Part 12: "Do not invent aggregate dashboards yet"). What IS logged, sufficient to COMPUTE every required metric later from raw log lines: `preparedCount` (count of `prove_pregeneration_started`), `consumedPreparedCount` (count of `prove_pregeneration_consumed`), `unusedPreparedCount`/`wasteRate` (derivable: prepared minus consumed, or a query over `canonical_prepared_activity` rows with `status NOT IN ('CONSUMED')`), `cacheHitCount`/`cacheMissCount` (from `CANONICAL_PROVE_CACHE_SUMMARY`'s own `preparedCacheStatus`), `generationCostUSD`/`costPerConsumedPreparedActivity` (derivable from the EXISTING `[ai]`/`[ai-runtime]` cost-tracking lines, already correlated via `operationId`/`parentOperationId`, cross-referenced against `prove_pregeneration_*` events by the same correlation ids), `preparedAgeAtConsumptionMs` (derivable: `consumed_at - ready_at`, both persisted columns).

## TESTS

Three new test files (101 tests total): `canon-r6-perf-r2-prove-pregeneration.test.ts` (38 — real mocked-DB tests of `isPreparedActivityContractCompatible`, `prepareCanonicalProveActivity`'s dedup/generation/failure-safety, `revalidatePreparedActivity`'s full sequence, `consumePreparedActivity`'s atomicity, TTL, the migration's own additive/dedup/generic-naming properties, and route-level trigger/consumption wiring), `canon-r6-perf-r2-focus-loading-ux.test.ts` (13 — the loading component's own timing thresholds, no-fake-progress guarantee, reminder rotation, reduced-motion, language-prop-only sourcing, ready-transition non-interference), and existing `canon-r6-perf-i1`/`canon-r6-perf-r1`/`canon-r6-prove-v1-exact10`/`canon-r6r1` files updated (never weakened) for the intentional extraction of the generation pipeline into a shared service (CANON-R6-PERF-R1's inline route logic now lives in `canonical-prove-generation.service.ts`, called identically by both the live and background paths).

## FULL REGRESSION

- `npx tsc --noEmit`: clean.
- `npx vitest run`: **254 test files, 4616 tests, all passing** (253 files / 4603 tests before this phase already included the PERF-R1 baseline; +2 new files this phase for the pregeneration/UX-specific matrix, 4 pre-existing files updated for the shared-service extraction, zero test weakened).
- `npm run build`: clean, all routes compiled.

## DB MIGRATION

**One new additive table, not applied** (no live DB access in this environment). `CREATE TABLE IF NOT EXISTS` + `CREATE UNIQUE/regular INDEX IF NOT EXISTS` throughout (idempotent, matching this repository's own established migration convention). No `ALTER`/`DROP` of any existing table. Preview-only when eventually applied; Production cutover remains unconfigured, per every prior phase in this session.

## PREVIEW LIVE PLAN (not executed — no live DB/Preview access in this environment)

**A. READY HIT**: (1) complete a real Practice v1 attempt that qualifies for Prove; (2) wait a few seconds (allow `after()`'s background preparation to complete — check `prove_pregeneration_ready` in the logs); (3) launch Prove; (4) confirm the `CANONICAL_PROVE_CACHE_SUMMARY` line shows `preparedCacheStatus: 'HIT'`, `externalAiCallCount: 0` on the accompanying `CANONICAL_PROVE_GENERATION_SUMMARY` (since no generation ran), and `totalReadyHitMs` well under 7s; (5) confirm exactly 10 questions, D3-D4, independent, no hint/Tutor UI, matching every CANON-R6/R6R1 guarantee unchanged.

**B. COLD MISS**: (1) launch Prove immediately (before background preparation could plausibly finish, or for a concept where no qualifying Practice pass has happened via this exact flow); (2) confirm `ProveFocusLoading`'s full experience renders after ~2s; (3) confirm the SAME CANON-R6-PERF-R1 chunked pipeline runs (`CANONICAL_PROVE_GENERATION_SUMMARY` populated, `chunkPlan` present); (4) confirm exactly 10 or a clean `V1_PROVE_GENERATION_INCOMPLETE` failure, never fewer.

**C. Deduplication**: trigger two qualifying Practice submissions for the same concept in quick succession (two tabs); confirm only ONE `prove_pregeneration_started` fires (the second logs `prove_pregeneration_skipped_duplicate`).

**D. Staleness**: after a prepared batch is READY, complete additional Practice for the SAME concept (introducing new prior-Practice fingerprints), then click Prove; confirm `revalidatePreparedActivity` either still validates (no actual collision) or correctly invalidates and falls back to cold generation — never serves a batch containing an exact repeat.

## FILES CHANGED

Implementation:
- `database/migrations/20260916_1000_canon_r6_perf_r2_canonical_prepared_activity.sql` (new)
- `src/services/canonical-prove-generation.service.ts` (new — the shared certified pipeline, extracted from route.ts)
- `src/services/canonical-prepared-activity.service.ts` (new — prepare/find/compatibility/revalidate/consume/invalidate + TTL)
- `src/components/ProveFocusLoading.tsx` (new)
- `src/app/api/quizzes/generate-and-take/route.ts` — the trigger (`handleSubmitQuiz`), cache-hit/miss branch (`handleGenerateQuiz`'s canonical_prove ternary now delegates to the shared generator and prepared-activity service), cache observability
- `src/app/dashboard/quiz/page.tsx` — renders `ProveFocusLoading` for `canonical_prove` only
- `src/lib/i18n/messages.ts` — 10 new keys × 5 locales
- `src/lib/lx/canonical-prove-generation-observability.ts` — the new `CANONICAL_PROVE_CACHE_SUMMARY` event

Tests (updated for the intentional shared-service extraction):
- `tests/unit/canon-r6-perf-i1-canonical-prove-observability.test.ts`
- `tests/unit/canon-r6-perf-r1-concurrent-chunking.test.ts`
- `tests/unit/canon-r6-prove-v1-exact10-independent-assessment.test.ts`
- `tests/unit/canon-r6r1-prove-novelty-and-results-single-authority.test.ts`

Tests (new):
- `tests/unit/canon-r6-perf-r2-prove-pregeneration.test.ts`
- `tests/unit/canon-r6-perf-r2-focus-loading-ux.test.ts`

## COMMITS

- `feat(canon-r6-perf-r2): selective canonical Prove pre-generation + focus loading UX` — implementation + all test changes.
- This docs commit (report only).

## REMAINING RISKS

1. **No live Preview execution occurred** (no DB/AI access in this environment) — every claim above (cache-hit latency, dedup-under-race, staleness-invalidation behavior) is verified at the unit/source-audit level, not against a real database or real AI provider. The Preview Live Plan above is written but unexecuted.
2. **Real cost/waste data does not yet exist.** This phase implements exactly the logging needed to compute hit rate, waste rate, and cost-per-consumed-batch — it does not (and per Part 30, should not) claim what those numbers will actually be in production.
3. **No TTL sweep job.** Expired rows become inert at consumption time (via `revalidatePreparedActivity`'s own expiry check) but are never proactively deleted — the table will accumulate `FAILED`/`INVALIDATED`/expired-but-`READY` rows over time. Acceptable for a first phase with unknown real volume; a cleanup job is a natural, low-risk follow-up once usage data justifies it.
4. **The consumption-time atomic UPDATE uses a provisional placeholder `quizId`**, reconciled onto the real id immediately after `storeQuiz`. This is a narrow window (a few DB round-trips) where `consumed_by_quiz_id` doesn't yet point at the real attempt; the consumption itself (the part that matters for single-use correctness) is still fully atomic and race-free — only the DIAGNOSTIC linkage has a brief lag, and a reconciliation failure is logged but never blocks or corrupts the learner's actual quiz.
5. **Speculative parallel Terra fallback (CANON-R6-PERF-DIAG's Option 3) was deliberately not added** (Part 13's own instruction) — if live data eventually shows the concurrent-chunk round's own EMPTY-fallback or the aggregate recovery fires often enough to matter for cache-miss latency, that remains available for a future phase.
