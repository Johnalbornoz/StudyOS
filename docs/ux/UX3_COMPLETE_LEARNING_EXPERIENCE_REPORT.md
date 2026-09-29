# UX-3: Complete Student Learning Experience

## At a glance

| Item | Value |
|---|---|
| Baseline | `UX3_BASELINE_SHA=bc0cc40`: `develop`, descends from the UX-2 certified SHA, equal to `origin/develop` and hosted DEV |
| Environment | DEV only |
| Migrations | None |
| Stage / Preview / Production | Not touched |
| Scope | Presentation and continuity of the Student learning journey. The canonical engine stays the sole authority: no rule, threshold, stage choice, scoring, generation or evidence change. |

## 1. Learning flow audit (as implemented)

**Routes**

- `/dashboard/quiz` (`quiz/page.tsx`, one client component) runs every activity:
  - `canonical_learn_check`, `topic_practice`, `review`
  - `canonical_prove`, `quick_check`
  - `canonical_retain`, `retention_check`
  - `canonical_transfer`
  - `diagnostic_check`, `cumulative_assessment`, `exam_simulation`
  - resumed verification
- `TeachingIntro` renders EXPLAIN, MODEL and GUIDE before practice, driven by the canonical `TeachingExperienceView`.
- `ContextualHelp` is the in-activity help (Practice modes only; the server gates it).
- `ContinuationPanel` gives the canonical next step (`/api/learning/continue`).
- `cognitive/explain` and `cognitive/transfer` are remediation-step activities; `remediation/[pathId]` is the repair-path overview.
- `/dashboard/tutor` is linked from Concept Mission.

**Authoritative fields consumed**

| Source | Fields |
|---|---|
| `generate-and-take` | `quizId`, `quiz.questions`, `language`, `resumed` (open session re-delivered), `alreadySubmitted` |
| Results | `canonicalResultsStatus`, `canonicalResults.{stage, requirements, actionState, nextEligibleAt}`, `proveSufficiency`, `transferResult` |
| Session check | `/session/[id]/check` (read-only LEARN_CHECK feedback) |
| Teaching | `teaching-intent` → `TeachingExperienceView` |

**Found**

1. Silent submit failure: `setError` was set, but the question view never rendered it.
2. Guided-step bypass: the "Ir directo a practicar" shortcut called `onDone()` and dropped a GUIDE stage the plan required.
3. A refresh lost every unsubmitted answer.
4. `alreadySubmitted` (the re-send after a lost response) was handled as `setResults(undefined)`: a blank screen.
5. Retain and Transfer were labelled "Demuéstralo". Loading said "Generando preguntas con IA…". The review screen said "Revisión del examen" after practice.
6. Single-choice options were plain buttons with no radio semantics. The reorder arrows had no accessible names. Controls were 28–34 px.
7. Tutor used a fixed `240px 1fr` grid (unusable at 390 px); a failed send silently lost the message.
8. Explain/Transfer remediation pages:
   - a failed submit replaced the page with a bare error, with no retry;
   - a network throw left them stuck on "submitting";
   - a failed generation had no retry.
9. GUIDE hung forever under React StrictMode's remount. The request's result was dropped, and the idempotency key stopped the re-run.
10. Audio controls were emoji glyphs in 30 px circles.

## 2. What changed for the Student

**One learning shell** (`.ls`, UX-2 tokens)

- **Header** (`SessionHeader`): experience chip, concept, subject, purpose line, position ("3 de 5", or "Aplicación cercana · 1/3" in Transfer).
- **Accents by kind:**
  - Prove: dark hero band, lime chip.
  - Retain: info blue.
  - Transfer / assessment: neutral outline.
  - Reinforce: warm.
- **Shared:** geometry, spacing (one 24 px card inset, 20/16 px on phones) and controls.
- **Exit:** stays in the Focus Mode bar.

**Vocabulary** (`lib/experience/learning-session.ts`, 5 locales). Internal enums are unchanged.

| Launched mode / step | Student sees |
|---|---|
| LEARN_CHECK | Compruébalo |
| Practice | Entrénalo |
| Repair step | Vamos a trabajarlo |
| Prove | Demuéstralo |
| Retain | ¿Todavía lo recuerdas? |
| Transfer | Aplícalo |
| Teaching steps | Entiéndelo · Míralo paso a paso · Ahora tú |

**Learn / Worked / Guided**

- Labelled stepper.
- Key-idea callout, sections at reading width, numbered worked steps.
- In GUIDE, the Student's step ("Tu turno") is clearly separate from the shown solution ("Así se hace" + "Por qué"), with "Paso n de N".
- A skipped reading step is never shown as done.

**Question and answer**

- The question is the heading.
- Options are `role="radio"` rows (whole row clickable, 52 px min, letter key, clear selected / focus / disabled states); multi-choice uses checkbox rows.
- Matching / classification use labelled 44 px selects that stack on phones; ordering uses 44 px labelled move buttons.
- Formulas scroll inside their own box.
- The answer composer is 16 px (no iOS zoom) and has a focus ring.

