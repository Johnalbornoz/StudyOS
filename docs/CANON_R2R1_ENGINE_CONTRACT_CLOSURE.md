# CANON-R2R1 — ENGINE CONTRACT CLOSURE

## STATUS

**CODE_PASS** (not "LIVE PASS" — no live browser/DB/auth/AI-provider access in this
environment, confirmed absent again this phase). Pedagogical Engine v1.0 is now
frozen: the four remaining open contracts CANON-R2 left as PASS_WITH_CONDITIONS
are closed. No integration, shadow mode, or migration was performed — this
phase is a pure contract closure on the isolated module, exactly as scoped.

Verification:
- `npx tsc --noEmit` — clean.
- `npx vitest run tests/unit/canon-r2-pedagogical-engine.test.ts
  tests/unit/canon-r2r1-engine-contract-closure.test.ts` — **136 tests, all
  passing** (83 in the updated CANON-R2 file + 53 in the new CANON-R2R1 file).
- `npx vitest run` (full suite) — **236 test files, 4115 tests, all passing**
  (was 235 files / 4061 tests before this phase — +1 file, +54 tests net,
  zero regressions).
- `npm run build` — clean.

## SCOPE FIREWALL

`git status --short` for this phase's diff, verbatim:

```
 M src/lib/pedagogical-engine/activity-contract.ts
 M src/lib/pedagogical-engine/engine.ts
 M src/lib/pedagogical-engine/evidence-qualification.ts
 M src/lib/pedagogical-engine/index.ts
 M src/lib/pedagogical-engine/policy.ts
 M src/lib/pedagogical-engine/types.ts
 M tests/unit/canon-r2-pedagogical-engine.test.ts
?? src/lib/pedagogical-engine/difficulty-policy.ts
?? tests/unit/canon-r2r1-engine-contract-closure.test.ts
```

Every touched file is inside `src/lib/pedagogical-engine/**`, the dedicated
CANON-R2/R2R1 engine test files, or (below) this report. No React component,
Next.js route, API, DB schema/service, AI generation code, Luna/Terra routing,
`reasoning_effort`, prompt construction, `promptCacheKey`, caching, Quality
Gate, semantic verification, generation retries, telemetry infrastructure,
performance code, multimodal code, `UnifiedResponseComposer`, MathLive, or any
learner-facing UX (Today, My Path, Concept Mission, Progress, Results,
`StartSessionButton`) was modified. No compile-only type export outside the
module was needed either — every change stayed entirely inside the engine's
own boundary.

## PRODUCT DECISIONS FROZEN

Four decisions, listed in the spec's own order:
1. Transfer per-challenge threshold: 70% (not the old 50% "complete failure"
   floor), checked independently from — and in addition to — the 80% overall
   average.
2. LEARN evidence qualification: a dedicated `LEARN_CHECK` attempt scoring
   **strictly above** 80%, never arbitrary activity existence.
3. Difficulty Policy: every stage's `targetDifficulty` is now derived from
   learner evidence (`difficulty-policy.ts`), never a static per-stage
   midpoint.
4. Complete canonical output contract: `canonicalRevision`, `stage`,
   `actionState`, `nextCanonicalAction`, `qualifiedEvidence`,
   `waitingReason`, `nextEligibleAt`, and `journeyProgressPercent` are all
   now first-class fields on `CanonicalPedagogicalDecision`.

## TRANSFER 70% FLOOR

`CANONICAL_POLICY.transfer.perChallengeFailureFloor` (50) is **removed
entirely** — verified by source audit (Test 12 of the new CANON-R2R1 file:
the string `perChallengeFailureFloor` no longer appears anywhere in engine
source). Replaced by `CANONICAL_POLICY.transfer.perChallengeMinimumScorePercent
= 70` (`policy.ts`). `qualifyEvidence`'s TRANSFER case now checks
`hasChallengeBelowFloor = perChallengeScores.some(s => s < 70)` **and**
`overall < 80` independently — either failing fails the attempt; passing
requires both.

