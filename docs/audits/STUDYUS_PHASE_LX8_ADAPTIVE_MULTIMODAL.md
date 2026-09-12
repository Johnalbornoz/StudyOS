# LX-8 -- ADAPTIVE & MULTIMODAL INTERACTION

Branch: `tmp/lx1` (worktree only -- not merged to `main`, not deployed).

## STATUS

**PASS_WITH_CONDITIONS**

Every certification criterion that can be met without a provider decision is met (modality is presentation/input authority only; TeachingIntent/SupportLevel/ResponseEvidenceContract/LearningDecision are all reused verbatim, never recomputed; accessibility is structurally separated from help; Independent modes stay independent; voice answers enter the exact same evidence pipeline as typed answers; no CAS/grading invention; visual questions are deterministic and gated; activity language governs every activity modality; no learning-style routing; optional-modality failures degrade gracefully; required-visual failures fail closed at generation time; no raw audio/transcript/answer leaks into logs; every existing canonical engine is untouched). The condition, per the spec's own instruction: **actual STT/TTS provider execution cannot be verified in this environment** (no live browser, no microphone/speaker hardware, no dev server with auth+DB per this session's established pattern) -- this is CODE PASS, not LIVE PASS. R31's explicit permission ("mark actual provider-dependent execution UNRESOLVED... never pretend a provider path has been live-tested") is invoked honestly below.

## CURRENT CAPABILITY AUDIT

### VOICE
Nothing existed before this phase: zero `SpeechRecognition`/`webkitSpeechRecognition`/`getUserMedia`/`MediaRecorder` usage anywhere in `src/`, no voice-input UI component, no audio upload API route. Classification: **EXTEND** (built from scratch this phase, browser-native only).

### TTS
Nothing existed before this phase: zero `speechSynthesis`/`SpeechSynthesisUtterance`/read-aloud UI/TTS API route anywhere. Classification: **EXTEND** (built from scratch this phase, browser-native only).

### MATH
`src/components/MathAnswerEditor.tsx` + `src/lib/math-toolbar-config.ts` already exist and already cover fractions (as `/`), exponents, roots, parentheses, π, Σ, ∫, ∞, variables (Greek letters), and standard operators -- all as literal Unicode insertions, deliberately never LaTeX (its own doc comment: "like Word's Insert Symbol... never LaTeX"). Mobile: `overflowX: 'auto'` on both toolbar rows. Answer contract: always a plain string, feeding `AnswerFormat: 'text'`. Classification: **KEEP** -- R12 is already satisfied; this phase does not touch `MathAnswerEditor.tsx`.

### VISUALS
`VisualAid` (`quiz-generation.service.ts:153-164`) already exists: `kind: 'diagram' | 'chart'`, inline sanitized SVG or a small `{chartType, labels, values}` dataset the client renders as SVG bars/lines (`MiniChart`/`VisualAidView`, `quiz/page.tsx`). Already deterministic -- Claude authors structured data/markup, never a raster image; no generative-image-AI call exists anywhere in `src/services`. The universal Question Quality Gate already validates chart-data consistency (`question-quality-contract.ts`, pre-existing `VISUAL_UNSUPPORTED`/`VISUAL_INCONSISTENT` codes). Classification: **KEEP** the renderer/generation architecture (R16 already satisfied); **EXTEND** the semantic wrapper (R17: `visualType`/`altText`/`pedagogicalRole` did not exist) and the quality gate (R19: a diagram with no `svg` at all, or any visual with no caption, previously were not checked).