**Audio** (requested mid-phase)

- Read-aloud and dictation are 44 px line-icon controls: `Volume2` / `Mic`, a stop square while active, `aria-pressed`, a listening pulse (off under reduced motion).
- The speaker is centred on the question's first line (derived offset, measured 0 px).
- "Insertar matemática" is a 44 px tool button with a `Sigma` icon.

**Feedback** (LEARN_CHECK, server check only)

- Tones: Correcto (success), Casi (warning), Todavía no (neutral, non-punitive).
- A failed check says it is not a mistake and offers "Volver a comprobar" (read-only). The answer stays locked.

**Results**

- The headline comes from `resolveActivityOutcome`, which reads only the fresh canonical decision after the evidence write:

  | Condition | Headline |
  |---|---|
  | Stage `CONSOLIDATED` | Dominado |
  | This activity's requirement is `SATISFIED` | Lo tienes |
  | This activity's requirement is `UNSATISFIED` | Todavía no · Vamos a trabajarlo |
  | Anything else (WAITING, unavailable, legacy) | A neutral "…completado" |

- The score is a plain fact ("4 de 5 correctas · 80%").
- The canonical next step and its single Continue share one card.
- "Revisar respuestas" replaces "Revisar examen".

**Next action**

- Unchanged authority: the CTA re-reads canonical truth (`/api/learning/continue`).
- The label is the neutral "Continuar", so it can never disagree with what launches.

**Independent / Prove / Retain / Transfer**

- The support line states why help is off, once.
- Each kind has its own purpose line and accent. Retain is no longer labelled "Demuéstralo".

## 3. Bugs fixed

