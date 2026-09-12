# LX-8R1 -- MULTIMODAL AUTHORITY REPAIR

Branch: `tmp/lx1` (worktree only -- not merged to `main`, not deployed).

## STATUS

**PASS_WITH_CONDITIONS**

All three repairs (interaction-policy authority, privacy claim, STT/TTS language authority) plus the response-packaging audit are complete and verified by 60+ tests, `tsc`, and `build`. The condition is unchanged from LX-8: browser/provider execution still requires LIVE QA, which this environment cannot perform (no browser, no microphone/speaker hardware).

## INTERACTION AUTHORITY

### BEFORE

`src/lib/lx/interaction-contract.ts` existed and was fully tested, but `quiz/page.tsx` never called it. Instead, the page independently re-derived the same two eligibility facts inline:
- `{q.answerFormat === 'text' && (<div>...<VoiceInputButton .../></div>)}` -- a second, hand-written "voice is allowed for free-text answers" rule.
- `<ReadAloudButton activityLanguage={quizLanguage} .../>` rendered unconditionally, with `ReadAloudButton`'s OWN internal `'speechSynthesis' in window` check being the only gate -- i.e. the page never asked the canonical contract whether AUDIO was permitted at all; it just always rendered the control and let the component silently no-op if unsupported.

Two representations of the same policy existed: the untouched, correct one in `interaction-contract.ts`, and a second, informal one baked into `quiz/page.tsx`'s JSX. That is precisely the "two Learning Engines" anti-pattern this whole LX track exists to prevent, applied to modality instead of pedagogy.

### AFTER

`quiz/page.tsx` now:
1. Detects browser capabilities ONCE (`modalityCapabilities` state, set in a mount-only `useEffect`).
2. Computes `coarseEvidenceMode` via the (extracted, unchanged-logic) `coarseEvidenceModeForQuizMode(quizMode)`.
3. Builds ONE `interactionContract` (`useMemo`, keyed on the current question's `answerFormat`, `coarseEvidenceMode`, the two language fields, and `modalityCapabilities`) by calling `buildInteractionContract(...)`.
4. Reads `ic.inputModes.includes('VOICE')` / `ic.outputModes.includes('AUDIO')` to decide whether to render `VoiceInputButton`/`ReadAloudButton` at all -- no other code path decides this.

`buildInteractionContract` itself was refactored to make this composition honest: it no longer imports `evidenceModeForActivity` or derives `integrityMode` from an `ActivityType` at all. `integrityMode: EvidenceMode` is now a required INPUT -- a server caller resolves it via the untouched `evidenceModeForActivity(activityType)` (`activity-taxonomy.ts`); the client (`quiz/page.tsx`) resolves it via its own pre-existing coarse mirror (now a named, single-copy function). Neither caller re-implements the OTHER's resolution method; both feed the SAME pure projection function.

A latent bug surfaced and was fixed during this repair: `inputModes` previously always included `'TEXT'` regardless of `answerFormat`, even for `single_choice`/`matching`/etc. questions where no free-response text surface exists at all. It now correctly returns `[]` for non-text answer formats.

### SERVER / CLIENT BOUNDARY

Investigated directly (not assumed): `src/lib/activity-taxonomy.ts` has **zero imports** -- it is a fully pure, dependency-free module, safe to import as a value from a client component. `interaction-contract.ts`'s other dependencies (`AnswerFormat` from `quiz-generation.service.ts`, `SupportLevel` from `adaptive-teaching-policy.ts`) are both **type-only** imports, erased at compile time -- they carry zero runtime code into any bundle. `buildInteractionContract` is therefore safe to import and call directly from `quiz/page.tsx` (a `'use client'` file), confirmed by a clean `npm run build`. The earlier LX-8 avoidance of this was over-cautious, based on a stale nearby comment about a *different* module (`PRACTICE_EVIDENCE_MODES`'s own duplicate-by-convention note) that does not actually apply to `interaction-contract.ts`. No server/client split module was needed -- Option B's "one pure canonical rule module both sides consume" is satisfied by the ONE existing `interaction-contract.ts`, called directly by both a future server caller and this client page.

## BROWSER CAPABILITY DETECTION

`modalityCapabilities` (`speechRecognitionSupported`, `speechSynthesisSupported`) is detected once, in one `useEffect`, and used for exactly one purpose: as the `capabilities` field of `buildInteractionContract`'s input. It is never read anywhere else in the file to gate rendering directly -- confirmed by source-contract test that no `{modalityCapabilities.speechRecognitionSupported && ...}`/`{modalityCapabilities.speechSynthesisSupported && ...}` conditional exists anywhere in the page. Detection remains an INPUT to the one canonical projection, never a second policy.

## PRIVACY MODEL

