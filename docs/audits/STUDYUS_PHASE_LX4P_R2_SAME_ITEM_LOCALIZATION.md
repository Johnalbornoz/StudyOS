# STUDYUS — PRODUCTION HOTFIX
## LX-4P-R2 — SAME-ITEM QUESTION LOCALIZATION — REPORT & CERTIFICATION

Branch: `tmp/lx1`
Repair commit: `2dbcb82`
Builds on: `0dc9bf7` (LX-4P-R1 doc) / `8d3c6ba` (LX-4P-R1 impl).

Teaching loop NOT redesigned. LX-8 multilingual model NOT implemented.
LX-6 not started.

---

## 1. QUESTION STRUCTURE AUDIT

`GeneratedQuestion` (`src/services/quiz-generation.service.ts:157`), stored
as JSONB in `quiz_sessions.questions`, has a stable `id`.

### IMMUTABLE — copied verbatim from the stored original, never from the AI

`id`, `conceptId`, `type` (QuestionType), `answerFormat`, `correctAnswer`,
`difficulty` (1–5), `cognitiveLevel`, `expectedReasoningType`,
`questionIntent`, `evidenceDimensions`, `learningObjectiveId`,
`calculatorAllowed`, `askConfidence`, `sourceReference`, every
`options[].id`, `matchingPairs` structure, `orderingItems` membership,
`classificationItems[].category` mapping, all numeric constants, all
formulas/expressions, all units. EvidenceMode / ActivityType live on the
`quiz_sessions` row (`storeQuiz`, immutable per attempt) and are never
touched. `current` index is client state and is not sent.

### LOCALIZABLE — display text only

`question` (stem), `options[].text`, `explanation`, `visualAid.caption`.
(`matchingPairs.left/right`, `orderingItems[]`,
`classificationCategories[]`, `classificationItems[].item` are localizable
in principle but are **not** localized here — see §2.)

### Not all formats localize the same way

| answerFormat | answer encoding | in-place localization |
|---|---|---|
| `single_choice` (multiple_choice / true_false / yes_no) | option **id** | **YES** — ids immutable, draft (`singleChoice`) is an id |
| `multi_choice` (multi_select) | comma-joined **ids** | **YES** |
| `text` (short_answer / open_ended / fill_blank / numeric_problem / step_by_step / case_study / scenario / error_detection / justification / comparison / prediction) | learner free text | **YES** — draft is a string, never translated; grading is merits-based |
| `matching` / `ordering` / `classification` | JSON of **label text** (client works off shuffled text, not ids) | **NO** — translating the labels would strand an in-progress arrangement → falls back to LX-4P-R1 explicit restart |

`LOCALIZABLE_ANSWER_FORMATS = { single_choice, multi_choice, text }`.

---

## 2. LOCALIZATION ARCHITECTURE

```
learner changes the question-language <select> during PRACTICE
        │
        ▼
quiz/page.tsx  changeQuizLanguage(next)
   phase==='quiz' && teachingStage==='questions'
        │
        ▼
attemptSameItemLocalization(next)
   POST /api/quizzes/localize-question
        { studentId, quizId, questionIndex: current, targetLanguage: next, optionOrder }
        │
        ▼
route  src/app/api/quizzes/localize-question/route.ts   (writes nothing)
   verifyAuth → verifyStudentAccess → getQuizSession(quizId)
   assert session.studentId === studentId
   assert 0 <= questionIndex < session.questions.length
   assert isLocale(targetLanguage)
   original = session.questions[questionIndex]           ← canonical, server-side
   if session.language === targetLanguage → reshape original, no AI
   else localizeGeneratedQuestion({ question: original, targetLanguage })
        │
        ▼
service  src/services/question-localization.service.ts
   LOCALIZABLE_ANSWER_FORMATS gate → else { ok:false, reason:'UNSUPPORTED_FORMAT' }
   executeAI( promptId 'quiz.question_localization', risk MEDIUM_RISK )   ← TRANSLATE-ONLY
        → provider/parse failure → { ok:false, reason:'PROVIDER_ERROR' | 'PARSE_ERROR' }
   reconcileLocalization(original, aiOutput)   ← §3
        → drift → { ok:false, reason:'NUMERIC_DRIFT'|'FORMULA_DRIFT'|'OPTION_DRIFT'|'EMPTY_TEXT' }
        → ok → { ok:true, question: <original structure + translated text> }
        │
        ▼
route → toClientQuestion(localized, questionIndex, { optionOrder })   ← shared transform, no reshuffle
        │
        ▼
client  ok  → setQuestions(qs => qs.map((q,i) => i===current ? localized : q)); setQuizLanguage(next)
        !ok → setLocalizeFailedFallback(true); setPendingLanguageSwitch(next)   → LX-4P-R1 dialog (R15 copy)
```

