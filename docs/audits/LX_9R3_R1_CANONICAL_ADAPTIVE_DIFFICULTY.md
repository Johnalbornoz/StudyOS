# LX-9R3-R1 — CANONICAL ADAPTIVE DIFFICULTY

## STATUS

**PASS.**

Both blockers this phase targeted are closed at the root, not patched at the surface:

- **Difficulty is no longer static.** `resolveTargetDifficulty` (`src/lib/lx/difficulty-contract.ts`) is the one canonical authority, wired into every ordinary canonical `generate-and-take` call site in place of the blind `validated.difficulty || 3` fallback. It is a pure function of ActivityType and Knowledge State only — no time spent, clicks, streaks, raw quiz count, or learner-selected value. The learner still cannot select difficulty; the pre-existing manual/legacy setup-slider escape hatch is preserved, unchanged.
- **The Retention waiting experience is honest.** A concept in the RETAIN stage whose spaced-retention review is not yet due no longer offers an actionable "Comprobar que todavía lo recuerdas" CTA. The Concept Mission instead shows what has already been proven, why StudyUS is waiting, and the next eligible review date when a canonical one exists — reusing facts the journey stage itself was already derived from, never a new decision.

Full suite: `npx tsc --noEmit` clean. `npx vitest run` — **3624/3624 passing** (3590 pre-existing + 34 new). `npm run build` — clean. LX-10 was not started.

## OLD STATIC AUTHORITY

Confirmed exactly as the prior LX-9R3 report described: `src/app/api/quizzes/generate-and-take/route.ts` resolved every generation call's difficulty to `validated.difficulty || 3`, and the ordinary canonical quiz UI (`quiz/page.tsx`) never sends a `difficulty` field in its request — only a separately-gated manual/legacy `setup=1` slider path (pre-existing, from LX-4) ever populates it. `src/lib/lx/difficulty-contract.ts` itself already documented this precisely: section E was an explicit `resolveTargetDifficulty()` stub returning `{status: 'UNRESOLVED', deferredTo: 'LX-4'}` — this phase is that deferred authority, finally implemented.

## CANONICAL INPUTS

Audited per the spec's own list (D1), against what StudyUS already computes and where:

| Candidate input | Where it already exists | Used here? |
|---|---|---|
| ActivityType | `activity-taxonomy.ts` | **Yes** — the primary purpose-driving input |
| EvidenceMode | pure function of ActivityType (`evidenceModeForActivity`) | Implicit — a second name for the same fact ActivityType already carries; consulting both would add no information |
| LearnerJourneyStage | `learner-journey-contract.ts`, itself a presentation-layer projection of `LearningState` | Not consulted directly — see below |
| TeachingIntent / SupportLevel | `adaptive-teaching-policy.ts`'s `computeSupportLevel`/`computeTeachingIntent` | Not literally called — see below |
| KnowledgeState dimensions | `knowledge-state.service.ts`'s `ConceptKnowledgeState` | **Yes** — `masteryState` + `criticalMisconceptionCount` |
| Recent independent evidence / recent canonical errors | `ConceptKnowledgeState.independentEvidenceCount` / `activeMisconceptionCount` / `criticalMisconceptionCount` | Represented via `masteryState` (itself already derived from these) + `criticalMisconceptionCount` directly |
| Retention state / Transfer state | `ConceptKnowledgeState.retentionScore`/`transferScore`, `validationReadiness` | Represented via `masteryState` for the activities where it matters (RETENTION_CHECK, TRANSFER) |

**Why `masteryState` + `criticalMisconceptionCount`, not raw scores, `TeachingIntent`, or `LearnerJourneyStage` directly:**

