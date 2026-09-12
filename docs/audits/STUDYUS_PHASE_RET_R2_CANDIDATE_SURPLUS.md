# STUDYUS — RET-R2 / RETENTION CANDIDATE-SURPLUS RELIABILITY REPAIR

## STATUS

**PASS.** (Code-level certification — see the certification block at the
end of this report for why "LIVE PASS" is never claimed in this
environment.)

The canonical published count (`RETENTION_REQUIRED_COUNT = 6`) is
unchanged. Candidate generation volume is now formally separated from
it (`RETENTION_INITIAL_CANDIDATE_COUNT = 8`), and bounded recovery is
sized with a deterministic surplus above the bare deficit
(`recoveryCandidateCount(deficit) = min(6, max(3, deficit + 2))`). The
provider call cap (2 Luna initial + 1 Terra recovery = 3 max) is
unchanged. The accept/reject authority (`applyQuestionQualityGate`) and
its internal ordering are untouched — RET-R2 changes how many
candidates are *requested*, never who decides what gets *published*.

## LIVE FAILURE ANALYSIS

Given trace: initial generation requested/generated 6, accepted 4 /
rejected 2. RET-R1's deficit-preserving logic correctly kept the 4 and
identified deficit = 2. One Terra recovery call requested the old
minimum-legal chunk size (3 candidates); it yielded accepted 1 /
rejected 2. Final accepted = 5, deficit = 1 → correctly failed closed
with `RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS`.

This is **not** a bug in RET-R1's preservation logic — every accepted
question was correctly kept, no valid question was ever discarded, and
the failure was closed (never a partial 5-question batch reached a
learner). The exposed gap is **candidate-pool sizing**: the system
generated exactly the canonical final count (6) initially, then only a
minimum-legal 3-question recovery chunk. Under those constraints, a
single bounded recovery round has no margin — any second rejection
inside it exhausts the budget. This can happen even with a
normally-functioning provider, purely from the arithmetic of "generate
exactly N, need exactly N, one bounded top-up of the bare minimum."

## REJECTION REASONS

No live telemetry from the specific traced incident exists to query in
this static repository — the given scenario's 2 initial + 2 recovery
rejections were reported only as "rejected," not broken down by cause.
Being honest about that limit, this repair does two things instead of
guessing at the historical causes:

1. **Fixes the structural gap** (candidate-pool sizing) that is
   provably sufficient to explain the failure regardless of *why* any
   individual question was rejected — under the old sizing, two
   unlucky rejections in either wave was enough to fail closed even if
   every rejection cause were routine and expected.
2. **Adds the telemetry that was missing.** `RETENTION_INITIAL_GATE_COMPLETE`
   and `RETENTION_RECOVERY_GATE_COMPLETE` now both carry a
   `rejectionReasons: Record<string, number>` aggregate (see
   OBSERVABILITY below), so any *future* recurrence is diagnosable by
   cause instead of by a bare accepted/rejected count.

## DID LX-8 VISUAL GATE CONTRIBUTE?

**No — proven structurally, not by telemetry.**
`generateRetentionCheckQuestions` calls
`buildQuestionGenerationPrompt(types, difficulty, language, contextChunks, 0, guidance, ibContext, conceptContext)`
— the literal `0` is the `visualAidRate` argument, meaning
retention_check generation **never requests a visual aid** from the
model. LX-8's new deterministic checks
(`VISUAL_MISSING_RENDER_DATA`, `VISUAL_INACCESSIBLE` in
`src/lib/lx/question-quality-contract.ts`) only execute inside an
`if (q.visualAid)` guard. Since retention questions structurally never
carry a `visualAid` field, these checks are provably unable to fire for
retention_check generation. This is a code-path proof, not an inference
from absent data — see
[quiz-generation.service.ts:1301](../../src/services/quiz-generation.service.ts:1301)
and [question-quality-contract.ts:176-179](../../src/lib/lx/question-quality-contract.ts:176)
for the exact lines. Test coverage: `ret-r2-candidate-surplus.test.ts`
tests 19-20 assert both the structural fact (visualAidRate=0 literal in
the retention call site) and that the visual gate remains *enabled*
(a deliberately visual-failing question is still rejected when forced,
proving RET-R2 did not weaken or disable it).