`quiz.question_localization` is a NEW registered prompt (v1,
`CONTENT_GENERATION`), separate from `quiz.question_generation`. Its
system prompt is TRANSLATE-ONLY: "You are NOT writing a new question…
Preserve every number EXACTLY… every formula/equation/variable/symbol
EXACTLY… every unit EXACTLY… the answer's meaning EXACTLY… the SAME
option ids and count… the SAME type, context, scenario and difficulty…
Do NOT simplify, do NOT make it harder, do NOT invent a new example, do
NOT add or remove information."

`shuffleArray` + `toClientQuestion` were extracted to
`src/lib/quiz/client-question.ts` so a localized question is reshaped for
the client by the *same* code as the original, with an added
`optionOrder` option that preserves the learner's current on-screen
choice order instead of reshuffling.

---

## 3. SEMANTIC INTEGRITY VALIDATOR (`reconcileLocalization`, pure)

1. **Non-empty stem** — else `EMPTY_TEXT`.
2. **Option identity** — the AI's option set must be exactly the
   original's `id` set, every translated text non-empty; the localized
   options are then rebuilt id-by-id **from the original** (the AI's ids
   are never trusted). Add/drop/rename → `OPTION_DRIFT`.
3. **Reconstruct** — `{ ...original, question: aiText, options: <rebuilt>,
   explanation: aiText || original, visualAid.caption: aiText || original }`.
   Everything else (id, type, correctAnswer, difficulty, cognitiveLevel,
   expectedReasoningType, questionIntent, calculatorAllowed, …) is the
   original's, structurally — not merely validated.
4. **Numeric integrity** — multiset of numeric tokens
   (`-?\d+([.,]\d+)?([eE][+-]?\d+)?`, comma normalised) over *all*
   localizable text combined must be identical before/after. Drop, add,
   round, or convert → `NUMERIC_DRIFT`.
5. **Formula integrity** — multiset of "math-ish" spans (LaTeX `$…$` /
   `\(…\)` / `\[…\]`, `x=y` / `x^2` / `a_b` operator runs, `√ ≤ ≥ × · ±
   ∑ ∫ π Ω µ °`, `n/m` ratios) must be identical → else `FORMULA_DRIFT`.

Any failure returns `{ ok: false }` and the question is **not** mutated.

---

## 4. FAILURE FALLBACK

The LX-4P-R1 explicit-restart dialog remains and is shown when:

- the format is `matching` / `ordering` / `classification`
  (`UNSUPPORTED_FORMAT`);
- the provider call throws or the response won't parse
  (`PROVIDER_ERROR` / `PARSE_ERROR`);
- `reconcileLocalization` rejects the translation
  (`NUMERIC_DRIFT` / `FORMULA_DRIFT` / `OPTION_DRIFT` / `EMPTY_TEXT`);
- there is no live `quizId` yet.

In that dialog `localizeFailedFallback` swaps the copy to R15's:
> **No se puede cambiar el idioma de esta pregunta aquí mismo**
> StudyUS no puede traducir esta pregunta con seguridad sin cambiarla.
> Empezar en {lang} iniciará una actividad nueva. El idioma de la
> interfaz no cambia.
> [ Cancelar ]  [ Iniciar actividad nueva ]

Confirming runs `regenerateInLanguage` (the R1 path). A question is never
partially localized.

---

## 5. ACTIVE-ATTEMPT PRESERVATION

On a successful same-item localization the client does **only**:
`setQuestions(qs => qs.map((q,i) => i===current ? localized : q))` and
`setQuizLanguage(next)`.

| State | After a successful localization |
|---|---|
| `quizId` | unchanged |
| `current` index | unchanged |
| `answers` map | unchanged |
| draft (`singleChoice` / `multiChoice` / `textAnswer` / …) | unchanged — the `[current, questions.length]` reset effect does not fire (length constant, index constant) |
| `teachingExperience` / `teachingStage` | unchanged — never referenced in the localization path |
| `results` | unchanged |
| help telemetry | unchanged — same `quizId` / `questionIndex` |
| `startLearningSession` | not called |

