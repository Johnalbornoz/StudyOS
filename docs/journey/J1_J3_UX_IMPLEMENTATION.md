# J1 / J3 — Institutional and independent exam entry UX (J1.3, J1.4, J3.3, J3.4, J3.5)

Branch `feat/student-exam-entry-ux`, base `9b56247` (J1.1/J1.2/J3.1/J3.2 foundation).

## Scope and gating

The entire UX is behind `STUDENT_JOURNEY_V2=UX`. Only that exact value counts:
- `SHADOW` keeps the J2 shadow behaviour and nothing else.
- `UX` also keeps the shadow hooks running.
- Any other value is OFF.

With OFF or SHADOW, Student v1 renders exactly as before. Each new entry point checks `isStudentJourneyUxEnabled()` in its own source, and a test enforces that.

**Not implemented (out of scope):**
- J3.6 EXAM_SCOPE (no subjects are created for Exam Targets)
- J3.7 target result / prediction UX
- G6 (cross-exam contamination fix)
- Blueprint session population
- `class_exam_assignments`
- prediction
- new mocks
- Question Bank changes

**No new migration.** The UX reuses `20261101_1000` when it is present. Without it, the UX falls back to the compatibility behaviour described under J3.4. No hosted DB writes were made.

## Routes

| Route | Change (UX only) |
|---|---|
| `/dashboard/profile` | **J1.3.** When the institution defines the path: the read-only "Tu ruta académica" card. The Student's own declaration sits in a separate "Información que indicaste tú" disclosure. A new learner with no profile and no target gets the **entry choice**. Otherwise the existing page. |
| `/dashboard/exam-prep` | **J1.4 / J3.5.** One card per target, active ones first, plus the "¿No sabes qué examen necesitas?" link and the existing direct chooser. |
| `/dashboard/exam-prep/[id]` | **J3.5.** Overview with three tabs: Resumen / Preparar / Resultados. Falls back to the existing preparation home when no resolution exists. |
| `/dashboard/exam-prep/discover` | **J3.3.** Guided "No sé qué examen necesito" flow. Returns 404 unless UX. |
| `PATCH /api/exam-preparation/[id]/schedule` | **J3.4.** The Student's own date facts. Owner-only; 404 unless UX. |
| Dashboard layout / nav | "Exámenes" becomes primary only while a target is in active preparation. |
| Onboarding gate, `/`, `/dashboard/onboarding` | An institutional path counts as READY (UX only). Before the profile is filled in, Exam Prep and Notifications are reachable (UX only). |

## J1.3 — "Tu ruta académica" (read-only)

- **Shown:** institution, programme, stage (with an "estimated" note when the grade was inferred), academic year, and subjects with level. Nothing is editable and no institution-owned fact is asked again.
- **PROGRAMME_UNMAPPED / INSTITUTION_CONTEXT_INCOMPLETE:** the programme reads "pendiente", followed by one neutral line: "Tu institución todavía está completando algunos datos de tu programa. Puedes seguir usando StudyUs mientras tanto." The Student gets no form and no code.
- **CONFLICT:** "Revisar información" opens both values side by side (institution / you) without choosing either. For an institution-internal conflict it opens an explanation instead. The Student's declaration lives in its own disclosure and never overwrites the institutional value: the resolver keeps the effective value empty.

## J1.4 — Programme ≠ Active Exam Target

When an institutional context exists, the Exam Prep list states that a programme is not an active preparation (`jx.inst.exams.note`). A target appears only when the Student chooses it or the institution assigns it. No target is ever derived from the curriculum.

Navigation prominence comes from `isActivePreparation`:
- phase ≥ ACTIVATION and the state is not RESULT_RECORDED, or
- an attempt is waiting to resume.

## J3.3 — Entry choice and exam selection

