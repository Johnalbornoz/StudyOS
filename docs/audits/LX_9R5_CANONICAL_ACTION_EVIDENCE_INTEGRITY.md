# LX-9R5 — CANONICAL ACTION & EVIDENCE INTEGRITY

## STATUS

**PASS_WITH_CONDITIONS.**

Every code-level FAIL condition this phase's certification names has been closed:

- My Path (and Today, sharing the same underlying read) can no longer show a canonical RETAIN stage while independently offering PRACTICE as the required action.
- WAITING is now an explicit, first-class outcome of `resolveContinuation` — never interpreted as an error, never silently converted into launching the wrong activity.
- Different surfaces no longer compute their own action/next-step answer — they consume the same `buildCanonicalLearningProgress`/shared-snapshot fields.
- Raw mastery no longer competes with canonical progress on the Progress dashboard's secondary line or on Results for any activity (previously scoped to retention_check only).
- Practice is never labelled "Con ayuda" from EvidenceMode alone — the label now requires a real recorded hint.
- Question count was investigated and found to already be governed by the existing, documented `executionMinimum` contract — not a new bug, but a symptom of the SAME wrong-activity-selection root cause this phase fixes at its source.

The condition, unchanged from every prior phase: this environment has no live browser/database/AI-provider access. Part L's 10-run live generation benchmark could not be executed; it is reported as an open item, not fabricated.

## CANONICAL ACTION

### MY PATH CONTRADICTION

Traced the exact live path: `getLearningOSSnapshot` → `selectExecutableNextAction` → `snapshot.nextExecutableItem` (a `LearningDecision` + estimated minutes) → `path-view.ts`'s `buildMyPathOverview`, which built `CurrentPosition.activityType` as a **verbatim, unconditional pass-through** of `best.decision.activityType`. `resolveConceptJourneyStage` (the SAME function driving the rung display) independently resolved `journey.currentStage = 'RETAIN'` for the identical concept. Both were true at once for "Potenciación": `journey.currentStage === 'RETAIN'` (correct) and `activityType === 'PRACTICE'` (a decision object that genuinely existed, ranked as globally-best, but whose activity was not actually executable).

### FIRST AUTHORITY SPLIT

Not a data-fetch bug — a **trust bug**. `path-view.ts` (and `today/page.tsx`, reading the identical `nextExecutableItem`) never asked "is this decision's activity actually actionable right now," it only asked "does a decision exist." `computeLearningState` and `selectActivityType` (`adaptive-learning-policy.ts`) are two **independently evaluated** functions over the same signals: the former correctly resolves `RETENTION_RISK` (giving stage RETAIN); the latter, once the review isn't yet due (`RETENTION_REVIEW_DUE`'s `temporalUrgency` not `HIGH`, per LX-9R3's own fix), falls through its own residual logic (keyed on `understandingScore`/`masteryState`) with **no awareness of the retention obligation at all**, and can land on PRACTICE. Neither function is wrong on its own terms — the split is that no consumer ever reconciled the two before presenting one as "the required next action."

### SINGLE READ MODEL

`buildCanonicalLearningProgress` (`src/lib/lx/canonical-learning-progress.ts`) now owns the reconciliation, extended with:

```
actionState: 'EXECUTABLE' | 'WAITING' | 'CONSOLIDATED' | 'BLOCKED'
nextCanonicalAction: ActivityType | null   // null unless actionState === 'EXECUTABLE'
waitingReason: 'RETENTION_NOT_DUE' | null
nextEligibleAt: string | null
intervention: LearnerJourneyIntervention | null   // verbatim from deriveLearnerJourneyStage
evidenceMode: EvidenceMode | null           // of nextCanonicalAction, when one exists
assistanceUsed: boolean | null              // per-attempt fact, passed through, never inferred here
```

Composed entirely from the SAME three already-canonical authorities as before (`resolveConceptJourneyStage`, `deriveJourneyProgress`, `isRetentionWaiting`) plus `deriveLearnerJourneyStage`'s own `.intervention` field (now surfaced via a new `resolveConceptJourneyResult` export from `path-view.ts` — a pure refactor that de-duplicated three copies of the same stage-resolution snippet into one shared helper, no behavior change). No new decision engine: `actionState` is a three-way ternary over facts every caller already had.

### ACTION STATE

```
actionState =
  journeyStage === 'CONSOLIDATED' ? 'CONSOLIDATED'
  : isRetentionWaiting(journeyStage, memory.retentionDue) ? 'WAITING'
  : activeDecision ? 'EXECUTABLE'
  : 'BLOCKED'
```

