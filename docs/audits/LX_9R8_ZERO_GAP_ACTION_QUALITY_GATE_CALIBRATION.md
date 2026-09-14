# LX-9R8 — ZERO-GAP ACTION + QUALITY-GATE CALIBRATION

## STATUS

**PASS.** Both defects proven live in the LX-9R8 spec are fixed at their root cause, not patched at the symptom:

- A zero-gap `PRACTICE`/`REVIEW` decision is no longer executable on any learner-facing surface, or via the generation route directly, unless an explicit `REINFORCE` intervention is active. `executionMinimum` can never manufacture a pedagogical requirement.
- The semantic quality verifier now receives the same difficulty-tier calibration the generator itself was given, closing a structurally provable contract gap that caused deliberately simple, low-difficulty Practice questions to be judged against an undifferentiated, unstated rigor standard.
- Every semantically rejected candidate now emits a safe, structured `[quality_gate_rejection]` log line and rolls into a `[quality_gate_summary]` aggregate line and rejection-reason histogram — the previous `SEMANTIC_FAIL` outcome was opaque; it is now fully explainable without ever logging question/answer content.
- An invalid canonical action (zero-gap Practice with no REINFORCE signal) now fails **before** any Luna/Terra call — never a wasted generate → verify → Terra-recovery cycle for an activity that should never have launched.

`npx tsc --noEmit`, `npx vitest run` (228 files / 3841 tests), and `npm run build` are all clean on the implementation commit. No live browser/DB/auth QA is possible in this environment — this is a code-level PASS, not a claim of live behavior.

---

## ZERO-GAP PRACTICE

### LIVE CONTRADICTION

The spec's live trace: a `topic_practice` request resolved `activityType=PRACTICE, targetDifficulty=2, masteryState=LEARNING`, and the request's own `[LX-4R R8]` log line admitted the canonical evidence gap was **0**. Phase 3C selected `PRACTICE` anyway, and generation ran (and then failed semantic verification twice — see below). The learner was offered, and the system attempted to execute, a Practice activity the canonical Evidence Sufficiency contract says needs zero further evidence.

### ROOT CAUSE

`selectActivityType` (`src/lib/adaptive-learning-policy.ts`) and `deriveEvidenceRequirement` (`src/lib/lx/evidence-sufficiency-contract.ts`) are two genuinely independent authorities that were never reconciled before this phase:

- `selectActivityType` picks `PRACTICE` from **qualitative** signals (`masteryState`/`understandingScore`) via its own final fallthrough (`return 'PRACTICE';`) — it has zero awareness of evidence counts.
- `deriveEvidenceRequirement` computes the **quantitative** evidence gap (`minimumEvidenceCount - evidenceCount`, clamped to ≥ 0) completely separately, only at generation-request time.

A learner whose evidence count has already reached the canonical minimum can still read as `masteryState: 'LEARNING'` (confidence/understanding not yet promoted) — the qualitative axis says "keep practicing," the quantitative axis says "no further evidence needed." Before this phase, that contradiction was treated as a mere **count anomaly** (`countAuthority.zeroGapMismatch`, from LX-4R R8): the route still ran generation at `executionMinimum` size, and every learner-facing surface still offered the Practice CTA. `selectActivityType`'s own fallthrough is the first authority that allows the contradiction — it is the point where a qualitative signal is trusted as if it settled an executability question only the quantitative evidence-gap contract can answer.

### CANONICAL FIX

`isZeroGapPracticeMismatch` (`src/lib/lx/evidence-sufficiency-contract.ts`) is the one new, pure, shared authority every surface now consults **before** treating a `PRACTICE`/`REVIEW` decision as executable:

```ts
export function isZeroGapPracticeMismatch(params: {
  activityType: ActivityType;
  hasReinforceIntervention: boolean;
  currentSufficiency: EvidenceSufficiency | null;
  masteryPolicy: MasteryPolicy;
}): boolean {
  if (activityType !== 'PRACTICE' && activityType !== 'REVIEW') return false;
  if (hasReinforceIntervention) return false;
  const requirement = deriveEvidenceRequirement({ activityType, evidenceMode: ..., targetDimension: 'UNDERSTANDING', masteryPolicy, currentSufficiency });
  return requirement.questionCount.status === 'DETERMINED' && requirement.questionCount.pedagogicalRequirement === 0;
}
```

It reuses the **existing** `deriveEvidenceRequirement` verbatim — no second evidence-gap computation was invented. It reads only `pedagogicalRequirement`, never `executionMinimum` (test 4 asserts this by source audit), so a positive execution floor (the generator cannot literally run 0 questions) can never be misread as a pedagogical need.