Worked examples (all now covered by tests):
- `90/85/75` → overall 83.3% ≥ 80, every challenge ≥ 70 → **PASS**.
- `100/100/60` → 60 < 70 → **FAIL**, despite an 86.7% overall average.
- `100/75/70` → overall 81.7% ≥ 80 AND every challenge ≥ 70 → **PASS** (the
  spec's own cautionary example: both checks apply, and here both happen to
  pass — a `70/70/70` ledger, by contrast, meets the per-challenge floor but
  fails its own 70% overall average, proving the two checks are genuinely
  independent, not redundant).
- `100/100/20` → 20 < 70 → **FAIL** (still fails, exactly as the original
  CANON-R2 example intended, just via the new floor instead of the old one).

## TRANSFER FAILURE DIAGNOSIS

CANON-R2's original Case B (foundational failure) inference — "every
challenge scored below 50%" — is **removed**. Qualification (did this attempt
pass?) and rollback diagnosis (why, and how far back?) are now fully separate
concerns, per the spec's own explicit instruction not to infer Case B from a
numeric score pattern.

The new mechanism: `RawEvidenceItem.transferFoundationalFailureIndicated?:
boolean` — an **explicit** diagnostic signal, never computed by this engine
from `perChallengeScores` itself, representing evidence dimensions outside a
bare score pattern (e.g. a procedural-correctness sub-check from a diagnostic
evaluator — out of this isolated engine's own scope to compute). Absent or
`false` → **Case A** (application-weak, the conservative default) is used
even for a `[20,30,10]` ledger (Test 42b, a direct regression guard proving
low scores alone never imply foundational rollback). Only `true` → **Case
B**, rolling back to PRACTICE. Case C (a critical misconception detected
during the attempt, via `hasCriticalMisconception`) is unchanged — it was
never score-derived in CANON-R2 either.

This is a genuine, disclosed simplification: a real diagnostic evaluator
(distinguishing "this specific challenge type is weak" from "the underlying
procedure itself is broken") is out of scope for an isolated pure engine with
no model access — the engine consumes that diagnosis as data, it does not
produce it.

## LEARN QUALIFICATION

CANON-R2's "any evidence item without a critical misconception satisfies
LEARN" is **removed**. `ACTIVITY_TYPE_FOR_STAGE.LEARN = 'LEARN_CHECK'` now
gates qualification exactly like every other stage — a bare Practice, Prove,
Retention, or (especially) premature Transfer attempt returns
`WRONG_ACTIVITY_TYPE`, never satisfying LEARN merely by existing.

Score semantics: `CANONICAL_POLICY.learn.minimumScorePercentExclusive = 80`,
compared with `item.scorePercent <= 80` → fail (never `<`) — exactly 80% still
fails; only strictly-above-80 qualifies (Tests 4/5 of the new file: 80% FAIL,
81% PASS). Assistance is explicitly allowed (no independence check for LEARN).
A critical misconception on the attempt itself still disqualifies it (Test 6),
via the same generic `hasCriticalMisconception` check every stage shares.

## DIFFICULTY POLICY

New module `difficulty-policy.ts`. Every function is pure, given
already-extracted evidence facts (never raw IO), and returns
`{target, reasonCode}` from the closed `DifficultyReasonCode` vocabulary.

### Practice

`resolvePracticeDifficulty(practiceItemsInOrder)` walks every Practice-type
evidence item chronologically (regardless of whether it independently
qualifies the PRACTICE *requirement* — evidence-existence and difficulty
policy are separate concerns): a critical misconception or a score below 60%
decreases the administered difficulty by one level (floor 2,
`PRACTICE_LOW_PERFORMANCE_DIFFICULTY_DECREASE` /
`PRACTICE_MISCONCEPTION_REINFORCEMENT`); 60–79% maintains it
(`PRACTICE_DIFFICULTY_MAINTAINED`); ≥80% increases it by one level (ceiling
4, `PRACTICE_SUCCESS_DIFFICULTY_INCREASE`, or `..._MAINTAINED` when already
at the ceiling). With no Practice evidence, defaults to 2
(`PRACTICE_DEFAULT_DIFFICULTY`). The FINAL item's outcome is the running
target — "recently demonstrated," not a lifetime average.

**Documented design note**: because ONE qualifying Practice attempt already
satisfies the PRACTICE *requirement* (preserved verbatim from CANON-R2 — see
`PRACTICE POLICY — PRESERVE`), the full engine can only ever display a "next
Practice target" while PRACTICE is genuinely still the active, reachable,
unsatisfied stage — either before any qualifying attempt, or after a
Prove/Retention/Transfer failure rolls the learner back to Practice for
repair (both paths are exercised end-to-end through the full engine
elsewhere in the CANON-R2 suite, e.g. Tests 19–21). The specific "D2 pass →
D3, D3 pass → D4, D4 pass → stays D4" progression (Part 31, Tests 18–20 of
the new file) is therefore tested by calling `resolvePracticeDifficulty`
directly — the correct, precise way to exercise that per-function contract,
since a full-engine scenario cannot observe two *successive* Practice
attempts without one of them already having ended Practice's own turn.

### Prove

`resolveProveDifficulty(highestQualifyingPracticeDifficulty)` clamps the
highest difficulty ever sustained through a *qualifying* Practice attempt
into Prove's own `[3,4]` range: D2→3, D3→3, D4→4 (all three of the spec's
own worked examples fall directly out of one `clamp` call). Defaults to 3
with no qualifying Practice evidence at all.