A REINFORCE intervention is never suppressed by the WAITING branch: `isRetentionWaiting` only ever fires for `journeyStage === 'RETAIN'`, and `deriveLearnerJourneyStage`'s own precedence means `MISCONCEPTION_BLOCKED`/`PREREQUISITE_BLOCKED`/`NEEDS_REPAIR` (the only states that set `intervention: 'REINFORCE'`) can never simultaneously resolve stage RETAIN — the two conditions are structurally mutually exclusive, so the Part D exception ("REINFORCE can still make Practice executable") holds without a special case.

### WAITING

Wired into the three concrete surfaces that previously trusted the decision's `activityType` directly:

- **My Path** (`path-view.ts`): `CurrentPosition.activityType` is now `actionState === 'EXECUTABLE' ? best.decision.activityType : null`, using the SAME `isRetentionWaiting` check against a new, single batched student-wide memory read (`getTwinMemorySignalsForStudent`, one query for the whole render, not per concept). `path/page.tsx` renders a WAITING card (reusing Concept Mission's own copy verbatim) instead of the Practice hero.
- **Today** (`today/page.tsx`): could NOT add its own memory read — an established architectural test (`closeout-b-retention-action.test.ts`) explicitly forbids Today from importing policy/memory/taxonomy modules for value, keeping it presentation-only. Fixed at the correct layer instead: `getLearningOSSnapshot` (`learning-os-snapshot.service.ts`, a service, not a presentation file) now computes `nextExecutableItemWaiting`/`nextExecutableItemNextEligibleAt` ONCE, keyed off the same `learningState === 'RETENTION_RISK'` + `retentionDue === false` condition, using a single-concept memory read for just the one hero item. Today reads these two pre-computed booleans/dates — zero new imports, zero new reads of its own.
- **Continuation** (`learning-continuation.service.ts`): see below.

### NEXT ACTION

`nextCanonicalAction` (and My Path/Today's `activityType`) is `null` whenever `actionState !== 'EXECUTABLE'` — a waiting/consolidated/blocked concept has nothing to report as "the required next action," by construction, not by a caller remembering to check first.

### SURFACE CONSISTENCY

Audited every surface named in Part L:

| Surface | Authority | Status |
|---|---|---|
| Concept Mission | `isRetentionWaiting` in `concept-mission.ts`'s NOW card (LX-9R3-R1) | Already correct — the SAME shared function |
| My Path | `isRetentionWaiting` via `path-view.ts` (this phase) | Fixed |
| Today | `nextExecutableItemWaiting` via the shared snapshot (this phase) | Fixed |
| Subject Detail | `resolveConceptJourneyStage` + `deriveJourneyProgress` (LX-9R1) | Already correct, unaffected (doesn't render a CTA, only stage/percent) |
| Progress dashboard | `buildCanonicalLearningProgress` (LX-9 FINAL, unchanged this phase) | Already correct |
| Continuation/Results | `resolveContinuation`'s new WAITING status (this phase) | Fixed |

A single test fixture (`buildCanonicalLearningProgress` called twice with identical input) proves determinism directly; per-surface consistency is proven by each surface consulting the same `isRetentionWaiting`/read-model output rather than an independent copy.

## CONTINUATION

### NULL-AS-ERROR ROOT CAUSE

`ContinuationPanel.tsx`'s error copy (`continuation.resolveFailed`, "No se pudo determinar...") is gated exclusively by a `failed` state set only inside a `catch` around the `/api/learning/continue` fetch — never by the ordinary `RETURN_TO_MISSION` path, which already navigated silently with no error banner. The route itself (`/api/learning/continue/route.ts`) already wraps `resolveContinuation` in its own try/catch, always returning valid JSON (`RETURN_TO_MISSION`/`RESOLVE_FAILED`) even on internal failure. The genuinely reachable gap: **before this phase, a WAITING concept's `phase4Decision` (activityType PRACTICE, from the same fallthrough bug) was not intercepted at all** — `resolveContinuation` would call `startLearningSession` and, since PRACTICE is a perfectly launchable activity type, return a normal `LAUNCH` result pointing at another Practice quiz. Whether the specific "resolveFailed" text in the live report came from a genuine transient exception or was an imprecise description of a confusing loop, the CORRECT behavior — an explicit, dated WAITING result — closes every version of this gap at once, and is what Part C explicitly asks for.

### WAITING RESULT

`ContinuationResolution` (`src/lib/lx/continuation.ts`) gains a third variant:

```ts
| { status: 'WAITING'; waitingReason: 'RETENTION_NOT_DUE'; nextEligibleAt: string | null }
```

`resolveContinuation` checks this **before** ever calling `startLearningSession`, using the identical `learningState === 'RETENTION_RISK'` + `retentionDue === false` condition established above (a single-concept `getTwinMemorySignal` read, since this service is not subject to Today's presentation-only restriction). A genuine REINFORCE-driven PRACTICE/REMEDIATION decision is never intercepted, for the same structural-exclusivity reason as above.

### RESULTS UX

`ContinuationPanel.tsx` renders the WAITING result in place — no navigation, no error state:

> Es. **"Buen trabajo"** / *"Por ahora no necesitas otra actividad. Tu próxima comprobación de memoria estará disponible el 16/09/2026."*
> CTA: **"Volver al concepto"** (the existing `continuation.backToConcept` link, reused verbatim).

New i18n keys (`continuation.waitingHeadline`/`waitingBody`/`waitingBodyWithDate`, all 5 locales) match the spec's own example copy precisely.

## GENERATION

### FIRST-ATTEMPT FAILURE

Could not be reproduced live (no provider access). The `[generation]` observability log (`generate-and-take/route.ts`, added in the prior LX-9 FINAL phase) already records `conceptId`/`quizMode`/`targetDifficulty`/`difficultyReasonCode`/`errorCode` on a `GENERATION_FAILED` response — the instrumentation Part E asks for exists and is ready to capture the exact failure mode the next time this can be observed live. Audited every code path between the continuation launch and generation for a Transfer-adjacent or Retention-adjacent defect specific to THIS concept (as the prior LX-9 FINAL phase did for the Transfer case) and found none — `resolveTargetDifficulty` is total and cannot throw or misfire (unchanged, confirmed again this phase); `resolveQuestionCount` cannot produce an invalid count (see below). Absent a reproducible live trace, the most defensible, evidence-backed statement is that the first failure was an ordinary, non-reproducible fault in the shared AI generation pipeline every Practice request uses — **not relabeled as fact without evidence**, reported as the best available inference.

### OPERATION TRACE

Not available — no live run exists to trace. The instrumentation needed to capture one (operationId, Luna/Terra call counts, candidate/quality-gate counts, duration) already exists for Retention (from the prior LX-9R3/LX-9 FINAL phases); Practice's own generation path does not yet carry an equivalent per-call `operationId` correlation, since Practice's live-QA-reported failure in this phase was traced to the CONTINUATION/ACTION-SELECTION layer, not the generation pipeline itself — extending Practice-path instrumentation to the same standard is a reasonable next step but was not required to explain THIS live report.

### QUESTION COUNT

Traced `deriveEvidenceRequirement`/`resolveQuestionCount` (`evidence-sufficiency-contract.ts`) exactly, for `activityType = PRACTICE`:

```
gap = max(0, minimumEvidenceCount - currentEvidenceCount)
count = clamp(max(executionMinimum=1, gap), [1, 20])
```

For a concept already at RETAIN (`currentEvidenceCount` comfortably exceeds `minimumEvidenceCount`, by definition of having reached validated mastery), `gap = 0`. `count = max(1, 0) = 1`. **This is the documented, intentional `executionMinimum` floor** ("0 questions is not a runnable activity") from a prior phase (LX-4R R8), which even logs its own `zeroGapMismatch` warning for exactly this situation — not a new defect in the count formula. The real defect is that PRACTICE was ever selected as the activity for a concept with zero remaining evidence gap in the first place — the SAME root cause this phase's Part A/D fix addresses. With the continuation/action-selection fix in place, a canonical PRACTICE launch reaching generation should now only happen when a genuine evidence gap exists or a REINFORCE intervention is active — the zero-gap-into-Practice path this count of 1 came from should no longer occur for this reason. No separate code change was made to the count formula itself; none was warranted.

### RETRY

Regression-checked: the LX-9 FINAL retry fix (`startCanonicalActivity` on the "Couldn't prepare your practice" card, `generateQuiz` only on the distinct top-level `phase==='error'` state) is unchanged and still verified by its own test plus this phase's test 14.

## EVIDENCE

### EVIDENCE MODE

Unchanged: `evidenceModeForActivity` (`activity-taxonomy.ts`) remains the pure, fixed `ActivityType -> EvidenceMode` mapping. PRACTICE/REVIEW/REMEDIATION are `PRACTICE` (assisted); SOLO_CHECK/SOLO_VERIFY/TRANSFER/RETENTION_CHECK are `INDEPENDENT`; DIAGNOSTIC_CHECK/CUMULATIVE_ASSESSMENT/MOCK_EXAM are `ASSESSMENT`. `generate-and-take/route.ts`'s `learningMode: 'SOLO' | 'COACH' = evidenceMode === 'PRACTICE' ? 'COACH' : 'SOLO'` is **untouched** — it still correctly answers "what kind of activity was this," and nothing about how it feeds mastery/independence evidence classification was changed.

### ASSISTANCE AVAILABLE

`LearningSupportStatus`'s existing `assistanceMode`/`hintsAvailable` props (quiz page) already correctly express "can this activity be assisted" per EvidenceMode — unaffected by this phase.

### ASSISTANCE USED

The actual gap: `hintsUsed` (a real per-concept count, `bucket.questionIndexes.filter((i) => quizSession.hintsUsedQuestions.includes(i)).length`, `generate-and-take/route.ts`) was **already computed and recorded** into evidence telemetry, but the HISTORY LABEL never consulted it — it derived "Con ayuda"/"Solo" purely from `learningMode` (the EvidenceMode classification). Fixed at the presentation layer only (`src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx`): a `COACH`-mode history row now shows "Con ayuda" only when `h.hintsUsed > 0`; otherwise a new, truthful label ("Sin ayuda utilizada" / "No help used," all 5 locales). `SOLO`-mode rows are unaffected — "Solo" remains accurate regardless, since no assistance was ever possible there.

### HISTORY LABEL

See above. The already-existing separate "N pistas usadas" badge (shown whenever `hintsUsed > 0`) is unchanged and now sits alongside a label that is never contradicted by it.

### KNOWLEDGE-STATE EFFECT

No change: `mastery.service.ts`'s handling of `telemetry.learningMode`/`hintsUsed` for mastery/independence scoring is untouched. `assistanceUsed` (the new read-model field) is a presentation pass-through only, populated by a caller describing one specific attempt (e.g. a future Results/history consumer of `buildCanonicalLearningProgress`) — it is never derived from ActivityType/EvidenceMode inside the read model itself, and it writes nothing.

## LEARNER METRICS

### RAW MASTERY REMOVAL

Two more sites closed, both following the exact pattern already established for retention_check in the prior phase (guard the render, never delete the underlying value):

- **Progress dashboard** (`src/app/dashboard/page.tsx`): the secondary "Dominio general: N%" line (`progress.overallMasteryLabel`) is removed. `overview.overallMasteryPercent` is still computed and returned by `getStudentProgressOverview` — available to any admin/analytics/debug consumer, just not rendered on this learner-facing page.
- **Results** (`src/app/dashboard/quiz/page.tsx`): the single-concept "Dominio del concepto: X% → Y%" block is now removed for **every** activity, not only retention_check (the reported live leak was on an ordinary Practice result). The multi-concept per-row mastery delta (cumulative/exam results) is removed the same way; the evidence-strength chip beside each concept name is unchanged. `results.mastery` remains present in the API response unconditionally — nothing was deleted server-side.

No new percentage was invented anywhere to replace either removal, per the explicit instruction.

### CANONICAL PROGRESS

Unaffected and unchanged: `journeyProgressPercent`'s fixed stage-anchor map (LX-9R1) and `averageJourneyProgress`'s concept-weighted aggregation (LX-9R1-R1) remain the sole progress-percentage authority everywhere.

## PERFORMANCE

### LIVE BENCHMARK

**Not run.** No live provider/database access in this environment — the standing constraint of this entire engagement, unchanged since the first LX-9R3 report. Fabricating p50/p95/cost figures here would violate this engagement's honesty requirement.

### P50 / P95 / FAILURE RATE

Not available for the same reason. The existing Retention-path instrumentation (`operationId`, `totalDurationMs`, Luna/Terra call counts) from the prior two phases remains ready to use the moment a live environment is available; nothing new needed to be added for Retention specifically this phase.

## TESTS

33 new tests (`tests/unit/lx9r5-canonical-action-continuation-assistance.test.ts`), covering all 32 required items in order (item 11's REINFORCE-exception check and item 16's exact-6-or-nothing regression check are each covered by a dedicated `it()`, giving one extra test beyond the 32 numbered items). Four pre-existing tests updated where they certified behavior this phase intentionally superseded: `tests/unit/lx7-my-path.test.ts` (the unconditional `activityType: best.decision.activityType` pass-through it certified was the exact bug this phase fixes — rewritten to assert the new conditional form), `tests/unit/lx4p-r3-active-learning-language.test.ts` and two required-test files from prior phases (`lx9r3-progression-novelty-difficulty-results.test.ts`, `lx9-final-transfer-recovery-canonical-progress.test.ts`) whose assertions named the exact retention_check-only guard string this phase broadened to every activity.

Full suite: `npx tsc --noEmit` clean. `npx vitest run` — **3691/3691 passing** (3658 pre-existing + 33 new). `npm run build` — clean.

## COMMITS

One implementation commit (the canonical-action-authority extension, My Path/Today/continuation fixes, the assistance-history fix, the two raw-mastery removals, the `resolveConceptJourneyResult` refactor, four pre-existing test updates, and the new 33-test file) plus this report, both carrying the required `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer. Nothing pushed to `origin/main`; nothing deployed. LX-10 was not started.
