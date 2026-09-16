# CANON-R5R1A — CANONICAL PRACTICE CONTRACT ENFORCEMENT

## STATUS

**CODE_PASS.** Canonical stage verification alone (CANON-R5R1's own
gate) is no longer sufficient to stamp `learning_evidence` as
`studyus-canonical-v1`. The server now independently derives the
authorized generation contract (item count, difficulty, assistance)
from a fresh `activityContract`, forces it into the actual generation
call regardless of any client-supplied `maxQuestions`/`difficulty`/
`quizMode`, persists that authorization alongside the session, and —
at submission — validates the ACTUALLY administered activity against
it before allowing v1 stamping. **No live Preview execution occurred
in this environment** (no `.env.local`/`DATABASE_URL`/live DB access
here, as in every prior phase of this session).

Verified in this environment:
- `npx tsc --noEmit` — clean.
- `npx vitest run` — **247 test files, 4397 tests, all passing** (was
  246/4375 before this phase — +1 new test file, +22 new tests, plus 4
  pre-existing tests updated for the new (legitimate, non-regressive)
  `v1EffectiveDifficulty ??` precedence link and the widened
  `storeQuiz` INSERT column list — **zero regressions**).
- `npm run build` — clean (Next.js 16.3.1, Turbopack).

## BLOCKER FROM R5R1

R5R1 verified canonical STAGE (`stage === 'PRACTICE'`, `actionState ===
'EXECUTABLE'`) before stamping v1, but never verified that the actually
GENERATED activity matched the engine's own `activityContract`. A
client could set `v1Launch=1` and still send `maxQuestions=20` /
`difficulty=5`, and — because the pre-existing legacy LX-4R
evidence-gap logic and `validated.difficulty` took precedence at the
actual generation call sites — those client values, not the canonical
contract, would reach the generator. This phase closes that gap
end-to-end: derivation, enforcement, persistence, and post-hoc
compliance checking.

## TRUST MODEL

Unchanged in kind from R5R1, strengthened in scope. `v1Launch=1` is
still only an intent signal — Part 14 makes this explicit: "Anyone can
theoretically construct that URL. Security/integrity does NOT depend on
the secrecy of that query parameter." What changed is WHAT the server
independently reconstructs once that intent is present: not just "is
this concept at canonical PRACTICE" (R5R1) but the full authorized
contract — item count, difficulty, assistance — all read exclusively
from `getCanonicalPedagogicalDecision(...).decision.activityContract`,
never from the request.

```
CLIENT: studentId, conceptId, v1Launch intent (+ optionally forged maxQuestions/difficulty/quizMode)
   ↓
SERVER: fresh getCanonicalPedagogicalDecision() -- ignores every client generation param
   ↓
decision.activityContract -- the ONE source of itemCount/difficulty/assistance
   ↓
SERVER OVERRIDES maxQuestions/difficulty for the actual generation call
   ↓
generation (existing, unmodified generatePracticeQuestions)
   ↓
persist the AUTHORIZED contract (quiz_sessions)
   ↓
submission: actual vs authorized compliance check
   ↓
ONLY IF compliant: v1 evidence
```

## v1Launch INTENT

Unchanged from R5R1 — still exclusively set by
`resolveCanonicalLaunch`'s own launch URL, still forwarded verbatim by
the quiz page, still re-verified independently by
`verifyV1PracticeLaunchMarker` before anything is trusted. This phase
adds nothing new here; see CANON_R5R1_V1_EVIDENCE_AND_RESULTS.md's own
TRUST MODEL section for the full mechanism.

## CANONICAL AUTHORIZATION