- **Entry choice** (on `/dashboard/profile`, new learners only): "Prepararme para un examen" → Exam Prep; "Seguir mi colegio o programa" → the existing academic-profile wizard (`?entry=curriculum`); "Mi colegio usa StudyUs" → Notifications, where invitations arrive. Subjects are never asked first.
- **"Continuar aprendiendo"** was adapted: a brand-new Student has nothing to continue, and the gate would redirect anyway.
- **Know my exam:** the existing direct chooser (`PreparationChooser`) with its audience and readiness rules. No technical exams.
- **Don't know:** one question per step: country → grade → destination (optional) → approximate month (optional, offered only when the schedule columns exist) → results.
  - At most three suggestions, taken only from the governed eligibility rules (country + grade). Only EXAM objectives are suggested.
  - Every suggestion carries TARGET_REQUIREMENT_UNCONFIRMED, shown as "Confirma con {institución} qué examen necesitas presentar." (or the generic copy).
  - The goal / university question decides nothing: no governed mapping exists. The destination only feeds that reminder, stored as `target_institution_name`.
  - If the exam is already a target, the flow links to it and never creates a duplicate.

## J3.4 — Dates

The resolver keeps the approved priority:
1. institution session
2. learner-selected official session
3. authoritative date
4. Student-reported `exam_date` (`STUDENT_REPORTED_EXAM_DATE`, never relabelled)
5. personal target date
6. estimated month (month precision, never a day)
7. UNKNOWN

The UI shows every known line with its own source label. Official wording is used only for authoritative sources.

**Date step:** one choice, then one input. The step asks only for the missing date and never re-asks the exam.

| Option | Behaviour |
|---|---|
| "Ya sé la fecha del examen" | Always offered. Writes the legacy `exam_date`. |
| "Quiero estar listo para una fecha" | Offered only when the migration columns exist. |
| "Sé el mes, pero no el día" | Offered only when the migration columns exist. |
| "Todavía no lo sé" | Writes nothing. The target stays valid. |

- **No official-session selector:** no session data is loaded.
- **API on an un-migrated database:** the personal date and the month return 409 `SCHEDULE_FIELDS_UNAVAILABLE` and are never faked.
- **Validation:** `validateTargetSchedule` runs on every write. A personal date after the sitting returns 400 `PERSONAL_DATE_AFTER_SITTING`, with its own copy.

## J3.5 — Overview (truthful only)

**Resumen**
- Phase and state in words.
- **One** next-action CTA (`presentNextAction`). Actions with no flow yet render as plain text, never as a dead button.
- Translated blockers.
- The "confirm with your institution" note.
- The date card with the date step.

**Preparar**
- Diagnostic.
- Practice links.
- Mocks, only when `mocksVisible` (the Journey says one can run). Labels say "reducido" or "completo" without any percentage. The "finish your activity" note shows when the mock is not startable, and the "we recommend reinforcing first" note shows when it is not recommended.
- Topics to reinforce, without status pills, counts or coverage.
- "Qué evalúa", as structure only.
- "Añadir a mi plan" creates a curriculum subject, so it is offered only to `ACADEMIC_PATH_DEFINED` learners (an EXAM_SCOPE dependency). Exam-only learners see "Practica estos temas en las actividades de esta evaluación."

**Resultados**
- The tab exists only when completed attempts exist (`AttemptHistory`).

**Never rendered**
- Readiness or coverage percentages, and status pills (G6).
- A prediction section or placeholder. `predictionVisible` is false for every resolution today, since the model class is NO_MODEL / PREDICTION_MODEL_UNAVAILABLE.

## Blocker mapping (`studentBlockerKeys`)

| Journey blocker | Student copy |
|---|---|
| BLUEPRINT_INCOMPLETE, BLUEPRINT_VERSION_INVALID | "Todavía no tenemos completa la estructura necesaria para preparar esta evaluación." |
| CONTENT_UNAVAILABLE (any scope, deduplicated) | "Todavía estamos preparando contenido suficiente para esta evaluación." |
| INSTITUTION_CONTEXT_INCOMPLETE | "Tu institución todavía está completando información de tu programa." |
| ACADEMIC_CONTEXT_CONFLICT | conflict copy (`jx.blocker.ACADEMIC_CONTEXT_CONFLICT`) |
| INSTITUTIONAL_RELEASE_REQUIRED | release copy |
| EXAM_DATE_UNKNOWN / SET_EXAM_DATE | no message: the date step itself, "¿Para cuándo quieres prepararte?" |
| TARGET_REQUIREMENT_UNCONFIRMED | "Confirma con tu institución qué examen necesitas presentar." (discovery and destination notes) |
| ATTEMPT_IN_PROGRESS | no message: the resume CTA |
| PREDICTION_*, NO_CONCEPT_MAPPINGS, TARGET_EXAM_UNCONFIRMED, CROSS_EXAM_EVIDENCE_RISK | silent (no Student action exists) |