### WHAT STUDYUS CONTROLS

- StudyUS's own backend never receives audio in this implementation -- there is no upload endpoint, and `VoiceInputButton.tsx` contains no `fetch`/`FormData`/`Blob`/`MediaRecorder` call anywhere (verified by test).
- No raw audio is ever stored by StudyUS, in any form, at any layer.
- The resulting transcript text is held only in component state, only for the duration of the review step, and is passed to the caller only on explicit learner acceptance.

### WHAT THE BROWSER / VENDOR MAY CONTROL

- Whether the browser's own `SpeechRecognition` implementation performs recognition on-device or by sending the audio to the browser vendor's own cloud infrastructure (e.g. many Chrome builds are vendor-cloud-backed) is a fact about that browser's implementation, not something StudyUS's code can observe, configure, or promise either way. The corrected doc comment in `VoiceInputButton.tsx` states this explicitly and no longer claims "entirely browser/OS-local."

### PRODUCTION SECURITY CONDITION

Browser-native STT requires explicit privacy/security review and approval before Production use with minors, if product policy requires it. This phase performs no such review and grants no such approval -- it only corrects the code's claim to match reality.

## ACTIVITY LANGUAGE

Unchanged in meaning, now explicitly wired through the contract: `activityLanguageContext = buildActivityLanguageContext(quizLanguage)` is built once per render alongside the interaction contract; `ic.activityLanguage` (always equal to `quizLanguage` today) is what `ReadAloudButton` receives -- TTS speaks the language of the content, never the interface language, never `expectedResponseLanguage`.

## EXPECTED RESPONSE LANGUAGE

`ic.expectedResponseLanguage` (also always equal to `quizLanguage` today, via `buildActivityLanguageContext`) is what `VoiceInputButton` now receives, under its renamed prop `expectedResponseLanguage`. Verified representable independently of `activityLanguage`: a direct unit test constructs `{activityLanguage: 'es', expectedResponseLanguage: 'de'}` and confirms both fields survive `buildInteractionContract` unmodified and distinctly -- proving the architecture supports the future language-learning case (`instructionLanguage = Spanish`, `expectedResponseLanguage = German`) with zero change to `VoiceInputButton`/`ReadAloudButton`, only to what a future caller passes in.

## STT LANGUAGE AUTHORITY

`VoiceInputButton.tsx`: `recognition.lang = activityLanguageToBCP47(props.expectedResponseLanguage)`. The component no longer accepts or reads an `activityLanguage` prop at all -- `expectedResponseLanguage` is its only language input, confirmed by source-contract test (`not.toMatch(/props\.activityLanguage/)`).

## TTS LANGUAGE AUTHORITY

`ReadAloudButton.tsx`: unchanged functionally (`activityLanguageToBCP47(activityLanguage)`), doc comment extended to explicitly contrast with `expectedResponseLanguage` and state why TTS deliberately does not use it.

## RESPONSE PACKAGING AUDIT

Audited all seven points from the spec:

1. **Learner-facing explanation label uses activity language**: `at['multimodal.reasoningLabel']`, where `at = getMessages(quizLanguage)` -- already correct before this repair, reconfirmed.
2. **No hard-coded English leaks into non-English activities**: the combined string interpolates only `at[...]` lookups (all 5 locales already translated in LX-8) and learner-entered text -- no literal English string appears in the packaging code.
3. **ANSWER_ONLY receives no second surface**: `requiresWork`/`requiresJustification` are both `false` for `ANSWER_ONLY` (`response-evidence-contract.ts`, untouched), so the reasoning `<div>` never renders -- reconfirmed by test.
4. **SHOW_WORK/JUSTIFY requirements remain canonical**: `response-evidence-contract.ts` was not touched by this repair.
5. **EXPLAIN remains correctly answerable**: `kind: 'EXPLAIN'` has `requiresFinalAnswer: false` and both `requiresWork`/`requiresJustification` false -- the single existing `textAnswer` surface correctly captures the whole explanation; no second box is (or should be) triggered.
6. **Absence of work is never penalized when `requiresWork: false`**: the reasoning box, and therefore `explanationAnswer`, is only ever non-empty when the box was shown, which only happens when the contract already requires it -- `canProceed`'s `'text'` case never references `explanationAnswer` at all (confirmed by test), so the learner is never blocked or penalized based on it either way; the server-side `applyResponseContractGuard` (unchanged) remains the actual enforcement authority.
7. **The internal separator cannot itself become evidence or confuse grading**: judged safe with one small hardening. The AI grader (`gradeAnswer`) already reads a single free-text blob and is robust to a human-style "answer, then reasoning" structure. To remove any residual ambiguity across locales, the packaging now inserts a fixed, language-neutral `---` marker before the localized label (`` `${textAnswer}\n\n---\n${at['multimodal.reasoningLabel']}: ${explanationAnswer}` ``) -- a deterministic, unambiguous boundary regardless of activity language, with zero change to the grader itself.