### Retention

`resolveRetentionDifficulty(qualifyingProveDifficulty)` — the difficulty
**actually administered** on the specific qualifying Prove attempt that
opened the current retention window, clamped again into `[3,4]` only as a
defensive measure (it is already inside that range by Prove's own
qualification rule). Never resets to a generic stage default.

### Transfer

`resolveTransferDifficulty({qualifyingProveDifficulty, qualifyingRetentionScore,
activeCriticalMisconception})` defaults to Transfer's floor (4,
`TRANSFER_BASE_DIFFICULTY`). Target 5
(`TRANSFER_ADVANCED_DIFFICULTY_SUPPORTED`) requires ALL of: the qualifying
Prove reached Prove's own ceiling (4), the qualifying Retention scored ≥90%,
and no critical misconception is currently active — a **documented CANON-R2R1
policy decision** for what "evidence supports a higher challenge" means
concretely (the spec names the ingredients — strength/consistency of Prove,
Retention performance, absence of misconception — without a numeric formula;
this is the deterministic rule this phase commits to).

### Reinforce

`resolveReinforceDifficulty(practiceTarget)` — one level below the learner's
own current Practice difficulty trend (the SAME trend `resolvePracticeDifficulty`
already computes), clamped into `[1,3]`. Never a fixed/random number — always
grounded in the same evidence already driving Practice.

## COMPLETE OUTPUT CONTRACT

`CanonicalPedagogicalDecision` now carries every field the spec's conceptual
shape lists, with semantics preserved even where the exact name differs
(e.g. `qualifiedEvidence` is deliberately the SAME qualification data already
on `requirements`, re-exposed under its own name per-item rather than an
independently-computed second notion of "qualified"):

```ts
{
  policyVersion, canonicalRevision, conceptId, studentId,
  stage,                 // renamed from currentStage; currentStage kept as a
                          // @deprecated compatibility alias, identical value
  currentStage,
  actionState, nextCanonicalAction,
  requirements, qualifiedEvidence,
  activityContract,
  waitingReason, nextEligibleAt,
  intervention, rollback,
  reasonCodes,
  journeyProgressPercent,
  computedAt,
}
```

Nothing was omitted; `currentStage` was kept alongside `stage` (rather than
renamed outright) specifically because CANON-R2's own test suite already
references it 30+ times — removing it outright would have been a needless,
disruptive rename with zero semantic benefit.

## ACTION STATE

