# STUDYUS — PRODUCTION HOTFIX
## LX-4P-R1 — ACTIVE ATTEMPT LANGUAGE INTEGRITY — REPORT & CERTIFICATION

Branch: `tmp/lx1`
Hotfix commit: `8d3c6ba`
Builds on: `04c8f11` (LX-5R doc) / `4dc5f5a` (LX-5R impl).

Teaching loop is NOT touched. Adaptive Teaching is NOT redesigned.
LX-8 multilingual architecture is NOT implemented. LX-6 not started.

---

## 1. LANGUAGE SELECTOR CONTRACT — BEFORE

`/dashboard/quiz` has exactly one language control (`src/app/dashboard/
quiz/page.tsx`, the corner `<select>` on the questions stage).

| Layer | Value used | Source |
|---|---|---|
| Selector state | `quizLanguage` (`useState<Locale>('en')`) | set from `genBody.data.language` after generation |
| Selector label | `t['quiz.languagePickerLabel']` = **"Idioma de las preguntas" / "Question language"** | — |
| UI chrome / `t` | `locale` (`useState<Locale>('es')`) | `GET /api/language` → `user_language_preferences.interface_language` |
| concepts list fetch | `locale` | `?language=${lang.locale}` |
| quiz session language | `quizLanguage` | `resolveLanguageForSubject` / explicit override (`generate-and-take` route) |
| generation request | `quizLanguage` (via `generateQuiz(language)`) | — |
| teaching-intent request | — (no language param) | keyed by `quizId` |
| ConceptExplanation request (`TeachingIntro`) | `quizLanguage` (`locale` prop) | `?language=${locale}` |
| guided-practice request (`TeachingIntro`) | `quizLanguage` | `{ language: locale }` |
| contextual-help request (`ContextualHelp`) | `quizLanguage` (`locale` prop) | `{ language: locale }` |
| question generation | `quizLanguage` | generator receives `language` |
| grading | quiz session's stored `language` | `quizSession.language` in `generate-and-take` |

**Contract answer: B — question/content language.** The label already
says so; `setLocale` is never called from this control. UI language is a
distinct account setting the selector does not touch.

The three-context schema already exists (`user_language_preferences`:
`interface_language`, `preferred_learning_language`, `source_language`) —
LX-4P-R1 does not extend it. It only stops one code path from treating
`quizLanguage` as a free, silent, mid-attempt regenerate trigger.