`generateQuiz` / `setQuizId` / `setCurrent(0)` / `setAnswers({})` /
`setTeachingExperience(null)` / `setTeachingStage(...)` are absent from
`localizeQuestionAt`, `attemptSameItemLocalization` and the lazy sync
effect (asserted by test).

Switching **back** to the generated language restores the pristine
question from `originalQuestionsRef.current[current]`. A best-effort lazy
effect keeps the *current* item aligned with `quizLanguage` as the
learner advances a switched batch; a lazy failure leaves that one item in
the original language rather than interrupting the attempt.

---

## 6. TEACHING LOOP PRESERVATION

MODEL / GUIDE run only while `teachingStage === 'teaching'`, which the
localization path never sets or clears. There is no language `<select>`
rendered on the teach-first stage (`TeachingIntro` has none), so a
question-language change during MODEL/GUIDE is not reachable from the UI;
the defensive `teachingStage === 'teaching'` branch falls back to the
explicit restart. `TeachingIntro`'s content-load effect is still keyed to
`[conceptId, quizId]` — a language change does not mint a new `quizId`,
so it does not re-fetch and does not re-enter. A completed MODEL/GUIDE
stays completed.

---

## 7. UI vs ACTIVITY LANGUAGE

| Surface | Authority |
|---|---|
| Quiz chrome (`t = getMessages(locale)` — "QUÉ SE TE PIDE", response-contract label, buttons, progress, the language dialog) | `locale` = account `interface_language` |
| Question content, options, `visualAid.caption` | `quizLanguage` (localized in place, or regenerated on restart) |
| `TeachingIntro` + `GuidedPractice` chrome (titles, "Reveal the next step", "Continue", "Skip to practice", "your step", "Check", "expected", stage kicker) | **`uiLocale`** prop = `locale` — **R13 fix** |
| `TeachingIntro` content (explanation, worked example, guided problem/steps) | `locale` prop = `quizLanguage` — fetched with `language=${locale}` |
| `ContextualHelp` menu labels ("Need help?", action names, errors) | **`uiLocale`** prop = `locale` — **R13 fix** |
| `ContextualHelp` help content | still requested with `language: locale` = `quizLanguage` |
| `LearningSupportStatus` ("Con ayuda disponible") | already `t` = account `locale` — unchanged |

Not yet split (deferred to LX-8, does not block it): `instructionLanguage`,
`targetLanguage`, `expectedResponseLanguage`, `targetLocale`/accent, and
the post-submit `ContinuationPanel` copy (LX-5; currently `quizLanguage`,
out of scope for this hotfix).

---

## 8. TEACHING UI I18N AUDIT (R13)

Every teaching / help control string is **UI chrome**, already keyed via
`t['…']` (no hard-coded English) — the defect was that `t` resolved
against the *question* language:

| String | Key | Classification | Fix |
|---|---|---|---|
| stage kicker (EXPLAIN/MODEL/GUIDE) | `teachingExperience.mode.*` | chrome | → `uiLocale` |
| "Here's the idea" / model title | `teachingIntro.explainTitle` / `.modelTitle` | chrome | → `uiLocale` |
| "Reveal the next step" | `workedExample.revealNext` | chrome | → `uiLocale` |
| "Step {n}" / "Why" | `workedExample.step` / `.why` | chrome | → `uiLocale` |
| "Continue" / "Start practice" / "Skip" | `teachingIntro.continue` / `.startPractice` / `.skip` | chrome | → `uiLocale` |
| "Solve one together" title | `guided.title` | chrome | → `uiLocale` |
| "your step" / "Check" / "expected" / "next step" | `guided.yourStep` / `.check` / `.expected` / `.nextStep` | chrome | → `uiLocale` |
| "not evidence" note | `guided.notEvidence` | chrome | → `uiLocale` |
| "Need help?" + action names + error | `help.*` | chrome | → `uiLocale` |
| worked example / guided problem / steps / explanation | AI payload (`explanation.*`, `guided.problem`, `step.prompt`, …) | **pedagogical content** | stays `locale` (activity language) |

No hard-coded UI strings were found; no generated content was converted
to the UI locale.

---

## 9. SECURITY

`POST /api/quizzes/localize-question`:
- `verifyAuth()` → 401;
- `verifyStudentAccess(authContext.userId, v.studentId, authContext.role)` → 403;
- `getQuizSession(v.quizId)` then `session.studentId !== v.studentId` → 404
  (ownership; a guessed `quizId` can't confirm another student's session);