1. `MasteryState` is *already* the canonical, already-thresholded classification `computeSupportLevel`'s own callers (`computePrimaryBarrier`) and `deriveLearnerJourneyStage` key off. Reading it introduces no new numeric band on top of a raw score — the banding StudyUS already does elsewhere is reused verbatim.
2. `criticalMisconceptionCount > 0` is the *exact* unconditional escalation `computePrimaryBarrier`/`computeSupportLevel` already apply (`ACTIVE_MISCONCEPTION` → `HIGH_SUPPORT`). This function applies the identical rule.
3. `TeachingIntent`/`SupportLevel` are computed from a *different*, heavier canonical source than what `generate-and-take` already has in hand: `adaptive-teaching.service.ts`'s `masteryScore`/`independentMastery` come from a full `DecisionContext`/`ConceptView` build (Phase 1/3's orchestrator), not from `ConceptKnowledgeState`. Building that context per quiz-generation call, only to feed a difficulty decision, would reintroduce real AI/DB topology cost — directly against the prior LX-9R3 phase's own performance work. `ConceptKnowledgeState` (via `getConceptKnowledgeState`) is *already* fetched at every one of this route's canonical call sites for the evidence-count requirement (`deriveEvidenceRequirement`); this authority reuses that exact read, at zero additional query cost for the single-concept fast paths.
4. `LearnerJourneyStage` is itself a *presentation-layer projection* of `LearningState`, which in turn reduces to the same Knowledge State facts read here for any concept that reaches generation without being blocked upstream (a blocking `LearningState` routes to PRACTICE/REMEDIATION before RETAIN/TRANSFER/PROVE could ever be selected — `computeLearningState`'s own precedence). Consulting the *ActivityType already selected* by that same precedence chain, plus Knowledge State, carries the same information as re-deriving the journey stage a second time.

No parallel learner model was created. No new DB table, no new score, no new evidence-tracking mechanism.

## TARGET DIFFICULTY POLICY

`resolveTargetDifficulty(context: {activityType, knowledgeState})` (`src/lib/lx/difficulty-contract.ts`) — pure, no IO, deterministic:

```
blocked    = criticalMisconceptionCount > 0 OR masteryState === 'INTERVENTION_REQUIRED'
established = !blocked AND masteryState is PROVISIONAL_MASTERY or VALIDATED_MASTERY
```

Every branch returns `{level: 1-5, reasonCode, derivedFrom}`. `reasonCode` names *why* (e.g. `PRACTICE_HIGH_SUPPORT_REBUILD`, `TRANSFER_HIGH_ABSTRACTION_ESTABLISHED`), `derivedFrom` names *what was consulted* — both for observability, never for a second decision downstream.

## ACTIVITY-SPECIFIC BEHAVIOR

### PRACTICE (and REVIEW, same EvidenceMode)

Four distinct levels, graded by `MasteryState`:

| Condition | Level | Reason |
|---|---|---|
| blocked (`INTERVENTION_REQUIRED` or active critical misconception) | **1** | `PRACTICE_HIGH_SUPPORT_REBUILD` |
| `LEARNING` / `UNKNOWN` | **2** | `PRACTICE_LEARNING_GUIDED` |
| `DEVELOPING` / `AT_RISK` | **3** | `PRACTICE_DEVELOPING_MODERATE` |
| established (`PROVISIONAL_MASTERY` / `VALIDATED_MASTERY`) | **4** | `PRACTICE_ESTABLISHED_CHALLENGE` |

### PROVE (SOLO_CHECK, SOLO_VERIFY)

Floor **3**, ceiling **4** — never trivialized, even under a blocking condition elsewhere (`PROVE_CRITICAL_MISCONCEPTION_FLOOR` still resolves to 3, not lower). "Independent, meaningful challenge" per the spec is satisfied by construction: PROVE never shares PRACTICE's rebuilding floor of 1.

### RETAIN (RETENTION_CHECK)

Same two-level band as PROVE (3-4), deliberately — see PRACTICE/RETAIN comparison below.

### TRANSFER

Floor **4**, ceiling **5** — the only activity that ever reaches level 5, and never below 4 even under a blocking condition (`TRANSFER_CRITICAL_MISCONCEPTION_FLOOR`).

### REINFORCE

Not a separate `ActivityType` — StudyUS's own existing taxonomy already expresses this two ways, both handled: `REMEDIATION` (its own ActivityType) always resolves to the floor (**1**, `REMEDIATION_REBUILD`), and PRACTICE/REVIEW's own `blocked` branch (above) applies the identical floor when the *same* blocking condition (`LearnerJourneyIntervention: 'REINFORCE'`, per `learner-journey-contract.ts`) is active during ordinary Practice. No third code path was introduced — "REINFORCE" already meant exactly this condition before this phase; it is now also reflected in difficulty, not just in teaching support.

### DIAGNOSTIC_CHECK

Always a fixed **2** (`DIAGNOSTIC_TARGETED`), never adaptive by design — its job is isolating one specific misconception cheaply, not testing challenge tolerance.

### CUMULATIVE_ASSESSMENT / MOCK_EXAM

Floor **3**, ceiling **4** — the same shape as PROVE, since both are independent/assessment evidence. Resolved per-concept in the multi-concept batch path (see GENERATION PROMPT INTEGRATION below).

## EVIDENCE-RESPONSIVE MOVEMENT

Satisfied without a new evidence-history mechanism: `MasteryState` is *itself* the accumulated, canonical classification of repeated evidence (`recalculateConceptKnowledgeState`'s own job) — a single lucky answer does not flip it, since the underlying mastery/evidence-count thresholds that move it are unchanged by this phase. "Strong independent success raises target challenge" and "repeated failure/intervention holds or lowers it" both fall directly out of reading the *existing* `masteryState` transition, not out of any new logic here.

## BOUNDED CHANGE

Guaranteed **by construction of the bands**, not by diffing against a stored history (which would itself be a second, parallel learner model):

- PRACTICE's four ordered tiers (blocked → LEARNING/UNKNOWN → DEVELOPING/AT_RISK → established) each differ from their neighbor by exactly one level (test 12).
- PROVE/RETAIN/TRANSFER/Assessment each span exactly **one** level between their "building" and "established" sub-states (test 12).
- No activity's own band exceeds a 4-level total spread (PRACTICE 1-4), and no single `MasteryState` transition ever skips a tier (the enum itself has no "skip" path from, say, `LEARNING` directly to `VALIDATED_MASTERY` without passing through `DEVELOPING`/`PROVISIONAL_MASTERY` first, per `recalculateConceptKnowledgeState`'s own gradual scoring — unmodified by this phase).

## PRACTICE

See ACTIVITY-SPECIFIC BEHAVIOR above. Summary: challenge tracks the SAME support-need classification `computeSupportLevel` already keys off (blocked/learning/developing/established), reused via `MasteryState` rather than re-computing `SupportLevel` itself (see CANONICAL INPUTS §3 for why).

## PROVE

See ACTIVITY-SPECIFIC BEHAVIOR above. Floor 3 is the enforcement mechanism for "no scaffolding-based reduction that trivializes evidence" — there is no code path in this function that can push PROVE below 3, tested explicitly (`tests/unit/lx9r3-r1-adaptive-difficulty-retention-waiting.test.ts`, test 7, exhaustive over every `MasteryState` × blocked/unblocked combination).

## RETAIN

Deliberately uses the **identical two-level band as PROVE** (3-4), keyed only by the *stable* `masteryState` — a retention attempt's own evidence does not retroactively inflate `masteryState` run over run (that field only moves via `recalculateConceptKnowledgeState`'s own broader evidence rules, unaffected by repeating a retention check). Calling `resolveTargetDifficulty` three times in a row with the same `masteryState` returns the *same* level every time (test 8) — the endless-harder-exam failure mode is structurally impossible, not merely avoided by convention.

