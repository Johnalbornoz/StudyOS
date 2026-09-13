# LX-9 — MOTIVATION, PROGRESSION & AI PERFORMANCE

## STATUS

- **Part A (Motivation & Progression): PASS.** Every new surface is a pure presentation projection over existing canonical evidence (`LearnerJourneyStage`, the existing streak/mastery-event source) -- zero new scoring authority, zero XP/points/badges/loot, zero mastery mutation. Milestones fire only on genuine forward evidence crossings.
- **Part B (AI Performance): PASS_WITH_CONDITIONS.** Every runtime AI call is now inventoried (`docs/LX9_AI_RUNTIME_PERFORMANCE_AUDIT.md`). Five call sites that hardcoded Anthropic Sonnet directly -- bypassing the central Luna/Terra routing authority entirely, with zero cost telemetry (Sonnet is intentionally unpriced in `MODEL_PRICING`, so every one of these calls was reporting `$0/incomplete`) -- are now migrated onto central routing, including the Tutor, which had zero token/cost/fallback telemetry before this phase. A safe, narrow deterministic grading short-circuit was added. Conditioned because: (1) the Tutor's model change (Sonnet → Luna-first) is a genuine conversational-quality decision this environment cannot validate live -- see CONDITIONS; (2) several audited opportunities (semantic-verification batching, request dedup, prefetch, misconception signature-list bounding) were deliberately NOT implemented this phase, each for a specific, stated reason, not by oversight.
- No live/Preview QA is claimed anywhere in this report. The full application-wide p50/p95 performance certification remains scheduled for after LX-10, per the spec's own instruction. LX-10 was NOT started.

---

# PART A — MOTIVATION & PROGRESSION

## MOTIVATION MODEL

StudyUS already had the canonical vocabulary this phase needed: `deriveLearnerJourneyStage` (`src/lib/lx/learner-journey-contract.ts`, LX-1B) maps existing canonical facts (`LearningState`, `MasteryState`, `ValidationReadiness`, memory/transfer overlays) to `NOT_STARTED → LEARN → PRACTICE → READY_TO_PROVE → PROVE → RETAIN → TRANSFER → CONSOLIDATED`, plus a `REINFORCE` intervention overlay. This is a pure presentation-layer projection, explicitly documented as never reading a raw score. LX-9 adds nothing to this authority -- it only reads it. Motivation is grounded in this same journey: visible progress toward LEARN → PRACTICE → PROVE → RETAIN → TRANSFER → CONSOLIDATED, never a separate gamification score.

## MILESTONES

New: `src/lib/lx/progression-milestones.ts` -- `deriveMilestoneFromStageTransition(before, after)`, a pure function over two `LearnerJourneyStage` values only (never a score/count/percentage). A milestone fires ONLY on a genuine forward crossing:

- **STARTED**: `NOT_STARTED` → any later stage.
- **PROVED**: crossed past `PROVE` (the independent-demonstration obligation was cleared).
- **RETAINED**: crossed past `RETAIN` (the retention obligation was cleared).
- **TRANSFERRED**: the specific `TRANSFER` → `CONSOLIDATED` transition (see below for why this is a special case).
- **CONSOLIDATED**: reaching `CONSOLIDATED` from anywhere else.

`PROVE`/`RETAIN`/`TRANSFER` are OPEN-OBLIGATION stages in the LX-1B taxonomy (a demonstration/retention/transfer check is now DUE), not achievements themselves -- the achievement is CLEARING one, i.e. moving PAST it. `TRANSFER` and `CONSOLIDATED` are adjacent stages with nothing between them, so "moved past TRANSFER" and "reached CONSOLIDATED" are the same event; `TRANSFERRED` is therefore reported only for that specific transition, never fabricated for a jump that skipped the TRANSFER stage entirely (that jump correctly reports plain `CONSOLIDATED`). A same-stage or backward move (e.g. a `REINFORCE` intervention temporarily lowering the rendered stage) always returns `null`.