## Multiple targets

Each card and each overview is resolved per target. Each one shows its own:
- date lines and sources
- state
- "Siguiente paso: …"
- blockers
- confirmation note

Readiness is never merged across targets and no aggregate is shown. Active targets are listed first.

## Institutional vs independent behaviour

| | Institutional (path defined) | Independent / exam-only |
|---|---|---|
| Gate | READY by the institutional path (UX only); the subject picker is never shown | READY by an exam target (J0) |
| Profile page | "Tu ruta académica", read-only; own declaration kept apart | Entry choice, then wizard or Exam Prep |
| Exam Prep | Programme ≠ target note; targets only when chosen or assigned | Direct chooser + guided discovery |
| "Añadir a mi plan" | Offered (existing behaviour) | Not offered (EXAM_SCOPE not implemented) |

## Navigation

"Exámenes" moves into the primary group only when `examPrepIsPrimary`, which requires at least one target in active preparation. It is never promoted for a distant HORIZON milestone or a mere target row. The check fails closed (secondary).

Not implemented: hysteresis. Today is **not** rewritten; it is documented as a follow-up.

## Tests

`tests/unit/journey-ux-entry.test.ts`, 45 tests:
- **Scenarios 1–12:**
  1. institution complete
  2. PROGRAMME_UNMAPPED
  3. conflict
  4. independent PAA without subjects (with an ADD_TO_PLAN control)
  5. no date (migrated and un-migrated options)
  6. personal date / month
  7. Student-reported date stays non-official
  8. multiple targets
  9. CONTENT_UNAVAILABLE / blueprint copy / silent technical blockers / no percentage
  10. prediction unavailable on every tab; Resultados only with attempts
  11. learning-only unaffected (nav equals v1, flag modes, gate unchanged without UX, Today untouched)
  12. a HORIZON target does not promote the nav
- **Schedule API:**
  - 404 with SHADOW
  - 409 without columns (nothing written)
  - legacy date stays STUDENT_REPORTED
  - PERSONAL_DATE_AFTER_SITTING
  - strict body (no official session, no target result, malformed month)
  - archived / foreign targets → 404
  - month provenance STUDENT_ENTERED
- **Copy:** every `jx.*` key in all 5 locales and reaching `getMessages`; no enum in any string; overview rendered in every locale without raw keys or enums; no percentage, coverage or StatusBadge in the new sources.

**Approved behaviour change.** In `tests/unit/journey-j2-shadow.test.ts`, the "shadow only" importer assertion becomes "only the shadow files **and** the flag-gated UX entry points / components import the journey". It is made stricter:
- the exact importer list is still asserted;
- every entry point must contain `isStudentJourneyUxEnabled()`;
- the two presentation components may only be imported by gated pages.

The shadow-hook, Today and inspection-API assertions are unchanged.

**Regression:** full unit suite 458 files / 7661 tests passed, `tsc --noEmit` clean, `next build` succeeded (includes `/dashboard/exam-prep/discover`).

## Manual browser validation

**Not performed.** It needs a signed-in Student against a database with the UX flag. Signing into hosted DEV is not allowed, and no local Clerk test identity was materialised in this phase. Validation is by render tests (`renderToStaticMarkup`) and route tests only. The CSS (`.jx-*`, tokens only, 44 px targets, 480 px stacking) was not visually checked at 390–1440 px or in dark mode.

## Known blockers / dependencies

- **G6:** no readiness % or coverage until cross-exam contamination is fixed.
- **EXAM_SCOPE (J3.6):** exam-only learners cannot add concepts to a plan.
- **J3.7:** no target result input and no prediction.
- **Blueprint sessions:** no official-session selector; no session dates.
- **Migration `20261101_1000`:** not on hosted environments. There, only the legacy exam date can be set (personal date and month are hidden; the API refuses them).
- **`class_exam_assignments`:** 0 rows on DEV. Institution-assigned targets only appear once assignments exist.
- **Discovery:** only country + grade rules exist (Saber 11, PAA, PISA). There is no governed goal → exam mapping.
- **Nav hysteresis and Today integration:** follow-ups.