## CANONICAL FINAL COUNT

Unchanged: `RETENTION_REQUIRED_COUNT = 6`. This is the only number a
learner-facing retention check ever publishes. Never touched by this
repair.

## CANDIDATE COUNT

New, formally separated from the published count:

- `RETENTION_INITIAL_CANDIDATE_COUNT_PER_CHUNK = 4` (was 3)
- `RETENTION_INITIAL_CANDIDATE_COUNT = 8` (`RETENTION_CHUNK_COUNT * RETENTION_INITIAL_CANDIDATE_COUNT_PER_CHUNK`, was 6)
- Recovery: `recoveryCandidateCount(deficit) = min(6, max(3, deficit + 2))`
  — deficit 1 → 3, deficit 2 → 4, deficit 3 → 5, deficit 4+ → 6 (ceiling).

## BEFORE

- Initial: 2 concurrent Luna calls × 3 candidates = 6 candidates requested for a 6-question requirement (zero margin).
- Recovery (if triggered): 1 Terra call requesting exactly 3 candidates (the old fixed chunk size), regardless of deficit size.
- A single additional rejection inside a triggered recovery round could exhaust the entire 3-call budget with no further recourse.

## AFTER

- Initial: 2 concurrent Luna calls × 4 candidates = 8 candidates requested for the same 6-question requirement (2-candidate margin, tolerating 1-2 ordinary rejections with **no recovery call at all**).
- Recovery (if still triggered): 1 Terra call requesting `recoveryCandidateCount(deficit)` candidates — always strictly more than the bare deficit, so the recovery round itself has margin to absorb a rejection.
- Provider call cap (3 total) and the accept/reject authority are unchanged — the fix is entirely in *how many candidates are asked for*, never in *how many calls are made* or *who decides acceptance*.

## INITIAL SURPLUS

Both initial chunks now request 4 candidates each (was 3), for a total
initial candidate pool of 8 against a published requirement of 6 — a
surplus of 2. Per R3, no new ranking/selection logic was introduced:
`applyQuestionQualityGate`'s `accepted` array already preserves the
caller's original ordering, so the existing
`acceptedUnique.slice(0, RETENTION_REQUIRED_COUNT)` truncation
(unchanged from RET-R1) automatically implements "take the first/best 6
in existing deterministic order" once more than 6 candidates survive
the gate. The pre-existing whole-chunk collision handling (exact
duplicate or structural overlap between the two initial chunks discards
the whole of Chunk B, keeps Chunk A) is deliberately left unchanged —
RET-R1's own investigation already established that collision handling
was never the live bug, and RET-R2's own guidance favors the smallest
safe change. Test coverage: `quiz-generation-retention.test.ts`
("INITIAL SUCCESS" describe block, 6 tests) and
`ret-r2-candidate-surplus.test.ts` tests 3-8.

## RECOVERY SURPLUS

`recoveryCandidateCount(deficit) = Math.min(6, Math.max(3, deficit + 2))`
— deterministic and bounded, never exactly the bare deficit (since a
recovery candidate can itself be rejected) and never unbounded (clamped
to a ceiling of 6, matching the published count itself so recovery can
never realistically need to request more candidates than a
from-scratch initial chunk would). No learner/mastery heuristic is
consulted; the formula is a pure function of the numeric deficit. Test
coverage: `ret-r2-candidate-surplus.test.ts` tests 10-12 (deficit 1→3,
deficit 2→4, deficit 6→ clamps to 6).

## QUALITY GATE

`applyQuestionQualityGate` (`gated-question-generation.service.ts`)
remains the sole accept/reject authority, untouched by this repair. Its
signature, its deterministic + semantic sub-checks, and its ordering
guarantee are all unchanged. RET-R2 adds a read-only classification
pass (`classifyRetentionRejections`) that re-runs
`checkQuestionQualityDeterministic` over rejected questions *purely to
label* why they were rejected for telemetry — it never influences or
overrides the real gate's decision, and it runs *after* the gate has
already produced its `accepted`/rejected split. Every published
question, from either the initial or recovery wave, passes through this
same real gate; no candidate is ever published on the strength of
surplus generation alone.