`V1PracticeLaunchMarker` (`src/lib/pedagogical-decision/v1-practice-launch-marker.ts`)
is widened from R5R1's simple `{policyVersion, revision, stage,
activityType}` marker into the full authorization Part 18 asks for:

```ts
export interface V1PracticeLaunchMarker {
  pedagogicalPolicyVersion: typeof V1_POLICY_VERSION;
  canonicalRevision: string;
  canonicalStage: PedagogicalStage;
  canonicalActivityType: 'PRACTICE' | 'REINFORCE';
  itemCount: { min: number; max: number; authorized: number };
  difficulty: { min: number; max: number; target: number };
  assistanceAllowed: boolean;
}
```

Built directly from `decision.activityContract` — `itemCount`/
`difficulty` are read verbatim (never re-derived or hardcoded), and
`assistanceAllowed = !contract.independence`. `resolveAuthorizedItemCount`
(the ONE deterministic "which single value to request" function, now
shared by `canonical-session-launch.ts`'s launch-URL builder AND this
authorization) picks `max` — the frozen engine's `ActivityContract.itemCount`
has no separate `target` field, so `max` is the documented, single
choice (Part 19: no duplicate `2`/`3`/`2-4` constants anywhere in this
directory). `verifyV1PracticeLaunchMarker`'s only parameters are
`{studentId, conceptId}` — there is no channel through which a caller
could supply or influence `maxQuestions`/`difficulty` (verified by a
signature source audit).

## SERVER-DERIVED PARAMETERS

`generate-and-take/route.ts`, right after the pre-existing legacy
LX-4R evidence-gap block finishes (never before it — that block's own
zero-gap-mismatch refusal still runs unmodified) and before
`conceptIds`/`perConceptCap` are computed:

```ts
let v1EffectiveDifficulty: number | undefined;
if (v1Marker) {
  maxQuestions = v1Marker.itemCount.authorized;
  v1EffectiveDifficulty = v1Marker.difficulty.target;
}
```

Every one of the three single-concept generation call sites
(`generateQuickCheckQuestions`/`generatePracticeQuestions`/
`generateRetentionCheckQuestions`) now reads
`difficulty: v1EffectiveDifficulty ?? validated.difficulty ??
resolvedDifficulty?.level ?? 3` — `v1EffectiveDifficulty` is `undefined`
for every non-v1-authorized request (quick_check/retention_check can
never carry a marker at all — see MODE ENFORCEMENT), so this is a
strict widening of the existing `??` precedence chain, never a
behavior change for anything but a genuinely authorized Practice
request.

## QUESTION COUNT

`maxQuestions = v1Marker.itemCount.authorized` (the engine's own
`max`, 3 today) feeds `perConceptCap = ceil(maxQuestions /
conceptIds.length)` — since a v1-authorized request is always
single-concept, `perConceptCap === maxQuestions === 3`, which
`generatePracticeQuestions` receives as its own `count`. A forged
`maxQuestions=20` in the request body is read into `validated.maxQuestions`
exactly as before, but is never consulted again once `v1Marker` exists
— the override statement above unconditionally replaces it.

## DIFFICULTY

`v1EffectiveDifficulty = v1Marker.difficulty.target` — the engine's own
evidence-driven target (from `difficulty-policy.ts`, unchanged, not
touched by this phase), not a hardcoded `2`. A forged
`difficulty=5` is read into `validated.difficulty` exactly as before,
but the `??` chain above means it is never reached once
`v1EffectiveDifficulty` is defined.

## ASSISTANCE

`assistanceAllowed = !contract.independence` is computed and persisted
(`true` for Practice, since `buildActivityContract`'s own Practice
branch sets `independence: false`) but is NOT enforced by a new
generation-time toggle — Practice already routes through the existing
`topic_practice` quiz_mode, whose `evidenceMode` (`PRACTICE`) already
grants AI assistance via the existing, unmodified `canUseAI({evidenceMode,
feature:'HINT'})` gate (`/api/quizzes/hint/route.ts`, untouched by this
or any prior phase). No new AI behavior was invented (Part 5's own
instruction) — `assistanceAllowed` is persisted purely as an auditable
record of what the engine's contract said, mirroring the existing,
already-correct mapping.

## MODE ENFORCEMENT

`v1Marker` (and therefore the entire override chain above) can only
ever be computed when `validated.quizMode === 'topic_practice'` — the
same guard R5R1 already established. A client sending
`quizMode: 'quick_check'` alongside `v1Launch: true` never reaches
`verifyV1PracticeLaunchMarker` at all (the `&&` chain short-circuits on
the quizMode check before the call), so the request is handled by the
ordinary, unmodified `quick_check` branch — never mislabeled as
canonical Practice. Verified by a source audit of the exact guard
condition text.

## SESSION PERSISTENCE

`quiz_sessions` keeps R5R1's three simple TEXT columns
(`pedagogical_policy_version`, `canonical_revision`, `canonical_stage`
— cheap, top-level, auditable without JSON parsing) and gains ONE new
additive, nullable JSONB column: `canonical_activity_contract`, storing
`{canonicalActivityType, itemCount, difficulty, assistanceAllowed}` —
matching this schema's own established precedent
(`learning_evidence.metadata`) for optional structured data, rather
than five more discrete columns (Part 24, option A). `getQuizSession`
trusts a marker ONLY when **both** the text columns and the JSONB
column are present and parse — a hypothetical partial/inconsistent row
(one without the other) reloads `v1Marker: null`, never a
partially-authorized session.

## ACTUAL VS AUTHORIZED

At submission, per concept bucket:

```ts
const actualDifficulty = aggregateEvidenceDifficulty(bucket.questionDifficulties); // unchanged real value
const isAuthorizedConcept = !!quizSession.v1Marker && conceptId === quizSession.conceptId;
const v1Compliance = isAuthorizedConcept
  ? checkV1ActivityContractCompliance({ authorization: quizSession.v1Marker!, actualItemCount: bucket.total, actualDifficulty })
  : null;