"Vary representation/context across attempts while holding this level steady" is Part B's job (cross-attempt structural-fingerprint exclusion, from the prior LX-9R3 phase), unmodified here — confirmed still wired into the same `generateRetentionCheckQuestions` call alongside the (now-adaptive) `options.difficulty` (test 9).

## TRANSFER

See ACTIVITY-SPECIFIC BEHAVIOR above — floor 4, ceiling 5, the only activity ever reaching 5 (test 10). **Scope note**: no code path in `quiz-generation.service.ts` currently generates a `TRANSFER`-typed question through this difficulty scale at all — Transfer activities are generated entirely through a separate, pre-existing pipeline (`src/services/transfer.service.ts`'s `generateStructuredTransferActivity`, with its OWN canonical `TransferDistance`/`transferDepth` authority, `transfer-read.service.ts`/`transfer-distance-authorization.ts`). This phase's `TRANSFER` branch exists for completeness and correctness of the pure function (and is directly tested), and documents honestly that Transfer's "not another Retention-shaped question at difficulty 3" (D8) is *already* satisfied structurally — Transfer was never on this pipeline's difficulty scale in the first place. No redundant second Transfer-complexity system was built.

## GENERATION PROMPT INTEGRATION

`generate-and-take/route.ts`: every ordinary canonical call site now resolves `validated.difficulty ?? resolvedDifficulty?.level ?? 3` (never a bare `|| 3`):

- **Single-concept fast paths** (`quick_check`/SOLO_CHECK, `topic_practice`/`review`/PRACTICE, `retention_check`/RETENTION_CHECK): `resolvedDifficulty` is computed once, reusing the `ConceptKnowledgeState` already fetched for the evidence-count requirement — zero additional queries.
- **`diagnostic_check`**: resolved directly (fixed level 2, no Knowledge State needed).
- **Multi-concept batch path** (`cumulative_assessment`/`exam_simulation`, and a `retention_check` override): resolved **per concept**, inside the existing `conceptIds.map(...)` — one additional `getConceptKnowledgeState` read per concept, run inside the same per-concept async unit the generation call already awaits (no new serialization across concepts).
- **Manual/legacy override preserved**: `validated.difficulty` (only ever populated by the pre-existing, separately-gated `setup=1` slider path) is checked *first* via `??` — never silently discarded.

The already-existing tiered `difficultyDesc` prompt text (from the prior LX-9R3 phase) is unchanged and now actually receives a *varying* input: verified directly (test 13) that the same `difficulty` value both selects the tier and is printed in the prompt, and that the five tiers name concretely different cognitive demands (direct recall → one clear step → two-step/representation-translation → multi-step/error-diagnosis → novel-context/abstraction).

## OBSERVABILITY

A safe, aggregate-only `[difficulty]` log line (`logDifficultyResolution`, `generate-and-take/route.ts`) at every resolution point: `activityType`, `targetDifficulty`, `difficultyReasonCode`, `derivedFrom`, `masteryState`, `criticalMisconceptionCount`. Never learner answer/question content, never raw mastery *scores* (only the already-categorical `masteryState`).

**Honest gap**: `journeyStage` and `supportLevel` are *not* separately computed and logged as their own fields — doing so would require running the full Phase 4 orchestrator (`LearningState`/`TeachingIntent`) per generation call, which is exactly the avoidable AI/DB topology cost the prior LX-9R3 performance work removed (see CANONICAL INPUTS §3). `difficultyReasonCode` and `masteryState` together already encode the equivalent classification (e.g. `PRACTICE_HIGH_SUPPORT_REBUILD` + `INTERVENTION_REQUIRED` unambiguously implies both "journey stage PRACTICE with a REINFORCE intervention" and "support level HIGH_SUPPORT") — sufficient for LX-10 QA to verify difficulty actually adapts, without a redundant second computation of the same underlying fact.

## RETENTION WAITING UX

### BEFORE

`ConceptMission`'s NOW card (`buildNow`, `src/lib/lx/concept-mission.ts`) passed the canonical `LearningDecision` through **verbatim** whenever one existed — including, before the prior LX-9R3 phase's loop-breaker fix, a same-day-repeatable `RETENTION_CHECK`, and even after that fix, a generic `REVIEW`/`PRACTICE` fallback with no explanation of *why* the learner wasn't offered the retention check they might expect.

### AFTER

`buildNow` now checks, **ahead of** the decision pass-through: `journey.stage === 'RETAIN' && memory?.retentionDue === false`. `retentionDue` is the *exact same* already-canonical fact `buildJourney` already consulted (via `deriveLearnerJourneyStage`) to arrive at the RETAIN stage in the first place — this is a presentation choice over an existing fact, never a new decision, and never a re-derivation of ActivityType (the Mission still never picks one, satisfying the file's own standing architectural rule). When true, `now.fallback` becomes the new `'RETENTION_WAITING'` value, `now.kind` is `NO_CANONICAL_ACTION`, and `now.activityType` is `null` — regardless of what the underlying `LearningDecision.activityType` happens to be (defense in depth: even a stray `RETENTION_CHECK` that somehow slipped through is suppressed, test 16).

`ConceptMission.tsx` renders the new fallback with copy naming what's been achieved and why StudyUS waits (`conceptMission.noActionRetentionWaitingTitle`/`Body`, all 5 locales), never raw scores or threshold math (test 17):

> Es. "Ya lo demostraste por tu cuenta" / "Ahora necesitamos comprobar que lo sigues recordando después de un tiempo..."
> En. "You've already proven it on your own" / "Now we need to check that you still remember it after some time has passed..."

### NEXT ELIGIBLE DATE

A new `nextReviewAt` field threads through `ConceptMissionMemory` → `concept-mission-view.service.ts` (sourced verbatim from `ConceptView.memory.nextReviewAt`, the SAME `MemorySignal` field `retentionDue` is already derived from — no new read) → `ConceptMissionNow.nextEligibleReviewAt`. When present, the UI shows the date-bearing copy variant (`...BodyWithDate`, with a `{date}` placeholder, formatted via the same `toLocaleDateString(locale)` convention already used elsewhere in this codebase); when absent, the plain variant (test 18).

### DUE STATE

When `memory.retentionDue === true`, the new branch does not fire — `buildNow` falls through to its unchanged `if (decision)` pass-through, so a genuinely-due `RETENTION_CHECK` decision (per the prior phase's `temporalUrgency === 'HIGH'` fix) is shown exactly as before (test 19). A qualifying successful attempt still clears RETAIN and advances to TRANSFER via the pre-existing, unmodified `selectActivityType`/`computeLearningState` precedence (test 20) — nothing in this phase touches that machinery. An early/deep-linked attempt that occurs anyway (race, legacy link) still gets the prior phase's honest `retentionTooSoon` Results copy, unchanged (test 21).

## TESTS

34 new tests (`tests/unit/lx9r3-r1-adaptive-difficulty-retention-waiting.test.ts`), covering all 24 required items in order (several items get more than one test for exhaustiveness — e.g. test 6 checks all 70 activityType×masteryState combinations). Pre-existing tests updated where they certified the *prior, since-resolved* UNRESOLVED stub: `tests/unit/lx1-difficulty-contract.test.ts` (rewrote the "UNRESOLVED by design" block into determinism/range checks against the real authority; bumped `DIFFICULTY_CONTRACT_VERSION` 2→3), `tests/unit/lx4-focus-and-flow.test.ts` (updated the "still UNRESOLVED" assertion), `tests/unit/lx9r3-progression-novelty-difficulty-results.test.ts` (test 17 now asserts the canonical `?? resolvedDifficulty?.level ??` pattern instead of the old static fallback it was previously certifying as acceptable), `tests/unit/lx3-concept-mission.test.ts` (one fixture extended with the new required `nextReviewAt` field; no behavioral change).

Full suite: `npx tsc --noEmit` clean. `npx vitest run` — **3624/3624 passing**. `npm run build` — clean.

## COMMIT

One implementation commit (`resolveTargetDifficulty`, its route wiring, the Retention Waiting UX, the 5 pre-existing test updates, and the new 34-test file) plus this report, both carrying the required `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer. Nothing pushed to `origin/main`; nothing deployed. LX-10 was not started.