## DEDUPE

Two dedupe mechanisms exist and are both preserved unchanged:

1. **Pre-gate, whole-chunk**: an exact duplicate or structural overlap
   between the two initial chunks discards the entire losing chunk
   (deterministic: always keeps Chunk A, regenerates Chunk B). This is
   RET-R1-era behavior, unchanged by RET-R2 except that the chunk being
   discarded is now sized 4 instead of 3.
2. **Post-gate, per-question, recovery-only**: `dedupeAgainstAccepted`
   filters any accepted recovery candidate that exactly duplicates an
   already-accepted question, so a recovery round can never
   double-publish a question that survived the initial wave. Verified
   in `ret-r2-candidate-surplus.test.ts` test 9: a recovery candidate
   deliberately duplicating a retained question is filtered out, and
   the final set contains the shared text exactly once.

## CALL CAP

`RETENTION_MAX_AI_CALLS_PER_ATTEMPT = 3` (2 concurrent Luna initial + at
most 1 bounded Terra recovery) is explicitly unchanged. RET-R2 changes
only the candidate COUNT per call, never the call COUNT. Verified by
`ret-r2-candidate-surplus.test.ts` tests 13-15 (including a
fully-exhausted-recovery scenario asserting the call count never
exceeds 3 — no retry loop was introduced).

## COST/LATENCY TRADEOFF

Initial-wave token cost increases modestly: `maxTokens` for a chunk
request scales as `Math.min(16000, 900 * count + 1500)`, so moving from
3→4 candidates per chunk raises the per-call cap from 4,200 to 5,100
tokens (a ~21% increase on the ceiling; actual usage scales with how
much material the model actually writes, not the cap). This is paid on
**every** retention generation, not just failure cases, in exchange for
a meaningfully higher probability of never needing a recovery call at
all (tolerating 1-2 ordinary rejections for free) and a higher
probability that a triggered recovery succeeds on the first and only
attempt (since `recoveryCandidateCount` no longer requests the bare
minimum). Performance/latency measurement against production traffic
remains deferred, as in RET-R1 — this repair is a reliability change
verified by code-level testing and structural reasoning about the
call-cost formula, not a live-measured benchmark. The tradeoff is
judged favorable because retention_check failures are learner-facing
hard failures (no partial batch is ever shown), so a modest, bounded
token-cost increase to reduce the frequency of a hard failure is the
right side of that tradeoff.

## OBSERVABILITY

New: `RETENTION_INITIAL_GATE_COMPLETE` and
`RETENTION_RECOVERY_GATE_COMPLETE` events now both carry a
`rejectionReasons: Record<string, number>` field — an aggregate count
per safe reason code (e.g. `{"SCHEMA_INVALID": 2, "VISUAL_MISSING_RENDER_DATA": 1}`),
computed by `classifyRetentionRejections` re-running the deterministic
contract check on rejected questions (falling back to a
`SEMANTIC_REJECTED` bucket when the deterministic check alone doesn't
explain the rejection). This never includes question text, answers,
explanations, or any learner/mastery data — only counts keyed by a
fixed, safe enum of reason codes. `RETENTION_GENERATION_STARTED` now
also reports `initialCandidateCount` alongside the existing
`requestedCount`, making the surplus visible in the log stream itself.
All existing RET-R1 events (`RETENTION_DEFICIT_IDENTIFIED`,
`RETENTION_RECOVERY_STARTED` — now also carrying
`recoveryCandidateCount` — `RETENTION_RECOVERY_COMPLETE`,
`RETENTION_BATCH_INSUFFICIENT`, `RETENTION_BATCH_READY`) are unchanged
in shape. Verified content-safety by
`ret-r2-candidate-surplus.test.ts` tests 17-18 and the pre-existing
`ret-r1-retention-deficit-recovery.test.ts` test 11 (asserting no
`"question"` key or literal marked text ever appears in any retention
telemetry event).