const v1Qualifies = isAuthorizedConcept && v1Compliance!.compliant;
```

`checkV1ActivityContractCompliance` (`v1-practice-launch-marker.ts`) is
pure, IO-free: `actualItemCount` must fall within `[authorization.itemCount.min,
authorization.itemCount.max]` inclusive, and `actualDifficulty` within
`[authorization.difficulty.min, authorization.difficulty.max]`
inclusive — both boundaries tested compliant, one below/above each
tested as a violation.

## CONTRACT VIOLATION

On `!v1Compliance.compliant`:
- the incident is logged (`console.warn('[canon-r5r1a]', {reason,
  detail, quizId, conceptId})`) with the closed
  `V1_ACTIVITY_CONTRACT_VIOLATION` reason code;
- `learning_evidence.metadata` gets **no** `pedagogicalPolicyVersion`/
  `canonicalRevision`/`canonicalStage`/`itemCount`/`correctCount` at
  all (the row falls through as ordinary, unversioned evidence — safest
  traceable choice: never fabricated compliance, never a mislabeled v1
  row);
- instead, `metadata.v1ActivityContractViolation` is stamped: `{reason,
  detail, authorizedItemCount, actualItemCount, authorizedDifficulty,
  actualDifficulty}` — an explicit, permanent, auditable record of what
  was authorized versus what actually happened;
- the row/evidence itself is **never deleted, never clamped** — the
  real `itemCount`/`difficulty`/score are still written exactly as any
  other attempt's would be (via the pre-existing, untouched write path);
- `canonicalResultsStatus` is set to `'V1_ACTIVITY_CONTRACT_VIOLATION'`
  and the canonical Results re-fetch is skipped entirely for this
  attempt (never treated as a valid v1 attempt for reconciliation
  purposes).

## EVIDENCE STAMPING

`pedagogicalPolicyVersion = studyus-canonical-v1` is written if and
only if **all three** of Part 13's conditions hold, in the exact order
this phase's own logic checks them: (A) `quizSession.v1Marker` exists
(a trusted server marker was persisted at generation time); (B) that
marker's own presence already implies it came from a fresh canonical
decision (R5R1's own guarantee, unchanged); (C) `v1Compliance.compliant`
is true for this exact concept's actual administered activity. The
metadata-stamping `...(v1Qualifies ? {...} : {})` spread is the single
place all three conditions converge.

## LEGACY COMPATIBILITY

A legacy `topic_practice` call (no `v1Launch`, gate off, or failed
re-verification) still produces `v1Marker: null` at generation time —
the entire override block (`if (v1Marker) {...}`) is a no-op, and every
downstream v1-specific code path (metadata stamping, contract
compliance checking, Results re-fetch) is unreachable, exactly as
before this phase. Verified by: a dedicated test confirming `storeQuiz`
persists `NULL` for the JSONB contract column when no marker is
supplied; a source audit confirming the override block is gated on
`v1Marker`; the full pre-existing generation-difficulty test suite
(4 files) passing with only their literal `??`-chain regex updated for
the new, additive precedence link — no behavioral assertion in any of
them changed.

## RESULTS RE-FETCH

Ordering unchanged from R5R1 (evidence write → fresh canonical decision
→ `canonicalResults`) — this phase only strengthens the GATE deciding
whether that re-fetch runs at all: R5R1 gated on `quizSession.v1Marker`
alone; R5R1A gates on `quizSession.v1Marker && authorizedResult?.v1Qualifies`
— a marker that existed at generation time but whose actual attempt
violated its own contract never triggers the re-fetch, and reports
`canonicalResultsStatus: 'V1_ACTIVITY_CONTRACT_VIOLATION'` instead of
silently falling into `'OK'` or `'NOT_V1'`.

## TESTS

One new file, 22 tests, all passing:

`tests/unit/canon-r5r1a-contract-enforcement.test.ts` —
- the authorization's `itemCount`/`difficulty`/`assistanceAllowed`
  mirror the real, frozen `CANONICAL_POLICY.practice` contract exactly,
  built via the real, unmocked engine;
- `verifyV1PracticeLaunchMarker`'s signature has no
  maxQuestions/difficulty/quizMode parameter at all (source audit);
- `checkV1ActivityContractCompliance`: item count at both boundaries
  compliant, below/above the range a violation; difficulty at both
  boundaries compliant, outside a violation; pure (never mutates its
  inputs);
- the `maxQuestions`/`v1EffectiveDifficulty` override happens strictly
  after the legacy LX-4R block and strictly before `perConceptCap` is
  computed (source-audit ordering checks) — the manual-tamper scenario
  (Parts 15/16/17) expressed as a structural guarantee rather than a
  live HTTP replay;
- mode enforcement: the guard condition's exact text, and that no other
  quizMode string appears in it;
- a genuinely LEARN-stage concept (no recognition, no evidence) never
  authorizes Practice (extends R5R1's own eligibility coverage).

Existing R5R1 test files updated for the widened, additive shape (not
regressions — each asserts the SAME underlying guarantee against the
new, longer source):
`tests/unit/canon-r5r1-generate-and-take-wiring.test.ts` (the
metadata-gate and Results-refetch-gate assertions now check `v1Qualifies`
instead of the bare marker, plus four new tests for the contract-violation
diagnostic path), `tests/unit/canon-r5r1-quiz-session-v1-marker.test.ts`
(rewritten for the widened `QuizSessionV1Marker` shape and the new JSONB
column, including a defensive "partial marker" test),
`tests/unit/lx4-focus-and-flow.test.ts`,
`tests/unit/lx9r3-progression-novelty-difficulty-results.test.ts`,
`tests/unit/lx9r3-r1-adaptive-difficulty-retention-waiting.test.ts`, and
`tests/unit/quiz-persistence-evidence-mode.test.ts` (literal `??`-chain
and INSERT-column-position assertions updated for the one new,
additive precedence link / column — the guarantees themselves are
unchanged and still enforced).

## FULL REGRESSION

- `npx tsc --noEmit` — clean.
- `npx vitest run` — 247/247 files, 4397/4397 tests passing.
- `npm run build` — clean.
- `git diff --stat` confirmed empty for `src/lib/pedagogical-engine/`,
  `src/lib/ai/`, `src/services/quiz-generation.service.ts`, and
  `src/services/mastery.service.ts`.

## DB MIGRATION

`database/migrations/20260915_1200_canon_r5r1a_quiz_session_authorized_contract.sql`
— one additive, nullable `JSONB` column
(`canonical_activity_contract`) on `quiz_sessions`. Non-destructive, no
backfill. **Not applied in this environment** (no live DB access). A
Preview-connected session should run `npm run db:migrate` (applies
every file it finds in `database/migrations/`, including R5R1's own
still-pending three-column migration if that has not yet been applied
either) to Preview only.

## PREVIEW LIVE PLAN

**Not executed in this environment.** Once both this phase's and
R5R1's migrations are applied to Preview and
`CANONICAL_ENGINE_V1_ENABLED=true` is set there:

1. Pick a migrated concept whose canonical stage is PRACTICE.
2. Call `POST /api/learning/session/start`; note the `launchTarget`
   (contains `v1Launch=1`, `maxQuestions=3`, `difficulty=<target>`).
3. Manually construct a generation request for the SAME concept with
   `v1Launch: true` but `maxQuestions: 20` and `difficulty: 5` (a direct
   `POST /api/quizzes/generate-and-take` call, bypassing the quiz page).
4. Verify: the generated question count is ≤3 and the actual difficulty
   administered matches the engine's own target — the forged values
   never reached the generator.
5. Inspect the new `quiz_sessions` row's `canonical_activity_contract`
   JSONB — confirm it reflects the REAL authorized contract, not the
   client's forged request.
6. Submit; inspect `learning_evidence.metadata` — confirm
   `pedagogicalPolicyVersion`/`itemCount`/`correctCount` are present and
   the itemCount is the REAL administered count.
7. Repeat step 2-3 for a concept canonically at PROVE — confirm no v1
   marker/authorization is ever created (still `V1_PROVE_GENERATION_NOT_READY`
   at the session-start layer, unchanged).
8. Separately, confirm an ordinary legacy `topic_practice` launch (no
   `v1Launch`) is completely unaffected — no authorization, no contract
   enforcement, `maxQuestions`/`difficulty` behave exactly as before any
   CANON-R5 phase.

## FILES CHANGED

New:
```
database/migrations/20260915_1200_canon_r5r1a_quiz_session_authorized_contract.sql
tests/unit/canon-r5r1a-contract-enforcement.test.ts
docs/CANON_R5R1A_CANONICAL_PRACTICE_CONTRACT_ENFORCEMENT.md
```

Modified:
```
src/lib/pedagogical-decision/v1-practice-launch-marker.ts   (widened V1PracticeLaunchMarker; new checkV1ActivityContractCompliance + V1_ACTIVITY_CONTRACT_VIOLATION)
src/lib/pedagogical-decision/canonical-session-launch.ts    (extracted resolveAuthorizedItemCount, shared by the launch URL and the authorization)
src/lib/pedagogical-decision/index.ts                       (export the new symbols)
src/services/quiz-persistence.service.ts                    (QuizSessionV1Marker widened; storeQuiz/getQuizSession read/write the new JSONB column)
src/app/api/quizzes/generate-and-take/route.ts              (server-derived maxQuestions/difficulty override; actual-vs-authorized compliance check; contract-violation diagnostic; Results re-fetch gated on v1Qualifies)
tests/unit/canon-r5r1-generate-and-take-wiring.test.ts       (updated gates + 4 new contract-compliance-focused tests)
tests/unit/canon-r5r1-quiz-session-v1-marker.test.ts         (rewritten for the widened marker/JSONB column)
tests/unit/lx4-focus-and-flow.test.ts                        (updated for actualDifficulty indirection)
tests/unit/lx9-final-transfer-recovery-canonical-progress.test.ts   (widened source-slice window)
tests/unit/lx9r3-progression-novelty-difficulty-results.test.ts     (updated `??`-chain regex)
tests/unit/lx9r3-r1-adaptive-difficulty-retention-waiting.test.ts   (updated `??`-chain regex)
tests/unit/quiz-persistence-evidence-mode.test.ts            (updated INSERT-parameter-position assertions)
```

`src/lib/pedagogical-engine/**`, `src/lib/ai/**`,
`src/services/quiz-generation.service.ts`, and
`src/services/mastery.service.ts` are all confirmed untouched via
`git diff --stat`.

## COMMITS

Two commits on `tmp/lx1`, each with the required
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer:
1. `feat(canon-r5r1a): server-derived canonical Practice contract enforcement` — the implementation, migration, new test file, and updated pre-existing tests.
2. `docs(canon-r5r1a): canonical practice contract enforcement report` — this document.

## REMAINING BLOCKERS

1. **Results UI** still does not consume `canonicalResults`/
   `canonicalResultsStatus`/the new `V1_ACTIVITY_CONTRACT_VIOLATION`
   status — unchanged from R5R1's own open item.
2. **My Path / Today secondary label visual parity** — unchanged from
   CANON-R5's own BLOCKER #5/#6.
3. **Prove/Retention/Transfer/Learn generation** — unchanged, still
   `NOT_READY`; this phase touched none of their contracts.
4. **Preview live validation** (this report's own PREVIEW LIVE PLAN)
   has not been run — no live DB access in this environment.

STOP after code + report, per this phase's own instruction. No push to
`main`. Production was not activated.
