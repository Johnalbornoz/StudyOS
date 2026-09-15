# CANON-R5 — CONTROLLED CANONICAL ENGINE INTEGRATION

## STATUS

**CODE_PASS.** One canonical decision service, backed by the frozen
Pedagogical Engine v1, now has server-enforced next-action authority
over session start, and is consumed by Concept Mission and Today's hero
card, behind an explicit, Production-hard-blocked feature gate. Several
learner-facing generation contracts (Prove, Retention, Transfer, and
LEARN_CHECK for genuinely new concepts) are **not yet honorable by the
real generation infrastructure** and are refused with a controlled,
closed-vocabulary `NOT_READY` result rather than silently substituted —
see BLOCKERS. **No live Preview execution occurred in this environment**
(no `.env.local`/`DATABASE_URL`/live DB access here, as in every prior
phase of this session) — see PREVIEW LIVE MATRIX for what remains to be
run by a Preview-connected session.

Verified in this environment:
- `npx tsc --noEmit` — clean.
- `npx vitest run` — **243 test files, 4337 tests, all passing** (was
  241/4276 before this phase — +2 new test files (one existing file's
  regression assertion updated for the new, still-equivalent source
  shape), +61 new tests, **zero regressions**).
- `npm run build` — clean (Next.js 16.3.1, Turbopack).

## ARCHITECTURE

```
                     ┌─────────────────────────────┐
                     │  Pedagogical Engine v1        │  (frozen, CANON-R2/R2R1/R4R1)
                     │  evaluateCanonicalLearningState│
                     └───────────────▲────────────────┘
                                     │ PedagogicalEngineInput (pure)
                     ┌───────────────┴────────────────┐
                     │  src/lib/pedagogical-decision/    │  <- NEW this phase
                     │  getCanonicalPedagogicalDecision  │
                     │  (evidence + recognitions + misc.) │
                     └───┬───────────┬───────────┬───────┘
                         │           │           │
              session/start   Concept Mission   Today
             (enforces        (read-boundary    (hero card
              actionState)     override)         override)
```

`src/lib/pedagogical-decision/` is the ORCHESTRATION layer this phase
adds. It is the only new directory; the frozen engine
(`src/lib/pedagogical-engine/`), the shadow comparator
(`src/lib/pedagogical-shadow/`), and the migration layer
(`src/lib/pedagogical-migration/`) are consumed, never modified in
substance (two of those directories gained one small, additive,
behavior-preserving addition each — see FILES CHANGED).

## FEATURE GATE

`src/lib/pedagogical-decision/feature-gate.ts`:

```ts
export function isCanonicalEngineV1Enabled(env = process.env): boolean {
  if (env.VERCEL_ENV === 'production') return false;
  return env.CANONICAL_ENGINE_V1_ENABLED === 'true';
}
```

Two independent conditions:
1. An explicit, human-set `CANONICAL_ENGINE_V1_ENABLED=true` — absent or
   any other value resolves to disabled.
2. A **hard interlock**: `VERCEL_ENV === 'production'` always returns
   `false`, regardless of the config value. This cannot be
   misconfigured into Production activation by copying a `.env` or a
   bad rollout.

Deliberately does **not** read or branch on `deployment-version.ts`'s
`buildDeploymentVersion` output — that module is explicitly
"observability only," never for gating (its own doc comment says so).
This is a separate, intentional `VERCEL_ENV` read for exactly this one
purpose, never inferred from a hostname string.

Every new integration point calls `isCanonicalEngineV1Enabled()` before
consulting the canonical decision service; with the gate off, every
touched file's behavior is byte-identical to before this phase (see
TESTS' "gate off" cases).

## CANONICAL DECISION SERVICE

`src/lib/pedagogical-decision/canonical-decision.service.ts` —
`getCanonicalPedagogicalDecision({studentId, conceptId, now?, client?})`:

1. loads real evidence — `fetchStudyUSEvidenceRows` (relocated from
   CANON-R3's CLI this phase, see DATA SOURCES) → `mapStudyUSEvidenceToPedagogicalEvidence`
   (CANON-R3's own, sole adapter — never re-implemented);
2. loads persisted recognitions — `loadRecognizedRequirementsForEngine`
   (CANON-R4R1's own, sole read adapter), keyed by the new
   `INITIAL_MIGRATION_VERSION` constant (see RECOGNITION LOADING);
3. loads the **current** active-critical-misconception fact —
   `getMisconceptionCountsForConcept(...).criticalCount > 0` (the
   existing, authoritative misconception service);
4. calls `evaluateCanonicalLearningState` — the frozen engine — exactly
   once, and returns its output verbatim (plus non-authoritative adapter
   diagnostics for observability).

No DB IO happens inside the pure engine — every read above is a plain
SELECT in this orchestration layer.

**Fail-safe (Part 28):** any read failure among the three inputs is
never swallowed into a default/empty decision. It is re-thrown as
`CanonicalDecisionUnavailableError`, a single, recognizable error type
every caller catches explicitly and turns into a controlled error
response — never a silent revert to legacy authority.

## DATA SOURCES

- **Evidence**: `fetchStudyUSEvidenceRows(studentId, conceptId)` —
  relocated, byte-identical, from `scripts/canon-r3-shadow-compare.ts`'s
  own `loadEvidenceRows` into `src/lib/pedagogical-shadow/evidence-fetch.ts`,
  so the canonical decision service and CANON-R3's own shadow CLI share
  the exact same one query and mapping (Part 7: "Reuse CANON-R3 adapter.
  Do not create another mapping from `learning_evidence`."). The CLI
  script now imports this shared function instead of keeping its own
  copy — a pure relocation, verified by the full CANON-R3 suite passing
  unmodified.
- **Recognitions**: `loadRecognizedRequirementsForEngine` (CANON-R4R1,
  unmodified) against `pedagogical_requirement_recognition`.
- **Misconceptions**: `getMisconceptionCountsForConcept` (existing,
  unmodified).

## RECOGNITION LOADING

CANON-R4R1's own dry-run/apply CLIs took `--migration-version` as a
**required CLI argument** — appropriate for a one-time, human-supervised
population run, but wrong for a server-side read path that must ask for
the same label on every request without a human re-typing it. This
phase adds the single missing piece: `src/lib/pedagogical-migration/migration-version.ts`
exports `INITIAL_MIGRATION_VERSION = 'studyus-canonical-v1-initial-migration'`
— the exact label already used for the real, live Preview migration this
phase's own spec describes as already applied and verified idempotent,
and the same value CANON-R4R1B's own regression fixture used to
reproduce the real Radicación row. The decision service reads persisted
recognitions **only** — migration is never recomputed dynamically from
old state on every request (Part 6).

## EVIDENCE LOADING

Real evidence is read once per decision, mapped through CANON-R3's
existing adapter, and handed to the engine as `RawEvidenceItem[]` —
nothing new is invented here; see DATA SOURCES above.

## TODAY

`src/services/learning-os-snapshot.service.ts`'s `LearningOSSnapshot`
gains two new fields:

```ts
canonicalOverride: CanonicalLearningSession | null;
canonicalOverrideReadFailed: boolean;
```

Populated **only** when the gate is on **and** the existing (unchanged)
Phase 3C/3D ranking already selected a `nextExecutableItem` — a single,
additional, per-item canonical decision call for the ONE concept
already chosen. **The ranking/selection of which concept to show is
NOT owned by the engine and is not touched** — CANON-R2's own charter
excludes cross-concept prioritization from the engine; Part 9 itself
frames this as "for each concept shown, the action must be canonical,"
not "the engine picks which concept."

`src/app/dashboard/today/page.tsx`'s hero card now prefers
`canonicalOverride.launchStatus` over the legacy
`nextExecutableItemWaiting`/`nextExecutableItemZeroGapBlocked` flags
when an override exists, and treats a **failed** canonical read
(`canonicalOverrideReadFailed`) as blocked — never as "legacy is fine"
(Part 28, generalized to a read surface, not just a write surface).

The secondary list (`dailyPlan.items.slice(1)`) and deferred list keep
their legacy per-item `activityType` labels — see BLOCKERS.

## CONCEPT MISSION

`src/services/concept-mission-view.service.ts`'s `getConceptMissionView`
still computes the full legacy `view` exactly as before (Part 3: kept
for diagnostics/comparison). When the gate is on, it then calls
`getCanonicalPedagogicalDecision` and replaces **only**
`view.journey` / `view.now` / `view.learn` via the new, additive
`overrideConceptMissionViewWithCanonicalDecision`
(`src/lib/pedagogical-decision/concept-mission-override.ts`) — never
`identity`/`goal`/`contractVersion`.

- Checkmarks (`milestone.demonstrated`) come **only** from
  `decision.requirements[].status === 'SATISFIED'` — never from
  `knowledgeState.evidenceCount`/`independentEvidenceCount` or any other
  legacy signal.
- Current location comes **only** from `decision.stage` — every
  `PedagogicalStage` literal is already a member of the page's own
  `LearnerJourneyStage` type, so no lossy string-translation table was
  needed.
- The result carries a new, additive `journey.source: 'CANONICAL_ENGINE_V1'`
  marker (widened from a 2-value to a 3-value closed union — no existing
  code path ever produces the new value, verified by the untouched
  regression suite).
- `getConceptMissionView`'s result type gained a third, additive
  variant: `{status: 'CANONICAL_DECISION_UNAVAILABLE'}` (Part 28) — the
  page (`.../concepts/[conceptId]/page.tsx`) throws a recognizable error
  for the nearest boundary rather than rendering the legacy view as if
  it still had authority.

## MY PATH

**Not integrated visually this phase** — see BLOCKERS. My Path's launch
button routes through the exact same `StartSessionButton` →
`/api/learning/session/start` funnel Today and Concept Mission use, so
the **safety-critical** guarantee (server-side canonical enforcement, no
fake generation, no client override) already holds for My Path
end-to-end even though its card copy is still legacy-derived.

## SESSION START

`POST /api/learning/session/start` — Part 12's own "most important
integration." When the gate is on:

1. resolves `actionConceptId`'s subject and verifies it belongs to
   `studentId` (`resolveConceptSubjectForStudent`, new, read-only —
   the legacy Phase 3C decision carried its own subjectId; the v1 path
   has none to trust, so this is the equivalent ownership check);
2. calls `getCanonicalPedagogicalDecision` **fresh**, every request —
   never a client-serialized decision;
3. resolves it into a launch via `resolveCanonicalLaunch`
   (`src/lib/pedagogical-decision/canonical-session-launch.ts`);
4. returns `{session, authority: 'CANONICAL_ENGINE_V1'}`.

The request schema (`StartSessionSchema`) still only accepts
`{studentId, actionConceptId}` — there is no mode/stage field to strip;
a client-supplied extra field is silently dropped by zod's default
object parsing and never reaches the decision call (verified by a
dedicated test).

A `CanonicalDecisionUnavailableError` returns **HTTP 503**
`CANONICAL_DECISION_UNAVAILABLE` and never falls through to the legacy
`getLearningDecisions` path (verified: the legacy mock is asserted
`not.toHaveBeenCalled()` on this path).

## ACTIVITY CONTRACT

`resolveCanonicalLaunch` reads `decision.activityContract` exactly as
the engine produced it — no independently-chosen question
count/difficulty/independence. Whether the **existing** generation
route can actually honor that contract today is a separate, explicit
question answered by `src/lib/pedagogical-decision/activity-launch-readiness.ts`
(see PRACTICE/PROVE/RETENTION/TRANSFER below) — grounded in direct
inspection of `generate-and-take/route.ts` and
`quiz-generation.service.ts`, never a guess.

## LEARN

For a **migrated, preexisting** concept, LEARN is already recognized
(`LEGACY_MIGRATION_BASELINE`) — the real, live-verified Preview cases
(Radicación, the two legacy-recognized cases, the zero-evidence case)
all start at PRACTICE or later and never need LEARN_CHECK generation at
all.

For a genuinely **post-cutover** concept whose stage is LEARN,
`resolveV1ActivityLaunchReadiness('LEARN_CHECK')` returns
`V1_LEARN_CHECK_GENERATION_NOT_READY` — StudyUS has no quiz_mode or
ActivityType producing a dedicated comprehension checkpoint today
(CANON-R3's own adapter audit: `LEARN_CHECK_SOURCE_UNAVAILABLE`, cited
verbatim, not re-derived). This is exactly Part 34's own anticipated
cutover blocker — "migrated legacy concepts may work without this, but
future concepts cannot" — and it never blocks any of the four
live-verified Preview cases.

## PRACTICE

**Ready.** `topic_practice`'s real `QUIZ_MODE_CONFIG` entry
(`generate-and-take/route.ts`) already accepts a caller-supplied
`maxQuestions` (1-20) and `difficulty` (1-5) that override its own
`defaultMax: 20` — the frozen v1 Practice contract (2-3 items,
difficulty 2-4) fits inside that existing, unmodified surface exactly.
`resolveCanonicalLaunch` builds `/dashboard/quiz?subjectId=&conceptId=&mode=topic_practice&maxQuestions=<contract.itemCount.max>&difficulty=<contract.difficulty.target, rounded, clamped 1-5>`.
An active REINFORCE overlay (same 2-3-item contract shape) launches the
same way.

## PROVE

**Not ready.** `quick_check` — the real independent-evidence analog —
has a **fixed** `defaultMax: 6` in `QUIZ_MODE_CONFIG`; the frozen v1
Prove contract requires **exactly 10**. `resolveV1ActivityLaunchReadiness('PROVE')`
returns `V1_PROVE_GENERATION_NOT_READY`. Session start, Today, and
Concept Mission all refuse/hide this CTA rather than launching a 6-item
quiz labeled as v1 Prove.

## RETENTION

**Not ready.** `RETENTION_REQUIRED_COUNT` (`quiz-generation.service.ts`)
is hardcoded to **6**, and is itself the exact trigger condition
`generate-and-take/route.ts` uses to invoke the specialized,
novelty-aware `generateRetentionCheckQuestions` generator
(`quizMode === 'retention_check' && maxQuestions === RETENTION_REQUIRED_COUNT`).
Passing `maxQuestions: 10` would not produce 10 novel items — it would
silently **skip** that specialized generator entirely, which is worse
than refusing to launch. `resolveV1ActivityLaunchReadiness('RETENTION_CHECK')`
returns `V1_RETENTION_GENERATION_NOT_READY`.

## TRANSFER

**Not ready**, per this phase's own Part 33 (followed to the letter).
Real Transfer evidence is recorded per individual task
(`transfer_task_instances`), never as 3 structured NEAR/CONTEXTUAL/HIGHER
challenges administered together (CANON-R3's own adapter audit:
`TRANSFER_CHALLENGE_BREAKDOWN_UNAVAILABLE`, cited verbatim).
`resolveV1ActivityLaunchReadiness('TRANSFER')` returns
`V1_TRANSFER_GENERATION_NOT_READY`; legacy Transfer is never substituted.

## RESULTS

**Not implemented this phase** — see BLOCKERS. `generate-and-take/route.ts`
is both the launch AND the evidence-recording/results endpoint for a
quiz attempt (1450 lines, deeply woven with reinforcement-override
logic, retry/Quality-Gate hooks, and per-mode question-count
authority). Wiring a canonical re-fetch into its submission response
safely requires threading a new "this was a v1-driven attempt" marker
through the whole quiz-session lifecycle into that route — exactly the
AI/generation surface every phase in this session, including this one's
own Part 30, has firewalled off. This phase declined to make that
change under the same discipline Part 33 explicitly models for Transfer
(stop and document, rather than force a change into protected
territory without live verification available).

## HISTORY

Untouched. No file under this phase's diff touches
`learning_evidence`, `decision_events`, or any history-rendering
surface's own interpretation logic.

## FAIL SAFE

Implemented and tested at three call sites:
`getCanonicalPedagogicalDecision` throwing `CanonicalDecisionUnavailableError`
is caught, and turned into a controlled response, never a legacy
fallback, in:
1. `POST /api/learning/session/start` → HTTP 503.
2. `getConceptMissionView` → `{status: 'CANONICAL_DECISION_UNAVAILABLE'}` → the page throws for its nearest error boundary.
3. `getLearningOSSnapshot` → `canonicalOverride: null, canonicalOverrideReadFailed: true` → Today treats this as blocked, not "legacy is fine."

## PERFORMANCE

- The three canonical decision reads (evidence, recognitions,
  misconceptions) run via `Promise.all` — not serial.
- Today's canonical override adds **at most one** extra
  per-render decision call (only for the single already-selected
  `nextExecutableItem`, never per item in the full ranked list).
- No AI/provider/performance/cache file was touched (`git diff --stat`
  against `src/lib/ai/`, `database/`, and the generation route is empty
  — see FILES CHANGED).

## TESTS

Two new files, 61 tests, all passing:

`tests/unit/canon-r5-canonical-decision-service.test.ts` (43 tests) —
direct unit tests of the new module against the **real, unmocked**
frozen engine:
- feature gate (default off, explicit on, Production hard-block, no
  `deployment-version.ts` import);
- `getCanonicalPedagogicalDecision` (exact-once reads, the Radicación
  shape end-to-end, real evidence-adapter reuse, misconception → REINFORCE
  wiring, `now` determinism, three independent fail-safe throws);
- `resolveV1ActivityLaunchReadiness` (all 6 activity types, plus a
  source audit that the two hardcoded grounding facts it cites — quick_check's
  `defaultMax: 6` and `RETENTION_REQUIRED_COUNT = 6` — are still true);
- `resolveCanonicalLaunch` (WAITING/CONSOLIDATED/LOCKED/BLOCKED never
  launch; PRACTICE/REINFORCE launch READY with contract-driven
  maxQuestions/difficulty; PROVE/RETENTION/TRANSFER/LEARN_CHECK refuse
  NOT_READY; stage/policyVersion/canonicalRevision pass through
  unchanged);
- `overrideConceptMissionViewWithCanonicalDecision` (identity/goal
  untouched; checkmarks from `requirements[].status` only; stage from
  `decision.stage`; WAITING/CONSOLIDATED/NOT-ready renders; never
  mutates its input).

`tests/unit/canon-r5-surface-integration.test.ts` (18 tests) — black-box
integration with `@/lib/pedagogical-decision` mocked:
- session start: gate off uses legacy path exclusively; gate on uses
  the canonical path exclusively and never the legacy one; a
  client-supplied `mode`/`stage` field is never forwarded; the schema
  itself has no such field (source audit); ownership failure returns
  404 before any decision call; a `CanonicalDecisionUnavailableError`
  returns 503 and never touches the legacy path; WAITING and NOT_READY
  decisions return 200 without ever calling the legacy session engine;
- Today's snapshot: `canonicalOverride` is null with the gate off; is
  populated for exactly the already-selected concept with the gate on;
  stays null with no `nextExecutableItem`; sets
  `canonicalOverrideReadFailed` on a fail-safe throw; the page source
  is confirmed to read that flag;
- Concept Mission: gate off returns the legacy view untouched; gate on
  calls the override exactly once; a fail-safe throw returns
  `CANONICAL_DECISION_UNAVAILABLE`; `NOT_FOUND` is resolved before any
  canonical call.

One pre-existing regression test
(`tests/unit/lx9r8-zero-gap-action-quality-gate.test.ts`) had a
literal-source-match assertion updated to match Today's new (still
behavior-preserving-when-the-gate-is-off) `bestZeroGapBlocked`
computation — the full 32-test file, and the full 4337-test suite,
pass.

## PREVIEW LIVE MATRIX

**Not executed in this environment** — no `.env.local`/`DATABASE_URL`/live
DB or Vercel Preview access here, as in every prior phase of this
session. What a Preview-connected session should run once
`CANONICAL_ENGINE_V1_ENABLED=true` is set there:

| Case | Expected `decision.stage` | Surfaces to check |
|---|---|---|
| A. Radicación | PRACTICE | Concept Mission, Today (if it is the ranked item), session start |
| B. Legacy Practice-recognized | PROVE (launch NOT_READY) | same |
| C. Legacy Prove-recognized | RETAIN (WAITING if not due) | same |
| D. Zero-evidence migrated | PRACTICE | same |
| E. Post-cutover concept | LEARN (launch NOT_READY) | same |

Cases A/D are already known (from this session's prior live validation)
to resolve to PRACTICE — this phase's own session-start/Concept-Mission
override should be verified to agree and to produce a real, launchable
`topic_practice` session end-to-end for at least one of them.

## BLOCKERS

Concrete, evidence-grounded gaps, each deliberately left as a stop
rather than forced:

1. **Prove/Retention/Transfer generation contracts.** `quick_check`
   (`defaultMax: 6`) and `RETENTION_REQUIRED_COUNT = 6` cannot represent
   the frozen v1 exact-10 contracts without a reviewed change to
   `quiz-generation.service.ts`/`generate-and-take/route.ts` that would
   also affect every non-v1 caller of those same modes. Transfer has no
   3-challenge-batch generation path at all. All three are refused with
   a closed `NOT_READY` reason rather than substituted.
2. **LEARN_CHECK generation** for genuinely post-cutover concepts does
   not exist. Never blocks a migrated concept.
3. **New v1 evidence write / policy-version stamping** (Part 20/21) is
   **not implemented**. The only real v1-driven activity today
   (Practice, via the existing `topic_practice` mode) still writes
   `learning_evidence` exactly as before this phase — its `metadata`
   carries no `pedagogicalPolicyVersion`/contract marker. Threading such
   a marker through `generate-and-take/route.ts`'s full session
   lifecycle is the same protected AI-generation surface as the Prove/
   Retention/Transfer gap above, and was not touched for the same
   reason.
4. **Results re-fetch** (Part 22) is **not implemented** — it would live
   in the same `generate-and-take/route.ts` submission path as #3.
5. **My Path's card copy** (`src/lib/lx/path-view.ts`) is not visually
   overridden this phase — its `buildSubjectPathView` renders every
   concept in every active subject (not just one "current" item),
   making a safe, non-N+1 override materially larger in scope than
   Concept Mission's or Today's single-concept override. The
   **safety-critical** property already holds regardless: My Path's
   launch button is the same `StartSessionButton` → session-start funnel
   already gated by the canonical engine.
6. **Today's secondary/deferred list items** (beyond the one hero card)
   keep their legacy per-item activityType label for the same reason —
   a per-item override across a whole ranked list is a larger,
   separately-reviewable scope than the single-item hero override built
   this phase.

None of these gaps allow a client to bypass server-side enforcement,
fabricate generation, or silently fall back to old authority — they are
presentation/generation-contract completeness gaps, not authority
leaks. #1/#2 are exactly the kind of stop this phase's own Part 33/34
anticipate and sanction explicitly.

## FILES CHANGED

New:
```
src/lib/pedagogical-decision/feature-gate.ts
src/lib/pedagogical-decision/canonical-decision.service.ts
src/lib/pedagogical-decision/activity-launch-readiness.ts
src/lib/pedagogical-decision/canonical-session-launch.ts
src/lib/pedagogical-decision/resolve-concept-subject.ts
src/lib/pedagogical-decision/concept-mission-override.ts
src/lib/pedagogical-decision/index.ts
src/lib/pedagogical-migration/migration-version.ts
src/lib/pedagogical-shadow/evidence-fetch.ts
tests/unit/canon-r5-canonical-decision-service.test.ts
tests/unit/canon-r5-surface-integration.test.ts
docs/CANON_R5_CONTROLLED_CANONICAL_ENGINE_CUTOVER.md
```

Modified:
```
scripts/canon-r3-shadow-compare.ts                                  (relocate loadEvidenceRows -> shared fetchStudyUSEvidenceRows; no behavior change)
src/app/api/learning/session/start/route.ts                         (canonical branch, gated; legacy branch untouched)
src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx        (handle new CANONICAL_DECISION_UNAVAILABLE result variant)
src/app/dashboard/today/page.tsx                                     (prefer canonicalOverride when present; legacy path unchanged)
src/lib/lx/concept-mission.ts                                        (additive: ConceptMissionNowFallback + ConceptMissionJourneySource widened, both backward compatible)
src/lib/pedagogical-migration/index.ts                               (export INITIAL_MIGRATION_VERSION)
src/lib/pedagogical-shadow/index.ts                                  (export fetchStudyUSEvidenceRows)
src/services/concept-mission-view.service.ts                         (canonical override branch, gated; legacy branch untouched)
src/services/learning-os-snapshot.service.ts                         (canonicalOverride/canonicalOverrideReadFailed fields, gated)
tests/unit/lx9r8-zero-gap-action-quality-gate.test.ts                (one assertion updated for Today's new, still-equivalent source shape)
```

`src/lib/pedagogical-engine/**`, `database/**`, and the AI/generation
route set (`src/lib/ai/**`, `src/services/quiz-generation.service.ts`,
`src/app/api/quizzes/**`) are all confirmed untouched via
`git diff --stat`.

## COMMITS

Two commits on `tmp/lx1`, each with the required
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer:
1. `feat(canon-r5): controlled canonical engine integration for session start, Today, and Concept Mission` — the implementation and the two new test files.
2. `docs(canon-r5): controlled canonical engine cutover report` — this document.

## PRODUCTION READINESS

**Not production-ready, and not intended to be by this phase's own
charter.** The feature gate hard-blocks Production regardless of
configuration. Preview readiness requires, at minimum:
1. Running the PREVIEW LIVE MATRIX above with `CANONICAL_ENGINE_V1_ENABLED=true`.
2. A separately-reviewed phase to close the Prove/Retention/Transfer/
   LEARN_CHECK generation gaps (BLOCKERS #1-2) before those stages can
   be certified for real learner use under v1.
3. A separately-reviewed phase for new-evidence policy-version stamping
   and Results re-fetch (BLOCKERS #3-4), touching
   `generate-and-take/route.ts` deliberately and in isolation from this
   integration phase.
4. A decision on My Path's/Today's-list's full visual parity (BLOCKERS
   #5-6) — cosmetic only, no safety impact either way.

STOP after Preview certification, per this phase's own instruction. No
push to `main`. Production was not activated.
