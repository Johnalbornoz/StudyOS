# LX-8R2-R1 — UNIVERSAL MATH RESPONSE SURFACE

## STATUS

**PASS** (code-level certification only — see CERTIFICATION at the end
for why "LIVE PASS" is never claimed in this environment).

Every learner-facing surface identified by the LX-8R2 report's own
disclosed gap now renders the same canonical `MathResponseComposer`
for a mathematical final answer. The two-tier math-input experience
(structured editor in main quiz, legacy textarea+symbols in
Retention/verification) no longer exists.

## RESPONSE-SURFACE AUDIT

Full inventory of every `MathAnswerEditor`/`textarea`/direct-response-
input occurrence in the learner-facing codebase, classified:

| Surface | Location | Classification | Action |
|---|---|---|---|
| Main quiz final answer | `quiz/page.tsx`, `q.answerFormat === 'text'` | MATH_RESPONSE (when `isMathAnswerContext`) / PROSE_RESPONSE (otherwise) | Already `MathResponseComposer` since LX-8R2; unchanged here |
| Main quiz reasoning/work box | `quiz/page.tsx`, `requiresWork \|\| requiresJustification` | REASONING_RESPONSE | Unchanged — stays `MathAnswerEditor` (R6/R8: this is a text surface, not a computed-value surface) |
| Retention resume-verification | `quiz/page.tsx`, `resumeVerifyAttemptId` branch (~line 1092) | MATH_RESPONSE (conditionally) / PROSE_RESPONSE | **Migrated** to `MathResponseComposer` in this repair |
| Inline Assessment verification (post-quiz) | `quiz/page.tsx`, `results.verificationNeeded` list (~line 1497) | MATH_RESPONSE (conditionally) / PROSE_RESPONSE | **Migrated** to `MathResponseComposer` in this repair |
| `resumeQuestion`/`v.question` single-choice branches | `quiz/page.tsx` | N/A — button-based, no text response at all | Untouched |
| Cognitive Transfer response | `cognitive/transfer/page.tsx` | PROSE_RESPONSE | Not migrated — see below |
| Cognitive Explain & Defend response | `cognitive/explain/page.tsx` | PROSE_RESPONSE / REASONING_RESPONSE | Not migrated — explicitly a "reasoning demonstration" by product name |
| `MathAnswerEditor` component itself | `components/MathAnswerEditor.tsx` | Infrastructure | Unmodified; now used exclusively as a prose/reasoning surface across the codebase |
| `VoiceInputButton` | `app/dashboard/VoiceInputButton.tsx` | Infrastructure (STT primitive, ADMIN/NON-LEARNER in the sense of not being a response surface itself) | Unmodified |

**Transfer and Explain & Defend are not migrated.** Neither page had
*any* math affordance before this repair — not even the legacy
`MathAnswerEditor`, just a bare `<textarea>`. Both are single, bespoke,
open-ended-prompt flows with no `subjectName`, no `answerFormat`
variety, and no `ResponseEvidenceContract`/`InteractionContract`
wiring at all — an architecturally different shape from the quiz
surfaces. Explain & Defend is explicitly named (in its own existing
doc comment) as "always an independent reasoning demonstration."
Transfer's prompt is an application/reasoning explanation, not a
"give a computed expression" ask. Per R6's own wording ("EXPLAIN →
prose response unless the canonical question explicitly requires a
mathematical final answer"), neither surface has a case where a
mathematical final answer is explicitly required — retrofitting
subject-detection into these bespoke routes to reach a composer that
would then never fire is not "applicable" in the sense required test 4
hedges for ("where applicable"). This is a disclosed, deliberate scope
boundary, not an oversight, and not a regression (nothing there
regressed — they had no math surface to begin with).

## CANONICAL MATH RESPONSE COMPOSER

`src/components/MathResponseComposer.tsx` is the one component every
migrated surface renders. It owns:

- `MathExpressionEditor` (the structured MathLive editor)
- Canonical `MathResponse` serialization, via the shared
  `wrapMathForStorage`/`unwrapMathFromStorage`/`toGraderString`
  functions (moved into `math-response-contract.ts` in this repair)
- The professional toolbar (inside `MathExpressionEditor`)
- The optional voice-to-math pipeline (`MathVoiceInput`)
- Its own accessibility/UI copy, resolved internally via `getMessages`
  — callers pass data, not eight label props

It takes as **inputs** (never computes itself): the caller's
`ActivityLanguageContext` and its own `voiceEnabled` decision (the
caller's `InteractionContract.inputModes.includes('VOICE')` — per the
established LX-8R1 R1 "one modality-eligibility authority" rule, this
composer never re-derives that). Its public interface is a plain
`value: string` / `onChange: (next: string) => void` pair — the exact
same storage shape `MathAnswerEditor` already used everywhere, so
migrating a call site is a drop-in prop-shape change, not a new state
shape threaded through the surrounding page.

It determines **none** of: mastery, EvidenceMode, SupportLevel,
grading, correctness, or which activity comes next — verified by a
dedicated test asserting no such import or logic exists in the file.

## MAIN QUIZ

Unchanged in behavior; refactored to call `MathResponseComposer`
instead of directly assembling `MathExpressionEditor` + `MathVoiceInput`
+ page-local wrap/unwrap functions. Not gated by `quizMode`/
`PRACTICE_EVIDENCE_MODES` at all, so it applies identically whether the
active attempt is Practice or Prove (`isProveMode`) — satisfying the
"Prove" half of the required test matrix without any separate wiring,
since Prove is not a separate route in this codebase, only a stricter
`EvidenceMode` within the same quiz flow.

## RETENTION

The standalone "resume a pending verification" screen
(`resumeVerifyAttemptId` branch) now computes, inline, the exact same
canonical contracts the main flow already uses:
`deriveResponseEvidenceContract({ type: resumeQuestion.type,
expectedReasoningType: resumeQuestion.expectedReasoningType }, 'ASSESSMENT')`
and `buildInteractionContract({ integrityMode: 'ASSESSMENT', answerFormat:
resumeQuestion.answerFormat, activityLanguage: activityLanguageContext,
capabilities: modalityCapabilities })` — reusing the SAME
`activityLanguageContext`/`modalityCapabilities` state already computed
once near the top of the component (before this early-return branch),
never a second capability-detection effect or language context.
`resumeQuestion` is confirmed (via `src/app/api/quizzes/verify/route.ts`
→ `getPendingVerificationAttempt` → the persisted `verification_question`
column, typed `GeneratedQuestion`) to already carry `.type` and
`.expectedReasoningType`, so no new field or API change was needed.
`integrityMode` is the literal `'ASSESSMENT'` EvidenceMode, never
re-derived or guessed — verification only ever fires from an
Assessment-mode attempt per that route's own doc comment. This is also
a genuine capability upgrade: this screen previously had **no voice
input at all**; it now gets the same voice-to-math pipeline as the main
quiz whenever the computed `InteractionContract` allows it.

## VERIFICATION / PROVE

The inline post-quiz Assessment verification list
(`results.verificationNeeded` map) is migrated identically, deriving
its own `vContract`/`vIc` per question from `v.question.type`/
`v.question.answerFormat` (confirmed via `toClientQuestion`,
`src/lib/quiz/client-question.ts`, to already include `type` and
`expectedReasoningType`). Both migrated sites call the exact same
`isMathAnswerContext`, `deriveResponseEvidenceContract`, and
`buildInteractionContract` functions the main quiz flow calls — no
bespoke eligibility logic was written for either.

"Prove" itself, as noted above, is not a distinct page — it is the
non-Practice `EvidenceMode` branch of the same main-quiz flow, already
covered.