`ActionState = 'EXECUTABLE' | 'WAITING' | 'LOCKED' | 'CONSOLIDATED' |
'BLOCKED'`, derived from the current stage's own `RequirementResult.status`
(never left for a consumer to infer): `LOCKED`→`LOCKED`, `WAITING`→`WAITING`,
`UNSATISFIED`→`EXECUTABLE`, and a defensive `UNRESOLVED`→`BLOCKED` mapping
(never actually reachable today, since no code path assigns a
requirement-level `UNRESOLVED` status, but present for completeness and
future-proofing, consistent with the type's own closed-enum contract). A
`REINFORCE` intervention always reports `EXECUTABLE` — there is always a
concrete reinforcement activity to do right now. `stage === 'CONSOLIDATED'`
always reports `actionState === 'CONSOLIDATED'`.

Example pair from the spec: `stage=RETAIN, actionState=WAITING` (before the
3-day minimum elapses) vs. `stage=RETAIN, actionState=EXECUTABLE` (once
eligible) — both are directly tested (Test 42 of the new file for the first;
Test 26 of the CANON-R2 file for the second).

## NEXT CANONICAL ACTION

`NextCanonicalAction = 'LEARN' | 'PRACTICE' | 'PROVE' | 'RETENTION_CHECK' |
'TRANSFER' | 'NONE'` — a semantic pedagogical action only, computed purely
from `stage` whenever `actionState === 'EXECUTABLE'`, `'NONE'` otherwise.
Never a URL, API route, or React navigation target — routing stays entirely
external, exactly as the spec requires. Independent of `intervention`:
REINFORCE is metadata layered on top of the same underlying action category
(its own reinforcement-shaped `ActivityContract` already carries that
distinction) — a REINFORCE-tagged decision at `stage=PRACTICE` still reports
`nextCanonicalAction: 'PRACTICE'`, not a separate `'REINFORCE'` value (which
does not exist in this enum, matching "REINFORCE is never a canonical journey
stage").

## WAITING CONTRACT

`waitingReason: WaitingReason | null` is `'RETENTION_MINIMUM_INTERVAL_NOT_REACHED'`
whenever `actionState === 'WAITING'` (today, the only temporal gate the
engine has), else `null`. `nextEligibleAt: string | null` is the same
concrete date the RETAIN requirement's own `waitingUntil` already carries —
deterministically derived from the qualifying Prove's timestamp plus the
canonical 3-day minimum wait, never recomputed by a consumer.

## CANONICAL REVISION

`computeCanonicalRevision` (`engine.ts`) — a deterministic, non-cryptographic
fingerprint (FNV-1a, a plain 32-bit hash, zero dependencies) over exactly:
`policyVersion`, `conceptId`, `studentId`, the injected `now`,
`activeCriticalMisconception`, and a **normalized, chronologically-sorted**
copy of the evidence ledger (ids, scores, counts, flags — never derived
fields). No random UUID, no persistence, no read of the system clock beyond
the caller-injected `now`. Evidence is sorted (with an `id` tiebreak for
identical timestamps) before fingerprinting specifically so a caller handing
the same evidence in a different array order still produces the identical
revision (Test 60 of the CANON-R2 suite already covers this property for the
decision as a whole; the revision inherits it for free by fingerprinting the
same sorted array the rest of the engine already uses).

Determinism is directly tested: same input → same revision (Test 45),
changed evidence → different revision (Test 46).

## CANONICAL REVISION SECURITY

`RawEvidenceItem` itself carries no learner answer text, question text, or
other free-form content by construction (scores, counts, booleans, and enum
tags only) — the fingerprint is therefore **structurally incapable** of
leaking PII, not merely policy-restricted from doing so (Test 47). Studying
`RawEvidenceItem`'s own field list (`types.ts`) is sufficient to verify this;
no redaction step was needed because there was never anything to redact.

## JOURNEY PROGRESS

`journeyProgressPercent` mirrors `src/lib/lx/journey-progress.ts`'s own
already-approved fixed stage-anchor percentages **without importing that
module** (Engine Isolation would otherwise be violated): `LEARN=15,
PRACTICE=35, PROVE=55, RETAIN=70, TRANSFER=85, CONSOLIDATED=100`. This
engine's own stage set has no `NOT_STARTED`/`READY_TO_PROVE` distinction (a
CANON-R2 simplification carried forward unchanged) — `LEARN` and `PROVE`
each cover both of that finer-grained model's corresponding states. The
percentage always follows `stage` exactly (Tests: strictly increasing across
the canonical order; premature evidence cannot raise it, since `stage` itself
already cannot be raised by premature evidence — CANON-R2's own Invariant,
reconfirmed here).

## ENGINE ISOLATION

Re-verified after every change in this phase (Tests 1–7, 64–70 of the
CANON-R2 file; still zero imports of React/Next.js/AI providers/DB clients/
Vercel/quiz-generation/the Quality Gate/any existing service or route). The
new `difficulty-policy.ts` file imports only `policy.ts` and `types.ts` —
consistent with the module's own dependency rules.

## SUPERSEDED CANON-R2 RULES

Exactly two, both explicitly flagged by the spec and both updated with
documented reasoning inline (never mechanically weakened):
1. **LEARN arbitrary-evidence qualification** — every CANON-R2 test fixture
   that previously relied on a bare Practice/Prove/Transfer attempt to also
   satisfy LEARN now explicitly includes a dedicated `learnCheckItem(...)`.
   Test 49 (premature Transfer evidence) and Test 75 (the Radicación
   regression case) both carry updated commentary explaining exactly why
   their expected `currentStage` changed (Test 49: from `'PRACTICE'` to
   `'LEARN'`, since a Transfer attempt can no longer satisfy even LEARN's own
   bar; Test 75: a plausible prior `LEARN_CHECK` pass was added to the
   ledger, since nothing in the originally-reported symptom contradicts the
   student having passed initial comprehension before the reported Practice
   attempts, and this preserves the test's original diagnostic point).
2. **Transfer's `<50%` floor** — Test 38 (the spec's own 100/100/20 example)
   and Test 42 (the foundational-failure case) both updated: Test 38 now
   documents that the SAME numeric outcome (FAIL) is reached via the new 70%
   floor, defaulting to Case A rather than the removed automatic Case B; Test
   42 now explicitly supplies `transferFoundationalFailureIndicated: true` to
   still exercise the Case B path, with a companion Test 42b proving the same
   score pattern WITHOUT that flag now correctly defaults to Case A.

## TESTS

- `tests/unit/canon-r2-pedagogical-engine.test.ts` — 83 tests (was 82;
  net +1 after superseded-rule updates and one new regression guard, 42b),
  all passing, all previously-passing behavior preserved except the two
  documented supersessions above.
- `tests/unit/canon-r2r1-engine-contract-closure.test.ts` (new) — 53 tests
  across the spec's own required categories: LEARN regression (Part 29,
  8 tests), Transfer regression (Part 30, 8 tests + 1 explicit floor-removal
  source audit), Practice difficulty (Part 31, 10 tests), Prove/Retention/
  Transfer difficulty (Part 32, 8 tests), Output Contract (Part 33, 14
  tests), plus 5 supplementary tests covering `actionState`/
  `nextCanonicalAction` cross-stage behavior, `qualifiedEvidence` shape, and
  `journeyProgressPercent` monotonicity.