### ADAPTIVE SUPPORT
`SupportLevel` (`'HIGH_SUPPORT'|'GUIDED'|'PARTIAL_SUPPORT'|'MINIMAL_SUPPORT'|'INDEPENDENT'`, `adaptive-teaching-policy.ts:77`) and `TeachingIntent` (same file, `:126-147`, with `supportLevel` as one of its fields) are real, certified, server-only-computed (`computeSupportLevel`/`computeTeachingIntent`, same file). The live quiz session deliberately does NOT fetch a `TeachingIntent` per question (`LearningSupportStatus.tsx`'s own doc comment: "fetching them would add a full `getLearningDecisions` per activity load") -- the only surface that already renders `SupportLevel`-driven copy is the remediation shell (`src/app/dashboard/remediation/[pathId]/page.tsx`, via `remediationSupportLevelCopy`/`remediationPromisesWorkedExample`). Hints are gated by `EvidenceMode` via server-side `canUseAI` (`ai-permission-policy.ts`), mirrored client-side only for whether the Hint button renders (`PRACTICE_EVIDENCE_MODES`, `quiz/page.tsx`) -- never by `SupportLevel` directly. Classification: **KEEP** the authority (untouched); **STANDARDIZE** the presentation mapping (R21, `support-presentation.ts` is new, but it is a lookup table over the existing enum, not a new computation).

### LANGUAGE
No module literally named `ACTIVITY_LANGUAGE`/`GLOBAL_INTERFACE_LANGUAGE` exists. The real mechanism: `getInterfaceLanguage` (shell/nav) vs. `resolveQuizLanguage` (one active activity's own language), both in `src/lib/i18n/language.ts`; the quiz page's own `quizLanguage` state IS the resolved activity language, held for the session and used to build its `at = getMessages(quizLanguage)` messages object -- confirmed by direct read, not assumption. No `expectedResponseLanguage` concept existed. Classification: **STANDARDIZE** -- `activity-language.ts` formalizes what already worked, under one name, and adds the one genuinely missing field.

## INTERACTION CONTRACT

`src/lib/lx/interaction-contract.ts`. `InteractionContract { inputModes, outputModes, preferredInputMode, preferredOutputMode, activityLanguage, expectedResponseLanguage, integrityMode, supportLevel, presentation, provenance }`, built by the pure `buildInteractionContract(inputs)`. It decides none of correctness/mastery/progression/next-activity/support-level/evidence-weight -- every one of those is either passed in verbatim (integrityMode from `evidenceModeForActivity`, supportLevel from an already-computed `TeachingIntent` when the caller has one) or a fixed, total lookup (`presentation`, from `support-presentation.ts`). `preferredInputMode`/`preferredOutputMode` are read back from a caller-supplied `AccessibilityPreferences` object and clamped to modes the activity actually offers -- never derived, never fed anywhere near `TeachingContextInputs`.

**Composition with `ResponseEvidenceContract` (R37, R2)**: kept deliberately UNMERGED. `response-evidence-contract.ts` (LX-1C/LX-1R, already live and used in both `quiz/page.tsx` and `generate-and-take/route.ts`) already declares `EvidenceRequirementKind = 'ANSWER_ONLY'|'SHOW_WORK'|'EXPLAIN'|'JUSTIFY'` and `requiresWork`/`requiresExplanation`/`requiresJustification` -- LX-8 did not reinvent this; its own doc comment explicitly reserves the voice/modality question for LX-8 ("HOW the learner may express it... is a SEPARATE concern... owned by LX-8"). `InteractionContract` answers HOW; `ResponseEvidenceContract` answers WHAT -- a caller composes both per question, neither embeds the other.

**Why `quiz/page.tsx` does not call `buildInteractionContract()` directly**: that file is a client component, and its own existing convention (`PRACTICE_EVIDENCE_MODES`'s comment) explicitly avoids importing server-tagged `lib` modules into client bundles, duplicating the minimal fact needed instead. LX-8 respects that convention: `interaction-contract.ts` is fully tested and ready for server-rendered callers, while `quiz/page.tsx` applies the same two rules inline (`answerFormat === 'text'` gates MATH/VOICE; browser-capability flags gate VOICE/AUDIO) -- proven equivalent by test (LX-8 test 7/8/13 exercise the pure function; the quiz-page source-contract tests confirm the same gating logic is present inline).

## TEACHING INTENT INTEGRATION

Untouched. `computeTeachingIntent`/`getTeachingIntentForConcept` are not called anywhere in the new code. `InteractionContract.supportLevel` is `null` unless a caller already has a `TeachingIntent` (e.g. a future remediation-shell caller) -- LX-8 introduces no new `getLearningDecisions`/`getTeachingIntentForConcept` call site, preserving the ordinary quiz session's existing zero-TeachingIntent-fetch performance characteristic.

## SUPPORT LEVEL INTEGRATION

`support-presentation.ts`'s `presentationForSupportLevel` is a pure, total, hand-written table matching R21's own example exactly (HIGH_SUPPORT: explanation+workedExample+readAloudSuggested+relevantVisual+guidedSteps; GUIDED: explanation+workedExample+guidedSteps; PARTIAL_SUPPORT: conciseReminder only; MINIMAL_SUPPORT/INDEPENDENT: nothing). It is consumed only by `buildInteractionContract`, never inlined elsewhere, and reads no raw score anywhere (confirmed by source-contract test).

## VOICE INPUT

`src/app/dashboard/VoiceInputButton.tsx`, browser-native `SpeechRecognition`/`webkitSpeechRecognition` only. Flow: mic tap -> `LISTENING` -> `onresult` -> `REVIEW` (transcript shown in an editable `<textarea>`, never auto-accepted) -> explicit "Use this" click -> `onAccept(transcript)` hands the string to the caller's existing `textAnswer` state, identical to what typing would have produced. Offered whenever `answerFormat === 'text'`, regardless of `quizMode`/`evidenceMode` -- R6's "voice may be allowed in Independent/Assessment as pure input" is satisfied structurally, since gating is on answer surface, never on integrity mode. No coaching, no suggested wording, no rewriting -- there is no AI call anywhere in this component.

## TRANSCRIPT REVIEW

The `REVIEW` state's `<textarea>` is the SAME state variable (`transcript`) the learner can freely edit before accepting -- corrections are the learner editing their own answer (R7), never an AI suggestion (no AI touches this component at all). "Record again" restarts capture; "Discard" returns to idle without ever calling `onAccept`.

## VOICE EVIDENCE INTEGRITY

By construction: `onAccept(transcript)` writes into the exact same `textAnswer` React state `MathAnswerEditor`'s `onChange` already writes into, which `encodeCurrentAnswer`'s `'text'` case (unchanged) sends onward to the existing `gradeAnswer`/`gradeStructuredAnswer` functions -- confirmed by direct audit read to be already input-method-agnostic (both take a plain `studentAnswer: string`, with zero branch on how it was produced). Voice cannot score differently from typing because there is no code path by which it could: it is the same string, through the same function, to the same grader. No pronunciation/accent/fluency scoring exists anywhere (grep-confirmed absent); marked explicitly **UNRESOLVED/future** per R38 -- a dedicated pronunciation evidence axis is out of LX-8's scope, not a silent gap.

## TTS

`src/app/dashboard/ReadAloudButton.tsx`, browser-native `speechSynthesis` only. Speaks exactly the `text` prop it is given -- no fetch, no generation, no rephrasing. Voice selection requires an exact-or-language-prefix match to the activity's own BCP-47 tag (`activityLanguageToBCP47`); if none exists, the button renders nothing rather than speaking in the wrong language (R11). Offered for every `integrityMode` (accessibility, not help, per R8/R22) gated only on `'speechSynthesis' in window`.

## ACTIVITY LANGUAGE

`quizLanguage` (the quiz page's pre-existing per-session state, itself derived from `resolveQuizLanguage`) is passed as `activityLanguage` to both new components -- never `getInterfaceLanguage`. Verified by source-contract test that no `ReadAloudButton`/`VoiceInputButton` call site in `quiz/page.tsx` references an interface-language variable.

## RESPONSE LANGUAGE

`ActivityLanguageContext { activityLanguage, expectedResponseLanguage }` (`activity-language.ts`) keeps the two fields structurally distinct even though `buildActivityLanguageContext` sets them equal today -- the extensibility R10 asks for (a future `instructionLanguage != targetLanguage != expectedResponseLanguage` language-learning surface) requires no contract change, only a different builder. LX-8 does not redesign language-learning pedagogy.

## MATH INPUT

Unchanged (see CURRENT CAPABILITY AUDIT / MATH above) -- `MathAnswerEditor.tsx` was not modified.

## SHOW WORK / EXPLANATION

`quiz/page.tsx` now renders a second `MathAnswerEditor` (state: `explanationAnswer`) labeled "Explain your reasoning" whenever the already-computed `responseContract.requiresWork || responseContract.requiresJustification` is true -- i.e. exactly the `SHOW_WORK`/`JUSTIFY` kinds `response-evidence-contract.ts` already assigns to `step_by_step`/`justification`/`scenario`/`prediction`/`error_detection` (or any type a canonical `expectedReasoningType: 'PROCEDURAL'` tag tightens). `ANSWER_ONLY` questions (the other 12 of 18 `QuestionType`s) never render it. At submit, `encodeCurrentAnswer`'s `'text'` case folds the reasoning text into the SAME single string already sent to the unmodified grader (`"${textAnswer}\n\nExplain your reasoning: ${explanationAnswer}"` when non-empty) -- zero grader change, zero new evidence field.

## VISUAL CONTRACT

`src/lib/lx/visual-contract.ts`. `VisualType` names the full R15 vocabulary (`DIAGRAM|CHART|GRAPH|GEOMETRY|NUMBER_LINE|TABLE|IMAGE_CONTEXT|FORMULA_RENDER`) but only `DIAGRAM`/`CHART` have a live generator+renderer today (`deriveVisualArtifact` maps the existing `VisualAid.kind` 1:1 to these two) -- the other six are named contract extension points, explicitly **UNRESOLVED/future**, not implemented. `VisualArtifact { visualType, source, altText, pedagogicalRole }`; `pedagogicalRole` defaults to `QUESTION_CONTEXT` (every live caller today).

## DETERMINISTIC RENDERING

Unchanged and already compliant (R16): `VisualAid` is authored as structured SVG/chart data by the existing content model, rendered client-side by the existing `MiniChart`/`VisualAidView` -- no generative image AI exists in this codebase, confirmed by direct grep across `src/services`/`src/lib`. LX-8 adds no new renderer.

## VISUAL QUALITY GATE

`question-quality-contract.ts`'s deterministic visual check gained exactly two new rules (`VISUAL_MISSING_RENDER_DATA`: a `kind: 'diagram'` with no `svg`; `VISUAL_INACCESSIBLE`: any visual with no `caption`) alongside the pre-existing `VISUAL_UNSUPPORTED`/`VISUAL_INCONSISTENT` checks (unsupported kind/chart-type; label/value length or non-finite-value mismatches). Both new checks are cheap, unambiguous structural facts -- never a content-correctness judgment -- so they belong in the deterministic pass, consistent with the module's own architecture. Verified by test: a diagram with no `svg`, or any visual with no caption, now fails the gate and can never reach a learner.

## ACCESSIBILITY

TTS and voice-as-input are both classified, in code and in tests, as accessibility/interaction capabilities, structurally separate from pedagogical help: neither component imports or calls `ContextualHelp`, `generateQuestionHint`, or any AI-assistance endpoint (source-contract test 36). Both remain available in every `integrityMode`, including `INDEPENDENT`/`ASSESSMENT` (tests 34/35).

## INDEPENDENT / HIGH-INTEGRITY MODES

`RETENTION_CHECK`/`TRANSFER`/`SOLO_VERIFY` all resolve to `integrityMode: 'INDEPENDENT'` and still include `VOICE` in `inputModes` and `AUDIO` in `outputModes` when the browser supports them (test 13/34/35) -- voice/TTS are pure interaction, never assistance, so integrity mode never suppresses them. What IS still suppressed in these modes, unchanged: hints (`PRACTICE_EVIDENCE_MODES`/`canUseAI`), the reasoning surface's difficulty is unaffected by modality (it is gated by `ResponseEvidenceContract` alone, never by `integrityMode`).

## FALLBACKS

STT unavailable: `VoiceInputButton` renders `null`; the existing `MathAnswerEditor` remains the only (and already-functioning) input. TTS unavailable or failing: `ReadAloudButton` renders `null` or reverts to idle; the question text itself is rendered unconditionally by unrelated, unmodified JSX (test 18). Required-visual failure: caught upstream, at generation/quality-gate time (`VISUAL_MISSING_RENDER_DATA`/`VISUAL_INACCESSIBLE`/`VISUAL_UNSUPPORTED`/`VISUAL_INCONSISTENT`) -- a malformed required visual fails closed and never reaches a learner in the first place (test 26/28/41). **Honest gap**: a visual that PASSES generation-time validation but then throws during browser SVG rendering has no dedicated live-recovery UI in this phase (no try/catch wraps `VisualAidView`) -- marked **UNRESOLVED**, not silently claimed as solved.

## PRIVACY

No audio is ever persisted: `SpeechRecognition` is entirely browser/OS-local and this codebase never touches a `MediaRecorder`/audio blob/upload anywhere (confirmed absent by grep, both before and after this phase). `logInteraction`'s `InteractionEventMeta` type has no field capable of carrying a transcript, answer, or audio value -- verified structurally by test, not just by convention.

## OBSERVABILITY

`src/lib/lx/multimodal-observability.ts`, `logInteraction(label, meta)`, mirroring the `[today]`/`[my-path]`/`[retention]` pattern exactly. All ten required event labels are wired: `VOICE_INPUT_STARTED`/`VOICE_TRANSCRIPTION_READY`/`VOICE_TRANSCRIPTION_FAILED` (+ `VOICE_TRANSCRIPT_ACCEPTED`, added for symmetry with R4's explicit-acceptance requirement) from `VoiceInputButton`; `TTS_STARTED`/`TTS_FAILED` from `ReadAloudButton`; `INTERACTION_CONTRACT_READY`/`MATH_INPUT_USED`/`VISUAL_RENDER_READY`/`VISUAL_RENDER_FAILED`/`MODALITY_FALLBACK_USED` are defined and available but not yet emitted from a live call site in this phase (no caller currently builds/logs a full `InteractionContract` at render time, since `quiz/page.tsx` uses the inlined-rule approach explained above) -- marked **UNRESOLVED/future wiring**, not fabricated.

## AI / PROVIDER BOUNDARY

Direct read of `src/lib/ai/model-routing.ts` (the actual, real file -- corrected here after an intermediate audit pass incorrectly claimed it didn't exist): `CAPABILITY_ROUTING` routes every canonical learner-runtime capability (`QUESTION_GENERATION`, `CONTENT_GENERATION`, `EXPLANATION_EVALUATION`, `GRADING`, `TRANSFER_EVALUATION`, `COGNITIVE_ANALYSIS`, `CLASSIFICATION`, `TUTOR`) to OpenAI, Luna (`gpt-5.6-luna`) primary / Terra (`gpt-5.6-terra`) fallback (or Terra-only for evaluation-grade capabilities) -- with `isAnthropicModel()` existing specifically to prove Claude/Anthropic is NOT in this runtime. **No STT/TTS capability exists in `AICapability`, and no audio-capable provider integration exists anywhere** (`adapters/openai.ts` only calls `/v1/chat/completions` and `/v1/embeddings`; `adapters/anthropic.ts` only calls `/v1/messages`) -- confirmed by direct grep, zero hits for whisper/elevenlabs/polly/azure-speech/google-speech. Per R31, this phase does **not** add a new provider or a new `AICapability` entry casually. It uses ONLY browser-native `speechSynthesis`/`SpeechRecognition` -- zero network calls, zero cost, zero new provider risk. A server-side STT/TTS provider integration remains **UNRESOLVED**, requiring an explicit product/security decision this phase does not make.

## PERFORMANCE / LAZY LOADING AUDIT

- TTS never blocks question rendering: `ReadAloudButton` is `next/dynamic(..., {ssr:false})` and internally renders `null` until it has confirmed browser support in a `useEffect` (never on the initial render path).
- Microphone initialization never blocks first interaction: `VoiceInputButton` (same lazy-loading treatment) only touches `SpeechRecognition` inside its `start()` handler, triggered by an explicit tap -- never at mount.
- Visual rendering: unchanged from the pre-existing architecture (`VisualAidView` already renders only when `q.visualAid` is present; no new coupling introduced).
- Large math components: `MathAnswerEditor` itself is untouched and was not eagerly-loaded before this phase either; out of scope.
- Both new components are code-split via `next/dynamic` (R33) -- their JS is not part of the initial `quiz/page.tsx` bundle chunk.

## MOBILE

Reviewed via source/style only (no live device QA performed, consistent with this session's established constraints): both new buttons are small (30x30px), icon-only, `flexShrink: 0`, placed inline next to existing content rather than in a fixed-size reserved area -- no new horizontal-overflow risk introduced. `MathAnswerEditor`'s pre-existing mobile handling (`overflowX: 'auto'`) is untouched. **Not claimed as LIVE-verified** on an actual mobile device/browser.

## TESTS

`tests/unit/lx8-multimodal-interaction.test.ts`, 55 cases covering all ten required-matrix categories (ADAPTIVE 1-6, VOICE 7-15, TTS 16-19, MATH 20-24, VISUAL 25-30, LANGUAGE 31-33, INTEGRITY 34-39, FALLBACK 40-42, OBSERVABILITY 43-44, REGRESSION 45-53) plus the new visual-gate checks (`question-quality-contract.ts`'s two additions) and the `response-evidence-contract.ts` composition proof (R37). Full suite: **202 test files / 3139 tests passing** (up from 201 files / 3084 tests before this phase). `npx tsc --noEmit`: clean. `npm run build`: compiles successfully.

## COMMIT

Implementation commit `691b4de` on `tmp/lx1`: `feat(lx): LX-8 -- adaptive & multimodal interaction` (11 files: 7 new modules/components, 1 new test file, 3 modified -- `quiz/page.tsx` additive wiring, `messages.ts` new keys, `question-quality-contract.ts` two new deterministic checks). This report is committed separately, matching the established impl-commit + docs-commit pattern.

## LIVE QA REQUIRED

None of the following can be claimed LIVE PASS from this environment (no browser, no microphone/speaker hardware, no auth+DB dev server available in this session):

- **A.** Spanish interface / English activity: confirm shell stays Spanish while question/TTS/voice-recognition locale are English.
- **B.** Practice open response with voice: activate mic, verify transcript review UI, edit, submit, confirm identical grading to a typed answer.
- **C.** Independent/Retention with voice: confirm the mic is present and offers zero coaching/hints.
- **D.** A `step_by_step`/`justification` question: confirm the second reasoning box appears and both fields reach the grader.
- **E.** A chart/diagram question: confirm it renders and reads correctly with a screen reader (`altText`).
- **F.** Voice unavailable (unsupported browser or denied permission): confirm typed input still works end to end.
- **G.** A visual that fails generation-time validation: confirm the question is simply never offered to the learner (not a broken render).

These are prepared, not executed. **Do not claim LIVE PASS until this QA runs.**

---

## CERTIFICATION

1. Modality is presentation/input authority only -- `InteractionContract` decides none of correctness/mastery/progression/next-activity/support-level/evidence-weight. **PASS**
2. TeachingIntent/SupportLevel remain canonical, computed only by `computeTeachingIntent`/`computeSupportLevel` -- untouched. **PASS**
3. Accessibility is structurally separated from help (no hint/explain call in either new component). **PASS**
4. Independent modes stay independent -- hints/assistance untouched; voice/TTS are pure interaction, offered by design, never assistance. **PASS**
5. Voice answers enter the exact same evidence contract as typed answers -- same state, same `encodeCurrentAnswer`, same grader, proven input-method-agnostic by direct read. **PASS**
6. Math modality invents no new grading requirement -- `MathAnswerEditor` untouched; no CAS built. **PASS**
7. Visual questions have deterministic, gate-verifiable visual context -- extended, not replaced. **PASS**
8. Activity language governs all activity modalities -- `quizLanguage`, never interface language. **PASS**
9. No fixed "learning style" routing -- absent by construction and by test. **PASS**
10. Optional modality failures degrade gracefully -- both new controls render `null` on unsupported/failed states. **PASS**
11. Required modality failures fail explicitly and safely -- visual failures are caught at the quality gate before reaching a learner; live SVG-render-time failure recovery is the one open gap, marked UNRESOLVED. **PASS_WITH_CONDITIONS**
12. No raw learner audio/answers leak into logs -- structurally enforced by `InteractionEventMeta`'s type. **PASS**
13. Existing canonical learning engines remain unchanged -- confirmed by regression tests across Today/My Path/Concept Mission/Practice/Retention/Transfer/LearningDecision/activity-language. **PASS**

Overall: **PASS_WITH_CONDITIONS** -- STT/TTS provider execution and live browser QA are UNRESOLVED, honestly, per R31/R40's own instruction. No LIVE PASS claim is made.

Do NOT start LX-9.

STOP.