## TRANSFER

Not migrated. See RESPONSE-SURFACE AUDIT above for the full reasoning.
`cognitive/transfer/page.tsx` is confirmed to have never rendered
`MathAnswerEditor` or any math toolbar — this is not a regression
relative to its pre-repair state.

## RESPONSE CONTRACT

`ResponseEvidenceContract` remains the sole authority for what
evidence is required, on every surface. `isMathAnswerContext` is
gated on `responseContract.kind` (or the inline-derived equivalent for
the two migrated surfaces) and excludes `EXPLAIN`/`JUSTIFY` — those
keep the prose `MathAnswerEditor`, which may still show a separate
reasoning/justification box alongside a math `ANSWER_ONLY`/`SHOW_WORK`
composer, per the pre-existing (LX-8R2) wiring, confirmed still intact:
the reasoning box is never converted to a second math field on any of
the three surfaces.

## VOICE

Identical pipeline on every surface that renders `MathResponseComposer`:
STT (`VoiceInputButton`, unchanged) → `MathVoiceInput`'s deterministic
`parseMathSpeech` → "StudyUS understood" review → explicit acceptance
→ canonical `MathResponse` → the same string-in grader. No raw
transcript ever reaches the answer state when a math field is active;
no auto-submit exists anywhere in the pipeline (confirmed by the
existing `MathVoiceInput`/`MathSpeechParser` test suites, both
untouched and still fully green).

## TOOLBAR

Unchanged — still owned entirely by `MathExpressionEditor`, itself
owned by `MathResponseComposer`. No second toolbar implementation was
introduced anywhere.

## SERIALIZATION

`wrapMathForStorage`/`unwrapMathFromStorage`/`toGraderString` now exist
**exactly once**, in `src/lib/lx/math-response-contract.ts`, imported
by `MathResponseComposer` — verified by a dedicated test that neither
`quiz/page.tsx` nor `MathResponseComposer.tsx` re-declares them. Every
mathematical input path (keyboard, toolbar, voice, in either language,
on any of the three surfaces) converges on this one serialization; the
existing cross-modality-identical-answer guarantee
(`math-response-contract.test.ts`) is unaffected since the underlying
`MathResponse`/`toGraderString` contract itself was not changed, only
relocated and reused more widely.

## MATH-CONTEXT AUTHORITY

`isMathAnswerContext` now lives exactly once, in
`math-response-contract.ts`, exported and imported by `quiz/page.tsx`
(no page-local redeclaration — verified by test). It remains gated on
the same pre-existing `inferMathToolbarSubject` heuristic (no
additional or parallel subject-detection heuristic was introduced —
verified: the function name appears exactly twice in the contract
file, once as an import and once as the single call site). Its doc
comment now explicitly states it is "PRESENTATION CLASSIFICATION ONLY"
and enumerates exactly what it must never be extended to decide
(correctness, mastery, EvidenceMode, SupportLevel, next activity). All
three quiz-page call sites (main quiz, resume, inline verification)
call this same function — verified by counting exactly three call
sites in the page source.

No stronger canonical question-level indicator was found during this
audit that would make `inferMathToolbarSubject` unnecessary (there is
no `subjectDomain`/dedicated math flag on a `GeneratedQuestion`) — the
existing heuristic remains the best available signal and was centralized
rather than replaced, per R9's own fallback instruction.

## LEGACY EDITOR REMAINING USES

`MathAnswerEditor` (unmodified in this repair) now renders in exactly
four places in `quiz/page.tsx`: the non-math branch of each of the
three text-answer surfaces (main quiz, resume, inline verification),
plus the main quiz's reasoning/justification box (never math-gated).
Every one of those four is either a genuinely prose-typed answer or an
explicitly-prose reasoning surface — never a mathematical final answer
reached through the legacy path. Per R7's explicit instruction, the
component was **not** renamed in this pass, to avoid unnecessary churn;
a future phase may rename it once its exclusively-prose role is a
settled fact rather than a same-day observation.