This phase wires the milestone module into ONE concrete surface (the quiz results screen, using the already-known `quizMode` + the server's own pass/fail signal -- see COMPLETION FEEDBACK). The general `deriveMilestoneFromStageTransition` function is architecturally ready for a future phase to wire into the mastery-evidence pipeline for the TRANSFER/CONSOLIDATED cases (which more naturally belong on the transfer/concept pages), but that wiring was not done this phase to avoid touching the core evidence-recording path without dedicated review.

## HABIT / CONSISTENCY

A real, working consecutive-day streak already existed (`gamification.service.ts::getStudentStreak`), surfaced as a flame icon + raw number in the dashboard footer. Per A5's explicit guidance ("3 learning days this week" rather than "Don't lose your 87-day streak!"), this phase adds `getLearningDaysThisWeek(studentId)` -- counts distinct calendar days (student's own timezone) with real learning activity within the CURRENT calendar week only (`date_trunc('week', ...)`, Monday-Sunday), bounded to [0,7] by construction. The dashboard footer now shows this instead of the old growing streak number, with a calendar icon replacing the flame (a flame icon paired with a value that resets every Monday would visually read as "you lost your fire," the opposite of the intended calm framing). `getLearningDaysThisWeek` only ever `SELECT`s -- it cannot alter competence, verified by source-contract test.

## TODAY INTEGRATION

Today's existing "why this matters" mechanism (`activityNarrative` + `WhyThisV3`, capped at `maxFacts={1}`) already satisfies A6's "one subtle progress connection is enough" -- and carries a hard precedent (LX6R1) against leaking raw scores/percentages into that copy. This phase deliberately did NOT add new fact types into that system: the risk of reintroducing an LX6R1-class leak for uncertain incremental value was judged not worth it in this pass. Today's existing authority is unchanged.

## MY PATH INTEGRATION

My Path already renders current position, per-concept `ConceptJourney` state, and cross-subject counts (`SubjectPathSummary`: `inProgressCount`, `consolidatedCount`, `retentionDueCount`, `transferPendingCount`, `interventionCount`) via `path-view.ts` and `JourneyStrip.tsx` -- no XP bar, discrete stage glyphs only. This already satisfies A7's "current position, recently completed milestones, nearby next milestone" shape at the SUMMARY level. A per-concept "recently completed milestone" FEED (as opposed to the count spans it already shows) was not built this phase -- flagged as a natural next step once the milestone module is wired into the evidence pipeline (see MILESTONES).

## COMPLETION FEEDBACK

`src/app/dashboard/quiz/page.tsx`'s results screen: when `quizMode === 'retention_check'` or `quizMode === 'quick_check'` AND the attempt passed (`results.messageKey !== 'keep_going'`, the server's own existing pass/fail signal -- no new score computed), the calm, milestone-specific line replaces the generic score-tier message:

- `retention_check` pass → **RETAINED**: "You still remember this after time."
- `quick_check` pass → **PROVED**: "You demonstrated this independently."

