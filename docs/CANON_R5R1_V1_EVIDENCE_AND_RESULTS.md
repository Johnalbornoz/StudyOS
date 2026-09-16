# CANON-R5R1 — v1 EVIDENCE PERSISTENCE & RESULTS RECONCILIATION

## STATUS

**CODE_PASS.** A Canonical-Engine-created Practice session now produces
a trusted, server-verified v1 marker that survives generation and
submission via `quiz_sessions`, real `learning_evidence` for that
attempt is stamped `studyus-canonical-v1` with the actual administered
item/correct counts, and Results re-fetches the canonical decision
fresh after the write. Legacy `topic_practice` callers are unaffected —
byte-identical behavior, no v1 stamping. **No live Preview execution
occurred in this environment** (no `.env.local`/`DATABASE_URL`/live DB
access here, as in every prior phase of this session).

Verified in this environment:
- `npx tsc --noEmit` — clean.
- `npx vitest run` — **246 test files, 4375 tests, all passing** (was
  243/4337 before this phase — +3 new test files (two pre-existing
  `quiz_sessions`-column-position tests updated for the new, additive
  columns), +38 new tests, **zero regressions**).
- `npm run build` — clean (Next.js 16.3.1, Turbopack).

## ROOT BLOCKERS FROM R5

R5's own BLOCKERS #3/#4 were: v1 Practice evidence still persisted as
unversioned legacy evidence, and Results never re-fetching canonical
state after the write. Both are closed by this phase, scoped exactly as
R5R1's spec demanded — Practice only, no Prove/Retention/Transfer/Learn
generation work, no AI/prompt/cache/Quality-Gate change. R5's BLOCKER #5
(My Path/Today secondary label visual parity) is explicitly out of
scope for this phase and remains open.

## TRUST MODEL

A client can request v1 stamping (`v1Launch: true` on the generation
request) but can **never** grant it. Two independent conditions, both
required, before `learning_evidence` is ever stamped `studyus-canonical-v1`:

1. **Intent**: the generation request carries `v1Launch: true` — set
   **exclusively** by `resolveCanonicalLaunch`'s own session-start launch
   URL (`v1Launch=1`), forwarded verbatim by the quiz page. A legacy
   caller (My Path, Today's secondary items, a manual URL, `?setup=1`)
   never sets this — Part 6's own "legacy Practice route remains legacy"
   is satisfied structurally, not by policy.
2. **Independent re-verification**: `verifyV1PracticeLaunchMarker`
   (`src/lib/pedagogical-decision/v1-practice-launch-marker.ts`) always
   calls `getCanonicalPedagogicalDecision` **fresh**, right now, for the
   exact `(studentId, conceptId)` pair, and only returns a marker when
   `resolveV1PracticeEligibility` — the SAME eligibility check
   `resolveCanonicalLaunch` (session start) itself uses — confirms an
   `EXECUTABLE` PRACTICE/REINFORCE decision whose contract the real
   generation route can honor today.

A forged/stale claim (Part 20's own "Server Trust Test": a legacy
session's client somehow sends `v1Launch: true`, or a concept that isn't
really at canonical PRACTICE) simply fails step 2 and the request
proceeds through the **existing, unmodified legacy generation path** —
never blocked, never labeled v1. At submission time, the server never
reads any v1 claim from the request body at all (`SubmitQuizSchema` has
no such field) — it reloads the marker from the **persisted**
`quiz_sessions` row (Part 12).

## SESSION MARKER

`resolveCanonicalLaunch` (session start) now appends `v1Launch=1` to
every READY Practice/Reinforce launch URL — a durable intent signal,
never itself authoritative (see TRUST MODEL). `dashboard/quiz/page.tsx`
reads it (`searchParams.get('v1Launch') === '1'`) and forwards it
verbatim in the generation request body, alongside the existing
`studentId`/`subjectId`/`conceptId`/`quizMode` fields — the same pattern
`isCanonicalFlow` already uses for the pre-existing `maxQuestions`
suppression.

`handleGenerateQuiz` (`generate-and-take/route.ts`) computes:

```ts
const v1Marker =
  validated.v1Launch === true && isCanonicalEngineV1Enabled() && validated.quizMode === 'topic_practice' && validated.conceptId
    ? await verifyV1PracticeLaunchMarker({ studentId: validated.studentId, conceptId: validated.conceptId })
    : null;
```

and passes it straight into `storeQuiz(..., v1Marker)`.

## DB STORAGE

New migration (NOT applied in this environment):
`database/migrations/20260915_1100_canon_r5r1_quiz_session_v1_marker.sql`
— three additive, nullable `TEXT` columns on `quiz_sessions`:
`pedagogical_policy_version`, `canonical_revision`, `canonical_stage`.
Every pre-existing row simply has all three `NULL` — no backfill, no
data rewrite, matching the exact convention CANON-R4R1's own migration
established for this codebase.

`storeQuiz` writes them (all `NULL` when no marker is supplied —
verified by a dedicated test); `getQuizSession` reads them back into a
new `QuizSession.v1Marker: {pedagogicalPolicyVersion, canonicalRevision,
canonicalStage} | null` field — `null` for every legacy row, exactly as
before this migration is applied.

`learning_evidence` itself needed **no schema change** — its existing
`metadata` JSONB column (already the write target for `activityType`,
`evidenceMode`, `questionSemantics`, etc. via `mastery.service.ts`'s
pre-existing `MasteryUpdateInput.metadata` extension point) is exactly
"the cleanest backward-compatible path" this phase's own Part 4 asked
for — no new column, no new table.

## POLICY VERSION

Reuses the existing `V1_POLICY_VERSION = 'studyus-canonical-v1'`
constant (`src/lib/pedagogical-migration/types.ts`, introduced in
CANON-R4) throughout — session marker, `learning_evidence.metadata`, and
Results — rather than duplicating the string literal anywhere new (Part
9: "avoid string duplication... create/export a single constant if one
does not already exist" — it already existed, so it is reused, not
redefined).

## ITEM COUNT

`bucket.total` (the REAL number of questions this concept's grading
bucket actually contained, already computed by the existing submission
logic for `conceptScore`) is stamped into `metadata.itemCount` — never
`validated.maxQuestions` or any other originally-requested ceiling.
Since `generatePracticeQuestions`'s own contract is "AI decides how many
per concept up to an adjustable ceiling — never padded to hit a fixed
count," a 3-requested/2-delivered attempt persists `itemCount: 2`
(verified by source audit that the write site reads `bucket.total`, not
`maxQuestions`).

`fetchStudyUSEvidenceRows` (the canonical decision service's own
evidence read) now prefers `metadata->>'itemCount'` over the pre-v1
`decision_events.reason_details->>'sampleSize'` fallback
(`COALESCE(le.metadata->>'itemCount', de.reason_details->>'sampleSize')`)
— a v1 row's item count is never "buried exclusively in decision_events"
(Part 4's own instruction), while every pre-v1 row keeps resolving
exactly as it always did.

## EVIDENCE WRITE

For a session carrying a trusted marker, and only for the exact concept
that marker authorized (`quizSession.v1Marker && conceptId ===
quizSession.conceptId` — relevant for a hypothetical multi-concept
bucket, though today only single-concept `topic_practice` can ever carry
a marker at all), the `metadata` object passed to `updateMastery` gains:

```ts
pedagogicalPolicyVersion: quizSession.v1Marker.pedagogicalPolicyVersion,
canonicalRevision: quizSession.v1Marker.canonicalRevision,
canonicalStage: quizSession.v1Marker.canonicalStage,
itemCount: bucket.total,
correctCount: bucket.correct,
```

`activityType: quizSession.activityType` (already `'PRACTICE'` for
`topic_practice`) and `difficulty`/`hintsUsed`/`aiAssistanceType`/
`timestamp`/`scorePercent` were already persisted by the existing,
unmodified write path — nothing about that part of the contract needed
to change.

## LEGACY COMPATIBILITY

A legacy `topic_practice` call (no `v1Launch`, or `v1Launch` present but
failing re-verification) produces `v1Marker: null` at generation time,
`quizSession.v1Marker === null` at submission time, and therefore **skips
every v1-specific `metadata` field and the Results re-fetch entirely** —
its `learning_evidence` row and response shape are byte-identical to
before this phase. Verified by:
- a dedicated test asserting `storeQuiz` persists `NULL` for all three
  marker columns when none is supplied;
- a source audit confirming the v1 metadata block and the Results
  re-fetch are both gated on `quizSession.v1Marker` being non-null.

## SUBMISSION FLOW

```
quizSession = getQuizSession(quizId)      -- reload from DB, server-trusted
  └─ quizSession.v1Marker                  -- null for legacy, real marker for v1
grade answers, compute bucket.total/bucket.correct per concept
updateMastery({ ..., metadata: { ...v1 fields iff quizSession.v1Marker } })
  └─ INSERT INTO learning_evidence (unchanged write path, existing metadata column)
IF quizSession.v1Marker:
  fresh = getCanonicalPedagogicalDecision({ studentId, conceptId: quizSession.conceptId })
  canonicalResults = fresh.decision (mapped fields) | canonicalResultsStatus = CANONICAL_RESULTS_UNAVAILABLE on failure
return { ...legacy result fields, canonicalResults, canonicalResultsStatus }
```

`SubmitQuizSchema` accepts only `{studentId, quizId, diagnosisId?,
remediationStepId?, answers}` — no v1/canonical field of any kind, so a
client cannot even attempt to forge one through the documented schema
(and zod's default object parsing silently drops any extra key anyway).

## CANONICAL RESULTS RE-FETCH

Placed strictly **after** `perConceptResults` (the `Promise.all` that
performs every concept's `updateMastery` call, i.e. after evidence has
already been written) — verified by a source-audit test comparing the
two call sites' string offsets. Never reuses the pre-quiz decision
(`verifyV1PracticeLaunchMarker`'s own decision, computed at generation
time, is discarded — a brand-new `getCanonicalPedagogicalDecision` call
runs here). Gated on `quizSession.v1Marker && quizSession.conceptId` —
a legacy attempt never triggers it and its response carries
`canonicalResultsStatus: 'NOT_V1'`.

## RESULTS UI

**Not implemented this phase.** The spec's own Part 14 UI examples
("v1 Practice passes → canonical Results may show PROVE... v1 Practice
fails → canonical Results shows PRACTICE") describe how a Results
screen should CONSUME `canonicalResults`/`canonicalResultsStatus` —
those fields are now present, real, and correctly populated in the API
response, but no page under `src/app/dashboard/**` reads them yet. This
is a presentation-layer follow-up with zero safety impact (the API
contract is already correct and tested); wiring `dashboard/quiz/page.tsx`'s
results view to prefer `canonicalResults` over its existing
`proveSufficiency`/`mastery`-delta-based copy is the natural next step
and is listed under REMAINING BLOCKERS.

## FAIL SAFE

`getCanonicalPedagogicalDecision`'s existing `CanonicalDecisionUnavailableError`
(CANON-R5) is caught at the Results re-fetch call site; on this error
(and only this error type — anything else re-throws) the evidence
already written is **never rolled back or deleted** (no `DELETE FROM
learning_evidence` exists anywhere in this file — verified), and the
response carries `canonicalResults: null, canonicalResultsStatus:
'CANONICAL_RESULTS_UNAVAILABLE'` alongside the still-present legacy
result fields (score, mastery delta, `proveSufficiency`) so the learner
still sees their attempt's outcome.

## FEATURE GATE

`isCanonicalEngineV1Enabled()` gates the v1-marker computation itself —
with the gate off (including the Production hard block, unchanged from
CANON-R5), `v1Marker` is always `null` regardless of any client
`v1Launch` claim, and every downstream v1-specific code path (metadata
stamping, Results re-fetch) is unreachable. Verified by a source-audit
test confirming `isCanonicalEngineV1Enabled()` sits in the same `&&`
guard as `v1Launch === true` — neither alone is sufficient.

## PROVE/RETENTION/TRANSFER/LEARN STATUS

Unchanged from CANON-R5 — still `V1_PROVE_GENERATION_NOT_READY`,
`V1_RETENTION_GENERATION_NOT_READY`, `V1_TRANSFER_GENERATION_NOT_READY`,
`V1_LEARN_CHECK_GENERATION_NOT_READY`. `activity-launch-readiness.ts`
was not touched by this phase (verified by source audit); the v1 marker
verification path only ever reaches `PRACTICE`/`REINFORCE` eligibility
(`resolveV1PracticeEligibility` itself only returns `eligible: true` for
those two activity types), so there is no path by which this phase
could accidentally widen any of the four `NOT_READY` gates.

## TESTS

Three new files, 38 tests, all passing:

`tests/unit/canon-r5r1-v1-practice-launch-marker.test.ts` (10 tests) —
`verifyV1PracticeLaunchMarker`/`resolveV1PracticeEligibility` against
the real, unmocked engine: a genuine Radicación-shaped marker; `null`
for a concept genuinely at LEARN; `null` when the fresh decision
resolves to something other than executable Practice (a Server Trust
Test analog); graceful `null` (never a throw) on a transient read
failure; the shared eligibility check's PRACTICE/REINFORCE/WAITING/
CONSOLIDATED/PROVE cases.

`tests/unit/canon-r5r1-quiz-session-v1-marker.test.ts` (6 tests) —
`storeQuiz`/`getQuizSession` round-trip: `NULL` columns for an ordinary
call; verbatim persistence of a supplied marker; verbatim reload of a
persisted marker; `null` reload for a legacy row; `null` session for a
missing quizId; a source audit of the new INSERT column names.

`tests/unit/canon-r5r1-generate-and-take-wiring.test.ts` (22 tests) —
source-audit coverage of the route wiring (the established convention
for this specific 1500+-line file elsewhere in this codebase): the
`v1Launch` schema field and its guard conditions; no client-suppliable
policy/stage/revision field on either schema; the metadata-stamping and
Results-refetch gates on `quizSession.v1Marker`; `itemCount`/`correctCount`
sourced from `bucket.total`/`bucket.correct`; re-fetch ordering after
evidence write; the `CanonicalDecisionUnavailableError` catch; no
evidence deletion; unchanged QUIZ_SUBMISSION idempotency identity; no
new AI-adapter import; `activity-launch-readiness.ts` untouched; the
`v1Launch` URL round-trip through `resolveCanonicalLaunch` and the quiz
page; feature-gate parity.

Two pre-existing tests were updated for the (additive, backward-compatible)
new `quiz_sessions` INSERT columns — both now assert the new column
positions/values rather than the old "last two params" assumption,
which the new columns necessarily invalidated:
`tests/unit/lx9-final-transfer-recovery-canonical-progress.test.ts`
(widened its source-slice window) and
`tests/unit/quiz-persistence-evidence-mode.test.ts` (asserts the new
marker columns are `null` for the audited legacy call). Both, and the
full 4375-test suite, pass.

## FULL REGRESSION

- `npx tsc --noEmit` — clean.
- `npx vitest run` — 246/246 files, 4375/4375 tests passing.
- `npm run build` — clean.
- `git diff --stat` confirmed empty for `src/lib/pedagogical-engine/`,
  `src/lib/ai/`, `src/services/quiz-generation.service.ts`, and
  `src/services/mastery.service.ts` (its pre-existing `metadata`
  extension point was used, not modified).

## DB MIGRATION

`database/migrations/20260915_1100_canon_r5r1_quiz_session_v1_marker.sql`
— additive, nullable, non-destructive, no backfill. **Not applied in
this environment** (no live DB access). A Preview-connected session
should run `npm run db:migrate` (which applies every file in
`database/migrations/` it finds, per this repository's own convention)
to Preview only, then run the PREVIEW LIVE RESULT steps below.

## PREVIEW LIVE RESULT

**Not executed in this environment.** What a Preview-connected session
should do once the migration above is applied and
`CANONICAL_ENGINE_V1_ENABLED=true` is set there:

1. Pick a migrated concept whose canonical stage is PRACTICE (Radicación
   or the zero-evidence case from CANON-R5's own live matrix).
2. Call `POST /api/learning/session/start` for it; confirm
   `session.launchTarget` contains `v1Launch=1`.
3. Follow that URL; confirm the resulting `POST /api/quizzes/generate-and-take`
   generate call includes `v1Launch: true` in its body (network tab).
4. Inspect the new `quiz_sessions` row: `pedagogical_policy_version =
   'studyus-canonical-v1'`, `canonical_stage = 'PRACTICE'`, a real
   `canonical_revision`.
5. Submit with a passing score (≥80%, no blocking critical
   misconception); inspect the new `learning_evidence` row's `metadata`:
   `pedagogicalPolicyVersion`, `itemCount` (the REAL count, cross-checked
   against the actual number of questions shown), `correctCount`,
   `canonicalStage`, `canonicalRevision`.
6. Inspect the submission response: `canonicalResultsStatus: 'OK'`,
   `canonicalResults.stage` should be `PROVE` (or another valid
   post-Practice state) if all other engine conditions are satisfied.
7. Repeat with a failing score (<80%); confirm `canonicalResults.stage`
   remains `PRACTICE`.
8. Separately, launch an ordinary (non-canonical) `topic_practice`
   session (e.g. from a manual URL with no `v1Launch`); confirm its
   `quiz_sessions`/`learning_evidence` rows carry no v1 marker at all.

## FILES CHANGED

New:
```
src/lib/pedagogical-decision/v1-practice-launch-marker.ts
database/migrations/20260915_1100_canon_r5r1_quiz_session_v1_marker.sql
tests/unit/canon-r5r1-v1-practice-launch-marker.test.ts
tests/unit/canon-r5r1-quiz-session-v1-marker.test.ts
tests/unit/canon-r5r1-generate-and-take-wiring.test.ts
docs/CANON_R5R1_V1_EVIDENCE_AND_RESULTS.md
```

Modified:
```
src/lib/pedagogical-decision/canonical-session-launch.ts   (extracted resolveV1PracticeEligibility; v1Launch=1 added to the launch URL)
src/lib/pedagogical-decision/index.ts                      (export the two new symbols)
src/lib/pedagogical-shadow/evidence-fetch.ts                (prefer metadata->>'itemCount'/'correctCount' over the decision_events fallback)
src/services/quiz-persistence.service.ts                    (storeQuiz/getQuizSession/QuizSession gain the v1 marker; additive-only)
src/app/api/quizzes/generate-and-take/route.ts              (v1Launch schema field; marker verification + storeQuiz wiring; v1 metadata stamping; canonical Results re-fetch)
src/app/dashboard/quiz/page.tsx                              (reads v1Launch from the URL, forwards it in genBody)
tests/unit/lx9-final-transfer-recovery-canonical-progress.test.ts   (widened source-slice window for the new, longer storeQuiz signature)
tests/unit/quiz-persistence-evidence-mode.test.ts                   (updated INSERT-parameter-position assertions for the new columns)
```

`src/lib/pedagogical-engine/**`, `src/lib/ai/**`,
`src/services/quiz-generation.service.ts`, and
`src/services/mastery.service.ts` are all confirmed untouched via
`git diff --stat`.

## COMMITS

Two commits on `tmp/lx1`, each with the required
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer:
1. `feat(canon-r5r1): trusted v1 launch marker, evidence persistence, and canonical Results reconciliation` — the implementation, migration, and three new test files, plus the two updated pre-existing tests.
2. `docs(canon-r5r1): v1 evidence persistence and results reconciliation report` — this document.

## REMAINING BLOCKERS

1. **Results UI** does not yet consume `canonicalResults`/
   `canonicalResultsStatus` — the API contract is correct and tested,
   but `dashboard/quiz/page.tsx`'s results screen still derives its copy
   from `proveSufficiency`/mastery deltas for every attempt, v1 included.
2. **My Path / Today secondary label visual parity** — unchanged from
   CANON-R5's own BLOCKER #5/#6, explicitly out of scope for this phase.
3. **Prove/Retention/Transfer/Learn generation** — unchanged from
   CANON-R5's BLOCKER #1/#2, explicitly out of scope for this phase.
4. **Preview live validation** (this report's own PREVIEW LIVE RESULT
   section) has not been run — no live DB access in this environment.

STOP after code + report, per this phase's own instruction. No push to
`main`. Production was not activated.
