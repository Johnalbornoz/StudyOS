# LX-9R3 — PROGRESSION CLOSURE, NOVELTY & PERFORMANCE

## STATUS

**PASS_WITH_CONDITIONS.**

Every correctness invariant the spec's CERTIFICATION section names as a FAIL condition has been fixed at the code level and is covered by passing tests, with no known way for the old failure mode to recur:

- The proven live infinite RETAIN loop is closed at its actual root cause (an activity-selection timing bug), not patched in the UI.
- "Continue" can no longer relaunch a satisfied obligation — it always re-reads canonical state fresh.
- Consecutive Retention attempts now carry bounded cross-attempt novelty protection, reusing the existing structural-fingerprint authority.
- Difficulty is now a real, testable cognitive-demand contract in the generation prompt, not a vague adjective.
- Raw mastery percentage no longer appears in the primary learner Results experience.
- Semantic verification's provider-call count is structurally, provably reduced (8 calls → 1 for a full Retention batch).

The **conditions**: this environment has no live browser, database, or AI-provider access (standing constraint of this entire engagement). Three things the spec explicitly asks for cannot be honestly produced without that access, and are reported as gaps rather than invented:

1. **The live 10-consecutive-Retention-launch performance study (p50/p95/AI-calls-per-run/cost-per-run/etc.)** — not run. No live provider to measure.
2. **D1's "waterfall" is structural (call graph, ordering, parallelism), not a live-timed trace** — no real per-call millisecond timings exist to report; RET-R2/RET-R3's own telemetry (`[retention]` console events) records counts and reasons, never wall-clock duration per AI call.
3. **The specific mechanism behind the observed ~25s (vs. this phase's target ≤7s) is confirmed only structurally** — this phase can prove the provider-*call-count* dropped (8 semantic calls → 1), which is the single largest, most certain latency/cost lever available without live data; it cannot prove the exact number of seconds that saves, because the pre-existing code already ran those 8 calls in parallel (`Promise.all`), and how much wall-clock 8 concurrent same-provider calls actually cost vs. 1 is a provider-concurrency question this environment cannot measure.

No new threshold was invented anywhere in this phase. Every gate reuses existing canonical authority (`MEMORY_POLICY_V1`'s 3-day gap, `computeRetentionStructuralFingerprint`, `dedupeAgainstAccepted`, `applyQuestionQualityGate`). LX-10 was not started.

## LIVE EVIDENCE

The reported trap — a learner completing Retention at 100% repeatedly ("EVIDENCIA SUFICIENTE" / "REPASO DE RETENCIÓN COMPLETADO") and being returned to another `retention_check` every time — is explained in full below (PROGRESSION § RETAIN LOOP ROOT CAUSE). The other three observations in the same report (near-identical consecutive questions; imperceptible difficulty; ~25s generation) are addressed in QUESTIONS and PERFORMANCE respectively. The raw "Dominio del concepto: 2.91% → 3.56%" leak is addressed in RESULTS.

## PROGRESSION

### RETAIN LOOP ROOT CAUSE

The loop was never a caching bug and never a UI bug. It was a single timing-unaware condition in activity selection.

**The chain, traced end-to-end:**

1. `updateMastery` (`src/services/mastery.service.ts`) inserts one `learning_evidence` row per attempt, then — same transaction — calls `projectConceptMemoryState`, a **pure replay** of the full evidence history (`src/lib/algorithms/memory-model.ts`). It has no wall-clock/caching dependency; it re-derives memory state from scratch, every time, from the same-transaction, still-uncommitted row included.
2. `MEMORY_POLICY_V1.minimumRetentionGapDays = 3` requires **3 calendar days** between the last qualifying attempt (or the initial competence anchor) and a new attempt for that new attempt to *qualify* as independent retention evidence (`isQualifiedRetentionAttempt`, `src/lib/memory-policy.ts`). A too-soon attempt — regardless of score, even 100% — is `continue`d over by the projector: **state is not mutated at all.**
3. `knowledge-state.service.ts` derives `validationReadiness = 'WAITING_FOR_RETENTION'` the **moment** `demonstratedRetentionScore` is null — i.e. the instant validated mastery is first reached, often the *same day*, well before the 3-day gap has elapsed.
4. The bug: `selectActivityType` (`src/lib/adaptive-learning-policy.ts`) treated `WAITING_FOR_RETENTION` alone (and, separately, the bare presence of a `RETENTION_REVIEW_DUE` signal, regardless of its own timing) as **independently sufficient** to offer `RETENTION_CHECK` — with no read of whether a fresh attempt could actually qualify yet.
5. Result: the learner takes a retention_check the same day mastery validates. It scores 100%, but per step 2 above, the projector correctly leaves state **untouched** (too soon to count). Per step 3, `WAITING_FOR_RETENTION` is still true. Per step 4, the SAME signals fire again on the very next decision. **Unbreakable same-day loop, proven live.**

**The fix** (`src/lib/adaptive-learning-policy.ts:selectActivityType`) reads no new data — it reads a signal that was already being computed but not consulted for its own timing:

```ts
const retentionReviewDue = context.signals.find((s) => s.type === 'RETENTION_REVIEW_DUE');
if (retentionReviewDue?.temporalUrgency === 'HIGH') return 'RETENTION_CHECK';
```

`RETENTION_REVIEW_DUE`'s `temporalUrgency` is computed (`adaptive-learning-orchestrator.service.ts`) from `daysUntilReview < 0 ? 'HIGH' : 'LOW'`, where the review date itself is set from the **same** `minimumReviewIntervalDays`/`minimumRetentionGapDays` (both `3`) anchor math the qualification gate uses. By the time this reads `HIGH`, a fresh attempt taken right now can actually qualify. `WAITING_FOR_RETENTION` alone, with no genuinely-due timing signal, no longer offers the activity — the concept still, correctly, shows `RETENTION_RISK` (see below), it just isn't actionable yet.

`computeLearningState` (the RETAIN/journey-stage derivation, same file) was audited and deliberately left **unchanged** — it is provably correct as-is: the concept genuinely hasn't re-demonstrated retention during the wait, so `RETENTION_RISK` (journey stage RETAIN) is an accurate state to show. Only *which activity gets offered* needed the timing gate. This is a narrower, lower-risk fix than inventing a new "waiting, not yet actionable" journey stage, which risked destabilizing `deriveLearnerJourneyStage`'s existing rule ordering for no behavioral benefit.

### RETAIN CLEARING AUTHORITY

*"What must be true for a learner to move from RETAIN to TRANSFER?"* — machine-readable and learner-explainable, using only existing canonical authority, no invented threshold:

- **Evidence requirement**: at least one retention-check attempt whose evidence the memory projector accepts as state-changing (`stateChanged: true` in `projectConceptMemoryState`'s result) — i.e. an attempt old enough (`minimumRetentionGapDays`, 3 days since the last qualifying attempt or the initial competence anchor) to count as independent proof the learner *still* remembers, not just that they *just learned it*.
- **Temporal spacing**: the same 3-day gap (`MEMORY_POLICY_V1`), already used both to decide qualification and to schedule `next_review_at` — this phase did not invent a second number; it wired the *existing* one into activity selection where the same math already lived.
- **Score**: irrelevant to *qualification* — a too-soon 100% is not evidence; a qualifying attempt of sufficient score satisfies retention; the projector's own `demonstratedRetentionScore` (not this phase's concern to alter) still governs whether a *qualifying* attempt itself counts as sufficient.
- **Policy version**: `ADAPTIVE_LEARNING_POLICY_VERSION` (unchanged, `3`) and `MEMORY_POLICY_V1` are the two versioned authorities; nothing here introduces a third.
- **Learner-explainable form** (see A5/copy below): *"To move to Transfer, you need to show you still remember this independently after some time has passed — not just right after learning it."*

### POST-EVIDENCE RECOMPUTATION

`mastery.service.ts::updateMastery`, single transaction, in this exact order (`tests/unit/lx9r3-progression-novelty-difficulty-results.test.ts`, tests 1–2, audit the literal source ordering):

1. `INSERT INTO learning_evidence` (the new attempt's row).
2. `projectConceptMemoryState(client, studentId, conceptId)` — re-reads the **just-written** row, same client, still uncommitted to any other transaction.
3. `recalculateConceptKnowledgeState(studentId, conceptId, client)` — Knowledge State is a *projection*, recomputed from the evidence table, never a second source of truth.
4. `COMMIT`.

A new field, `MasteryUpdateResult.retentionCheckQualified`, is now exposed: `metadata?.activityType === 'RETENTION_CHECK' ? memoryProjection.stateChanged : undefined`. This is a safe, **non-fabricated** proxy: the projector is a pure function of evidence history, and exactly one new row is inserted per call, so `stateChanged === true` can only be attributable to *this* row. No new write, no new column, no new authority — an existing return value that was previously discarded is now surfaced.

### CONTINUATION

"Continue" was already, architecturally, never able to use a stale decision — this predates LX-9R3 (LX-5's continuation checkpoint design) and this phase's audit *confirmed* rather than needed to build it:

- `ContinuationPanel.tsx`'s own doc comment: *"CONTINUE calls `/api/learning/continue`, which re-reads canonical truth and returns a launch target or 'return to mission'. This component chooses nothing pedagogical."*
- `resolveContinuation` (`src/services/learning-continuation.service.ts`) calls `getConceptKnowledgeState(studentId, conceptId)` **fresh**, in its own request, entirely separate from the quiz-submission request/response that just completed. There is no decision object carried from the submission response into this call.

What LX-9R3 changed is *what that fresh read now resolves to* (the loop-breaker above) and *what the learner is told while waiting* (below) — not the re-read architecture itself, which was already correct.

### TRANSFER HANDOFF

Once Retention is genuinely cleared (a qualifying attempt lands and `validationReadiness` moves past `WAITING_FOR_RETENTION`), `selectActivityType`'s existing `TRANSFER_REQUIRED` branch (unchanged, positioned immediately after the fixed retention check) takes over — Transfer was already the canonical next stage; the loop bug simply prevented anyone from ever reaching it same-day. `tests/unit/lx9r3-progression-novelty-difficulty-results.test.ts` test 5 exercises this directly.

Retention is never misused as a Transfer substitute (Part C4): Retention's own generation path (`generateRetentionCheckQuestions`) is untouched in *purpose* — it still targets durable retrieval of the *same* construct, only varying representation (Part C, below), not novelty-for-its-own-sake or increasing abstraction run over run.

### CONCEPT COMPLETION

Audited, not rebuilt — the existing Concept Mission journey rail (`src/lib/lx/concept-mission.ts`, `ConceptMission.tsx`) already implements the full canonical journey (Aprender → Practicar → Demostrar → Retener → Transferir → Consolidado):

- A current-stage headline (`"Estás aquí: {stage}"`), a rung-by-rung PASSED/CURRENT/UPCOMING rail, and a distinct terminal `CONSOLIDATED_NO_ACTION` state ("Ahora mismo no hace falta nada. StudyUS te lo volverá a proponer para un repaso de retención cuando toque.") — explicitly framing consolidation as *ongoing*, never "finished forever."
- `LearnerJourneyStage`'s `'CONSOLIDATED'` value is derived only from `learningState === 'VALIDATED'` (`computeLearningState`'s full 10-rule precedence chain, all of which must be clear) — a multi-signal accumulated state, never derivable from one quiz score.
- Per-activity completion copy (`ContinuationPanel`, `continuation.ts`) is already activity-scoped ("Repaso de retención completado" / "Práctica completada"), never claiming the whole concept is done.

**One narrow gap found and fixed**: the quiz Results screen's bare `"Score"` / `"Puntaje"` label (`src/app/dashboard/quiz/page.tsx`) for the just-completed activity's own score, shown before any concept-level context, could — in isolation — read as "the concept is done." Relabeled to `"This activity's score"` / `"Puntaje de esta actividad"` (and the DE/FR/PT equivalents) across all five locales. Everything else in the journey/continuation layer already refused to imply single-quiz-completes-concept; no other changes were needed for Part F.

## QUESTIONS

### CROSS-ATTEMPT NOVELTY

**Audit (B1)**: `dedupeAgainstAccepted` (`quiz-generation.service.ts`) only ever compared candidates against `accepted` questions from the **same** generation call (called with `[]` or `acceptedUnique` — both scoped to one invocation). Zero awareness of a learner's prior attempts existed anywhere in the codebase (confirmed by a targeted repo-wide search for any existing fingerprint-persistence or reuse-detection mechanism — none found).

**Fix**: `fetchRecentRetentionQuestions(studentId, conceptId, attemptWindow)` reads the learner's last `RETENTION_NOVELTY_ATTEMPT_WINDOW` (3) `RETENTION_CHECK` `quiz_sessions` rows and flattens their persisted `questions` JSONB back into `GeneratedQuestion[]` — the **exact same shape** `dedupeAgainstAccepted` already consumes, so it is passed straight in as an additional `accepted` reference set. No second fingerprint format, no second matching engine, no new write path — `storeQuiz` was already persisting this data for every quiz.

This lookup runs in `Promise.all` alongside the existing `retrieveContext` RAG call (never serialized in front of the AI generation calls), and fails **open** to an empty history on any DB error (`.catch(() => [])`) — a non-critical novelty lookup must never block generation the way the Quality Gate itself is allowed to fail closed.

### FINGERPRINTING

Reuses `computeRetentionStructuralFingerprint` unchanged: `[conceptId, type, symbolicShape, cognitiveLevel, questionIntent].join('::')`, where `symbolicShape` abstracts bare numeric literals while preserving exponent/subscript digit-count — so `"Evaluate $2x+3$"` and `"Evaluate $9x+41$"` collide (same reasoning demand, cosmetic numbers only), while a different operator, variable, function, or exponent-digit-count does not. A question with no `$...$`/`$$...$$` math span gets `null` and is compared by normalized exact text only (the same fallback `dedupeAgainstAccepted` already used for non-math questions).

### NOVELTY WINDOW

Bounded to the last **3 attempts** (`RETENTION_NOVELTY_ATTEMPT_WINDOW`), enforced as a SQL `LIMIT` on the history query — never a global "this learner can never see this again" rule, and never an unbounded/permanent history table. Same-batch dedup still runs first (unchanged ordering/attribution), so a same-batch collision and a cross-attempt collision are logged under distinct reason codes (`DUPLICATE_OF_ACCEPTED`/`STRUCTURAL_OVERLAP_WITH_ACCEPTED` vs. the new `CROSS_ATTEMPT_EXACT_DUPLICATE`/`CROSS_ATTEMPT_STRUCTURAL_OVERLAP`) — never conflated.

The generation prompt for both initial chunks (and the recovery call, alongside its existing same-attempt exclusion note) now also receives a bounded exclusion note built **only** from the recent-attempt window's own question text (never correctAnswer/explanation/evidence) — the LLM is told what to avoid; the fingerprint dedup is the deterministic backstop that fires regardless of whether the model complied.

### DIFFICULTY AUTHORITY

**Audited, confirmed unchanged from a prior deliberate decision (LX-4J)**: difficulty is StudyUS-side, never learner-selected. The client (`quiz/page.tsx`) never sends a `difficulty` value to the generation endpoint; every call site in `generate-and-take/route.ts` falls back to a fixed `validated.difficulty || 3` — i.e. **every request currently generates at a static difficulty of 3.** A prior phase deliberately removed the learner-facing 1–5 difficulty-dots UI with the comment *"there is no canonical learner-relative difficulty authority (target challenge is UNRESOLVED)"* — this phase respects that decision and does not reintroduce learner-facing difficulty selection or attempt to newly wire difficulty to journey stage/mastery (a genuinely larger architectural change, out of this phase's scope, and explicitly not requested — the spec asks for a *meaningful, testable contract at whatever level is used*, not a new adaptive-selection engine).

### DIFFICULTY PROGRESSION

What changed: `buildQuestionGenerationPrompt`'s `difficultyDesc` (`quiz-generation.service.ts`), previously four vague adjective tiers ("basic, foundational understanding" → "expert, requires deep understanding and integration"), now names the concrete cognitive-demand vocabulary the spec requires:

| Tier | Was | Now names |
|---|---|---|
| 1 | "basic, foundational understanding" | direct recall / single most familiar textbook-form application — explicitly no combined operations, no unfamiliar representation, no multi-step reasoning |
| 2 | (folded into "basic") | one clear application step in a familiar representation |
| 3 | "intermediate, requires some analysis" | combines two related steps, or translating between two equivalent representations (word problem ↔ symbolic form, graph ↔ equation) |
| 4 | "advanced, requires application and synthesis" | multi-step reasoning, a less familiar representation/context, **or diagnosing an error in someone else's reasoning/work** |
| 5 | "expert, requires deep understanding and integration" | transfer to a genuinely unfamiliar context, **combining multiple operations/concepts**, or reasoning at a **higher level of abstraction** (explaining why a method works, generalizing, judging between approaches) |

Retention specifically (Part C3): its own generation path is unaffected in *difficulty* (still whatever the caller passes, typically the static 3) but now carries the cross-attempt exclusion note above, which explicitly instructs varying *representation, context, structure, or reasoning path* across attempts — satisfying "not identical in structure" without turning Retention into an escalating exam, which is not its purpose.

## PERFORMANCE

### CURRENT ~25S WATERFALL (structural, not live-timed — see STATUS)

No live per-call millisecond telemetry exists in this environment; RET-R2/RET-R3's `[retention]` console events record counts and rejection reasons, never durations. The topology **before** this phase, reconstructed from source (`git show HEAD~1` of `quiz-generation.service.ts` / `gated-question-generation.service.ts`):

```
t=0    Luna chunk A (4 candidates) ─┐  Promise.all (parallel)
t=0    Luna chunk B (4 candidates) ─┘
       ↓ (both resolve)
       deterministic gate (free, no AI) on all 8
       ↓
       up to 8 candidates classified NOT_DETERMINISTICALLY_VERIFIED
       ↓
       up to 8 Terra semantic-verification calls ─ Promise.all (parallel)
       ↓ (all resolve)
       dedupe (free) → acceptedUnique
       ↓ (if deficit > 0, e.g. a rejection dropped the count below 6)
       1 Terra recovery generation call (blocking, waits for the above)
       ↓
       up to 6 more Terra semantic-verification calls ─ Promise.all
       ↓
       final dedupe → publish or fail closed
```

**Critical path**: 2 parallel Luna calls → (gate, free) → up to 8 *parallel* Terra calls → (dedupe, free) → **if and only if a recovery round fires** → 1 Terra generation call → up to 6 *parallel* Terra calls. The semantic-verification fan-out was **already parallelized** (`Promise.all`) before this phase — so the ~25s was not caused by N sequential round-trips in code. The most likely remaining structural cost (unmeasurable here) is provider-side: up to 8 (then up to 6 more, if recovery fires) *concurrent* calls to the same high-risk capability/model plausibly queue behind account-level rate/concurrency limits in a way a single call cannot, and/or each of up to 14 total calls carries its own fixed per-request network/queueing overhead regardless of concurrency.

### SEMANTIC VERIFICATION TOPOLOGY / BATCHING

**Changed this phase**: `applyQuestionQualityGate` (`gated-question-generation.service.ts`) now branches on how many candidates need semantic verification:

- **> 1 candidate**: **one** `verifyQuestionQualityBatch` call (new, `question-quality-verifier.service.ts`) carrying all of them, with a strict schema (`QUESTION_QUALITY_VERDICT_BATCH_SCHEMA`) mapping `{id, verdict}` pairs.
- **exactly 1**: the original single-candidate `verifyQuestionQuality` call, unchanged (avoids batch-prompt overhead for the trivial case).
- **0**: no call at all (unchanged).

Every requirement from the spec's D3 gate was verified before shipping this, not merely assumed:

- **Candidate isolation is structural**: the batch result `Map` is pre-seeded with every requested id → `null` (fail-closed) *before* the call is attempted; only a verdict carrying that *exact* id overwrites its own entry; a foreign/unrecognized id is ignored; a malformed verdict for one id degrades **only that id** to `null`, never the batch (`tests/unit/lx9r3-semantic-batch-verifier.test.ts`, tests 25/26 — against the **real** implementation, not a mock, including an out-of-order response, a missing id, a foreign id, and a hard call failure).
- **A candidate the deterministic gate already resolved (PASS/FAIL) never reaches the semantic verifier at all** — unchanged prior behavior, reconfirmed under the new branching (`tests/unit/lx9r3-quality-gate-call-reduction.test.ts`, test 23).
- Quality regression suites for every existing consumer of the gate (Practice, Quick Check, cumulative/exam, variant generation, and all three Retention modes) pass **unmodified in intent** — 12 test files needed only their `question-quality-verifier.service` mock extended with the new export; zero assertions about *what gets accepted or rejected* changed.

### FILTER ORDER

Reordered per D4's stated objective ("expensive semantic evaluation should happen as late as possible, only on plausible publishable candidates"):

```
generation → PRE-GATE per-question dedupe (same-batch, free)
           → cross-attempt novelty dedupe (recent-history, free — DB only)
           → deterministic contract (free)
           → BATCHED semantic verification (1 call, only for what's left)
           → publish / bounded recovery
```

The pre-gate dedup (new this phase) and cross-attempt novelty dedup (Part B) both run **before** any AI call — a duplicate or recently-repeated candidate now never reaches the deterministic gate *or* costs a Terra call, whereas previously dedup ran only *after* the gate. Verified via the full RET-R2/RET-R3/quiz-generation-retention suite (89 tests) passing **unchanged** when the pre-gate reorder alone was introduced — proof it is a pure reordering with no behavior-visible difference in outcomes, only fewer wasted AI calls when duplicates exist.

### BEFORE/AFTER PROVIDER CALLS

The one number this phase can state with full confidence, independent of any live timing:

| Scenario | Before | After |
|---|---|---|
| Initial wave, all 8 candidates need semantic check | 8 Terra calls | **1** Terra call |
| Recovery wave, up to 6 candidates need semantic check | up to 6 Terra calls | **1** Terra call |
| Worst-case total AI calls for one Retention attempt (2 initial gen + semantic + 1 recovery gen + semantic) | up to 2 + 8 + 1 + 6 = **17** | 2 + 1 + 1 + 1 = **5** |
| Typical case (no recovery needed, most candidates deterministically resolved) | 2 + (0–8) | 2 + (0–1) |

`RETENTION_MAX_AI_CALLS_PER_ATTEMPT` (generation calls specifically — 2 initial + at most 1 recovery = 3) is unchanged and still enforced; this phase's reduction is entirely in the **semantic-verification** call count, which was not previously bounded to a small constant.

### BEFORE/AFTER LATENCY

**Cannot be honestly stated as a number of seconds** without live measurement (see STATUS). What can be said structurally: the call-count reduction above removes whatever wall-clock cost 7 extra (up to 8→1) and up to 5 extra (up to 6→1) *concurrent* same-provider calls were contributing beyond a single call's own latency — plausibly significant if the provider enforces per-account concurrency/rate limits below 8, plausibly small if it does not. This phase does not claim the ≤7s target is met; it claims the single largest identified, *provable* lever (call count) has been pulled, and reports the remainder honestly as unconfirmed pending live access.

### BEFORE/AFTER COST

Directionally lower-or-equal, not precisely quantifiable without live token accounting: total tokens across one batched call scale with candidate count (`maxTokens = min(16000, 300 + candidates.length × perCandidateBudget)`) and should be comparable to the sum of what N separate calls would have used for the same content — the batching removes N−1 sets of fixed per-request overhead (system-prompt repetition, response-schema boilerplate) without asking the model to evaluate less content. No regression toward *worse* cost is possible from this change alone; the improvement's exact magnitude needs live usage data this environment cannot produce.

## RESULTS

### RAW MASTERY REMOVAL

`quiz/page.tsx`'s mastery-delta block (`"Dominio del concepto: X% → Y%"`) is now gated `quizMode !== 'retention_check' && ...` — never rendered for a retention check's Results, where it was reported leaking. Practice/Assessment modes are unaffected (not reported broken, and the delta may carry genuine pedagogical value there — scoped narrowly per the actual complaint, not removed platform-wide).

The raw score is **not deleted from the system** — `generate-and-take/route.ts`'s API response still returns `mastery: primaryMastery` and `retentionCheckQualified` unconditionally; only the **learner-facing UI** for retention checks hides it. Admin/debug/analytics surfaces consuming the same API response retain full access (Part E's own explicit allowance).

### CANONICAL FEEDBACK

A new field, `retentionCheckQualified` (threaded from `mastery.service.ts` → `generate-and-take/route.ts` → `quiz/page.tsx`), lets Results tell the truth instead of declaring victory right before looping:

- If the attempt didn't qualify (too soon per the 3-day gap) — regardless of score — Results now shows a new, honest message (`quiz.retentionTooSoon`, all 5 locales): *"You already practiced this memory check today. Try again in a few days so it counts as evidence you still remember it over time."* It no longer claims "Retention completed" for an attempt that provably could not move the learner forward.
- Only a **qualifying**, passing attempt earns the `RETAINED` milestone copy.

### NEXT MILESTONE

The Results screen's `ContinuationPanel` (unconditional, every quiz mode) is the canonical "what happens next" — it calls `/api/learning/continue`, which re-reads state fresh (see PROGRESSION § CONTINUATION) and either launches the next canonical activity (e.g. Transfer, once Retention is genuinely cleared) or returns to the Concept Mission. Results itself invents no next-stage claim; it defers entirely to this existing, already-canonical mechanism.

## TESTS

Full required-test-matrix mapping (34/34 addressed; new file per group, one exception noted):

**Progression (1–9)** — `tests/unit/lx9r3-progression-novelty-difficulty-results.test.ts` (source-contract audits for 1, 2, 3/9; direct pure-policy fixtures against `selectActivityType`/`computeLearningState` for 4, 5, 7, 8; `buildConceptMissionView` for 6). Pre-existing files updated in place where the old certification was of the *bug*, not the fix: `phase-4-learning-state-decision-policy.test.ts`, `adaptive-learning-orchestrator.test.ts` (each split their old single WAITING_FOR_RETENTION-alone assertion into 3 explicit HIGH/LOW/absent-signal cases).

**Novelty (10–16)** + **Performance 22/24/28/29** — same file, against the real `generateRetentionCheckQuestions` with a DB/executeAI mock harness matching this codebase's existing RET-R2/RET-R3 convention.

**Difficulty (17–21)** — same file, source-contract audits of the route's static default, the prompt builder's parameter threading, the concrete cognitive-demand vocabulary, and the absence of any learner-facing difficulty control.

**Performance 23/27** — `tests/unit/lx9r3-quality-gate-call-reduction.test.ts`, against the real `applyQuestionQualityGate` with a mocked verifier (call-count assertions).

**Performance 25/26** — `tests/unit/lx9r3-semantic-batch-verifier.test.ts`, against the **real** `verifyQuestionQualityBatch` (not mocked anywhere else in this phase) with only the network boundary (executeAI/callModel) mocked — out-of-order responses, a missing id, a foreign id, a malformed verdict, an empty response, a hard failure, and unparseable JSON.

**Performance 30** ("all quality regression suites green") — certified by the full existing suite passing unmodified in intent (12 pre-existing files needed only their verifier mock extended with the new batch export; zero behavioral assertions changed), not a dedicated new unit test.

**Results (31–34)** — same file as progression, source-contract audits of the exact guard conditions and API response shape implemented this phase.

**Full suite**: `npx tsc --noEmit` clean. `npx vitest run` — **3588/3588 passing** (3550 pre-existing + 38 new: 29 in the progression/novelty/difficulty/results file, 4 in the call-reduction file, 5 in the batch-verifier file). `npm run build` — clean.

**Live performance validation**: not run — no live provider/DB access in this environment (see STATUS). Reporting a fabricated p50/p95 would violate this engagement's standing honesty requirement; this gap is disclosed rather than papered over.

## COMMITS

1. Implementation — loop-breaker fix, evidence-qualification threading, results-honesty fix, cross-attempt novelty, difficulty prompt rewrite, batched semantic verification, raw-mastery-leak fix, and the 12 pre-existing test-mock updates the batching change required.
2. This report (docs-only, separate commit).

Both commits carry the required `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer. Nothing was pushed to `origin/main`; nothing was deployed. LX-10 was not started.
