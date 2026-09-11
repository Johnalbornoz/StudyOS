# STUDYUS — LX-4P-PERF LIVE REPAIR
## PERF-R1E — GUIDE / QUESTION INDEPENDENCE

Branch: `tmp/lx1`
Repair commit: `501b936`
Builds on: `6fda371` / `ad7a029` (R1D).

LX-6 not started. Not deployed. Nothing pushed to `origin/main`.
The OpenAI question-generation `INVALID_RESPONSE` live blocker was **not**
touched here — separate, next.

---

## STATUS: **PASS**

---

## ROOT CAUSE

Live QA trace:

```
T0_start                = 98429
T4_gen_start            = 98430
T1_teachingintent_ready = 98953   (TeachingIntent ≈ 524 ms)
POST /api/quizzes/generate-and-take -> 500
(no request ever made to /api/learning/guided-practice)
```

`TeachingIntro`'s GUIDE effect was:

```js
useEffect(() => {
  if (!needsGuided) { setGpLoading(false); return; }
  if (!quizId) { setGpLoading(true); return; }   // <-- never resolves
  ...
}, [conceptId, quizId, locale]);
```

`quizId` is only set once `/api/quizzes/generate-and-take` succeeds
(`applyGenResult(data)` → `setQuizId(data.quizId)`). When generation
500s, `quizId` never exists, the effect's early-return branch
(`setGpLoading(true); return;`) runs on every render and never reaches
the `fetch`, so `gpLoading` is `true` forever → `guidePending` is `true`
forever → once the learner finishes MODEL (`idx >= effectivePlan.length`
with `guidePending`), the component renders the loading card
indefinitely: **"Preparing the teaching..." with no way out.**

`/api/learning/guided-practice` itself required `quizId` because it used
`getQuizSession(v.quizId)` as its *only* way to learn `conceptId`,
`subjectId`, and `evidenceMode` (for the `canUseAI` permission gate) —
GUIDE was coupled to Practice question generation purely for
plumbing convenience, not for any pedagogical reason.

---

## GUIDE AUTHORITY

GUIDE ("solve one together") is teaching **scaffolding**:
`teaching-content.service.ts`'s own docstring — "it never chooses the
concept, the ActivityType, mastery, SupportLevel, remediation, or
whether Prove is required. Those are canonical elsewhere. It also NEVER
writes learning evidence." A guided answer is never an attempt; nothing
about GUIDE requires a `quiz_sessions` row to exist, and it never should
have.

The information genuinely required for canonical guided teaching is
exactly what MODEL and `/api/learning/teaching-intent` already operate
on: `studentId`, `conceptId`, the canonical `QuizMode` (transport input,
mapped through the fixed taxonomy to `EvidenceMode`), and the activity
language.

---

## QUIZID DEPENDENCY

**REMOVED** as a requirement for GUIDE.

Exact remaining purpose: `/api/learning/guided-practice` still *accepts*
`quizId` and, when present, resolves `conceptId` / `subjectId` /
`evidenceMode` from the canonical `quiz_sessions` row exactly as before
— kept for back-compat with any caller that already has a live session.
`TeachingIntro` itself no longer sends it; the `quizId` prop remains on
its contract (unused by the GUIDE effect) purely because MODEL/EXPLAIN
and the surrounding page still track it for other purposes (e.g. the
question-count/localization flow), and the existing
`quizId: string | null` type contract is preserved.

---

## AFTER FLOW

```
Continue
   ├── TeachingExperience   (studentId + conceptId + mode)      -- unchanged
   ├── MODEL explanation    (studentId + conceptId + locale)    -- unchanged
   ├── GUIDE generation     (studentId + conceptId + quizMode + locale)  -- NEW: fires immediately, no quizId
   └── Practice questions   (background generate-and-take)      -- unchanged
```

All four independent. MODEL renders when its explanation is ready. GUIDE
renders when its own fetch resolves. Practice questions succeed or fail
on their own timeline and only matter at the PRACTICE transition
(existing `genState: 'idle'|'loading'|'ready'|'error'` recoverable UI,
untouched).

`TeachingIntro`'s GUIDE effect:
```js
useEffect(() => {
  if (!needsGuided) { setGpLoading(false); return; }
  ...
  fetch('/api/learning/guided-practice', { ...,
    body: JSON.stringify({ studentId, conceptId, mode: quizMode, language: locale }),
  })...
}, [conceptId, quizMode, locale]);
```
No `quizId` check, no `quizId` in the request body or deps.

---

## QUESTION FAILURE BEHAVIOR

- `generate-and-take` failing sets `genState: 'error'` only — asserted
  (`applyGen` catch block touches nothing but `setGenState`/the perf
  mark; never `setGuided`/`setGpLoading`/`setTeachingExperience`).
- MODEL is unaffected (it never depended on `quizId`; unchanged since
  R1/R1D).
- GUIDE is unaffected — it now resolves from `conceptId`/`quizMode`
  alone.
- The learner can complete MODEL → GUIDE fully even when
  `generate-and-take` has already failed.
- Only at the PRACTICE transition does the failure matter, and only
  there does the existing recoverable "Preparing your practice" /
  "generation failed, retry" UI apply — unchanged.

---

## GUIDE FAILURE BEHAVIOR

