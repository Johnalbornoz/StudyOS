# STUDYUS — LX-4P LANGUAGE INTEGRITY REPAIR

## LX-4P-R3 — ACTIVE LEARNING LANGUAGE INTEGRITY

Continued on `tmp/lx1`. Builds on `49d5f16`'s parent `ac57928` (LX-5R1
LIVE QA candidate). Implementation commit: `49d5f16`.

### ROOT CAUSE

`src/app/dashboard/quiz/page.tsx` derives exactly one translations object
for the whole page:

```ts
const t = getMessages(locale);   // locale = the GLOBAL interface language
```

`locale` (`useState<Locale>('es')`, populated from `/api/language`) is
the account/interface setting. `quizLanguage`
(`useState<Locale>('en')`, populated once from the generated question
batch's own `data.language`) is the canonical activity language — and it
was **already** correctly threaded into `TeachingIntro`, `ContextualHelp`,
and `ContinuationPanel` (LX-4P-PERF-R1 R20 and LX-5D). But every OTHER
string on the page — assistance banner, response-contract chrome,
confidence UI, math-toolbar labels (via `MathAnswerEditor`), and the
entire Results/feedback/verification screen — read from `t`, i.e. the
interface locale, not `quizLanguage`. When the two diverge (same-item
localization was rejected for semantic-safety reasons and a new English
activity was created while the account stayed on Spanish), those strings
rendered in Spanish inside an English activity.

### LANGUAGE AUTHORITY BEFORE

| Surface | File | Source (before) |
|---|---|---|
| Assistance banner | `LearningSupportStatus.tsx` (via `t` prop) | `page.tsx`'s `t` → **interface locale** ❌ |
| Response-contract label/instruction | `page.tsx` inline | `t` → **interface locale** ❌ |
| Confidence prompt/options | `page.tsx` inline | `t` → **interface locale** ❌ |
| Math-toolbar categories | `MathAnswerEditor.tsx` (via `locale` prop) | `page.tsx` passed `locale={locale}` → **interface locale** ❌ |
| Hints / "Need help?" (ContextualHelp) | `ContextualHelp.tsx` (via `locale` prop) | `page.tsx` passed `locale={quizLanguage}` → **activity locale** ✅ (already correct) |
| Question text, MODEL/GUIDE (TeachingIntro) | `TeachingIntro.tsx` (via `locale` prop) | `page.tsx` passed `locale={quizLanguage}` → **activity locale** ✅ (already correct) |
| Results score/mastery/feedback/retry/review | `page.tsx` inline | `t` → **interface locale** ❌ |
| Verification (results + resume-pending flow) | `page.tsx` inline, `MathAnswerEditor` | `t` / `locale={locale}` → **interface locale** ❌ |
| "Salir" (exit activity) | `src/app/dashboard/layout.tsx` | `getInterfaceLanguage()` → **interface locale** ✅ (correct, and out of scope) |

None of the affected child components (`LearningSupportStatus`,
`MathAnswerEditor`, `TeachingIntro`, `ContextualHelp`) infer language
themselves — every one of them already takes `locale`/`t` as a prop
(confirmed: none references `getInterfaceLanguage`, a cookie, or any
other global source). The bug was entirely in *what `page.tsx` chose to
pass them*, not in the child components.

### LANGUAGE AUTHORITY AFTER

`page.tsx` now derives a second object:

```ts
const t = getMessages(locale);        // interface locale -- pre-activity setup screen only
const at = getMessages(quizLanguage); // activity translations -- everything else
```

Every string previously read via `t[...]` in the active-learning surface
(the resume-verify flow, `phase==='loading'`/`'error'`, the
teaching-batch-preparing wait, the entire Results/feedback/verification
screen, and the question-answering card) now reads via `at[...]`. The
three `MathAnswerEditor` call sites and the one `LearningSupportStatus`
call site were switched from `locale`/`t` to `quizLanguage`/`at`. `t`
remains exactly as before for the pre-activity legacy/manual
configurator screen (`phase === 'setup'`, the cumulative/exam
multi-concept picker) — no activity language exists yet at that point.

### GLOBAL SHELL

Untouched. "Salir" (`nav.exitActivity`) is rendered by
`src/app/dashboard/layout.tsx`, a server component that resolves its own
`locale` via `getInterfaceLanguage()` — a completely separate code path
from `quiz/page.tsx`'s `quizLanguage` state, which `layout.tsx` never
references. Verified by source-contract test (`layout.tsx` contains no
mention of `quizLanguage`).

### ACTIVE LEARNING SURFACE

Every state past the pre-activity setup screen now shares one authority
(`at`, backed by `quizLanguage`):

- The resume-verify flow (an existing pending verification, answered in
  `quizLanguage` per its own submit payload) — breadcrumb, title, states,
  the question's own "why you're seeing this" explanation, submit
  button.
- `phase==='loading'`/`'error'` transitional states.
- The "teaching done, batch still generating" wait screen
  (`practice.preparing`/`prepareFailedTitle`/`prepareFailedBody`/
  `prepareRetry`).
- The full Results screen: score, mastery deltas, IB estimate, exam-
  readiness calibration, diagnostic outcome, verification-needed
  sub-flow, Prove-sufficiency note, review/feedback screen, "Practice
  Again"/"Review" actions.
- The question-answering card itself: calculator note, Prove banner,
  response-contract chrome, confidence, per-type instructions
  (multi-select/matching/ordering/classification), the language-switch
  restart dialog and its own picker label, Next/Submit.

### ASSISTANCE

`LearningSupportStatus` is now called with `t={at}` instead of `t={t}`.
The component itself is unchanged (already pure presentation, taking a
resolved `Messages` object as a prop) — "Con ayuda disponible" / "Puedes
pedir una pista si te atascas." now resolve from the activity language.

### RESPONSE CONTRACT

`{at['responseContract.label']}` and
`at[\`responseContract.${responseContract.kind}\` as keyof typeof t]`
(the `as keyof typeof t` type annotation is unaffected — `t` and `at`
share the identical `Record<MessageKey, string>` type, so indexing `at`
with a `keyof typeof t` key type-checks exactly as before).
`deriveResponseEvidenceContract` itself — the canonical logic that
decides which contract kind applies — is untouched; only the label
presenting its result changed source.

### CONFIDENCE

`quiz.confidenceQuestion`/`Low`/`Medium`/`High` now read from `at`. The
confidence state machine (`confidences`, `confidenceSelected`,
`setConfidenceSelected`) and whatever downstream gating consumes it are
completely untouched — this is a presentation-only change to which
translation object supplies the label text.

### MATH INPUT

The three `<MathAnswerEditor .../>` call sites (resume-verify, results
verification, and the main question card) now pass `locale=
{quizLanguage}` instead of `locale={locale}`. `MathAnswerEditor` itself
was not modified — it already resolved `mathToolbar.category*`/
`categoriesLabel` purely from its own `locale` prop. Symbol insertion
(`insertAtCursor`, cursor placement, `button.insertText`) is untouched —
mathematical symbols are language-neutral and were never part of this
bug.

### MODEL / GUIDE / PRACTICE / PROVE

- **MODEL/GUIDE**: `TeachingIntro` (and its nested `GuidedPractice`
  sub-component) already received `locale={quizLanguage}` from a prior
  phase (LX-4P-PERF-R1 R20) — confirmed still correct, unchanged.
- **PRACTICE**: the question-answering card's calculator note, per-type
  instructions, and Next/Submit controls now read `at`.
- **PROVE**: the Prove banner (`activeLearning.proveTitle`/`proveBody`/
  `helpUnavailable`) and the Prove-sufficiency note passed into
  `ContinuationPanel`'s `note` prop both now read `at` — the latter
  specifically because `ContinuationPanel` itself already renders its
  own copy in `quizLanguage`; passing it a `note` in the interface
  locale would have re-introduced exactly this bug one level down.

### FIVE LOCALES

`Messages` is typed as `Record<MessageKey, string>`, and all five locale
objects (`es`, `en`, `de`, `fr`, `pt`) are declared with that exact type
— TypeScript itself rejects a locale object missing any key, so every
key this repair now reads via `at` was **already** guaranteed present,
non-empty, and correctly translated in all five locales before this
phase touched anything (confirmed: `npx tsc --noEmit` was clean both
before and after, and no new message keys were added). `getMessages`
falls back to `es` only when the *locale code itself* is unrecognized —
never per missing key — so there is no per-key Spanish fallback
mechanism to weaken in the first place.

### SEMANTIC-FIDELITY PRESERVATION

Not modified. `attemptSameItemLocalization`, `regenerateInLanguage`, and
the `pendingLanguageSwitch` restart-confirmation dialog are all
byte-for-byte unchanged — this repair only ever renamed a `t[...]` read
to `at[...]` or a `locale={locale}` prop to `locale={quizLanguage}`. The
one pre-existing test asserting this dialog's own label
(`lx4p-r1-language-integrity.test.ts`) needed exactly one update: its
`aria-label` assertion moved from `t['quiz.languagePickerLabel']` to
`at['quiz.languagePickerLabel']`, because the language picker itself is
rendered inside the active learning card and controls the activity's own
language — it is part of the active-learning surface this phase brings
into line, not an exception to it.

### TESTS

New file: `tests/unit/lx4p-r3-active-learning-language.test.ts` — 38
tests covering all 26 required scenarios (several requirements map to
more than one test for direct + inverse/negative coverage). One
pre-existing test (`lx4p-r1-language-integrity.test.ts`, R4's `<select>`
label assertion) was updated to match the corrected behavior; no other
assertion in it changed, and its other 8 tests (mid-attempt restart
flow, attempt-identity preservation, evidence integrity, UI-locale vs.
question-language separation, teaching-loop consistency, contextual-help
identity, i18n key completeness) all remain green unmodified.

Requirements 21–26 (R1D/R1E/R1F/R1G/LX-5R1/evidence-mastery unaffected)
are satisfied by the full existing suite remaining green — none of those
phases' files were touched here.

```
npx tsc --noEmit        # clean, 0 errors
npx vitest run          # 196 files, 2966 tests, all passed
npm run build           # succeeded, Turbopack production build
```

(2966 = 2928 pre-existing + 38 new; the one modified pre-existing test
file's other 8 tests are unchanged in outcome.)

### COMMIT

`49d5f16` — `fix(lx): LX-4P-R3 -- active learning chrome must follow activity language`

---

## LX-4P-R3 — ACTIVE LEARNING LANGUAGE INTEGRITY

**STATUS: PASS**

For the live matrix (`interfaceLanguage=es`, `activityLanguage=en`):
the global shell ("Salir") is untouched, sourced independently from
`layout.tsx`'s own interface-locale resolution. Every string in the
active learning surface — assistance banner, response-contract chrome,
confidence prompt/options, math-toolbar category labels, hints,
MODEL/GUIDE, PRACTICE/PROVE chrome, feedback, retry/error states, and
the results/verification screen — now reads from a single canonical
activity-language authority (`at`, backed by the same `quizLanguage`
already used by TeachingIntro/ContextualHelp/ContinuationPanel), with no
child component inferring language independently. The inverse direction
(`interfaceLanguage=en`, `activityLanguage=es`) is structurally
guaranteed by the same code path — there is no locale-specific branching
in the fix. `LearningDecision`, `TeachingIntent`, `SupportLevel`,
`EvidenceMode`, question generation, the quality gate, confidence
gating, and `ResponseEvidenceContract` semantics are all unchanged.

Do NOT claim LIVE PASS until pushed to QA and reproduced — this is a
code-level PASS backed by unit/source-contract tests and a clean build,
not a live QA run.

Do NOT start LX-6.