- `session.questions[v.questionIndex]` absent → 404 (bounded index; zod
  `int().min(0)`);
- `targetLanguage` is `z.enum(LOCALES)` **and** re-checked with
  `isLocale()` → 400;
- the question is read from the **stored session**, never from the
  request body — the route accepts no question object;
- `optionOrder` is only a display hint: `toClientQuestion` validates it
  is a permutation of the question's own ids and appends any missing id,
  so it can neither drop nor invent a choice;
- writes nothing (no `storeQuiz`, no `INSERT`/`UPDATE`), does not touch
  `quiz_sessions`.

---

## 10. EVIDENCE INTEGRITY

The submit path (`generate-and-take` POST-with-answers) is **unchanged**:
it still reads `quizSession.questions` (the stored originals) and
`quizSession.language` (the stored original language) and grades against
them. Same-item localization is a client-side *presentation* swap:

- structured types — the learner's answer is an option **id**, identical
  across the translation, so it maps to the same canonical `correctAnswer`;
- free-text types — `correctAnswer` is unchanged and `gradeAnswer` is
  merits-based and language-tolerant (`language` there only sets the
  *feedback* language).

No new `learning_evidence`, no `updateMastery`, no KS recompute, no
operation-key change (one `quizId` ⇒ one batch ⇒ one `operationId`). A
confirmed restart is a distinct session/`operationId` exactly as in R1.
Mastery policy untouched. Known minor: for a free-text question localized
mid-quiz, the graded *feedback sentence* may render in the stored
original language — correctness and evidence are unaffected; full
per-question grading-language threading is LX-8.

---

## 11. TESTS

```
npx tsc --noEmit    clean
npx vitest run      180 files / 2630 passed
                    (+ tests/unit/lx4p-r2-same-item-localization.test.ts, 29 cases:
                     reconcileLocalization purity + NUMERIC/FORMULA/OPTION/EMPTY drift
                     rejection; LOCALIZABLE_ANSWER_FORMATS; TRANSLATE-ONLY prompt;
                     route auth/ownership/bounds/locale + read-only + fast-path;
                     client attempt-preservation (no quizId/index/answers/teaching
                     reset); R15 fallback; restore-on-return; free-text never
                     translated; R11 no teaching re-entry; R13 chrome/content split;
                     evidence path unchanged; i18n x5)
                    (lx4p-r1 + lx4r expectations updated for the extracted
                     toClientQuestion and the R2 flow)
npm run build       ✓ compiled; 96/96 static pages; new ƒ /api/quizzes/localize-question
```

Faithful-harness visual (auth + AI-keys constraint unchanged): the R15
fallback dialog renders correctly at 375 px over the dimmed, still-visible
question — honest title, "El idioma de la interfaz no cambia", ghost
Cancel + primary "Iniciar actividad nueva". Screenshot captured.
Dev-server note: Turbopack dev did not hot-register the new route
directory (same as `/api/learning/continue` in LX-5); `next build`
emits it (96/96) and it mirrors the working `contextual-help` / `verify`
guards line-for-line.

Not executed here (human — needs a real Clerk session + AI provider
keys): the same-item localization AI round-trip and the full production
acceptance run in §12.

---

## 12. PRODUCTION ACCEPTANCE CASE — expected result

Concept **Fuerza centrípeta**, flow MODEL → GUIDE → PRACTICE →
**Question 2/2 in Español** (numeric: 0.50 kg / 1.2 m / 4.0 m/s).

Change question language → **English**:
- `POST /api/quizzes/localize-question { questionIndex: current(=1), targetLanguage: 'en', optionOrder }`;
- server reads `session.questions[1]`, TRANSLATE-ONLY prompt, `reconcileLocalization` confirms 0.50 / 1.2 / 4.0 and any formula survive and the option-id set is intact;
- client swaps `questions[1]` only, `setQuizLanguage('en')`.
- Result: **still Question 2/2**, same numbers, same problem, same
  `correctAnswer`, same draft, **same `quizId`**, English stem/options,
  **no MODEL, no GUIDE, no restart**. StudyUS UI stays in the account
  language.

Change **English → Español**:
- `session.language === 'es'` ⇒ route fast-path, no AI ⇒ returns the
  reshaped stored original; client also restores from
  `originalQuestionsRef`.
- Result: the **exact same item** back in Spanish.