`gpLoading` now **always** resolves (the fetch always settles to a
`.then`, success or `.catch(() => null)`), so:
- a slow GUIDE (however long) still eventually resolves the effect;
- a network failure or a deterministic `isFallback` sequence both
  resolve to `guidedPractice: null` → `guided` stays `null` →
  `effectivePlan` drops GUIDE by the *same* existing degrade-by-omission
  rule EXPLAIN/MODEL already use ("Drop stages whose content failed to
  load, so we never show an empty stage") — the established UX, not a
  new error surface;
- crucially, `gpLoading` becoming `false` means `guidePending` becomes
  `false` too, so the "Preparing the teaching..." card is only ever
  transient, never terminal. This was the actual defect; it is fixed.

---

## AI PERMISSION INTEGRITY

Unchanged gate, applied identically on both resolution paths:
`canUseAI({ evidenceMode, feature: 'EXPLAIN' })` → allowed only when
`evidenceMode === 'PRACTICE'`. Verified per mode
(`quick_check` / `retention_check` / `cumulative_assessment` /
`exam_simulation` / `diagnostic_check` → `HELP_DISABLED_FOR_MODE`, no AI
call) and for an `ASSESSMENT` `quizId` session. `mode` is transport input
only — the server re-derives `EvidenceMode` through the fixed
`evidenceModeForQuizMode` taxonomy; the client cannot hand it an
`EvidenceMode`/`SupportLevel`/permission decision directly. `conceptId`
is authorised by an explicit subject-ownership check (`concepts.subject_id
= subjects.id`, `subjects.student_id === studentId`) before any AI call.

---

## LANGUAGE INTEGRITY

`GET /api/concepts/[id]/explanation?...&language=${locale}` and
`POST /api/learning/guided-practice { ..., language: locale }` both still
use `locale` — the activity/question language, unchanged since R20. GUIDE
chrome (`GuidedPractice` sub-component) still reads `getMessages(locale)`.
Global interface language is untouched.

---

## EVIDENCE INTEGRITY

`teaching-content.service.ts`: no `updateMastery` / `learning_evidence` /
`recordEvidence` / `applyEvidence`; no `computeSupportLevel` /
`selectActivityType` / `LearningDecision` / `isProveRequired`.
`/api/learning/guided-practice`: no evidence-writing call on either
resolution path. `EvidenceMode` is read-only input to `canUseAI`, never
written. No change to Knowledge State / mastery thresholds /
`ResponseEvidenceContract` / Retention / Transfer.

---

## TESTS

`npx tsc --noEmit` clean · `npx vitest run` **191 files / 2821 tests
pass** · `npm run build` compiles.

New: `tests/unit/lx4p-perf-r1e-guide-independence.test.ts` (28 cases).
4 existing tests updated (GUIDE request shape / comment text) in
`lx4p-perf-r1-parallel-runtime`, `lx4p-r1-language-integrity`,
`lx4p-r2-same-item-localization`, `lx4r-teaching-loop`.

| # | Requirement | Covered by |
|---|---|---|
| 1 | success path unchanged | existing suites green (no regression) |
| 2 | generate-and-take 500 before GUIDE → GUIDE still starts | route: "conceptId + mode … generates, no quiz session ever looked up" |
| 3 | question gen fails while MODEL visible → GUIDE still resolves | source: GUIDE effect independent of `expLoading`/explanation state |
| 4 | question gen never returns → GUIDE doesn't wait on quizId | source: "GUIDE effect no longer gates on quizId" |
| 5 | GUIDE ready before questions → sequence stays MODEL → GUIDE → PRACTICE | `effectivePlan`/`plan`/`stages` logic unchanged (test 9) |
| 6 | GUIDE pending not silently skipped | `guidePending` / `isLast` assertions retained |
| 7 | GUIDE itself fails → no infinite "Preparing the teaching…" | `gpLoading` always resolves (route always returns; effect always reaches `.then`) |
| 8 | Practice failed after GUIDE → recoverable Practice retry | test 14 — `applyGen` catch only sets `genState`, never GUIDE state |
| 9 | no client SupportLevel computation | unchanged; GUIDE route computes nothing pedagogical, only `EvidenceMode` via the fixed table |
| 10 | EvidenceMode derived server-side | `evidenceModeForQuizMode(mode)` / `session.evidenceMode` — never client-sent |
| 11 | not enabled in Prove / Independent / Assessment | R6 per-mode denial tests (5 modes) + ASSESSMENT quizId session |
| 12 | activity language preserved | `language: locale` on the GUIDE request; unchanged elsewhere |
| 13 | MODEL TTFI (PERF-R1D) unchanged | `EXPLANATION_READY`/`MODEL_RENDERED` marks + T0..T6 still present |
| 14 | question generation remains background | wave B shape unchanged; `generate-and-take` fetch untouched |
| 15 | evidence / mastery untouched | teaching-content + route assertions |

---

## COMMIT

`501b936` on `tmp/lx1` (after `6fda371`).

---

Do not claim live success until deployed to QA and reproduced: redeploy,
repeat the exact incident (force `generate-and-take` to fail or be slow),
and confirm GUIDE loads and completes while Practice shows its own
recoverable state at the transition.

Do NOT start LX-6.

STOP.