## FULL REGRESSION

`npx vitest run` (whole repository): **236 test files, 4115 tests, 0
failures** — up from 235 files / 4061 tests before this phase (net +1 file,
+54 tests). Confirmed via source audit (Tests 64–70 of the CANON-R2 file,
re-run unchanged this phase) that this phase touches none of: LX-10R1
performance architecture, `promptCacheKey`, static prefix ordering, provider
routing, `reasoning_effort`, the Quality Gate, RELEASE-R1's frontend routing
fixes, UX/CANON-R1's retention-before-transfer precedence, multimodal code,
language authority, database infrastructure, or any existing route.

## FILES CHANGED

```
 M src/lib/pedagogical-engine/activity-contract.ts
 M src/lib/pedagogical-engine/engine.ts
 M src/lib/pedagogical-engine/evidence-qualification.ts
 M src/lib/pedagogical-engine/index.ts
 M src/lib/pedagogical-engine/policy.ts
 M src/lib/pedagogical-engine/types.ts
 M tests/unit/canon-r2-pedagogical-engine.test.ts
?? src/lib/pedagogical-engine/difficulty-policy.ts
?? tests/unit/canon-r2r1-engine-contract-closure.test.ts
?? docs/CANON_R2R1_ENGINE_CONTRACT_CLOSURE.md
```

## COMMITS

Two commits on `tmp/lx1`, each with the required
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer:
1. `fix(canon-r2r1): freeze Pedagogical Engine v1.0 contracts` — the four
   product-decision closures inside `src/lib/pedagogical-engine/` and the
   two engine test files.
2. `docs(canon-r2r1): engine contract closure report` — this document.

No other file is touched by either commit (verified above).