## REGRESSIONS

None found. Verified via source-contract assertions
(`ret-r2-candidate-surplus.test.ts` tests 21-29) that RET-R2 leaves
untouched: Practice question generation
(`generatePracticeQuestions`), Quick Check generation
(`generateQuickCheckQuestions`), Transfer/cumulative-exam gated batch
generation (`generateGatedQuestionBatch`), retention_check's
EvidenceMode (still `INDEPENDENT` in the activity taxonomy), no-help
integrity (no hint/guide language in the retention fast path),
Structured Outputs contract (`GENERATED_QUESTION_BATCH_SCHEMA` +
prompt version `v3` unchanged on both initial and recovery calls),
Luna/Terra provider routing (initial waves still route through
`RETENTION_CHUNK_MODEL`/Luna, recovery still explicitly routes through
Terra), and the absence of any evidence write in the retention
generation path. The full 3,200-test suite (204 files) passes with no
unrelated failures.

## TESTS

All required test items are covered across three files:

- **`tests/unit/quiz-generation-retention.test.ts`** (38 tests, rewritten) —
  initial-wave architecture, prompt wording (`Generate EXACTLY 4 CANDIDATE
  questions`, "StudyUS will select the best 6" framing), timeout/model/
  promptVersion contract, Variant B diversification notes, the 12-case
  structural-fingerprint suite (unaffected, pure function), the 4/3/2-call
  recovery-path scenarios re-sized for 4-per-chunk initial waves and
  `recoveryCandidateCount`-sized recovery, and the `[0, 6]`-only length
  invariant.
- **`tests/unit/ret-r1-retention-deficit-recovery.test.ts`** (25 tests,
  rewritten) — RET-R1's original 20-item deficit-preservation matrix,
  re-sized: initial chunks now carry 4 candidates (with 3 deterministically
  rejected to reproduce a deficit of 1, matching RET-R1's original "5 of 6
  accepted" narrative under the new sizing), and every recovery-chunk
  fixture is sized to the deficit-specific `recoveryCandidateCount` value
  the production formula actually computes for that scenario (3 for
  deficit=1, 4 for deficit=2).
- **`tests/unit/ret-r2-candidate-surplus.test.ts`** (30 tests, new — the
  file required by this spec) — covers, in order: canonical-vs-candidate
  count separation (1-2), initial surplus absorbing 1-2 rejections without
  recovery (3-4), universal gate authority and no-inflation (5-6), the
  whole-chunk collision rule never double-publishing a duplicate (7),
  deficit computed from the actually-retained/gated set rather than the
  raw 8-candidate request (8), recovery-stage dedupe never inflating past 6
  (9), the deterministic bounded recovery-surplus formula at 3 deficit
  values (10-12), the unchanged 3-call cap under both success and total
  exhaustion (13-15), explicit closed-failure still possible when recovery
  can't close the gap (16), safe aggregate rejection telemetry (17-18), the
  LX-8 visual-gate non-contribution proof plus confirmation the gate stays
  enabled (19-20), nine non-regression checks across every adjacent
  capability (21-29), and the exact-6-or-nothing invariant across four
  representative scenarios (30).

`npx tsc --noEmit`: clean. `npx vitest run`: **3200 passed / 3200** across
204 files. `npm run build`: clean production build (Next.js 16.3.1,
Turbopack), no route/type errors.

## COMMIT

Implementation and all three test files committed together in one
focused commit on `tmp/lx1`:
`fix: separate retention candidate generation count from published count (RET-R2)`.
This report is committed separately per the standing workflow.

---

**No rejected question was ever published. The canonical count never
exceeded or fell below 6 in any test scenario. No Quality Gate check
was weakened, bypassed, or disabled — the LX-8 visual checks remain
fully active and were proven (not assumed) unrelated to retention
rejections. Provider call volume remains capped at 3. This is a
code-level PASS only: no live browser, database, auth, or provider
execution exists in this environment to observe the actual historical
rejection causes or measure real-world recovery-success-rate
improvement. Do NOT claim LIVE PASS until live QA is performed. Do NOT
start LX-9. STOP.**