**Conclusion**: packaging was already safe on 6 of 7 points; point 7 received the smallest possible deterministic hardening (one fixed separator token), not a grader or evidence-schema change.

## INDEPENDENT INTEGRITY

Unchanged and reconfirmed under the new architecture: `RETENTION_CHECK`/`TRANSFER`/`SOLO_VERIFY` (evidenceMode `INDEPENDENT` via the untouched `evidenceModeForActivity`) still resolve to `ic.integrityMode === 'INDEPENDENT'` while `ic.inputModes` still contains `VOICE` and `ic.outputModes` still contains `AUDIO` for a free-text question -- voice/TTS remain pure interaction, never assistance, and the Hint button's own gate (`PRACTICE_EVIDENCE_MODES`) is untouched by this repair.

## OBSERVABILITY

`INTERACTION_CONTRACT_READY` is now wired on the live quiz surface: logged once per question shown (a `useRef`-guarded effect prevents re-firing on unrelated re-renders like a hint toggle or confidence pick), carrying `conceptId`, `inputModes`, `outputModes`, `supportLevel`, `activityLanguage`, `expectedResponseLanguage`, `integrityMode` -- no question text, no answer, no transcript, no audio. `InteractionEventMeta`'s type was extended with `expectedResponseLanguage`/`integrityMode` and renamed `inputMode`/`outputMode` to `inputModes`/`outputModes` (plural, matching what a contract actually carries) -- still structurally incapable of carrying free-text content, verified by test.

## REGRESSIONS

Confirmed untouched by this repair: `RETENTION_REQUIRED_COUNT`/Retention's 6-question path; `transfer-policy.ts`; `generatePracticeQuestions`; `resolveQuizLanguage`/`src/lib/i18n/language.ts`; `response-evidence-contract.ts`'s semantics; `EvidenceMode`/`activity-taxonomy.ts`; `computeTeachingIntent`/`computeSupportLevel`; the Hint button's `canUseAI`/`PRACTICE_EVIDENCE_MODES` gate; `adaptive-learning-policy.ts`. Full suite: **203 test files / 3169 tests passing** (up from 202 files / 3139 tests before this phase). `npx tsc --noEmit`: clean. `npm run build`: compiles successfully.

## TESTS

`tests/unit/lx8r1-multimodal-authority-repair.test.ts` (new, 30 cases): the full required LX-8R1 matrix -- one-authority consumption, no duplicate VOICE/AUDIO eligibility logic, capability detection as input only, INDEPENDENT still permits accessibility modalities and still hides pedagogical help, voice review/no-auto-submit unchanged, corrected privacy claims (both absence of the old claim and presence of the new one), STT-from-expectedResponseLanguage / TTS-from-activityLanguage (including the hypothetical Spanish-instruction/German-response case), the full response-packaging audit, `INTERACTION_CONTRACT_READY` wiring with no content leakage, and regression guards. `tests/unit/lx8-multimodal-interaction.test.ts` (updated, still 55 cases): adjusted to the `integrityMode`-as-input contract shape, the corrected `ReadAloudButton`/`VoiceInputButton` JSX gating, and the extended observability metadata shape.

## COMMIT

Implementation commit `823032d` on `tmp/lx1`: `fix: LX-8R1 -- multimodal authority, privacy & response-language repair` (7 files: `interaction-contract.ts`, `multimodal-observability.ts`, `ReadAloudButton.tsx`, `VoiceInputButton.tsx`, `quiz/page.tsx`, one updated test file, one new test file). This report is committed separately, matching the established impl-commit + docs-commit pattern.

---

## CERTIFICATION

1. The live learner surface consumes one canonical interaction-policy authority rather than duplicating it -- **PASS** (verified: `quiz/page.tsx` calls `buildInteractionContract` and gates every modality render off its result; no independent eligibility rule remains anywhere in the file).
2. Privacy statements do not overclaim device-local STT -- **PASS** (the old claim is gone; the corrected boundary is documented and tested).
3. STT is governed by `expectedResponseLanguage` -- **PASS**.
4. TTS remains governed by the content/activity language -- **PASS**.
5. `ResponseEvidenceContract` remains the sole authority for what evidence the learner must provide -- **PASS** (untouched; the one packaging change is a presentation-layer separator, not an evidence-schema change).
6. Independent remains free of pedagogical assistance -- **PASS** (Hint gating untouched; voice/TTS remain pure interaction in every integrityMode).

Browser/provider execution still requires LIVE QA -- not performed in this environment.

Do NOT start LX-9.

STOP.