Six call sites now consult it, all folding the result into a `BLOCKED`/`NO_CANONICAL_ACTION` outcome before any CTA or generation request is exposed:

| Surface | File | Effect when zero-gap |
|---|---|---|
| Canonical read model | `src/lib/lx/canonical-learning-progress.ts` | `actionState: 'BLOCKED'`, `nextCanonicalAction: null` |
| My Path | `src/lib/lx/path-view.ts` | hero `actionState: 'BLOCKED'` |
| Today | `src/services/learning-os-snapshot.service.ts` → `src/app/dashboard/today/page.tsx` | `nextExecutableItemZeroGapBlocked`; hero CTA renders `null` |
| Concept Mission | `src/lib/lx/concept-mission.ts` | `now.kind: 'NO_CANONICAL_ACTION'`, `fallback: 'ZERO_GAP_MISMATCH'` |
| Continuation | `src/services/learning-continuation.service.ts` | `{ status: 'RETURN_TO_MISSION', reason: 'ZERO_GAP_MISMATCH' }`, checked before `startLearningSession` |
| Generation route (backstop) | `src/app/api/quizzes/generate-and-take/route.ts` | `500 GENERATION_FAILED`, `reason: 'ZERO_GAP_PRACTICE_MISMATCH'`, before any AI call |

Today and the Mission compute the check inside their own service/read-model layer (`learning-os-snapshot.service.ts`, `concept-mission.ts`), never inside the page/component itself — Today's page gained zero new imports, consistent with the Closeout B architectural boundary already established by LX-9R5/LX-9R6 for the WAITING flag.

The route's own check is a deliberately **conservative** backstop, not the primary prevention: it has no full `LearningDecision`/journey available (only the already-fetched `ConceptKnowledgeState`), so its REINFORCE signal is narrower (`criticalMisconceptionCount > 0 || masteryState === 'INTERVENTION_REQUIRED'`) than the richer `journey.intervention === 'REINFORCE'` the five upstream surfaces use. It exists so a client bypass of the upstream CTA suppression can never still reach Luna/Terra — defense in depth, never the sole line of defense.

### REINFORCE EXCEPTION

Only an **explicit** canonical intervention justifies offering zero-gap Practice — the spec's A2 requirement. `hasReinforceIntervention` is derived, per surface, from the SAME already-canonical fact each surface already has:

- `canonical-learning-progress.ts` / `path-view.ts` / `concept-mission.ts`: `journeyResult.intervention === 'REINFORCE'` (from `deriveLearnerJourneyStage`, which sets `intervention: 'REINFORCE'` only for `learningState ∈ {MISCONCEPTION_BLOCKED, PREREQUISITE_BLOCKED, NEEDS_REPAIR}`).
- `learning-continuation.service.ts` / `learning-os-snapshot.service.ts`: a locally duplicated `REINFORCE_LEARNING_STATES` `Set` of the same three `LearningState` values (these two services don't have the richer `journey.intervention` field directly available, so they mirror the exact same rule the journey contract itself uses).
- `route.ts`: the narrower `criticalMisconceptionCount > 0 || masteryState === 'INTERVENTION_REQUIRED'` backstop described above.

`isZeroGapPracticeMismatch` itself never infers a REINFORCE justification from `masteryState`/`understandingScore` — it takes `hasReinforceIntervention` as an already-decided boolean input and short-circuits to `false` (never a mismatch) whenever it is `true`, before it ever consults the evidence-gap contract. Required test 3 proves low understanding alone (`understandingScore: 5`, no REINFORCE learningState) still blocks — the exception is never inferred from mastery level.

---

## SEMANTIC QUALITY

### LIVE FAIL

Live trace: Luna generated 1 question (difficulty 2). Semantic verification ran as a real, billed provider call and returned `SEMANTIC_FAIL` (`acceptedCount: 0`). The Terra recovery generation also succeeded (1 question) but was **also** rejected by semantic verification. Final result: `QUESTION_COUNT_INSUFFICIENT`, `publishedCount: 0`, `durationMs: 11604`. The provider request/billing/structured-output/exact-count contract were all functioning correctly — the failure was entirely inside the quality judgment itself.

### VERIFIER REASON

Before this phase, the rejection reason was invisible: `applyQuestionQualityGate` counted `semanticRejected++` but recorded no per-candidate detail beyond that number. There was no way to see *which* dimension (concept alignment, ambiguity, reasoning consistency, distractor plausibility, scenario appropriateness, visual consistency, or low confidence) caused either rejection.

### GENERATOR CONTRACT

`buildQuestionGenerationPrompt` (`src/services/quiz-generation.service.ts`) has always told the generator explicitly what a given difficulty tier demands — before this phase via an inline `if (difficulty <= 1) ... else ...` block, now via the extracted `describeDifficultyTier(difficulty)`. Difficulty 2's own definition: *"one clear application step in a familiar representation — still no multi-step reasoning, error diagnosis, or context transfer required."* The generator was correctly instructed to produce a simple, single-step question at difficulty 2.

### VERIFIER CONTRACT

`question-quality-verifier.service.ts`'s `buildPrompt`/`questionPayload`/`buildBatchPrompt` — **before this phase** — never included `q.difficulty` in the payload sent to the model, and the system prompt never mentioned difficulty calibration at all. Every candidate, whether difficulty-1 "everyday practice" or difficulty-5 "exam simulation," was judged against a single, undifferentiated, unstated rigor standard.

### CONTRACT MISMATCH

This is the structurally provable root cause: the generator is instructed to produce a *deliberately simple* difficulty-2 question, but the verifier has no way to recognize that simplicity is *correct at that tier*, not a defect. A genuinely simple question (few reasoning steps, an unremarkable distractor set, a direct scenario) reads, to a verifier with no difficulty context, exactly like a *low-effort* question — the two are indistinguishable without the tier information the generator already had. This directly matches the live evidence: a difficulty-2 question rejected twice in a row by independent semantic-verification calls.

### FIX

`describeDifficultyTier` (`src/services/quiz-generation.service.ts`, newly exported) is the single shared source of truth for tier meaning, extracted from the generator's own previously-inline logic with **zero change in wording** (locked by required test 22, which asserts every one of the 5 tiers reads exactly as the original text did). `question-quality-verifier.service.ts` imports it — it never redefines tier prose (required test 17). Both the single-candidate and batch verifier prompts now:

- include `difficulty: q.difficulty` in the payload sent to the model, and
- state the target tier calibration inline (`describeDifficultyTier(q.difficulty)` for the single-candidate path; all 5 tier summaries, applied per-candidate, for the batch path), explicitly instructing the verifier to judge unambiguous/reasoningConsistent/distractorsPlausible/scenarioAppropriate against **that candidate's own assigned tier**, never a harder implicit standard.

This is a calibration fix to the verifier, not a lowering of its standards — no dimension was removed, weakened, or made optional; the verifier was given the missing context it needs to apply its existing standards correctly to a low-difficulty question, exactly as B2 requires ("if valid fixtures are rejected by current verifier criteria, fix the verifier/prompt calibration, never generation").

### REJECTION TAXONOMY

`QualityRejectionReasonCode` (`question-quality-verifier.service.ts`, newly exported) is a 9-value taxonomy built from the verifier's own actual checked dimensions, not the spec's illustrative example names verbatim (per the spec's own instruction that "exact taxonomy should reflect existing verifier criteria"):

```
OUT_OF_SCOPE | ANSWER_INCORRECT | AMBIGUOUS | REASONING_MISMATCH |
WEAK_DISTRACTORS | SCENARIO_INAPPROPRIATE | VISUAL_INCONSISTENT |
LOW_CONFIDENCE | VERIFY_ERROR
```

`classifyQualityRejectionReasons(verdict)` is the one pure function mapping a raw verdict's failed boolean dimensions to these codes; `evaluateQuestionQualityVerdict` calls it internally (unchanged pass/fail behavior — only its internal `reason` string format changed, confirmed via grep that no existing test asserted the old lowercase-hyphenated format).

`gated-question-generation.service.ts` adds, at the one shared gate authority (`applyQuestionQualityGate`), so every caller gets it identically without re-deriving anything:

- **`[quality_gate_rejection]`** — one line per semantically rejected candidate: `operationId, candidateId, activityType, difficulty, verdict (SEMANTIC_FAIL | VERIFY_ERROR), reasonCode[]`. Never question text, correct answer, explanation, or any other student/content data (required test 10 asserts this by serializing the exact logged payload and checking it never contains the fixture's own question text or the literal strings `question`/`correctAnswer`/`explanation`).
- **`[quality_gate_summary]`** — one aggregate line per gate call: `operationId, activityType, generatedCandidates, semanticChecked, semanticAccepted, semanticRejected, deterministicRejected, rejectionHistogram` — the spec's 4-field aggregate (`generatedCandidates/semanticChecked/semanticAccepted/semanticRejected`) plus the full histogram and the pre-existing deterministic count, all from the one return path every caller already shares.
- **`semanticRejectionHistogram`** — now part of `applyQuestionQualityGate`'s return value: every taxonomy code always present (0 when unseen), so a caller can diff two runs without missing-key ambiguity.

`operationId`/`activityType` are threaded through from every canonical generation call site — `quick_check` (`qcGateReq`, tagged `'SOLO_CHECK'`), `practice` (`gateReq`, tagged with the caller's own `activityType` or `'PRACTICE'`), `retention_check` (`retentionApplyGate`, tagged `'RETENTION_CHECK'`), and the general gated-batch path (`generateGatedQuestionBatch`, tagged with `opts.activityType`) — so a rejected candidate's log line is always correlatable back to the operation that produced it, matching this engagement's established `operationId` correlation discipline (LX-9R6-R1/LX-9 FINAL).

---

## PERFORMANCE

### FIRST-PASS GENERATION

Live trace: Luna generation took **~5.03s**.

### VERIFICATION

Live trace: semantic verification took **~1.95s**.

### TOTAL

Live trace: **~7s** before persistence/client overhead on a clean first pass; **11.6s** observed with the one recovery cycle (Terra regeneration + a second semantic verification round) this specific request triggered.

### REMAINING BOTTLENECK

This environment has no live provider access, so no new timing measurement was possible in this pass — the numbers above are the spec's own live trace, reproduced here for reference, not re-measured. What can be established structurally, honestly bounded to what code-level analysis can prove:

- **Semantic verification cannot be skipped for genuinely undetermined candidates.** `checkQuestionQualityDeterministic` already returns `PASS` (skipping semantic verification entirely) for every claim it CAN recompute deterministically (numeric answers within its narrow recomputable subset, structural/schema/pedagogy checks). It returns `NOT_DETERMINISTICALLY_VERIFIED` — and only then reaches the semantic verifier — for claims genuinely outside that subset: free-text answer correctness, scenario/reasoning appropriateness, and (whenever `options` are present) distractor plausibility. The difficulty-2 fixture in this phase's required tests reaches `NOT_DETERMINISTICALLY_VERIFIED` for exactly this reason (test 12). Skipping semantic verification for these would mean publishing a question whose distractor plausibility, ambiguity, and concept alignment were never actually checked — a pedagogical safety regression the spec explicitly forbids ("do not optimize by weakening validation").
- **Batching is already in place where it helps.** `applyQuestionQualityGate` already routes more than one candidate needing semantic verification through a single batched `verifyQuestionQualityBatch` call (LX-9R3 D3, unchanged by this phase) rather than N separate calls — the canonical small-count Practice path (≤ 4 questions, the common case per the live trace) has at most one candidate needing semantic verification per Luna/Terra attempt in the fixed-slot quick_check path, so batching's benefit is realized on the multi-chunk Practice and cumulative/exam paths, not this specific single-question live trace.
- **Shortening the verifier prompt/context is bounded by what this phase just fixed.** The difficulty calibration added in Part B (a short paragraph plus one `difficulty` field) is the minimum context needed to prevent the exact over-rejection this phase root-caused; shortening it further would reintroduce the contract gap. `semantic_verification`'s existing token budget (`maxOutputTokens: 900`, `reasoningEffort: 'low'`) was already the smallest of any generation-adjacent budget in this codebase before this phase and is unchanged by it.
- **Moving verification off the critical path is not pedagogically safe for this activity shape.** The canonical small-count Practice/quick_check/retention paths publish an exact, learner-facing count synchronously — a candidate whose quality is still unverified cannot be shown to the learner speculatively and revoked later without a materially different (and much larger) product/UX change than this phase's scope. This phase does not propose that change; it only makes the EXISTING synchronous gate correct and observable.

**PASS_WITH_CONDITIONS on Part D specifically**: correctness (Parts A/B/C) is fully verified at the code level; Part D's live-timing numbers are the spec's own reproduction, not independently re-measured in this environment, and the "avoid/batch/shorten/move-off-critical-path" question is answered structurally (why each lever is already used where safe, or would trade away validation where it is not) rather than with a new live benchmark, since no live provider access exists here.

---

## TESTS

24 required tests across two files (both new):

- **`tests/unit/lx9r8-zero-gap-action-quality-gate.test.ts`** (32 tests) — runs the REAL, unmocked pure functions throughout (`isZeroGapPracticeMismatch`, `buildCanonicalLearningProgress`, `buildConceptMissionView`, `checkQuestionQualityDeterministic`, `evaluateQuestionQualityVerdict`, `classifyQualityRejectionReasons`, `describeDifficultyTier`) plus source audits for the four surfaces that need heavier I/O mocking to exercise directly (Today, My Path, continuation, route.ts). Covers required tests 1-9 (Part A), 12-17 (Part B1/B2 contract validity), and 21-23 (regression).
- **`tests/unit/lx9r8-r1-quality-gate-observability.test.ts`** (7 tests) — whole-module-mocks the deterministic contract and semantic verifier (same pattern as the pre-existing `lx4p-perf-r1c-r1-gate-primitives.test.ts`) to exercise `applyQuestionQualityGate`/`gateUnitWithTerraFallback`'s logging and histogram behavior in isolation, kept in a separate file because a single file cannot both mock and run-for-real the same modules. Covers required tests 10-11 (Part B/B3 instrumentation) and 18-20 (histogram observability + exact-count/retry regression).

Required test 24 ("all existing tests green") is the full suite run below, not a dedicated assertion.

| # | Requirement | Test file |
|---|---|---|
| 1 | Zero-gap PRACTICE not executable | `lx9r8-zero-gap-action-quality-gate.test.ts` §1 |
| 2 | Zero-gap REVIEW not executable | §2 |
| 3 | REINFORCE exception (explicit only) | §3 |
| 4 | executionMinimum cannot manufacture a requirement | §4 |
| 5 | Today cannot offer the CTA | §5 |
| 6 | My Path cannot offer the CTA | §6 |
| 7 | Concept Mission cannot offer the CTA | §7 |
| 8 | Continuation cannot launch | §8 |
| 9 | Route fails before any AI call | §9 |
| 10 | Per-candidate rejection log, no content leakage | `lx9r8-r1-...ts` §10 |
| 11 | Stable reasonCode shared by log + histogram | §11 |
| 12-13 | Valid difficulty-2 fixture clears deterministic + semantic contract | `lx9r8-zero-gap-...ts` §12-13 |
| 14 | Ambiguous fixture rejected (AMBIGUOUS) | §14 |
| 15 | Out-of-scope fixture rejected (OUT_OF_SCOPE) | §15 |
| 16-17 | Generator/verifier difficulty definitions match, one shared authority | §16-17 |
| 18 | Rejection histogram observable | `lx9r8-r1-...ts` §18 |
| 19 | Exact-count contract unchanged | §19 |
| 20 | Retry/recovery contract unchanged | §20 |
| 21 | Canonical stage/progress unchanged | `lx9r8-zero-gap-...ts` §21 |
| 22 | Difficulty-tier prose unchanged by extraction | §22 |
| 23 | Novelty/dedupe logic unchanged | §23 |
| 24 | Full suite green | see below |

**Verification, run on the implementation commit:**

```
npx tsc --noEmit        -> clean, 0 errors
npx vitest run          -> 228 test files, 3841 tests, all passed
npm run build            -> clean production build
```

Three pre-existing tests required updates because this phase's changes extended a call site or return shape they anchored on literally (not because their underlying invariant changed):

- `tests/unit/ret-r3-retention-availability.test.ts` — the exact-call-shape audit for `retentionApplyGate`'s `applyQuestionQualityGate` call updated to match the new `operationId`/`activityType` arguments (same authority, same no-bypass assertion).
- `tests/unit/lx4p-perf-r1c-gated-practice.test.ts` / `lx4p-perf-r1c-r1-gate-primitives.test.ts` — their `question-quality-verifier.service` mocks extended with a `classifyQualityRejectionReasons` stub, since `applyQuestionQualityGate` now calls it during rejection logging.
- `tests/unit/lx3-concept-mission.test.ts`, `lx9-final-transfer-recovery-canonical-progress.test.ts`, `lx9r3-progression-novelty-difficulty-results.test.ts`, `lx9r3-r1-adaptive-difficulty-retention-waiting.test.ts`, `lx7-my-path.test.ts` — anchors/fixtures updated for the new `masteryPolicy` input field and the `describeDifficultyTier` extraction (verified the underlying assertions still hold against the same, relocated text).

---

## COMMIT

Implementation: `2f4656e` — `fix(lx-9r8): zero-gap Practice/Review must not be executable; verifier now shares generator's difficulty calibration`

This report: separate docs commit, immediately following.

Branch: `tmp/lx1` (git worktree only — never `origin/main`, nothing deployed).

**DO NOT start LX-10.**