The "mixed language" production observation (Spanish "Con ayuda
disponible" / "QUÉ SE TE PIDE" beside English question content) is the
**intended** split — UI chrome follows `locale` (the account's Spanish),
content follows `quizLanguage` (English) — surfacing only because the two
contexts legitimately diverged and nothing told the learner. Not changed
here beyond the honest dialog copy; the full model is LX-8.

---

## 2. ROOT CAUSE

`changeQuizLanguage(next)` did, unconditionally:

```
setSwitchingLanguage(true) → await generateQuiz(studentId, next) → …
```

and `generateQuiz`:

```
POST /api/quizzes/generate-and-take { language: next }   // a NEW generation
setQuizId(genBody.data.quizId)        // NEW session id
setQuizLanguage(genBody.data.language)
setQuestions(genBody.data.quiz.questions)   // NEW, unrelated question batch
setCountAuthority(…)
setCurrent(0)                          // ← 2/2 collapses to 1/2
setAnswers({})                         // ← any draft wiped
setResults(null); setReviewing(false)
setTeachingExperience(null); setTeachingStage('questions')
setPhase('quiz')
+ re-fetch teaching-intent for the new quizId
```

So a language change = **a brand-new quiz session with brand-new
generated questions and a reset index**, at any stage. The observed
"Question 2/2 conceptual → Question 1/2 numeric" is exactly this: a
different generated batch, index back to 0. It never translated the
current item because no code path can — see §4.

---

## 3. ATTEMPT IDENTITY AUDIT — BEFORE vs AFTER

For the production case (on Q2 of `[Q1, Q2]`, Español):

| Field | BEFORE — switch to English | AFTER — switch to English |
|---|---|---|
| `quizId` | new id (new `quiz_sessions` row) | **unchanged** until the learner confirms; on confirm → new id (explicit new session) |
| generated item identity | replaced (different questions) | **unchanged** until confirm |
| `current` index | reset to `0` (2/2 → 1/2) | **unchanged** (`pendingLanguageSwitch` set; no state reset) |
| `evidenceMode` | recomputed for new session | unchanged |
| `ActivityType` / `quizMode` | fixed at mount — unaffected either way | unchanged |
| `ResponseEvidenceContract` | recomputed from the new question | unchanged (same question) |
| `expectedReasoningType` | from the new question | unchanged |
| draft answer (`singleChoice`/`textAnswer`/…) | wiped by the `[current, questions.length]` reset effect | **unchanged** (no deps changed) |
| `answers` map | `{}` | unchanged |
| help telemetry (`ContextualHelp`) | orphaned (keyed to old `quizId`/`current`) | unchanged (same `quizId`/`current`) |
| teaching stage | reset to `questions`, teaching-intent re-fetched | unchanged |

On **confirm**, AFTER behaves like BEFORE by design — but only after an
explicit "this starts a new session" the learner accepted.

---

## 4. CHOSEN SAFE STRATEGY — **ACTIVITY LANGUAGE LOCK + EXPLICIT RESTART** (Option B)

**Why not Option A (same-item localization):** StudyUS has no mechanism
to translate an existing generated question while preserving its
semantic/numeric parameters, distractors, `correctAnswer`,
`ResponseEvidenceContract`, `expectedReasoningType` and intrinsic
difficulty. The only translation service (`src/services/
localization.service.ts`) batch-translates **short display labels**
(topic/concept names) and explicitly not structured question objects.
Building an ad-hoc AI question translator in a hotfix is out of scope and
risky (silent semantic drift, answer-key mismatch).

**Implemented (`src/app/dashboard/quiz/page.tsx`):**

- `changeQuizLanguage(next)`:
  - `if (!studentId || next === quizLanguage) return;`
  - **`if (phase === 'quiz') { setPendingLanguageSwitch(next); return; }`** —
    an active attempt (item on screen, or a teach-first stage) never
    regenerates silently. The `<select>` is controlled by
    `value={quizLanguage}`, so it visually snaps back on its own.
  - else (`setup` / pre-item) → `void regenerateInLanguage(next)` — safe,
    no learner-facing item to disturb.
- `regenerateInLanguage(next)` — the **only** wrapper that calls
  `generateQuiz(studentId, next)` for a language change; reached pre-item
  or from confirm.
- `confirmPendingLanguageSwitch()` — `const n = pendingLanguageSwitch;
  setPendingLanguageSwitch(null); if (n) void regenerateInLanguage(n);`
- Confirm modal (`role="dialog"`, `aria-modal`), gated on
  `pendingLanguageSwitch`, rendered over the (still-visible, dimmed)
  question:
  > **¿Cambiar el idioma de las preguntas?**
  > Empezarás una nueva sesión de práctica en {lang} y se perderá tu
  > progreso en esta actividad. El idioma de la interfaz de StudyUS no
  > cambia.
  > [ Cancelar ]  [ Empezar en {lang} ]
- 4 i18n keys `quiz.langSwitch.{title,body,cancel,confirm}` × es/en/de/fr/pt
  (`{lang}` = `LOCALE_NAMES[next]`).

Nothing regenerates without `confirmPendingLanguageSwitch`. No silent
reset.

---

## 5. UI LOCALE vs ACTIVITY LANGUAGE — SEPARATION IMPLEMENTED

| Context | Authority | Notes |
|---|---|---|
| **UI copy** (Exit, Continue, "Need help?", "What's being asked", Check, Skip to practice, Show me an example, the confirm dialog itself, progress `n/n`) | `locale` — the account's `interface_language` via `t = getMessages(locale)` | not affected by the question-language selector |
| **Pedagogical content** (generated question, worked example, guided-practice problem/steps, generated explanation, diagram caption, contextual-help content) | `quizLanguage` — the quiz session's question language | latched for the attempt |

`setLocale` is never called from `changeQuizLanguage` /
`regenerateInLanguage` / `confirmPendingLanguageSwitch` (asserted by
test). The selector's `aria-label`/`title` = "Idioma de las preguntas /
Question language" and the dialog states plainly that the interface
language does not change. The smallest explicit distinction for safety;
the full LX-8 model (UI / instruction / target / question / expected
response / locale-accent) is deferred.

---

## 6. TEACHING LOOP — MODEL / GUIDE / PRACTICE

- The teach-first stage renders **only** on the questions/teaching stage;
  `TeachingIntro` has no language control of its own. There is no
  in-stage switch affordance during MODEL or GUIDE (spec tests 5–6 are
  N/A by construction — the only switch surface is the questions stage).
- `TeachingIntro`'s content-load effect deps are **`[conceptId, quizId]`**,
  not `locale`. A UI-locale change alone never regenerates the worked
  example or guided practice. (asserted)
- All three stages consume `quizLanguage` for content; latching it keeps
  MODEL → GUIDE → PRACTICE in one consistent activity language for the
  attempt's life.
- A confirmed restart re-enters the loop cleanly (new `quizId` →
  `TeachingIntro` reloads in the new language, then PRACTICE).

---

## 7. CONTEXTUAL HELP — LANGUAGE + QUESTION IDENTITY

`ContextualHelp` (`src/app/dashboard/quiz/ContextualHelp.tsx`) posts only
`{ studentId, quizId, questionIndex, action, language: locale }` to
`/api/learning/contextual-help`. It never calls `generate-and-take`,
never `setQuestions`, never mints a quiz. With the language selector no
longer changing `quizId`/`current` mid-attempt, every help action (hint,
example, reminder, another explanation, first step) is bound to the same
question. Help content uses `quizLanguage`; the surrounding labels use
`locale`.

---

## 8. EVIDENCE INTEGRITY — RESULTS

Audited against R5's failure list:

| Risk | Before | After |
|---|---|---|
| reuse same `quizId` with different questions | **No** — `generateQuiz` mints a fresh `quizId` for the new batch | No |
| evidence against a replaced question set | No — submission always uses the current-session `quizId` from state; the abandoned session had nothing submitted | No |
| reset index while retaining prior answers | **No** — `generateQuiz` does `setCurrent(0)` and `setAnswers({})` together | No (nothing resets pre-confirm) |
| duplicate evidence | No | No |
| operation-key collisions | No — operation key is `(operationType, operationId, conceptId)`; each session is a distinct `operationId` | No |
| mixed batches in one evidence write | No — one `quizId` ⇒ one batch | No |

The pre-hotfix bug did not corrupt persisted evidence (each switch was a
clean new session; grading is per-`quizId`). It corrupted the **learner
experience** — silent item substitution and progress loss. No
mastery-policy change. Minor: an abandoned `quiz_sessions` row per
pre-confirm switch is now avoided (the switch no longer regenerates until
confirmed).

---

## 9. LX-5 COMPATIBILITY

`Concept Mission → Learn → Continue Learning → canonical session → MODEL →
GUIDE → PRACTICE` is unchanged. LX-5 continuation enters `/dashboard/quiz`
via the same `launchTarget` params; `changeQuizLanguage`'s new gate only
adds a confirm step for a mid-attempt language change and never touches
continuation, `ContinuationPanel`, or the results view. LX-5R Transfer /
Focus-Mode-origin work untouched. Full LX-5 + LX-5R test files still green.

---

## 10. TESTS

```
npx tsc --noEmit    clean
npx vitest run      179 files / 2601 passed
                    (+ tests/unit/lx4p-r1-language-integrity.test.ts, 12 cases:
                     R2/R3 identity, R4 no-silent-regen + confirm modal,
                     R5 evidence, R6 UI-vs-content split, R7 teaching deps,
                     R8 contextual-help identity, i18n x5)
npm run build       ✓ compiled; 95/95 static pages
```

Faithful-harness visual (auth constraint unchanged — no real Clerk
session / AI keys here): the confirm modal renders correctly at 375 px
over the dimmed, still-visible question — 2/2 preserved behind it, honest
body copy incl. "El idioma de la interfaz de StudyUS no cambia", ghost
Cancel + primary "Empezar en {lang}". Screenshot captured.

Spec test matrix — expected behaviour after the hotfix:

| # | Scenario | Result |
|---|---|---|
| 1 | Español → English during Q1 | confirm dialog; Q1 unchanged unless confirmed |
| 2 | English → Español during Q2 | confirm dialog; **Q2 stays Q2**, index stays 2/2 unless confirmed |
| 3 | switch after a draft typed | draft preserved on cancel; on confirm the learner was warned progress is lost |
| 4 | switch after using contextual help | help stays bound to the same `quizId`/index; dialog on switch |
| 5 | switch during MODEL | N/A — no switch affordance on the teach stage |
| 6 | switch during GUIDE | N/A — same |
| 7 | switch during PRACTICE | confirm dialog; no silent regen |
| 8 | Prove / INDEPENDENT mode | same gate; confirm → fresh INDEPENDENT batch (correct) |
| 9 | page refresh | server re-serves the session in its own `language`; UI chrome in `locale` |
| 10 | LX-5 Learn → Continue entry | unaffected; enters PRACTICE, gate applies as normal |
| 11 | no duplicate evidence | one `quizId` ⇒ one batch; confirmed restart = distinct `operationId` |
| 12 | no stale draft applied to a different question | pre-confirm nothing changes; confirm = full new session, drafts cleared with index |

Runtime execution of 1–12 against production is a **human** step
(authenticated session + AI keys) — see NEXT STEP.

---

## 11. HOTFIX COMMIT

`8d3c6ba` — `fix(lx): LX-4P-R1 -- language change must not silently replace the active item`

Files: `src/app/dashboard/quiz/page.tsx`, `src/lib/i18n/messages.ts`
(+4 keys ×5), `tests/unit/lx4p-r1-language-integrity.test.ts` (new).
No migration.

---

# LX-4P-R1 — ACTIVE ATTEMPT LANGUAGE INTEGRITY CERTIFICATION

## STATUS

PASS  *(code complete; tsc clean, vitest 2601 green, build 95/95)*

## ROOT CAUSE

`changeQuizLanguage` unconditionally called `generateQuiz(language)`,
which mints a new `quizId`, replaces `questions[]`, and runs
`setCurrent(0)` + `setAnswers({})`. A language change was therefore a
full new quiz session with a different generated question batch and a
reset index (2/2 → 1/2), at any stage — never a translation of the
current item (no same-item localization exists).

## ACTIVE QUESTION IDENTITY

Now preserved. While `phase === 'quiz'`, `changeQuizLanguage` only sets
`pendingLanguageSwitch` and returns — no `setQuizId`, no `setQuestions`,
no `setCurrent`, no `setAnswers`. `quizId`, generated item, current
index, `ResponseEvidenceContract`, `expectedReasoningType` and any draft
are untouched until the learner confirms.

## LANGUAGE SWITCH

Mid-attempt: a `role="dialog"` confirm — "Empezarás una nueva sesión de
práctica en {lang}… El idioma de la interfaz de StudyUS no cambia." —
[Cancelar] leaves everything as-is (the controlled `<select>` snaps
back); [Empezar en {lang}] calls `regenerateInLanguage`, the sole path
that mints a new session for a language change. Pre-item (setup): switches
directly, nothing to disturb. No silent regeneration anywhere.

## UI LANGUAGE

Authority: the account setting `user_language_preferences.
interface_language`, read via `GET /api/language` into `locale`, consumed
as `t = getMessages(locale)`. Not changed by the question-language
selector (`setLocale` is never called from it).

## ACTIVITY LANGUAGE

Authority: the quiz session's question language, held client-side as
`quizLanguage` (seeded from `genBody.data.language`; server resolves via
`resolveLanguageForSubject` / explicit override). Latched for the life of
the attempt; drives question content, `TeachingIntro` (MODEL/GUIDE) and
`ContextualHelp` content.

## TEACHING LOOP

Intact. MODEL → GUIDE → PRACTICE unchanged. `TeachingIntro` content load
is keyed to `[conceptId, quizId]` (not `locale`), so a UI-locale change
never regenerates a stage. No switch affordance exists during MODEL/GUIDE
(questions stage only). A confirmed restart re-enters the loop in the new
language.

## EVIDENCE INTEGRITY

No corruption before or after. One `quizId` ⇒ one question batch;
answers submit against the current-session `quizId`; a regenerated
session is a distinct `operationId`. `generateQuiz` resets index and
answers together (no index-reset-with-retained-drafts). Mastery policy
untouched.

## MIGRATION REQUIRED

NO.

## PRODUCTION REGRESSION CASE

Canonical Practice, `questions = [Q1, Q2]`, learner on **Q2, language =
Español** (conceptual "car on a curve / centripetal vs centrifugal"
item).

Change selector → **English**:

- BEFORE: active attempt silently became `Question 1/2` of a *different*
  batch (numeric "0.50 kg / 1.2 m / 4.0 m/s") — new `quizId`, index reset.
- AFTER: a confirm dialog appears. **Q2 stays Q2**, index stays `2/2`,
  `quizId` unchanged, draft (if any) intact. Nothing regenerates. Only if
  the learner presses **"Empezar en English"** does a new session start —
  and they were told that explicitly.

There is NO silent new/different Q1.

## HOTFIX COMMIT

`8d3c6ba`

## NEXT STEP

Deploy `tmp/lx1` HEAD to production, then repeat the exact authenticated
language-switch regression test:

1. Start canonical Practice on a supported concept (e.g. Fuerza
   centrípeta), advance to Q2 in Español.
2. Change the question-language selector to English.
3. Confirm: the confirm dialog appears; on Cancel, Q2 and 2/2 are
   unchanged; on "Empezar en English", a new session starts and the
   dialog's warning matched what happened.
4. Repeat switching during MODEL/GUIDE is unreachable; during PRACTICE it
   is always gated.

Nothing has been pushed to `origin/main`. Do NOT start LX-6.

STOP.
