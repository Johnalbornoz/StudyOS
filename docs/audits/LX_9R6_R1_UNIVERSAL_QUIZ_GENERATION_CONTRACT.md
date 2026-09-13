# LX-9R6-R1 — UNIVERSAL QUIZ GENERATION CONTRACT

## STATUS

**PASS.** Every code-level certification criterion is met: no valid quiz can silently
publish fewer questions than its canonical required count; every major canonical
generation path (Practice, Review, Diagnostic, Cumulative, Mock, and the pre-existing
Solo Check/Retention) now emits correlated operation-level diagnostics; recovery is
bounded everywhere it exists; and the full regression suite is green
(**3780/3780**, up from LX-9R6's 3748). Canonical journey, canonical actions, adaptive
difficulty, WAITING, novelty, assistance semantics, Tutor, and Transfer were not
touched — this phase edited exactly three files:
`src/app/api/quizzes/generate-and-take/route.ts`, `src/services/quiz-generation.service.ts`,
and `src/services/gated-question-generation.service.ts`.

## COUNT AUTHORITY

Unchanged this phase: `route.ts` still resolves the ONE canonical `requiredQuestionCount`
before any generator runs — `maxQuestions` (clamped per mode) for multi-concept modes,
`resolveQuestionCount`'s canonical-evidence-gap result for single-concept Practice/Solo
Check, `RETENTION_REQUIRED_COUNT` (6, forced) for Retention, `[2,4]`-clamped for
Diagnostic. What changed is that every generator downstream of that one number now
either meets it exactly or fails closed — it was never the generator's job to decide the
number, only to reliably deliver it.

## REQUIRED VS CANDIDATE COUNT

Terminology used consistently in this phase's code and logs:

- **`requiredQuestionCount`** (a.k.a. `count`/`target`/`targetCount` in the existing
  code, left as-is to avoid a pure renaming diff across already-tested call sites) —
  the number the learner's activity MUST contain. Never aspirational.
- **`candidateTarget` / candidate surplus** — the internal generation volume used to
  *reliably* reach `requiredQuestionCount`: a chunk's own "up to N" request, a Terra
  regeneration's replacement batch, or the new aggregate recovery round's
  `recoverySize` (`deficit + 1`, bounded). Retention's pre-existing 8-candidates-for-6
  design is the canonical prior art this phase generalizes; nothing there changed.

No log line or code path calls a candidate number "required," and no `requiredQuestionCount`
is ever treated as negotiable.

---

## PRACTICE

### REQUIRED

`perConceptCap` (route.ts), which for the single-concept Practice/Review fast path
equals `maxQuestions` — itself either the canonical evidence-gap count (`resolveQuestionCount`)
or the caller's manual/legacy override. Unchanged.

### INITIAL CANDIDATES

Unchanged: `planChunks(count)` balanced chunks (≤`MAX_QUESTIONS_PER_CHUNK`=4 each),
each an independent "Generate UP TO N… fewer is fine" Luna call, run concurrently. A
chunk whose Luna output is empty still gets its own, unchanged, per-chunk Terra
regeneration (`gateUnitWithTerraFallback`, `fallbackWhen: 'EMPTY'`).

### RECOVERY

**New.** After every chunk (and its own per-chunk Terra fallback) is gated and
deduped, if the aggregate result is still short of `count`, exactly ONE bounded
recovery request fires: sized to `min(MAX_QUESTIONS_PER_CHUNK*2, deficit+1)`, run on
Terra, gated through the same universal quality gate, deduped against everything
already accepted, and merged in only up to the remaining deficit. If that one round
still can't close the gap, the function logs `PRACTICE_GENERATION_INSUFFICIENT`
(`errorCode: QUESTION_COUNT_INSUFFICIENT`) and returns `[]` — never a shorter array.
Bounded: at most one extra AI call total, regardless of how large the deficit is.

### PUBLISHED

Exactly `count`, or `[]`. Verified behaviorally in
`tests/unit/quiz-generation-practice-chunking.test.ts` (rewritten "exact-count publish
contract" describe block) across: full first-pass delivery, per-chunk Terra recovery,
aggregate recovery closing a cross-chunk-duplicate-induced deficit, aggregate recovery
itself failing (closes to `[]`), and an unbounded-loop guard (never more than one
recovery call regardless of deficit size).

---

## SOLO_CHECK

Untouched. Still `generateQuickCheckQuestions`'s exact-6-or-`[]` contract from LX-9R6
(6 parallel slots, now-recoverable initial-call failures, all-or-nothing publish).

## RETENTION

Untouched. Still `generateRetentionCheckQuestions`'s exact-6-or-`[]` contract
(candidate surplus, per-question gate, one bounded deficit-recovery round,
`RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS` on failure).

## DIAGNOSTIC

Routes through `generateGatedQuestionBatch` with `count` = the `[2,4]`-clamped exact
value route.ts already resolves (single concept, so `perConceptCap === maxQuestions`).
Now exact-or-`[]`: the fallback mode changed from `'EMPTY'` to `'SHORT'`, so a Luna
result that is non-empty but short of the target now also gets a Terra retry (it
previously did not); if the merged result is still short, `insufficientCount` is set
and the function returns `[]` instead of the short array.

## CUMULATIVE

`generateGatedQuestionBatch` is now exact-`perConceptCap`-or-`[]` **per concept**
(same fix as Diagnostic). Because a multi-concept request sums several concepts'
contributions before the final `.slice(0, maxQuestions)`, one concept's bounded
recovery still failing would previously silently shrink the total; route.ts now closes
this with a universal aggregate backstop (see below) that fails the *whole* request
closed rather than publishing fewer than `maxQuestions`.

## MOCK

Identical to Cumulative — same `generateGatedQuestionBatch` call, same per-concept
exact-count fix, same aggregate backstop.

**The aggregate backstop** (route.ts, new): immediately after
`const questions = shuffleArray(questionArrays.flat()).slice(0, maxQuestions);`, a new
check — `questions.length > 0 && questions.length < maxQuestions` — logs
`errorCode: QUESTION_COUNT_INSUFFICIENT` and fails the whole request closed (500
`GENERATION_FAILED`, same learner-facing copy as any other generation failure) *before*
reaching the pre-existing `questions.length === 0` gate. This is a single choke point
every mode's result converges on, catching a residual multi-concept shortfall even if
a future generator regresses — defense in depth on top of, not instead of, the
per-generator fixes above.

---

## UNIVERSAL OBSERVABILITY

### OPERATION ID

`generatePracticeQuestions` (`[practice]`) and `generateGatedQuestionBatch`
(`[gated_batch]`) each now mint their own `operationId` (mirroring `[quick_check]`/
`[retention]` from LX-9R6) and log `STARTED` / `INITIAL_GENERATION_COMPLETE` /
`QUALITY_GATE_COMPLETE` (Practice) or the gate's own Luna/Terra stages (gated batch) /
`RECOVERY_STARTED` / `RECOVERY_COMPLETE` / `GENERATION_SUCCEEDED` /
`GENERATION_INSUFFICIENT` / catch-all `UNEXPECTED_GENERATION_ERROR`.

### PROVIDER CALLS

`generateGatedQuestionBatch` still threads its own `operationId` into
`emitAggregateGateEvent` via the pre-existing `GateUnitTelemetry` plumbing (unchanged
from LX-4P-PERF-R1G) — every Luna/Terra generation call's real usage
(`lunaGenerationCalls`/`terraGenerationCalls`) is correlatable with this call's
`[gated_batch]` lines without a second, duplicate accounting path.

### QUALITY GATE

Unchanged gate itself (`applyQuestionQualityGate`); now logged with
`acceptedCount`/`recoveryCalls` at each terminal outcome for both Practice and gated
batch.

### RECOVERY

`recoveryCalls` (0 or 1) and, for Practice, the explicit `deficit`/`recoverySize`/
`recoveredCount` are logged at `RECOVERY_STARTED`/`RECOVERY_COMPLETE`.

### ERROR TAXONOMY

New stable codes used where this phase's fix actually applies:
`QUESTION_COUNT_INSUFFICIENT` (the count contract violation this phase closes),
`UNEXPECTED_GENERATION_ERROR` (catch-all exception), `CONCEPT_NOT_FOUND` mapped under
`INVALID_GENERATION_CONTRACT` for Practice's own pre-generation concept lookup.
`GENERATION_FAILED` remains the learner-facing/route-level code (unchanged, calm,
generic per the standing instruction); the new codes live in the internal logs only.
Not retrofitted everywhere in one pass — `AI_SCHEMA_INVALID`/`SEMANTIC_VERIFICATION_FAILED`/
`PERSISTENCE_FAILED` already have equivalent internal signals (`failureStage` from
`parseGeneratedQuestionBatch`, gate rejection reasons, `storeQuiz` exceptions) that
were not renamed to match this list, to avoid unrelated churn to already-tested log
shapes; flagged as a naming-consolidation opportunity for a future phase, not a
functional gap.

### DURATION

`durationMs: Date.now() - startedAt` on every terminal `[practice]`/`[gated_batch]`
outcome.

### COST CORRELATION

Unchanged — the same `BillableCallUsage[]`/`emitAggregateGateEvent` mechanism from
LX-4P-PERF-R1G, now reachable for every activity that routes through
`generateGatedQuestionBatch`, not just the ones that already used it.

---

## TESTS

59 new/rewritten tests across four files:

- **`tests/unit/lx9r6-r1-universal-count-contract-observability.test.ts`** (new, 29
  tests) — the 30 required items (1-12 count contract, 13-24 observability, 25-30
  regression), via source audits plus direct `generateGatedQuestionBatch` behavioral
  tests (SHORT-mode recovery succeeding and failing closed).
- **`tests/unit/quiz-generation-practice-chunking.test.ts`** (rewritten, 31 tests) —
  every chunk-architecture test updated to use full-chunk-size mocks so architecture
  assertions (call counts, models, prompt wording) stay meaningful under the new
  exact-count contract; new tests for aggregate recovery succeeding, aggregate recovery
  failing closed, and the unbounded-loop guard.
- **`tests/unit/quiz-generation-latex-safety.test.ts`** (2 tests rewritten) — the
  "corrupted question reduces final count, partial tolerance preserved" premise is now
  the opposite; rewritten to certify fail-closed-when-unrecoverable and
  recovery-closes-the-gap-when-possible.
- **`tests/unit/lx9r5-canonical-action-continuation-assistance.test.ts`** (1 slice
  window widened — the added `parentOperationId` field pushed a pre-existing
  source-audit anchor slightly past its old window).

No test was silently deleted; every rewrite carries a comment citing this phase and
explaining why the old assertion certified behavior the standing invariant now
forbids.

Full verification:
- `npx tsc --noEmit` — clean.
- `npx vitest run` — **3780/3780 passing** (225 files).
- `npm run build` — clean.

## COMMIT

`c76e3df` — `fix: enforce exact quiz question counts and add universal generation telemetry (LX-9R6-R1)`.
(This report is a separate docs commit, delivered via SendUserFile.)

---

# CERTIFICATION

**PASS.** No valid canonical quiz-generation request can silently publish fewer
questions than its `requiredQuestionCount` — every path either meets it exactly or
fails closed with an internally distinguishable `QUESTION_COUNT_INSUFFICIENT`, and the
route-level aggregate backstop catches the residual multi-concept case as defense in
depth. Every major canonical generation path (Practice, Review, Diagnostic, Cumulative,
Mock) now carries correlated, operation-level diagnostics matching the
Solo-Check/Retention pattern LX-9R6 established; Solo Check and Retention themselves
are untouched and still exact-6-or-nothing. Recovery is bounded everywhere: at most one
extra AI call per unit, no loop, no unbounded retry. Canonical journey, canonical
action, adaptive difficulty, WAITING, novelty, and assistance semantics were not
touched — verified both by the diff (three files changed, none of them
policy/journey/difficulty modules) and by the full regression suite passing unchanged
plus 59 new/updated tests. Tutor and Transfer were not touched at all.

DO NOT start LX-10.

STOP.