If the current item were `ordering` / `matching` / `classification`, or a
translation failed a drift check, the learner instead sees the R15
"start a new activity" dialog — never a silent swap.

---

# LX-4P-R2 — SAME-ITEM LOCALIZATION CERTIFICATION

## STATUS

PASS  *(code complete; tsc clean, vitest 2630 green, build 96/96)*

## SAME ITEM

On a successful localization these are all preserved (structurally copied
from the stored original, then re-validated):
`quizId` · question identity (`id`) · question index (`current`) ·
semantic content · every number & formula (multiset-equal, else the
translation is rejected) · `correctAnswer` · Response Contract inputs
(`type`, `expectedReasoningType`) · `difficulty` · `cognitiveLevel` ·
option id set & on-screen order.

## LANGUAGE SWITCH

Active question, localizable format, translation passes validation →
`questions[current]` is replaced in place, `quizLanguage` updated,
nothing else touched. Not localizable / provider error / drift / no
session → the LX-4P-R1 explicit-restart dialog with R15 copy; confirming
it starts a new session (the R1 path). Pre-item (setup) → switch
directly. Never a silent swap, never a silent restart.

## TEACHING LOOP

No MODEL/GUIDE re-entry. The localization path never sets `quizId`,
`teachingExperience` or `teachingStage`; `TeachingIntro`'s content effect
is keyed to `[conceptId, quizId]` and `quizId` does not change. A
completed teach-first stage stays completed.

## DRAFT

Preserved. No `setAnswers` / `setSingleChoice` / `setMultiChoice` /
`setTextAnswer` in the localization path; the per-question reset effect
(`[current, questions.length]`) does not fire because neither dep
changes. Structured selections stay selected (draft is an option id,
ids are immutable). Free-text answers are never sent for translation and
never modified.

## UI LANGUAGE

Authority: account `user_language_preferences.interface_language` → `GET
/api/language` → `locale` → `getMessages(locale)`. Now also drives
`TeachingIntro` / `GuidedPractice` / `ContextualHelp` chrome via a
`uiLocale` prop (R13).

## QUESTION LANGUAGE

Authority: the quiz session's question language (`quizSession.language`,
seeded from generation). Represented client-side as `quizLanguage`;
changed in place by same-item localization or regenerated on an explicit
restart. Drives question content, `TeachingIntro` content fetches, and
`ContextualHelp` content.

## FALLBACK

The LX-4P-R1 explicit restart is retained and is the safety path for
unsupported formats (`matching`/`ordering`/`classification`), provider
failure, parse failure, and any semantic-drift rejection. Copy switches
to R15's "can't change in place → start a new activity". A question is
never partially localized.

## SEMANTIC VALIDATION

`reconcileLocalization` (pure): non-empty stem; exact option-id set with
options rebuilt from the original (AI ids discarded); numeric-token
multiset equality over all display text; formula/LaTeX/operator-span
multiset equality. Every immutable field is *copied* from the stored
original, not trusted from the model. Any check fails → `{ ok:false }` →
restart fallback, no mutation.

## EVIDENCE INTEGRITY

Submit/grading path unchanged — runs on the stored original questions +
original language. One `quizId` ⇒ one batch ⇒ one `operationId`. No
evidence/mastery write from this path. Mastery policy untouched.

## MIGRATION REQUIRED

NO.

## PRODUCTION ACCEPTANCE

**Fuerza centrípeta**, MODEL → GUIDE → PRACTICE → **Q2 Español** →
switch **English**:
→ same **Q2**, same 0.50 kg / 1.2 m / 4.0 m/s, same answer, same draft,
same `quizId`, English content, **no MODEL / no GUIDE / no restart**, UI
stays in the account language.
Then **English → Español**:
→ the **exact same Q2** restored in Spanish (route fast-path, no AI).
No silent different Q1 in either direction.

## REPAIR COMMIT

`2dbcb82`

## NEXT STEP

Deploy `tmp/lx1` HEAD to production, then repeat the authenticated
production regression: Practice on Fuerza centrípeta → advance past
MODEL/GUIDE → Q2 in Español → switch to English (expect same Q2, English,
no teaching re-entry) → switch back to Español (expect same Q2). Also
verify an `ordering`/`matching` question shows the R15 dialog, and that
teaching chrome now renders in the account language while the worked
example stays in the activity language.

Nothing has been pushed to `origin/main`. Do NOT start LX-6.

STOP.
