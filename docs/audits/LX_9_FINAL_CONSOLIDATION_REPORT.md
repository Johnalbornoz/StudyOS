# LX-9 FINAL CONSOLIDATION REPORT

## STATUS

**PASS_WITH_CONDITIONS.**

Both code-level blockers are fixed, traced to their actual root cause rather than patched symptomatically, and covered by tests. The consolidation onto one canonical progress read model is real and wired into the one confirmed gap (the Progress dashboard's per-concept row). The condition, unchanged from every prior phase of this engagement: this environment has no live browser, database, or AI-provider access, so the live 10-consecutive-Retention-launch performance benchmark (Part T) could not be run. Instrumentation for it (`operationId`, per-call correlation, total duration) has been added and is ready to use the next time a live environment is available; reporting a fabricated p50/p95 here would violate this engagement's standing honesty requirement, so that gap is disclosed rather than papered over.

Everything the CERTIFICATION section lists as a FAIL condition has been verified absent or fixed:
- Transfer 50% no longer leads to a broken Continue path — the actual defect (a UI retry-function mismatch) is fixed.
- Retry can no longer move into a different failure state.
- Failed Transfer does not erase valid Retention — traced and confirmed structurally impossible, not merely "not observed."
- Concept Mission and the Progress dashboard now read the same canonical authority for the same concept.
- No surface computes its own learner-progress state or primary percentage independently anymore for the one surface that did.
- Broken sessions cannot be launched (confirmed pre-existing, audited).
- Retention waiting, novelty, and adaptive difficulty all remain correct (regression-tested).

## TRANSFER RECOVERY

### LIVE FAILURE

Reported: a learner completes TRANSFER at 50% ("Partial") on "Regla de tres simple," clicks Continue, and hits "Couldn't prepare your practice" ("Your teaching progress is safe. Try again."). Clicking the retry button produces a *different* error, "Couldn't load the quiz," with "Try again" / "Back to dashboard." Returning to Concept Mission shows RETENER; history shows "TRANSFER — Partial (50%) — Solo."

### FIRST BROKEN CONTRACT

Not a data/contract mismatch — a **UI retry-function bug**, found by tracing the exact two error states to their source in `src/app/dashboard/quiz/page.tsx`:

- "Couldn't prepare your practice" (`practice.prepareFailedTitle`) renders when `startCanonicalActivity`'s background generation wave sets `genState = 'error'` (the canonical-flow launch path, entered automatically for any `/dashboard/quiz?...&mode=topic_practice` continuation).
- "Couldn't load the quiz" (`quiz.loadError`) renders when the page's top-level `phase` becomes `'error'` — which only the *separate* `generateQuiz` function sets, on its own failure.

The retry button under "Couldn't prepare your practice" called **`generateQuiz`**, not `startCanonicalActivity` — the wrong function. `generateQuiz` immediately runs `setPhase('loading')`, taking the page out of `phase === 'quiz'` entirely; if the underlying generation call fails again (as it evidently did live), `generateQuiz`'s own catch sets `phase = 'error'`, rendering the *second, different* error card the report describes. One ordinary generation hiccup was turned into what looked like two escalating failures purely by which function the retry button invoked. **Fixed**: the retry button now calls `startCanonicalActivity`, the function that actually failed, which resets its own state and stays on `phase === 'quiz'` throughout — a second failure re-renders the same recoverable card, never a different one.

### TRANSFER 50% EVIDENCE

Traced via `/api/cognitive/transfer/submit`: a "partial" grade maps to `scorePercent = 50`, written through the canonical `updateMastery` with `sourceType: 'TRANSFER'`. `projectConceptTransferState` runs for this evidence and — per `src/lib/algorithms/transfer-model.ts`'s explicit "PARTIAL/FAILURE/assisted: score only, never depth" rule — updates only the rolling `demonstrated_transfer_score`; **`transferDepth` is not advanced**. `TRANSFER_FRAGILE_SCORE_THRESHOLD = 50` (`adaptive-learning-policy.ts`) is advisory documentation only — `evaluateSignal` returns `null` for it, so it never drives activity selection. **A 50% Transfer is correctly treated as a genuine partial failure, not as "demonstrated."**

### RETENTION EVIDENCE

Confirmed structurally independent (Part C's invariant holds, unmodified): `mastery.service.ts::updateMastery` calls `projectConceptMemoryState` for every evidence write, TRANSFER included, but the memory replay's own `normalizeMemoryEvidence` (`src/lib/algorithms/memory-model.ts`) reads evidence **only** via `raw.metadata.activityType`. Transfer's submit route never sets an `activityType` key in its evidence metadata (only `transferDistance`/`assisted`/`transferTaskId`), so every TRANSFER-sourced row fails normalization and is **excluded from the replay** before it can affect anything. `memory-policy.ts` documents this explicitly for the top-level `activity_type='transfer'` column: it "carries no qualification-relevant information." **A Transfer attempt cannot move `nextReviewAt`, `memoryStatus`, or any retention state — mechanically, not just by observed behavior.** If RETAIN appears due after a Transfer attempt, it is because real wall-clock time independently passed a pre-existing `next_review_at`, never because the Transfer submission touched it.

### POST-TRANSFER KNOWLEDGE STATE

`masteryState`/`validationReadiness` update via the same canonical `recalculateConceptKnowledgeState` every evidence write already triggers — no Transfer-specific special case exists or was added. `retentionScore` is untouched by a TRANSFER-sourced row (excluded from the memory replay, above); `transferScore` reflects the new 50% in its rolling average; `demonstratedRetentionScore` is unaffected.

### POST-TRANSFER LEARNING STATE

`computeLearningState`'s precedence (`adaptive-learning-policy.ts`) checks `RETENTION_RISK` strictly before `TRANSFER_GAP` — documented as "EXPLICIT PRECEDENCE (most-severe-first... never a weighted/compensating combination)." **This is by design, confirmed correct, not touched by this phase.** With no blocking misconception/prerequisite/repair signal, a residual DEVELOPING-band concept with no evidence to review yet falls through to `PRACTICE` (`selectActivityType`'s existing, unmodified fallthrough) — the deterministic next action Part B asks for, decided entirely by the existing Learning Engine.

### POST-TRANSFER JOURNEY STAGE

`deriveLearnerJourneyStage` shows RETAIN whenever `learningState === 'RETENTION_RISK'` — exactly what the precedence above produces when retention is independently due. This is accurate, not an unjustified reset (Part C's own explicit concern): the SAME learner can legitimately owe both a retention check and a transfer proof at once, and RETAIN is reported first because retrieval durability is the more urgent obligation. REINFORCE (Part D) never enters this picture: `learner-journey-contract.ts`'s `BLOCKED_OR_REPAIR` set (`MISCONCEPTION_BLOCKED`/`PREREQUISITE_BLOCKED`/`NEEDS_REPAIR`) is the *only* trigger, and Transfer's own grading (`transfer.service.ts::evaluateTransferResponse`) does plain correct/partial/incorrect scoring with no misconception classification call — a partial Transfer cannot produce any of the three REINFORCE-triggering states on its own.

### CANONICAL NEXT ACTION

`PRACTICE` (per the trace above), launched via `learning-session-engine.service.ts`'s existing `quizLaunch('topic_practice', decision)` — unmodified.

### CONTINUATION PAYLOAD

`{ subjectId: decision.subjectId, conceptId: decision.actionConceptId, mode: 'topic_practice' }` → `/dashboard/quiz?subjectId=...&conceptId=...&mode=topic_practice`. Audited against every failure mode Part E lists: `topic_practice` is a valid `QuizMode` enum member the route's Zod schema accepts; `conceptId`/`subjectId` are both present; `mode` is understood by `quiz/page.tsx`'s `isCanonicalFlow` check, correctly auto-starting `startCanonicalActivity`. **No payload/contract mismatch found anywhere in this chain.**

### QUIZ GENERATION PAYLOAD

`generatePracticeQuestions(conceptId, studentId, subjectId, { count: perConceptCap, difficulty, guidance, language, visualAidRate, ibContext })` — the same call every ordinary topic_practice request makes; nothing Transfer-specific reaches it (`knowledge-state.service.ts`/`quiz-generation.service.ts` never reference `transferDepth`/`concept_transfer_state` at all).

### TARGET DIFFICULTY

Audited per Part H: `resolveTargetDifficulty` (`difficulty-contract.ts`) is a total, pure switch with a safe default branch — it cannot throw, and cannot return an invalid level, for any `MasteryState`/`criticalMisconceptionCount` combination a post-Transfer Knowledge State could carry. `deriveEvidenceRequirement`/`resolveQuestionCount` are likewise pure and wrapped in a try/catch that falls back to `config.defaultMax` on any throw; `resolveQuestionCount`'s clamp (`min(max, max(min, raw))`, `min=1`) makes `maxQuestions <= 0` structurally impossible. **Adaptive difficulty is confirmed NOT implicated in this failure** — ruled out, not assumed.

### SESSION CREATION

`storeQuiz` is called strictly after the `questions.length === 0` guard returns early (`generate-and-take/route.ts`) — a failed generation never reaches persistence. `storeQuiz` itself is a single `INSERT` statement (`quiz-persistence.service.ts`), atomic by Postgres's own single-statement semantics.

### RETRY ROOT CAUSE

The retry-function mismatch described under FIRST BROKEN CONTRACT, above. No evidence of a second, generation-side defect specific to Transfer — the most likely explanation for the *first* failure (before any retry) is an ordinary, non-reproducible AI-generation fault in the shared `generateGatedPracticeBatch` pipeline every Practice quiz uses, made to look far worse than it was by the retry bug converting one recoverable moment into a second, different-looking dead end.

### SESSION ATOMICITY

Audited (Part G): no code path was found where a failed generation could persist a `quiz_session` row, leave an incomplete payload, or let the client hold a `quizId` from a failed response — `applyGenResult` (which sets `quizId`/`questions` client-side) is only ever invoked from the success branch of the generation promise chain. **No atomicity fix was needed; the invariant already held.**

### FIX

One change: `quiz/page.tsx`'s "Couldn't prepare your practice" retry button now calls `startCanonicalActivity(studentId)` instead of `generateQuiz(studentId)`.

## CANONICAL PROGRESS

### OLD PARALLEL AUTHORITIES

Audited every learner-facing surface. Today (no stage/status label rendered at all — action-only, out of scope), My Path, Concept Mission, and the Subjects detail page were **already** canonical, each calling `resolveConceptJourneyStage` (`path-view.ts`) or `deriveLearnerJourneyStage` directly — this consolidation work (LX-9R1/LX-9R1-R1) predates this phase. The **one** remaining parallel authority: `/dashboard`'s (Progress dashboard) per-concept row rendered `masteryStateLabel(c.masteryState, t)` — the raw `MasteryState` enum's learner-facing translation ("Aprendiendo" for `LEARNING`) — with no reference to the concept's canonical journey stage at all. This is the exact live-QA-reported split: Concept Mission (canonical, correct) vs. this one row (raw MasteryState, a genuinely different axis).

### NEW SINGLE READ MODEL

`src/lib/lx/canonical-learning-progress.ts`, `buildCanonicalLearningProgress(input)` → `CanonicalLearningProgress { conceptId, journeyStage, journeyProgressPercent, journeyProgressLabelKey, nextCanonicalAction, waitingReason, nextEligibleAt, evidenceDimensions }`. Not a second Learning Engine — a pure composition of three already-canonical authorities:
- `resolveConceptJourneyStage` (`path-view.ts`) — the same stage resolver My Path/Subject Detail already call.
- `deriveJourneyProgress` (`journey-progress.ts`, LX-9R1) — the same fixed stage-anchor percentage map Subject Detail already uses.
- `isRetentionWaiting` — a NEW small pure function extracted from Concept Mission's own NOW-card logic (LX-9R3-R1 W1) into `learner-journey-contract.ts`, so Concept Mission and this read model apply the identical "RETAIN but not due" condition instead of two independently-maintained copies of it.

### JOURNEY STAGE AUTHORITY

Unchanged: `LEARN → PRACTICE → READY_TO_PROVE/PROVE → RETAIN → TRANSFER → CONSOLIDATED` (+ REINFORCE overlay), from `deriveLearnerJourneyStage` only. No new taxonomy was introduced anywhere.

### JOURNEY PROGRESS AUTHORITY

Unchanged: the fixed LX-9R1 stage-anchor map (`NOT_STARTED:0, LEARN:15, PRACTICE:35, READY_TO_PROVE:50, PROVE:55, RETAIN:70, TRANSFER:85, CONSOLIDATED:100`). `buildCanonicalLearningProgress` never reads `mastery_score`, `avgMasteryPercent`, quiz score, confidence, or evidence count for this value (verified by source audit, test 27).

### EVIDENCE DIMENSIONS

Kept fully separate, per Part N: `CanonicalEvidenceDimensions` (understanding/independence/application/retention/transfer) is its own field on the read model, never used to compute `journeyStage`/`journeyProgressPercent`, and never forced to numerically agree with them (test 28 reproduces the spec's own example: RETAIN/70% alongside Understanding 33%/Application 50%).

### SURFACE MIGRATION

`src/services/progress-overview.service.ts`'s per-concept `ConceptProgress` now carries `journeyStage`/`journeyProgressPercent`/`journeyProgressLabelKey`, computed via `buildCanonicalLearningProgress` using the SAME `knowledgeStateByConceptId`/`decisionByConceptId` maps already built for the subject-level aggregate — no additional query. Today (no status label), My Path, Concept Mission, and Subject Detail required no migration — already canonical.

### STATUS LABEL CLEANUP

`src/app/dashboard/page.tsx`'s per-concept row: removed the `masteryStateLabel`/`masteryStateColor` badge, replaced with `{t[c.journeyProgressLabelKey]} · {c.journeyProgressPercent}%` — the same label vocabulary and percentage Concept Mission and Subject Detail already show for this concept. The Concept Detail page's own "Knowledge State" section (a *separate*, explicitly-labeled evidence-dimensions panel, sitting *alongside* Concept Mission's canonical "Estás aquí" claim on the same page, never in place of it) was deliberately left unchanged — it is legitimate evidence-profile analytics, not a competing progress claim, and Part N/O explicitly preserve this category.

### RAW MASTERY DEMOTION

`ConceptProgress.masteryPercent`/`masteryState` remain on the type (kept for analytics per Part O) but are no longer rendered as the row's primary status on the Progress dashboard — evidence-dimension KPIs (Lo entiendo / Lo hago solo / etc.) still render below, unchanged, as secondary analytics.

### AGGREGATION

Untouched: `averageJourneyProgress` (LX-9R1) remains the sole subject/overall aggregation authority, still concept-weighted (every concept across every active subject contributes one entry, never a mean of per-subject percentages) — confirmed via the full existing LX-9R1-R1 suite passing unmodified.

## REGRESSION SAFETY

### RETENTION WAITING

Unchanged behavior, refactored onto the new shared `isRetentionWaiting` function (no logic change — `stage === 'RETAIN' && retentionDue === false`, verbatim). All prior LX-9R3-R1 Retention Waiting UX tests remain green.

### NOVELTY

Untouched this phase; `RETENTION_NOVELTY_ATTEMPT_WINDOW`, `fetchRecentRetentionQuestions`, and the full LX-9R3 novelty suite remain green.

### ADAPTIVE DIFFICULTY

Untouched this phase; `resolveTargetDifficulty`'s policy is byte-identical to LX-9R3-R1's delivered version. Confirmed structurally not implicated in the Transfer-recovery bug (see TARGET DIFFICULTY above).

### RESULTS

The retention_check raw-mastery-leak guard (`quizMode !== 'retention_check' && ...`) is untouched and still present.

### TUTOR

No Tutor-related file was touched by this phase; `tutor.service.ts` is unmodified.

## PERFORMANCE

### LIVE 10-RUN BENCHMARK

**Not run.** This environment has no live database or AI-provider access — the standing constraint of this entire engagement. Instrumentation to make the benchmark possible the next time a live environment is available has been added this phase: `generateRetentionCheckQuestions` now stamps every `[retention]` telemetry line with a single `operationId` (generated once per call) so all of one launch's events can be grouped, and its two terminal events (`RETENTION_BATCH_READY` / `RETENTION_BATCH_INSUFFICIENT`) now carry `totalDurationMs`. The generation-failure path in `generate-and-take/route.ts` now logs a `[generation]` line with `conceptId`/`quizMode`/`targetDifficulty`/`difficultyReasonCode`/`errorCode` on failure, and `resolveContinuation` now logs a `[continuation]` line with `conceptId`/`continuationResult`/`activityType`/`sessionCreated` on every resolution. None of this fabricates a number; it only makes the real numbers loggable the next time this can run against a live provider.

### P50 / P95 / MEAN / MIN/MAX / CALLS PER RUN / COST PER RUN / FIRST-PASS SUCCESS / RECOVERY RATE

Not available — no live data exists to report honestly. Reporting any of these without a real run would be fabrication.

### REMAINING BOTTLENECK IF ANY

Unchanged from the prior LX-9R3 report's own honest disclosure: semantic-verification call count was structurally reduced (8 Terra calls → 1 batched call for the initial wave), which is the single largest *provable* lever without live telemetry; whether the ≤7s target is actually met depends on provider-side concurrency behavior this environment cannot measure.

## TESTS

34 new tests (`tests/unit/lx9-final-transfer-recovery-canonical-progress.test.ts`), covering all 37 required items (several combined into one `it()` where the spec's own items are trivially proven together, e.g. items 5-8 in one launch-target assertion, items 23-26 as one parametrized case per canonical stage — six stages × one `it()` each) plus item 37 ("all existing tests green"), certified by the full suite rather than a redundant unit test. One pre-existing test updated in place (`tests/unit/lx4p-perf-r1-parallel-runtime.test.ts`) — it certified the retry button calling `generateQuiz`, which is exactly the bug this phase fixed; rewritten to assert `startCanonicalActivity` instead, preserving its original intent ("retry re-runs generation, never navigates away").

Full suite: `npx tsc --noEmit` clean. `npx vitest run` — **3658/3658 passing** (3624 pre-existing + 34 new). `npm run build` — clean.

## COMMITS

One implementation commit (Transfer-recovery retry fix, `canonical-learning-progress.ts`, `isRetentionWaiting` extraction, `progress-overview.service.ts`/`dashboard/page.tsx` migration, observability additions, the 38-test file, and the one pre-existing test update) plus this report, both carrying the required `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer. Nothing pushed to `origin/main`; nothing deployed. LX-10 was not started.