| # | Bug | Fix | Proof |
|---|---|---|---|
| A | Silent submit failure | Classified as NETWORK / SERVER / EXPIRED. Visible `role="alert"`. Answers kept. "Reintentar envío" re-sends the same set. `submittingRef` guard against double submission. Inputs frozen while in flight. Never shown as incorrect. `alreadySubmitted` → an honest "ya estaban registradas" state plus the canonical continuation. | Real DEV session: an injected network failure on the final submit showed the alert and Retry; the real retry succeeded. Unit tests. |
| B | Guided-step bypass | `teachingSkipTarget`: the shortcut jumps to the next GUIDE in the canonical plan and ends teaching only when no GUIDE remains. Labelled "Ir al ejercicio guiado" when that is where it goes. | Fixture: EXPLAIN → shortcut → "Ahora tú". Unit tests plus a mutation check (restoring `onClick={onDone}` fails the suite). |
| C | Refresh loses state | Safe continuity (section 4). | Real DEV session: reload restored the selected option with "Retomamos donde lo dejaste". |
| D | Tutor at 390 px | Below 1024 px one pane at a time (list ↔ conversation, "← Conversaciones"), `100dvh`-based height, 16 px input, `role="log"`. A failed send restores the text and shows an alert. A failed list load has a retry. | 390 px screenshots and stubbed send failure. |
| E | GUIDE hangs on remount | The cleanup releases the idempotency key when it drops a response. | Fixture (dev StrictMode). |
| F | Explain/Transfer remediation failures | Generation: Retry plus back-to-concept. Submit: the text is kept, the alert shows, and Retry re-sends with the same `activityId` (the server's evidence idempotency key). No stuck "submitting". | Unit tests. |

## 4. Session refresh / resume

**Preserved**

- Which question the learner is on.
- Answers already entered for earlier questions.
- The in-progress answer: choice, multi-choice, text/math document, matching, ordering, classification, confidence.
- A LEARN_CHECK answer already checked stays locked.
- Presentation/answer timestamps the client had already stamped.

**How it's kept safe**

- `sessionStorage` (gone when the tab closes), key `studyus.learnDraft.v1:<studentId>:<quizId>`.
- A draft is restored only when the server re-delivers the same open session (same `quizId`) and a content fingerprint of its questions matches.
- Other students' drafts are purged on read. Drafts older than 6 h are discarded.
- Cleared on results, `alreadySubmitted`, or an expired session.
- Priority: server state first. A draft only refills inputs; it never scores, submits, advances or creates a session.

**Not preserved**

- Legacy, non-canonical launches that mint a new `quizId` on reload: no draft matches, so nothing is restored. That is safe by design.
- Help-panel contents and teaching-stage position within EXPLAIN/MODEL. A learner who had reached the questions returns to them.
- Unsubmitted work across devices or tabs. That would need server-side drafts (GAP-04, B-level); not built.

## 5. Backend and security

- **No backend changes.** No migrations.
- The UX-2 ownership fixes (readiness exam profile, practice-exam start) are untouched.
- No new routes were trusted with object ids. UX-3 uses the existing learning APIs unchanged.

## 6. Validation

**Real authenticated DEV data** (signed-in student, local server on the DEV database, concept "Regla de tres compuesta")

- A real LEARN_CHECK end to end: single-choice, multi-choice, two free-text math answers, help menu, and correct / not-yet feedback with a "Piensa en esto" direction.
- Refresh continuity restored the selection in the same server session.
- The injected submit failure, then a real retry.
- Result: 4/5 (80%). The engine kept LEARN `UNSATISFIED`, so the page correctly said "Todavía no" with the canonical next step "Repasemos juntos la idea principal". A client-side score threshold would have celebrated here.
- Draft cleared on completion.

**Deterministic harness (not real data)**

- States the student cannot reach today: teach-first EXPLAIN/MODEL/GUIDE, Practice with long options and wide formulas, Prove (satisfied / not yet), Retain, Transfer through to Mastered, `alreadySubmitted`, generation error, and the Tutor send failure.
- Built as a temporary dev-only route that rendered the real `QuizPage` behind a client-side fetch fixture (no server writes, no AI calls). Deleted before commit.

**Device matrix**

Checks per cell: iframe at exact CSS width; page overflow, controls under 44 px, clipped chips/buttons/labels, raw enums or untranslated keys, header/card content-edge alignment (0 px); plus screenshots.

| Surface | 1440 | 1024 | 768 | 430 | 390 |
|---|---|---|---|---|---|
| Learn / Explain / Worked / Guided | PASS | PASS | PASS | PASS | PASS |
| Practice (+ ordering / matching / math / confidence) | PASS | PASS | PASS | PASS | PASS |
| Feedback (LEARN_CHECK, real) | PASS | PASS | PASS | PASS | PASS |
| Prove | PASS | PASS | PASS | PASS | PASS |
| Retain | PASS | PASS | PASS | PASS | PASS |
| Transfer | PASS | PASS | PASS | PASS | PASS |
| Tutor / help | PASS | PASS | PASS | PASS | PASS |
| Error / retry | PASS | PASS | PASS | PASS | PASS |

**Other checks**

- **Dark mode:** Prove question, Prove result, options and selected state checked at 390 px with the app's own dark tokens.
- **Locales:** ES / EN / DE / FR / PT on practice, Prove and teaching at 1440 and 390: correct kind chip, no raw enum or key, no clipping. German fits (step labels wrap cleanly, with no hyphenation).

**Precision defects found and fixed: 21**

1. The kind chip stretched full width in the preparing state.
2. The support note was a boxed emoji banner, duplicating the header.
3. The help trigger's text started 7 px off the content edge.
4. The not-yet feedback was the same green as correct.
5. The question broke early under balanced wrapping (also teaching and outcome titles).
6. The skipped MODEL step was shown as done.
7. The teaching card repeated the stepper chip.
8. The confidence buttons had unequal widths.
9. Inner edges were misaligned between the outcome card (32 px) and the next-step card (24 px).
10. The ghost secondary actions started inside the column edge.
11. The outcome heading showed a focus box on programmatic focus.
12. Focus went to the hidden Continue heading instead of the outcome.
13. Transfer step numbers were not centred on their first line (now a derived offset).
14. The question-language select was 32 px.
15. The teaching shortcut button was 32 px.
16. The composer was 14 px, triggering iOS zoom.
17. The composer had no focus indicator.
18. Guided / form inputs were 15 px on touch devices.
19. The reorder buttons were 28 px with no names.
20. The audio controls were 30 px emoji.
21. Two "no help" lines were stacked.

**Accessibility**

- Question heading; radio/checkbox semantics; labelled selects and reorder buttons.
- Live regions: feedback (`role="status"`), errors (`role="alert"`), Tutor log.
- Focus moves to the outcome; `aria-pressed` on audio controls; visible focus everywhere; 44 px targets.
- Reduced motion honoured.

## 7. Tests and gates

- New: `tests/unit/ux3-learning-experience.test.ts` (34 tests).
- Source guards in 11 existing test files were realigned to the new structure, each asserting the same invariant, never weakened.
- Full vitest, `tsc --noEmit`, and `next build`: see the final certification.

**E2E not run:** `npm run test:e2e` (`scripts/e2e-cognitive-loop.ts`) is a service-level cognitive loop:

- it makes real AI calls;
- it inserts and then DELETEs rows in the database its env file points at;
- UX-3 changed no backend behaviour, so it would certify nothing here.

## 8. Remaining gaps (not implemented)

**B-level (backend support)**

| Gap | What's missing | Consequence today |
|---|---|---|
| GAP-01/02 | A decision reason / strategy-change field | "Probemos de otra manera" is never shown |
| GAP-03 | Per-question misconception | — |
| GAP-04 | Server-side drafts, for cross-device resume | — |
| Tutor page title | Still says "Tutor IA" (outside the learning shell) | — |

**C-level / model changes (out of scope):** prerequisite unlocks, topic readiness, gamification, persisted stage transitions, SOLO_VERIFY changes.