## INTEGRITY

`MathResponseComposer` and everything it owns provide only structured
math entry, the notation toolbar, and voice-to-math transcription — no
hint, worked example, equation-completion, simplification, solving, or
AI-suggestion logic exists anywhere in the composer or
`MathExpressionEditor` (verified by test, using word-boundary-safe
regexes to avoid false matches like "resolve" containing "solve").
Retention/Prove/verification remain fully independent — no assistance
axis was touched by this repair; `canUseAI`/server-side enforcement is
untouched, and this repair adds no new AI call anywhere.

## TESTS

- `tests/unit/lx8r2-r1-universal-math-surface.test.ts` (new, 37 tests)
  — the full required 24-item test matrix: the response-surface audit
  assertions, composer ownership/boundary checks, both migration sites'
  wiring (contract derivation + composer rendering), the integrity
  checks, the voice pipeline reuse, response-contract kind coverage
  (ANSWER_ONLY/SHOW_WORK/JUSTIFY/EXPLAIN), legacy-editor confinement to
  prose surfaces, one-serialization/one-classifier verification, and
  the R10 parser-limitation documentation check.
- `tests/unit/lx8r2-math-response-experience.test.ts` (32 tests, 6
  updated in place) — re-pointed at the new architecture
  (`MathResponseComposer` instead of direct `MathExpressionEditor`/
  `MathVoiceInput` imports in the page; `isMathAnswerContext`/wrap/
  unwrap read from the shared contract module instead of page-local
  definitions) — every other assertion in this file was already
  correct and needed no change.
- `tests/unit/math-speech-parser.test.ts` (51 tests, 2 added) — R10's
  fail-closed-on-compound-number-outside-vocabulary case, and
  confirmation that a bare literal digit string of any length still
  parses regardless of the 0-20 word-vocabulary limit.
- All pre-existing suites (RET-R1, RET-R2, LX-8, LX-8R1, LX-8R2's
  original math-response-contract/math-expression-toolbar-config
  files, and everything else) required **zero** changes and remain
  green.

`npx tsc --noEmit`: clean. `npx vitest run`: **3335 passed / 3335**
across 209 files (up from LX-8R2's 3296/208 — 39 net new tests, one
new file, two files updated in place). `npm run build`: clean
production build, exit code 0, `/dashboard/quiz` compiles with no SSR
error.

Manual-quality expressions from the spec
(`(2x^2+5)^3`, `sqrt(x+3)`, `(x+1)/(x-2)`, `x^4`, `2x+3=7`) are already
covered end-to-end by the pre-existing `math-speech-parser.test.ts` and
`math-response-contract.test.ts` suites (unchanged in this repair) —
those guarantees now apply identically on every surface that renders
`MathResponseComposer`, since all three surfaces call the exact same
`MathExpressionEditor`/`MathVoiceInput`/serialization code, not
copies.

## COMMIT

Implementation and all test files committed together in one focused
commit on `tmp/lx1`: `feat: extract canonical MathResponseComposer,
migrate retention/verification off legacy editor (LX-8R2-R1)`. This
report is committed separately per the standing workflow.

---

**PASS**: the quality of mathematical response entry is now invariant
across canonical activity modes. A student answering mathematics in a
Retention resume-verification or a post-Assessment verification
question receives the identical structured editor and voice-to-math
capability as a student answering mathematics in main-quiz Practice or
Prove — the same component, the same serialization, the same
classifier, on every surface. Transfer and Explain & Defend remain
disclosed, non-regressing scope boundaries (no math affordance existed
there before this repair either). This is a code-level PASS only: no
live browser/microphone/screen-reader exists in this environment to
observe the two newly-wired voice-to-math paths in a real device. Do
NOT claim LIVE PASS until browser QA. Do NOT start LX-9. STOP.
