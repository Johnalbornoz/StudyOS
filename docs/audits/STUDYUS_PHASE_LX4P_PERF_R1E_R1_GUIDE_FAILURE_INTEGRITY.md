# STUDYUS — PERF-R1E REPAIR
## PERF-R1E-R1 — CANONICAL GUIDE MUST NOT BE SILENTLY OMITTED

Branch: `tmp/lx1`
Repair commit: `3b2b906`
Builds on: `acb25d3` / `501b936` (R1E).

LX-6 not started. Not deployed. Nothing pushed to `origin/main`.
The OpenAI question-generation `INVALID_RESPONSE` live blocker was **not**
touched here.

---

## STATUS: **PASS**

---

## CANONICAL GUIDE REQUIRED STATE

`needsGuided = plan.includes('GUIDE')` is unchanged — it is still derived
purely from the canonical `TeachingExperienceView.stages` (upstream,
server-authoritative). What changed is what happens to that requirement
once it is true:

- **Before (the blocker):** `effectivePlan` kept GUIDE only while
  `guided?.steps?.length > 0` — a failed fetch (`guided === null`) fell
  into the exact same "drop this stage" branch as a stage that was never
  canonically required, silently rewriting the path.
- **After:** `effectivePlan`'s `GUIDE` branch is unconditional
  (`return true`). The **only** way GUIDE is absent from `effectivePlan`
  is `!needsGuided` — GUIDE was never in `plan` to begin with. A
  required GUIDE now has an explicit, separate lifecycle:
  `guideState: 'idle' | 'loading' | 'ready' | 'error'`, and its stage
  slot renders one of three sub-states inline — it is never removed.

---

## GUIDE SUCCESS

Unchanged shape, now explicit: `guideState` transitions
`'loading' → 'ready'` and `<GuidedPractice>` renders. Advancing past
GUIDE (`onComplete → advance`) is reachable **only** from inside a
genuinely rendered `GuidedPractice`, which itself renders **only** when
`guideState === 'ready' && guided` — there is no other path to
`advance()` from the GUIDE stage (the generic bottom Continue/Skip bar
is still excluded for `stage === 'GUIDE'`).

---

## GUIDE FAILURE

`guideState` transitions `'loading' → 'error'` whenever the response is
not a genuine non-empty guided sequence — a network error, a non-ok
response, a parse failure, **and** the deterministic "no good sequence"
fallback are all folded into the same `ok = !!gp && Array.isArray(gp.steps)
&& gp.steps.length > 0` check and all resolve to `'error'`. This is a
deliberate widening from R1E: previously "fallback" silently skipped
GUIDE by design; now ANY empty outcome for a *required* GUIDE is treated
as a failure requiring an explicit learner-facing state, never a silent
skip.

The `'error'` sub-state renders (activity-language chrome):
- **`guided.failedTitle`** / **`guided.failedBody`** — "We couldn't
  prepare the guided example." / "Your teaching progress is safe. You
  can retry or exit the activity." (5 locales)
- **RETRY** (`guided.retry`) → `retryGuide()`
- **EXIT the activity** (`guided.exit`) → a real link (`exitHref`) to
  the Concept Mission — **not** a "skip to Practice" action. No skip
  button, no invented content, no automatic advance.

---

## GUIDE RETRY

`retryGuide()` bumps `guideAttempt`, which is part of the GUIDE effect's
composite guard key (`${conceptId}@${quizMode}@${locale}@${guideAttempt}`,
the same idempotent-key pattern `useInteractiveFormula` already uses) —
so a retry always fires a genuinely fresh request, while an unrelated
re-render never re-fires the same attempt (StrictMode-safe). A
`guideRetryInFlightRef` blocks a second concurrent click before the
state has had a chance to leave `'error'`. The effect always resolves to
`'ready'` or `'error'` — never stuck in `'loading'` indefinitely, on the
first attempt or any retry.

`GUIDE_RETRY_STARTED` is emitted (distinct from `GUIDE_REQUEST_STARTED`)
so a retry is visible in the logs as a retry, not a fresh incident.

---

## SILENT GUIDE OMISSION

**MUST BE: NONE.**

Verified:
- `effectivePlan`'s GUIDE branch has no content-based drop condition
  (source-contract test: the old `if (s === 'GUIDE') return (guided...`
  pattern is gone; `return true` unconditionally keeps it).
- The only code path that can call `advance()` from the GUIDE stage is
  a fully-rendered, fully-completed `GuidedPractice` (`guideState ===
  'ready'`).
- No skip-to-Practice control exists anywhere inside the GUIDE
  loading/error sub-states.
- The error sub-state never renders `<GuidedPractice>` and never calls
  `setGuided(...)` with fabricated content.

---

## QUESTION FAILURE INDEPENDENCE