Both modes are already `SOLO`/no-help, independent-evidence quiz modes (per the file's own pre-existing `QUIZ_SUPPORT_CONTEXT`) -- an ordinary Practice pass NEVER gets this copy (see ANTI-GAMIFICATION GUARDRAILS / A9). New i18n keys (`progression.milestone*`) across all 5 locales, calm tone, no exclamation marks, no numbers.

## ANTI-GAMIFICATION GUARDRAILS

- Confirmed via codebase-wide grep (prior to this phase, and unaffected by it): no XP, points, badges, or loot mechanic exists anywhere in StudyUS.
- `deriveMilestoneFromStageTransition` takes only two `LearnerJourneyStage` values -- structurally cannot read a raw score, count, or percentage.
- Milestone completion copy is used ONLY for the two independent/SOLO quiz modes on an actual pass -- a Practice pass (help available, lower evidence weight per `mastery.ts`'s own `EVIDENCE_WEIGHTS`) never triggers it, so "correct answer ≠ achievement" (A9) holds structurally, not just by convention.
- `getLearningDaysThisWeek` never writes to `mastery_records`/`concept_knowledge_state` -- a broken habit cannot lower competence, and a perfect week cannot raise it either; the two systems are fully decoupled, verified by source-contract test.
- No new "gamification progression engine" was created -- `progression-milestones.ts` imports `LearnerJourneyStage` as a TYPE only and contains no re-implementation of `deriveLearnerJourneyStage`.

---

# PART B — AI PERFORMANCE

## COMPLETE AI INVENTORY

See `docs/LX9_AI_RUNTIME_PERFORMANCE_AUDIT.md` for the full required table (Journey / Capability / Function-call site / Primary model / Fallback model / Blocking / Parallel / Calls-per-operation / Typical input-output tokens / Quality verification / Fallback rate / Estimated cost / Optimization / Before-after topology / Risk / Status). Every `executeAI(...)` call site in the codebase is accounted for -- 30 call sites across 17 service files, confirmed via `grep -rln "executeAI(" src`.

## BASELINE

No live provider telemetry exists in this environment (no credentials, no production traffic). The baseline reported throughout this document is STRUCTURAL: each call's own configured token-budget ceiling (`TOKEN_BUDGETS`) priced against `MODEL_PRICING`'s configured reference rates -- a ceiling, never a fabricated "typical." Where a call site previously used Anthropic Sonnet, its baseline cost was **literally $0/incomplete** by `pricing.ts`'s own explicit design (an unconfigured model prices as $0 rather than a guess) -- meaning five call sites, including the entire Tutor surface, were cost-blind before this phase, not merely "expensive."

## CALL GRAPH BY JOURNEY

### PRACTICE
Luna-first, per-unit (batch/chunk/slot) Question Quality Gate, one bounded Terra retry only when a unit is empty/short. Requested count always equals needed count -- no surplus generation, since single-slot retry already covers Practice's failure tolerance needs. Unchanged this phase; audited and found already optimal.

### RETENTION
RET-R2's 8-candidate surplus (6 published) + RET-R3's per-question dedupe (never whole-chunk discard), ≤3 AI calls total. Certified in prior phases (RET-R1/R2/R3); unchanged and unaffected by this phase's changes (full regression suite green).

### TRANSFER
Generation: a bounded regenerate-on-reject loop (≤2 AI calls), gated by a deterministic novelty/fingerprint check, not an AI verification -- structurally different from Retention's surplus-candidate pattern, and correctly so given Transfer's lower request volume. Evaluation: direct-to-Terra, no Luna attempt, by the routing table's own long-standing, specific rationale. Unchanged.

### GRADING
Deterministic types (multiple_choice/matching/ordering/classification): 0 AI calls, confirmed already correct, untouched. Free-text: 1 Terra call, UNLESS the question is `numeric_problem` and the student's answer is a bare number matching the correct answer within tolerance -- **new this phase**, 0 AI calls in that specific case. Explain & Defend's rubric evaluation and misconception classification remain Terra-only, audited and left in place (HIGH_RISK, feeds mastery directly, no evidence Luna matches Terra's accuracy here).

### TUTOR
The single largest change this phase. Was: Anthropic Sonnet hardcoded directly, bypassing `CAPABILITY_ROUTING.TUTOR`'s own already-declared "Luna first" intent, no token budget (`maxTokens: 2048` was a bare literal), unbounded RAG context insertion, zero cost/token telemetry (Sonnet's `$0/incomplete` pricing by design), zero fallback (a failure just propagated). Now: routes through `resolveModels('TUTOR')` (Luna primary), one bounded Terra retry on outright failure (mirroring the exact "Luna first, one Terra fallback, never a third attempt" shape used everywhere else in the canonical runtime), a dedicated `tutor_reply` token budget, `fitContextChunks`-bounded RAG context, full `parseUsage`/`recordRuntimeEvent`/`operationId` telemetry. See CONDITIONS for the one open item (conversational quality validation).

### OTHER
Concept explanation, interactive formula, guided practice, error guidance, hint: already Luna-first, already budgeted, already cached where appropriate (prior phases) -- confirmed unchanged and correct. Content-ingestion classification/extraction (`concept-extraction.service.ts` x2, `topic-hierarchy.service.ts`) and cross-cutting localization (`localization.service.ts`) migrated this phase from hardcoded Sonnet onto central routing. Vision transcription (`ai.service.ts:extractTextFromImage`) stays on Sonnet, documented as an exception -- the OpenAI adapter has no vision support today, and building one was out of scope for this phase. Two legacy call sites (`ai.service.ts`'s `extractConceptsFromText` / `generateQuestion`, both confirmed to have zero live frontend callers) and one unused cognitive-graph inference function are flagged DEAD -- not touched, recommended for a future deletion pass.

## MODEL ROUTING

Full table in the audit doc. Summary: `CLASSIFICATION`, `OTHER`, `CONTENT_GENERATION`, and (as of this phase) `TUTOR` all resolve Luna-first with Terra fallback. `GRADING`, `EXPLANATION_EVALUATION`, `TRANSFER_EVALUATION`, `COGNITIVE_ANALYSIS` remain Terra-only, each with a specific, non-empty, pre-existing rationale (verified present for every Terra-only capability by test) -- none of these were flipped to Luna-first without evidence, per B3's own explicit "no subjective Terra-feels-safer" standard applied in the other direction: there being no PROOF Luna is insufficient is not the same as proof it's sufficient for an answer-correctness-consequential evaluation.

## ELIMINATED AI CALLS

A bare-number `numeric_problem` answer that exactly (within the same tight tolerance the Quality Gate's own `tryRecomputeNumeric` already uses) matches the correct answer is now graded with **zero AI calls** (`tryDeterministicNumericGrade`, `quiz-generation.service.ts`). Deliberately narrow: any answer that shows work, is wrong, is non-numeric, or is a non-`numeric_problem` type still goes through the unchanged AI grading path -- this can never make grading MORE lenient than AI already would, only skip AI when the outcome is already certain (B17/B18/B31).

## LUNA / TERRA CHANGES

Five call sites moved off a hardcoded, unrouted, unpriced Anthropic Sonnet onto Luna-first + Terra-fallback central routing: `concept-extraction.service.ts` (`extractConceptsFromChunk`, `suggestConceptNames`), `topic-hierarchy.service.ts` (`callClaudeForHierarchy`, serving both `classifySubjectHierarchy` and `classifySingleConcept`), `localization.service.ts` (`translateBatch`), and `tutor.service.ts` (`sendMessage`). Three of these five (`extractConceptsFromChunk`, `callClaudeForHierarchy`, `translateBatch`) already produced an OBJECT-rooted JSON response, so the migration to OpenAI's `json_object` response mode was a clean model/provider swap with no prompt-schema change. `suggestConceptNames`'s response was re-shaped from a bare array to `{"suggestions": [...]}` to satisfy that same OpenAI requirement. `sendMessage`'s response is free-form prose (never JSON) -- this required a small, additive, backward-compatible change to the shared `callModel` adapter itself: a new `plainText?: boolean` option that opts a caller OUT of `callModel`'s default Structured-Output JSON mode when no `jsonSchema` is given (every existing caller is unaffected, since none of them pass this new option).

## PARALLELIZATION

Audited; no new parallelization opportunities were found beyond what prior phases already implemented (Retention's 2 concurrent initial chunks, Quick Check's 6 concurrent slots, `concept-extraction`'s per-chunk `Promise.all`, embedding's `Promise.allSettled` on ingest). No currently-sequential-but-independent call pair was identified as a promising target this phase.

## BATCHING

Audited (B8/B9), NOT implemented. `question-quality-verifier.service.ts:verifyQuestionQuality` is called once per NOT_DETERMINISTICALLY_VERIFIED candidate, in parallel, never batched into one structured Terra call. Batching N candidates into one call was evaluated and rejected for this phase specifically because it would require a new array-based verdict schema AND carries a real risk of cross-candidate contamination (one candidate's content influencing another's verdict inside a shared context window) that cannot be validated for quality impact without live evaluation data this environment doesn't have. This is the single most significant audited-but-deferred optimization in this report -- see CONDITIONS.

## PROMPT TOKEN REDUCTION

Two real, unbounded prompt-size risks were found and left unfixed this phase, both flagged rather than blindly truncated (truncating a classification/dedup input carries real correctness risk without careful, case-by-case validation): `topic-hierarchy.service.ts:classifySubjectHierarchy` resends every existing concept's `id:label` pair on every full reclassification (not just newly-added ones), and `misconception.service.ts:classifyMisconception` concatenates the full existing-misconception-signature list for a concept with no cap, so it grows unbounded as more misconceptions are recorded over a concept's lifetime. Tutor's RAG context, previously fully unbounded, is now bounded via `fitContextChunks` (this phase).

## OUTPUT TOKEN REDUCTION

The Tutor's `maxTokens: 2048` bare literal is now `budgetFor('tutor_reply').maxOutputTokens` (still 2048, but now a named, auditable budget rather than a magic number, consistent with every other capability's convention) with the actual RAG-context-driving input now bounded too.

## CACHE

Concept explanation and interactive formula were already cached (prior phases, confirmed unchanged and correct); localization was already a well-built cache-then-generate pattern (confirmed, now also correctly routed/priced). Guided practice and error guidance are intentionally NOT cached, confirmed correct as-is (a guided sequence is per-activity, and stale error advice would be actively harmful). No new caching was added this phase -- the audit found the existing caching decisions already sound, not a gap.

## REQUEST DEDUP

Audited (B13), NOT implemented. No in-flight request deduplication middleware exists for any AI call site. This is a real, confirmed gap -- not touched this phase because implementing it safely (without risking two learner actions incorrectly collapsing into one) needs its own dedicated design pass, not a bolt-on within this already-large phase.

## PREFETCH

Audited (B15), NOT implemented. No pre-generation of a likely next question/activity exists. Deferred for the same reason as REQUEST DEDUP -- a genuine future opportunity, not attempted here to avoid introducing wasted-generation risk (B15's own explicit warning against generating for many possibilities) without a measured probability-of-use signal this environment cannot produce.

## QUALITY GATE OPTIMIZATION

Audited in depth (B9). Found ALREADY IMPLEMENTED, pre-existing, and confirmed via direct code read (not re-built this phase): `applyQuestionQualityGate` (`gated-question-generation.service.ts`) already sends ONLY `NOT_DETERMINISTICALLY_VERIFIED` questions to the semantic Terra verifier -- a deterministic PASS or FAIL never reaches Terra at all. This alone is a substantial, already-shipped cost reduction from prior phases. The one remaining, NOT-implemented opportunity is semantic-verification batching (see BATCHING above).

## GRADING OPTIMIZATION

New this phase: deterministic bare-number `numeric_problem` short-circuit (see ELIMINATED AI CALLS). Confirmed unchanged and already correct: multiple_choice/matching/ordering/classification grading was already fully deterministic before this phase.

## TUTOR OPTIMIZATION

See TUTOR under CALL GRAPH BY JOURNEY. Streaming (B20) was audited and NOT implemented -- the Tutor currently returns one blocking JSON response; adding streaming would require both an API route rework (SSE/`ReadableStream`) and a frontend consumption change, a larger architectural lift than this phase's routing/telemetry/budget fixes, and is flagged as a genuine future opportunity rather than attempted here.

## FAILURE / FALLBACK

The Tutor now has a real fallback for the first time (previously: none, a failure just propagated). One bounded Luna → Terra retry, never a third attempt, mirroring the shape used everywhere else in the canonical runtime. The failed Luna attempt now ALSO gets its own telemetry event (using the thrown `AIExecutionFailure`'s own carried execution metadata) so a fallback-rate computation never undercounts how many Luna attempts actually happened -- matching the same "telemeter every attempt" convention `gated-question-generation.service.ts` already established for its own Luna/Terra pairs.

## WASTED CALLS

New: `src/lib/ai/performance-dashboard-contract.ts::detectWastedOperations` -- flags the specific anomaly of a fallback attempt running after the primary attempt already had an accepted, gate-passed result (one of B30's own named examples). The canonical runtime's control flow should make this impossible by construction (fallback only fires on insufficiency), so an empty result from this function is the expected, healthy case, confirmed by test; a non-empty result would be a genuine anomaly worth investigating.

## TELEMETRY

The Tutor went from ZERO token/cost/fallback telemetry to full `parseUsage` + `recordRuntimeEvent` + `operationId` correlation this phase -- the single largest telemetry gap closed. `AIRuntimeEvent`'s existing shape (from prior R1G work) already covers every field B23 asks for (`operationId`, `capability`, `provider`, `model`, `promptId`, `promptVersion`, `inputTokens`, `cachedInputTokens`, `outputTokens`, `latencyMs`, `success` via `qualityGateResult`, `fallbackUsed`, `estimatedCostUSD`, `costComplete`) -- no new event schema was needed, only new CALLERS of the existing one.

## PERFORMANCE KPIS

`AI_CALL_COUNT`, `AI_LATENCY_MS`, `INPUT_TOKENS`, `CACHED_INPUT_TOKENS`, `OUTPUT_TOKENS`, `ESTIMATED_COST_USD` are all directly computable today from `AIRuntimeEvent` via the new `summarizeByCapability`. `FIRST_PASS_ACCEPTANCE_RATE` is computed the same way (non-fallback attempts' accepted/attempted ratio). `FALLBACK_RATE`, `RECOVERY_RATE`, `FAILURE_RATE` are likewise derivable once events are collected from real traffic -- none of these are reported as live numbers in this report, since this environment has no production events to aggregate; the CAPABILITY to compute them from real data is what this phase delivers.

## COST KPIS

`COST_PER_SUCCESSFUL_LEARNING_INTERACTION` is not reported as a live number for the same reason (no production data). What changed structurally: five previously $0/incomplete-cost call sites (including the Tutor, likely one of the highest-volume per-conversation-turn surfaces in the app) now report REAL, priced Luna/Terra cost per call, meaning this KPI can be computed accurately for those surfaces for the first time once real traffic exists.

## BEFORE / AFTER TOPOLOGY

See the audit doc's per-row "Before topology" / "After topology" columns. The Tutor's is the most significant: Sonnet/unbudgeted/uninstrumented/no-fallback → Luna-first/budgeted/bounded/fully-telemetered/one-bounded-Terra-fallback.

## QUALITY REGRESSION

Full existing test suite (3475 tests, 214 files) remains green after every change in this phase, including every RET-R1/R2/R3, LX-8, and transfer/grading regression suite. No Question Quality Gate threshold, deterministic check, or semantic verification requirement was touched. The deterministic numeric-grading short-circuit was designed to be strictly narrower than what AI grading would already accept (see ELIMINATED AI CALLS) -- it cannot make grading more lenient, only skip AI when the outcome is already certain.

## TESTS

- `tests/unit/lx9-motivation-ai-performance.test.ts` (**new**, 30 tests) -- covers required items 1-4 (routing authority, no hardcoded models outside documented exceptions), 9-12 (Luna-first routing, bounded Tutor fallback), 5-8/29-31 (deterministic numeric grading), 16-18 (citing existing Quality Gate coverage), 21/23 (Tutor context/token bounding), 32-37 (Tutor telemetry, wasted-call detection), 38-42 (motivation invariants).
- `tests/unit/tutor-cross-surface-guard.test.ts` and `tests/unit/tutor-adaptive-teaching.test.ts` -- updated in place to mock the new `callModel` call path instead of the removed `callAnthropicMessages` one; all pre-existing assertions preserved unchanged (60 tests total, all still passing).
- `tests/unit/ret-r2-candidate-surplus.test.ts` -- one pre-existing type-narrowing fix (unrelated to LX-9's behavior, a latent `unknown`-typed property access caught by this phase's `tsc` run).

## COMMITS

Implementation (`src/`, `tests/`) committed separately from this report and from the audit document, all with the required `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer. LX-10 was NOT started.

---

## CONDITIONS (why Part B is PASS_WITH_CONDITIONS, not full PASS)

1. **Tutor conversational quality is unvalidated.** Moving the Tutor from Claude Sonnet to Luna-first is the single highest-blast-radius change in this phase -- it changes the underlying model behind every tutoring conversation. It is a defensible, evidence-grounded fix (the routing table already declared "Luna first" as the intended TUTOR policy; Sonnet's use was an unwired, undocumented bypass of that intent, not a considered quality decision with a recorded rationale), and it is architecturally safe (one bounded Terra fallback, unchanged prompt/formatting instructions, full regression suite green). But this environment has no live browser/QA capability to verify Luna produces conversational tutoring quality comparable to Sonnet's. **Requesting live/Preview telemetry and qualitative review** of tutor replies after this ships, before treating the model choice itself as fully certified.
2. **Semantic-verification batching, request dedup, and prefetch remain unimplemented**, each for a stated reason (cross-candidate contamination risk without live eval data; correctness risk of naive request-collapsing; wasted-generation risk without a measured use-probability signal) -- not oversights, but genuine scope boundaries for this phase.
3. **Two unbounded prompt-context risks** (`topic-hierarchy.service.ts`'s full-concept-relist, `misconception.service.ts`'s unbounded signature list) are flagged, not fixed, since a correctness-safe bound needs case-by-case validation this phase did not have time to do carefully.

No candidate counts were increased anywhere in this phase, and no Question Quality Gate, Retention count, or evidence requirement was weakened, per this spec's own standing instruction.