The two failure domains remain structurally separate, verified at the
source level:
- The GUIDE fetch/resolution code (from the `fetch('/api/learning/guided
  -practice'...)` call through `retryGuide`) references neither `quizId`,
  `genState`, nor `questions` as identifiers.
- The quiz page's `applyGen` catch block (`generate-and-take` failure)
  only calls `setGenState('error')` — it never touches `setGuided`,
  `setGuideState`, `guideAttempt`, or `setTeachingExperience`.
- `generate-and-take` returning 500 has zero effect on the GUIDE effect
  (it depends on `conceptId`/`quizMode`/`locale`/`guideAttempt` only);
  GUIDE can succeed, fail, and be retried entirely independently of
  Practice question generation's own state, in either order.

---

## AI PERMISSION INTEGRITY

Unchanged from R1E: `canUseAI({ evidenceMode, feature: 'EXPLAIN' })` is
the only gate, still resolved server-side through
`evidenceModeForQuizMode(mode)` (conceptId+mode path) or
`session.evidenceMode` (quizId path). This repair touches **no**
permission logic — it only changes what the CLIENT does with a `null`
GUIDE result. `TeachingIntro` still computes no `SupportLevel` /
`EvidenceMode` / permission decision of any kind.

---

## LANGUAGE INTEGRITY

The GUIDE request body still sends `language: locale` (the activity
language); the new failure/retry/exit chrome reads the same
`t = getMessages(locale)` every other string in this component uses. No
`uiLocale` identifier is used anywhere (the R20 reversal stays intact).

---

## EVIDENCE INTEGRITY

`teaching-content.service.ts`: still no `updateMastery` /
`learning_evidence` / `recordEvidence` / `applyEvidence`, still no
`computeSupportLevel` / `selectActivityType` / `LearningDecision` /
`isProveRequired`. The `guided-practice` route is unchanged in this
repair (no server changes at all — this was a client-only fix). The
GUIDE failure UI itself writes nothing and fabricates nothing.

---

## TESTS

`npx tsc --noEmit` clean · `npx vitest run` **192 files / 2842 tests
pass** · `npm run build` compiles.

New: `tests/unit/lx4p-perf-r1e-r1-guide-failure-integrity.test.ts`
(21 cases). 5 existing tests updated for the `guideState` shape
(`gpLoading`/`guidePending` no longer exist).

| # | Requirement | Covered by |
|---|---|---|
| 1 | GUIDE not required → no request, no UI | `needsGuided` early-return to `'idle'`, no fetch |
| 2 | success → MODEL → GUIDE → PRACTICE | unchanged shape; `guideState 'ready'` + `GuidedPractice` |
| 3 | network failure → explicit error state | `guideState 'error'`; `guided.failedTitle/Body` rendered |
| 4 | failure does not remove GUIDE from plan | `effectivePlan` GUIDE branch unconditional |
| 5 | failure does not auto-transition to Practice | `advance()` reachable only via completed `GuidedPractice` |
| 6 | retry succeeds → renders, continues normally | `retryGuide` → fresh key → `'ready'` |
| 7 | retry fails → recoverable, no infinite loading | effect always settles to `'ready'`/`'error'` |
| 8 | gen 500 + GUIDE succeeds → GUIDE works | GUIDE code path has no `quizId`/`genState` dependency |
| 9 | gen 500 + GUIDE fails + retry succeeds | retry keyed independently of `quizId`/`genState` |
| 10 | GUIDE failure doesn't modify gen state | `applyGen` catch only sets `genState` |
| 11 | no client SupportLevel computation | unchanged |
| 12 | server EvidenceMode permission unchanged | `evidenceModeForQuizMode`/`session.evidenceMode` + `canUseAI` untouched |
| 13 | Practice/Prove/Assessment integrity | unchanged (R1E's per-mode denial tests still green) |
| 14 | activity language preserved | `language: locale`; `getMessages(locale)`; no `uiLocale` |
| 15 | MODEL TTFI (R1D) unchanged | `EXPLANATION_READY`/`MODEL_RENDERED` + explanation-only loading gate |
| 16 | evidence/mastery untouched | teaching-content + route assertions; error UI fabricates nothing |

---

## REPAIR COMMIT

`3b2b906` on `tmp/lx1` (after `acb25d3`).

---

## NEXT STEP

PERF-R1E is promoted to **PASS**.

Push the repaired HEAD to QA and reproduce the original
`generate-and-take` failure. Expected QA result:

```
MODEL
  → GUIDE loads successfully despite question-generation 500
  → after GUIDE, Practice shows its own recoverable generation failure.
```

Additionally verify the NEW failure path by forcing
`/api/learning/guided-practice` itself to fail (e.g. block the request or
return 500): the learner should see the explicit "We couldn't prepare
the guided example" state with working Retry and Exit actions, never an
indefinite "Preparing the teaching..." and never a silent jump to
Practice.

Do NOT fix `INVALID_RESPONSE` in this repair. Do NOT start LX-6.

STOP.
