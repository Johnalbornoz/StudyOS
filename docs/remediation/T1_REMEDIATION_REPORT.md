# T1 Remediation Report — Account & Academic Profile

> Status of this pass: **IMPLEMENTED → TECH_PASS → DEPLOYED_DEV**. Not DONE: manual re-test (MANUAL_RETEST) and regression sign-off by the product owner are next.
> No T2/T3/T4/T7/T8/T10 issues were remediated. Stage/Preview and Production were not touched.

## A. Baseline

| | |
|---|---|
| Starting SHA | `2e68756` (`fix(qb): streamline academic review workspace`), exactly what hosted DEV served (`dpl_AwPHMi1UaKcv2hJB42w8gFQigE45`, meta `studyosCertifiedSha=2e68756`) |
| Branch | `remediation/t1-account-profile` (new worktree from `2e68756`; the `develop` Git matcher is stale at `92e3509`) |
| Migrations before | 66 governed files in `database/migrations` (last `20261105_1100_safety_signal_routing`); DEV ledger had 0 pending |
| Test baseline | 480 files / **8454 tests passing**; `tsc --noEmit` clean |
| DEV database | fingerprint `2a29b99ee14a22b4` (verified before every DB action) |

## B. Code changes

### REM-T1-01 — Auth / session / onboarding shell (STU-E2E-003, -004, -006, -007)
- `src/proxy.ts` + `src/lib/auth/protected-routes.ts`:
  - Unauthenticated requests for `/dashboard/**`, `/role-select` and `/account/**` are redirected to the app's `/sign-in?redirect_url=…` before any Server Component renders.
  - `/account-suspended` is not matched.
- `src/app/dashboard/layout.tsx`:
  - A defensive `redirect('/sign-in')` when there is no session.
  - Computes the Student onboarding stage. While it is not READY, the shell renders `chrome="onboarding"`.
- `src/app/dashboard/LearnerShell.tsx`: new `onboarding` chrome with StudyUs brand, language selector and **Sign out** only. There is no Home, Learn, Progress, My Plan, Exam Prep, Study Plan, Improve or Account navigation.
- `src/components/auth/SignOutAction.tsx`: Clerk-native `signOut({ redirectUrl: '/sign-in' })`. It is also added to `/role-select` and `/account/change-password`.
- Route gating stays in the proxy and is re-evaluated on every request, so a refresh cannot bypass it. Notifications are gated like the rest.
- i18n: `common.signOut` and `onboarding.shellLabel` in es, en, de, fr and pt.

### REM-T1-02 — Student context model (STU-E2E-008, T1.25, T1.26)
- `students.student_context_type` (`ACADEMIC` | `EXAM_PREP` | NULL): see section C.
- `src/lib/student/student-context.ts`: `effectiveContextType`. A stored choice wins. Otherwise a completed profile means ACADEMIC, an exam target alone means EXAM_PREP, and anything else means "not chosen".
- `/dashboard/start` (`page.tsx` + `StudentContextChoice.tsx`): "What best describes your current situation?". One click saves the choice and navigates.
- `POST/GET /api/student/context` and `src/services/student-context.service.ts`: only `UPDATE students SET student_context_type`. Roles, profiles and memberships are never touched.
- Gate (`src/lib/student/onboarding-gate.ts`, `.server.ts`):
  - New stage `CONTEXT` sends the Student to `/dashboard/start`.
  - New stage `EXAM_TARGET` sends them to Exam Prep. School, grade and curriculum are never asked; the profile stays optional.
  - The existing J0 rule "a valid exam target means READY" keeps giving both contexts Learn and Exam Prep.
  - Callers that predate the context model, and `STUDENT_JOURNEY_V2=UX` (which has its own EntryChoice), keep their exact behaviour.
- The exam-prep path reuses the existing objective-first Exam Definition catalogue (`ObjectivePicker`, framework → exam / subject level → preparation). No parallel catalogue was added.

### REM-T1-03 — Context-aware final step (STU-E2E-012)
- `src/lib/exam-core/catalog/programme-sessions.ts`: governed, versioned (2026-10-09) and sourced session configuration.
  - IB Diploma: May / November.
  - Cambridge IGCSE / Upper Secondary / Advanced / AICE Diploma: February/March (India only), May/June, October/November.
  - Programmes are matched by their exact catalogue name. IB's model is not copied to Cambridge.
- `src/lib/student/time-context.ts`:
  - Model per programme: an exam session, or a school year. The school year is a split year ("2026–2027") or, for Colombia's calendar-year system, a single year ("2026").
  - Controlled options: for a school year, the current and the next year; for an exam session, the next 4 sittings.
  - Server acceptance: the value must be one of the options, or exactly the stored value.
  - Structured columns plus canonical text. Legacy values are parsed when they are unambiguous.
- Wizard final step: option buttons only (no free text). API `POST /api/academic-profile` accepts `timeContext`, validates it (`TIME_CONTEXT_INVALID`, 400) and writes the structured columns and the canonical `academic_year` text in the same transaction (both save paths).
- Edit preload: structured values first, then legacy text when it parses. Text that does not parse is shown ("Saved value: …") and never rewritten.

#### REM-T1-03 targeted correction — Cambridge exam-series governance (`programme-sessions.ts` v2026-10-09.2)
- Canonical series are the awarding body's own names: IB `MAY` / `NOVEMBER` (unchanged); Cambridge `MARCH` / `JUNE` / `NOVEMBER`. Feb/Mar, May/Jun and Oct/Nov are calendar windows, not identifiers.
- Availability is resolved by programme, qualification, syllabus (where known), region and year (`availableSeries`):
  - June and November are offered everywhere.
  - March is restricted and needs both positive facts:
    - a governed region rule (India, Romania, from 2026) for that country and year;
    - every selected syllabus is known and lists March.
  - So India 2027 with a known March-enabled syllabus gives March / June / November; India 2027 with no syllabus known, or any unknown syllabus, gives June / November; Mexico gives June / November.
  - Governed qualification exclusions and per-syllabus availability remove series. The rule is conservative: a series must be available for every known selected syllabus.
  - No syllabus overrides are governed yet, and catalogue subjects carry no syllabus code. The programme-level availability therefore applies, which never offers an unsupported series.
- Backward compatibility: the legacy identifiers `FEB_MARCH`, `MAY_JUNE` and `OCT_NOV` are read as `MARCH`, `JUNE` and `NOVEMBER` and are never rewritten. New writes are canonical only (API enum `MAY` / `NOVEMBER` / `MARCH` / `JUNE`).
- Migration `20261106_1100_exam_series_canonical.sql` only widens the CHECK (canonical values plus legacy values). It was applied to DEV, where no row stored a series yet.

### REM-T1-04 — Academic Profile propagation (STU-E2E-013)
- One resolver: `src/lib/student/student-context.server.ts` → `loadResolvedStudentContext`.
  - Returns context type, programme, qualification, and profile subjects with their exact variant ("Mathematics: analysis and approaches · HL").
  - Returns the learner-catalog key for each subject (exact name, the part before ":", or the canonical subject).
  - Returns `knownLevels` (HL/SL). An ambiguous level is never guessed.
- "For you" (`subject-catalog.ts` `suggestSubjects`, `subject-picker.server.ts`): when the profile has subjects, it shows exactly those (plus any exam focus), never a generic IB list. The full catalog stays under "View all".
- `SubjectPicker`: uses the known level, so HL/SL is not asked again. "Change level" remains an explicit action.
- `POST /api/subjects/create`: applies the same rule server-side (the profile is the source of truth; an explicit level still wins).
- Exam Prep (`picker.ts` `isPersonalProfileSubject`, `ObjectivePicker`):
  - The Student's own subjects (personal profile, never a class's) appear first in their framework.
  - "Explore all IB DP options (n)" stays available.
  - Frameworks that contain the Student's subjects are listed first.
- Class context is not merged. The class keeps governing inside the class (eligibility and institution reasons are unchanged), and the resolver never reads class tables.
- Profile changes propagate after Finish (every read is server-side and per request). Drafts are never persisted.

### REM-T1-05 — First-use branch consistency (STU-E2E-015)
- `/dashboard/onboarding` is now one decision: two equivalent cards that both navigate.
- "Learn a subject" → `/dashboard/onboarding/learn` ("Choose what you want to learn", personalized subjects first).
- "Prepare for an exam" → `/dashboard/exam-prep?from=onboarding`.
- Back from either returns to the journey choice (`src/lib/lx/onboarding-paths.ts`). The page creates nothing, so a refresh is deterministic.

### REM-T1-06 — Profile edit Cancel / Exit (STU-E2E-019)
- `src/lib/student/academic-profile-draft.ts` provides `isProfileDraftDirty`, `wizardActions` and `cancelOutcome`.
- Buttons: Cancel | Continue, then Cancel | Back | Continue, and finally Cancel | Back | Finish.
- A dirty Cancel shows "Discard unsaved changes?" with Keep editing / Discard changes. Discard restores the persisted values.
- In first-time onboarding, Cancel returns to the context choice.
- Finish is still the only write (one POST). The existing draft-safety behaviour is kept.

### REM-T1-07 — Localization consistency (STU-E2E-010)
- `src/lib/i18n/catalog-labels.ts`: one place for display values. The fallback is the canonical, official value.
  - Countries: `Intl.DisplayNames`, plus "Other" in 5 locales.
  - Grade labels: e.g. "3° Preparatoria" displays as "Preparatoria, year 3" in English. Official level names are kept.
  - Learner subject names: "Matemáticas" displays as "Mathematics" in English.
  - Official programme and qualification names (IB Diploma Programme, Cambridge IGCSE, MCCEMS) are not translated.
- Applied in the wizard, the profile summary, SubjectPicker, Progress, Today, My Plan, Subjects, Path, Study Plan and Learn.
- Stored values and IDs never change with the locale. Role labels were already localized in all 5 locales (verified).

## C. Database / migrations

- **Schema changed: YES (additive only).** One migration: `database/migrations/20261106_1000_student_context_and_time_context.sql`.
  - `students.student_context_type` (CHECK ACADEMIC/EXAM_PREP, nullable) and `student_context_selected_at`.
  - `student_academic_profile.academic_year_start`, `academic_year_end`, `exam_series`, `exam_year` (nullable, with CHECKs), plus a shape CHECK that allows one form at a time.
- **Backfill:** only NULL contexts are filled. A completed profile becomes ACADEMIC, and an exam target alone becomes EXAM_PREP. Nothing else is updated or deleted.
- **Applied to DEV** with the governed runner (`db-migrate.ts`): dry run first (1 pending: this one), then applied and recorded in the ledger.
- Counts before and after were identical:

  | Students | Profiles | Profile subjects | Exam preparations | Enrollments | Subjects | User roles |
  |---|---|---|---|---|---|---|
  | 36 | 12 | 3 | 22 | 33 | 35 | 37 |

- Resulting contexts: 12 ACADEMIC, 2 EXAM_PREP, 22 not chosen yet.
- **Rollback:** documented in the migration header (drop the 6 columns and the constraint, then delete the ledger row). Data in the new columns would be lost; nothing else is affected. The legacy `academic_year` text stays authoritative for every older reader.
- Stage/Preview and Production: **not migrated** (DEV → Stage → Production promotion order).

## D. Test results

| Suite | Result |
|---|---|
| Unit + route/component (vitest, mocked DB/Clerk) | **481 files / 8490 tests passing**: 8454 baseline plus 36 new in `tests/unit/t1-remediation.test.ts` covering brief cases 1–30, time context, migration and class context. 7 existing tests were updated to the new contract (see below). |
| TypeScript | `tsc --noEmit` clean |
| Production build | `next build` succeeds; new routes `/dashboard/start`, `/dashboard/onboarding/learn`, `/api/student/context` |
| DB scenario (DEV, read-only) | Old vs new gate for all 15 DEV Students: **0 READY Students sent back**. 10 READY stay READY, 3 incomplete go profile → context choice, 2 stay at first subject. |
| Hosted DEV HTTP smoke (unauthenticated) | 8 protected routes → 307 to `/sign-in?redirect_url=…`; `/api/student/context` and `/api/academic-profile` → 401; `/sign-in` → 200 |
| Accessibility | No automated a11y tooling in this repository. The new UI uses landmarks, labelled groups, `role="alertdialog"` for the discard confirmation, `aria-current` / `aria-busy` and real buttons. **Not run** as an automated suite. |

Existing tests updated, with the reason for each:
- `dashboard-layout-role-redirect`: the layout now redirects an unauthenticated request instead of rendering the shell.
- `student-onboarding-gate` and `journey-j0-exam-only-access`: the row now carries `student_context_type: 'ACADEMIC'` to keep their "profile first" intent; the new "no context" case is covered by the new tests.
- `subject-academic-context`: "nothing is written" is now asserted as no INSERT/UPDATE/DELETE, because the route now reads the profile subjects.
- `ux5-closure` and `exam-objective-first`: the journeys now navigate to dedicated steps.
- `exam-platform-v2-integration-matrix`: the migration chain includes `20261106_1000`.

## E. Regression (already validated T1 behaviours)

PASS here means verified by automated tests and the DEV scenario above. All of them are still to be confirmed in the manual re-test.

| Behaviour | Status | Evidence |
|---|---|---|
| Registered Student login | PASS | Clerk flow unchanged; `/sign-in` 200 on DEV; `redirect_url` returns after sign-in |
| Refresh session persistence | PASS | Session is Clerk's; the gate is re-evaluated per request (test 2b) |
| Logout/login persistence | PASS | Context, profile and language are server-side (tests 11/12, 25–27) |
| Primary Student role persistence | PASS | No role writes in the new code (tests 5/6) |
| `/role-select` blocks arbitrary role replacement | PASS | `role-assignment.service` unchanged (`f1-role-assignment-security`) |
| Family = access/relationship, not a role | PASS | Unchanged (`f2-parent-relationship-lifecycle`, `f10-parent-*`) |
| Independent Student Academic Profile | PASS | Catalogue save path unchanged plus time columns (`academic-profile-catalogue`) |
| Institution/class invitation acceptance | PASS | Unchanged code paths; existing tests pass |
| Invitation not pending again after re-login | PASS | Unchanged |
| Personal profile not overwritten by class context | PASS | Tests 22–24; resolver never reads class tables |
| Class curriculum can differ from personal | PASS | Eligibility / `academic-context` unchanged |
| Profile edit preloads saved values | PASS | Test 13 |
| Unsaved profile edits do not persist | PASS | Tests 15–17 |
| Saved profile changes persist | PASS | Test 16; API writes in one transaction |
| Profile survives refresh / logout-login | PASS | Server-side |
| Enrollment survives profile editing | PASS | Test 24 |
| Language survives refresh / navigation / re-login | PASS | Tests 25–27 |

## F. Deployment

| | |
|---|---|
| Commit deployed | `d5a1249` (code = `73de984` + the sign-in redirect fix) |
| Deployment | `dpl_34T2PqAowPP5wRHxai6wz24w72vx` (`study-66qzej8j4-study-so.vercel.app`), target `dev`, **READY** |
| Stable DEV URL | `https://study-os-env-dev-study-so.vercel.app`, re-pointed with `vercel alias set`; `/api/version` → `commitSha d5a1249…`, `environment development` |
| Built on | the exact previous DEV build (`2e68756`), so no other track's DEV work was dropped |

## G. Issue status

| Issue | Status |
|---|---|
| STU-E2E-003 / 004 / 006 / 007 (REM-T1-01) | TECH_PASS |
| STU-E2E-008, **T1.25**, **T1.26** (REM-T1-02) | TECH_PASS |
| STU-E2E-012 (REM-T1-03) | TECH_PASS |
| STU-E2E-013 (REM-T1-04) | TECH_PASS |
| STU-E2E-015 (REM-T1-05) | TECH_PASS |
| STU-E2E-019 (REM-T1-06) | TECH_PASS |
| STU-E2E-010 (REM-T1-07) | TECH_PASS |
| Deferred: 001, 002, 005, 009, 016, 017, 018 | NOT_FIXED (by design: later tracks) |
| Invalidated: 011, 014 | — (no change) |

## H. Manual retest checklist (DEV)

1. Signed out, open `/dashboard/today`, `/dashboard/notifications` and `/role-select`. Expected: the StudyUs sign-in page, with no sidebar or "Not authenticated" message. Sign in and confirm you are returned to the requested page.
2. New Student (role STUDENT):
   - Expected: "What best describes your current situation?", with only brand, language and **Sign out**.
   - Typing `/dashboard/learn` returns you to the choice.
   - Sign out works and ends the session.
3. **Academic Student:** country → grade → programme → subjects → final step.
   - National/MX: controlled school year (2026–2027 / 2027–2028).
   - IB Diploma: exam session (Nov 2026, May 2027, …).
   - Cambridge: May/June and Oct/Nov, never IB's months.
4. **Exam-prep Candidate:**
   - Expected: goes straight to Exam Prep. No school, grade or curriculum is asked.
   - After choosing an exam, Home, Learn and Exam Prep are all available.
   - Refresh and log out/in: the context is kept.
5. IB Student with Math AA HL, Physics HL and Visual Arts HL:
   - First-use "Learn a subject" → "For you" shows exactly those 3, with variant and level.
   - Choosing Mathematics does **not** ask HL/SL.
   - "View all" still lists every subject.
   - Exam Prep shows the 3 first, then "Explore all IB DP options (n)".
6. First-use: both cards navigate to their own step, and Back returns to the choice.
7. Profile edit:
   - Change the grade, then Cancel → "Discard unsaved changes?" → Discard. The saved profile is unchanged.
   - Cancel with no changes closes at once.
   - Finish saves.
8. English UI: countries ("Mexico", "Germany"), grade ("Preparatoria, year 3") and subjects ("Mathematics") are in English; Spanish shows "Estados Unidos", "Alemania". Switching language does not change the profile.
9. A Student enrolled in a class with a different curriculum: the personal profile is unchanged after editing it, and the class membership is intact.

---

# T1 — FINAL REMEDIATION DELTA (Student Account / Academic Profile / Exam Prep / Learn)

Status: **T1_FINAL_DELTA = TECH_PASS / READY_FOR_MANUAL_RETEST**. T1 is **not** DONE. T2 was not started. Stage and Production were not touched.

Scope: only the residuals of the full manual re-test on DEV (A–G). Out of scope and untouched: Question Bank, practices, diagnostics, mocks, content generation, licensing (Q1); PAA 2021 / current-version readiness (Q1/T7); the Topic/Concept Assessment Blueprint Engine; T2.

## Δ-A. Baseline

| | |
|---|---|
| DEV before the delta | `https://study-os-env-dev-study-so.vercel.app` → `/api/version` = `cc57dd64a82e99d47df414763108dc5d27343e37` |
| Branch / worktree | `remediation/t1-final-delta`, created from `cc57dd6` (the commit DEV served). `develop` was not used (it is behind). |
| Baseline before any change | 481 test files / 8496 tests passing · `tsc --noEmit` clean · `next build` OK |
| Preserved | original remediation REM-T1-01..07, Cambridge canonical series (MARCH / JUNE / NOVEMBER), March fail-closed |

## Δ-B. Changes per residual

### A — EXAM_PREP landing is the exam selector
- `exam-prep/page.tsx` reads the Student's context (`loadResolvedStudentContext`). With `context_type = EXAM_PREP` the lead is "Elige el examen que quieres presentar. Después configuraremos la convocatoria, asignatura o sección que corresponda." under "¿Para qué examen quieres prepararte?".
- `PreparationChooser.tsx`: an EXAM_PREP Student gets the whole organised catalogue directly (`data-exam-selector`). No "Preparaciones recomendadas", no "completa / revisar mi perfil académico", no link to `/dashboard/profile`, no profile reasons or "your subjects" block.
- ACADEMIC is unchanged: profile-based recommendations, the reason per option, "Buscar otra preparación", and the profile CTA when nothing matches.
- Country / region: no exam currently needs one to be configured. Cambridge March is the only region-restricted series and it stays fail-closed (no governed syllabus availability yet), so nothing is asked.

### B1 — Cambridge is one family
- `objective-catalog.ts`: `OBJECTIVE_FAMILIES` (CAMBRIDGE → `CIE_IGCSE`, `CIE_AS_A`, `CIE_AICE`). Frameworks, objective keys, qualifications, syllabus codes, levels and series rules are unchanged underneath.
- `ObjectivePicker.tsx`: the landing shows one card "Cambridge International" with the CTA "Elegir programa". It opens "¿Qué programa de Cambridge quieres preparar?" with Cambridge IGCSE / Cambridge International AS & A Level / Cambridge AICE Diploma, then subject / syllabus → level → session.
- The framework filter shows one "Cambridge International" chip instead of three.

### B2 — long catalogues grouped by canonical subject
- New `catalog/subject-localization.ts`: governed canonical subjects, mapped from the catalogue's own identifiers (IB subject key, Cambridge syllabus code). Never from label text. An unmapped entry is its own group.
- A listing longer than 8 options renders as accordions (`<details>`), closed by default, with the subject and its number of options ("Matemáticas · 4 opciones"). IB: 60 rows → 24 subjects. Cambridge International AS & A Level: 87 rows → 26 subjects.
- Search opens every subject that holds a match and covers subject, variant, level (name and code), syllabus code, in the interface locale and in the official English name.
- Every option keeps its own row and its own "Añadir a mi preparación" CTA. HL/SL, AA/AI, Core/Extended and syllabus codes stay visible. Nothing is pre-selected.
- ACADEMIC: the Student's own subjects still come first ("Tus asignaturas"). EXAM_PREP: the full organised catalogue.

### C — exam session in Exam Preparation
- New `objectives/objective-session.ts`: an objective whose awarding body runs governed series (IB DP, Cambridge IGCSE / AS & A Level / AICE) resolves its options through the same session catalogue as the Academic Profile (`programme-sessions.ts` `availableSeries`, via `time-context.ts`). No availability is written in the UI or in this module.
- After choosing such an exam, the preparation page asks "¿En qué convocatoria vas a presentar el examen?" with controlled options ("Mayo 2027", "Noviembre 2027", …). The detail then shows "Convocatoria: Mayo 2027". "Sin fecha de examen" no longer appears for these exams (detail, list and Home).
- "Editar los detalles de tu objetivo" shows the session selector for these exams instead of the free date picker. Exams without governed series (PAA, Saber 11, PISA) keep the date field.
- `PATCH /api/exam-preparation/[id]` accepts `examSession` ("ES:MAY:2027"). The server accepts only a series the catalogue offers for that objective now, or the stored value. Anything else → 400 `INVALID_EXAM_SESSION`, nothing written.
- A chosen session counts as timing configured (`hasExamDate`), so the "add your exam date" next step no longer applies.
- Backward compatibility: legacy identifiers (FEB_MARCH / MAY_JUNE / OCT_NOV) are read as canonical and never rewritten; new saves write MAY / NOVEMBER / MARCH / JUNE only. `exam_date` keeps its meaning and is never cleared by saving a session.
- `official_session_key` (Journey: an official session reference) was deliberately not reused.

### D — academic aspiration
- New `student/interest-areas.ts`: the 14-area taxonomy with stable canonical IDs and labels in 5 locales. OTHER takes an optional free-text detail ("¿Qué área te interesa?"); any other area stores no detail.
- The goal card is now "Tu examen" (exam, subject, level, session or date) and, apart, "Tu objetivo académico (opcional)" with "Universidad o institución objetivo (opcional)" and "Área académica o profesional de interés (opcional)" as a controlled dropdown.
- Optional everywhere: no field is required and nothing in the preparation plan reads them.
- The former free-text "Titulación a la que aspiras" input was replaced by the area dropdown. Values already stored in `target_qualification` are kept and still shown read-only.

### E — curriculum reaches the content of a Learn subject
- Subject autonomy is unchanged: "Tus materias" = chosen, "Para ti" = from the Academic Profile, "Ver todas" = full catalogue. Nothing is auto-activated.
- New `learning-plan/subject-curriculum-topics.ts` + `learn/CurriculumTopics.tsx`. Inside a subject linked to a known curriculum (an exam the Student prepares, or their personal Academic Profile), Learn shows, in order:
  1. "Tu siguiente reto" (the engine's own decision; unchanged), with "Forma parte de tu currículo: <tema>" when the concept belongs to a curriculum topic.
  2. "Temas de tu currículo — IB Diploma Programme · Física · HL", with the concepts inside each topic. A concept the Student already studies links to it; any other can be added with the existing "Añadir a mi plan" action.
  3. "Buscar o añadir otro tema" (the existing free search + document upload).
- The structure comes only from the governed chain: structure version (PUBLISHED) → structure nodes → learning objectives → published concept mappings → canonical concepts.
- **What DEV actually holds:** the structure nodes are exam papers ("Paper 1A", "Paper 2"), not syllabus units. A paper is not a topic, so the curriculum's learning objectives are shown as the topics ("A. Espacio, tiempo y movimiento…"), and an objective that only re-assesses concepts already listed is not repeated. Where a curriculum has real unit/topic nodes, those are the topics.
- A curriculum with no published objective → concept mapping shows an honest state ("Todavía no tenemos la estructura de temas de este currículo en StudyUs…"). A subject with no known curriculum shows no curriculum section.
- Not implemented (out of scope): the Blueprint Engine and any topic-level practice / assessment generation.

### F — Home context clarity (copy only)
- The generic "Tu objetivo" chip is gone. Home shows "Aprendiendo ahora — <materia>" and "Preparación activa — <examen>".
- With several active preparations: "Preparaciones activas — <examen> y N más", linking to the list. No single objective is implied.
- Same selection rule as before (`selectGoalProfile`); no architecture change.

### G — localization
- UI strings: every new string exists in es / en / de / fr / pt.
- Subjects: `localizeSubjectName` now also resolves official programme subject names. IB subjects use the IB's official Spanish names ("Matemáticas: Análisis y Enfoques", "Gestión Empresarial", "Literatura y Representación Teatral", "Artes Visuales", "Física"). Applied in Academic Profile (wizard + summary), Learn, Home, Progress, subject switchers, "Para ti", Exam Prep rows, the preparation title and facts.
- IB levels: "Nivel Superior (NS)" / "Nivel Medio (NM)" in Spanish, "Higher Level (HL)" / "Standard Level (SL)" otherwise. The code is never dropped.
- Concepts: a learner concept linked to the catalogue is shown with the catalogue's label in the interface language (`canonical_concept_localizations`), in the central label loader and in Learn. DEV example: "Conservation of momentum" → "Conservación del momento lineal".
- Curriculum topics: reviewed Spanish labels for the IB objectives, keyed by objective code (`catalog/objective-localization.ts`).
- Grades: the English interface no longer shows "Preparatoria, year 3"; it shows the governed equivalence ("Grade 12"). Spanish keeps "3° Preparatoria".
- "Temas de Physics" → "Temas de Física".
- No runtime translation anywhere. Stored values and canonical IDs never change with the language.
- Kept as published: programme / qualification names (IB Diploma Programme, Cambridge IGCSE, Cambridge International AS & A Level, Cambridge AICE Diploma), Cambridge syllabus titles and codes.

**Known localization limits (fallback = the stored official value):**
- Cambridge syllabus statements used as curriculum topics are official English text and stay in English.
- PAA / PISA objective statements are authored in Spanish and stay in Spanish in the English interface.
- Canonical-subject group names and IB subject names exist in Spanish and English; de / fr / pt fall back to English.
- A Student's own free-text concepts and AI-classified topic names are shown as stored.
- The two IB History / World Religions variant labels carry English version notes from the catalogue.

## Δ-C. Schema / migrations

One additive migration: `database/migrations/20261107_1000_exam_target_session_and_aspiration.sql` (next version after `20261106_1100`; no applied migration was edited or renamed).

| Column on `student_exam_profiles` | Purpose |
|---|---|
| `target_exam_series text` | canonical series (MAY / NOVEMBER / MARCH / JUNE) |
| `target_exam_year integer` | year of the series (both-or-neither) |
| `interest_area text` | canonical area ID |
| `interest_area_detail text` | optional detail, only with `OTHER` |

- All four columns are nullable; CHECK constraints apply to the new columns only. No backfill, no drop, no rename.
- Why not reuse: `exam_date` is a day, `estimated_exam_month` is the Student's month estimate, `official_session_key` is an official session reference, `target_qualification` is free text.
- Dry-run on DEV first: exactly 1 pending. Applied to **DEV only** (database fingerprint `2a29b99ee14a22b4`). Dry-run afterwards: nothing pending.

| Integrity check (DEV) | Before | After |
|---|---|---|
| students | 37 | 37 |
| student_academic_profile | 12 | 12 |
| student_academic_subjects | 5 | 5 |
| student_exam_profiles | 26 | 26 |
| subjects / concepts / mastery_records | 36 / 100 / 83 | 36 / 100 / 83 |
| class_enrollments / simulation_attempts | 33 / 12 | 33 / 12 |
| checksum of existing preparation data | `1e3349676155162df8f37635b4b5d274` | `1e3349676155162df8f37635b4b5d274` |
| columns on `student_exam_profiles` | 30 | 34 |

Stage (`53d158d5811e7ee0`) and Production (`6671e7382d808d06`) were not connected to. For those environments the migration goes through the same governed runner in their own release.

## Δ-D. Automated tests

| | |
|---|---|
| Full suite | **482 files / 8521 tests passing** (baseline 481 / 8496; +25) |
| TypeScript | `tsc --noEmit` clean |
| Build | `next build` successful |
| New | `tests/unit/t1-final-delta.test.ts` — CASE 01–25 (section J), all passing |
| Updated to the new contract | `exam-objective-first-render` (PreparationHome props), `exam-platform-v2-integration-matrix` (migration chain), `t1-remediation` cases 28–29 (IB Spanish name, "Grade 12"), `ux2-experience-foundation` (Home goal source guard) |
| Real-database smoke (read-only, DEV) | the new queries ran against real data: curriculum topics resolved for IB Mathematics AA SL (6 topics), concept labels returned in Spanish and English, picker data for existing Students |
| axe / accessibility | **Not run.** The repository has no axe / pa11y / Playwright tooling. No result is claimed. New controls use native `<details>`, `<select>`, `<fieldset>/<legend>` and labelled inputs. |

Not verified by automation: the pages in a real signed-in browser session on DEV (no test account was used). That is the manual re-test below.

## Δ-E. Regression (section H)

All previous tests still pass. Covered again by CASE 23–25 and the existing REM-T1 cases: protected routes → `/sign-in?redirect_url=…`; onboarding shell; STUDENT stays the primary role; EXAM_PREP context persistence; Academic Profile persistence and the IB "Mayo 2027" session; Cancel on each step, "¿Descartar los cambios sin guardar?", discard restores, no partial saves; Learn subject autonomy; institution / class separation; history surviving profile changes.

## Δ-F. DEV deployment

Filled in the delivery message (deployment URL, READY state and `/api/version` = final commit of `remediation/t1-final-delta`). Stage and Production: not deployed.

## Δ-G. Status per residual

| Residual | Status |
|---|---|
| A. EXAM_PREP landing | TECH_PASS |
| B1. Cambridge family | TECH_PASS |
| B2. Catalogue grouped by canonical subject | TECH_PASS |
| C. Exam session in Exam Preparation | TECH_PASS |
| D. Academic aspiration fields | TECH_PASS |
| E. Curriculum → Learn content | TECH_PASS — with the data limit above: DEV's curriculum nodes are exam papers, so topics are the curriculum's learning objectives |
| F. Home context clarity | TECH_PASS |
| G. Localization | TECH_PASS — with the known limits listed under G |

## Δ-H. Manual re-test checklist (DEV)

1. **EXAM_PREP landing.** Sign in as an EXAM_PREP Student with no Academic Profile → Exam Prep. Expected: "¿Para qué examen quieres prepararte?" + the new lead; the catalogue is visible at once; no profile message or CTA anywhere.
2. **ACADEMIC landing.** Sign in as an ACADEMIC Student. Expected: "Preparaciones recomendadas para ti" as before.
3. **Cambridge.** One "Cambridge International" card → "Elegir programa" → the three programmes → a programme → subjects with syllabus code and level.
4. **IB catalogue.** IB Diploma → subjects as closed accordions with counts. Search "análisis" or "hl": the right subject opens. Each row has "Añadir a mi preparación".
5. **IB session.** Add Math AA HL → the page asks for the session → choose "Mayo 2027" → "Convocatoria: Mayo 2027" in the detail, the list and Home. No "Sin fecha de examen".
6. **Cambridge session.** Add a Cambridge AS & A Level subject → options are June / November only (no March, no May).
7. **PAA.** "Editar los detalles de tu objetivo" still offers a date.
8. **Aspiration.** In the same form: institution + area dropdown; choose "Otro" → "¿Qué área te interesa?" appears. Save, reload: values kept. Leave everything empty: nothing blocks.
9. **Learn.** Open a subject tied to an exam you prepare or to your profile (e.g. IB Physics HL / Mathematics). Expected order: "Tu siguiente reto" → "Temas de tu currículo — …" with concepts → "Buscar o añadir otro tema". A subject with no known curriculum shows no curriculum section. The 5 profile subjects are still not auto-added.
10. **Home.** "Aprendiendo ahora — <materia>" and "Preparación activa — <examen>"; with two preparations, "Preparaciones activas — … y 1 más".
11. **Language.** Spanish: Física, Matemáticas: Análisis y Enfoques, Gestión Empresarial, Artes Visuales, "Temas de Física", Spanish concept names for catalogue concepts. English: "Grade 12" for 3° Preparatoria, English subject names. Switch back and forth: saved values unchanged.
12. **Regression.** Profile edit Cancel / discard; logout / login keeps the EXAM_PREP context; a class with another curriculum does not change the personal profile; old preparations and progress are intact.

---

# T1 — FINAL MICRO-REMEDIATION (post-manual-retest delta)

Status: **T1_MICRO_DELTA = TECH_PASS / READY_FOR_FINAL_SMOKE**. T1 is **not** DONE. T2, Q1 and the Blueprint Engine were not touched. Stage and Production were not touched.

## μ-A. Baseline

| | |
|---|---|
| DEV before | `/api/version` = `b8f21f48a3ff7bd16da05b012425872eefcd6653` |
| Branch / worktree | `remediation/t1-micro-delta`, created from `b8f21f4` |
| Baseline before any change | 482 files / 8521 tests passing · `tsc` clean · `next build` OK |

## μ-B. M01 — class / assignment persistence: investigated, **no defect, no data loss**

Traced read-only in the DEV database (fingerprint `2a29b99ee14a22b4`): institution → class → enrolment → assignment → visibility query → `/dashboard/assignments`.

**Finding: the two observations come from two different accounts.**

| | Account A | Account B |
|---|---|---|
| Sign-in identity | separate Clerk user, created 2026-09-30 | separate Clerk user, created 2026-10-08 |
| Personal profile | Grade 12 · 2026–2027 · no catalogue programme | **IB Diploma Programme · 3° Preparatoria · May 2027** |
| Class "Math" | ACTIVE since 2026-10-03 | ACTIVE since 2026-10-09 |
| Assignments ever | **"Diferenciales"** (assigned 2026-10-04, `IN_PROGRESS`, last changed 2026-10-04) | none |
| Exam preparations | 0 | 2 |

- "Diferenciales" exists, is untouched since 4 October and is still "En curso". The page's own query returns it for Account A today.
- It was assigned to Account A individually. Account B joined the same class five days later and was never assigned anything, so "No tienes tareas pendientes" is correct for B.
- There is no duplicated identity: the two accounts have different Clerk IDs and different e-mail addresses. No user has two student records.
- Checked and ruled out: enrolment lost (both ACTIVE); assignment deleted (present; DEV totals 1 IN_PROGRESS, 29 ASSIGNED, 2 COMPLETED); relation detached; workspace / context filtering (the query filters only by student + status); migrations (the three T1 migrations touch no class-side table).
- Nothing was fixed in code for M01 and **no assignment was created or altered**.
- Product note, out of scope: an assignment given to named students is not extended to students who join the class later.

Regression tests added anyway (micro-delta tests 1–3): an ACADEMIC student with a personal IB profile, an active enrolment and an active assignment; all three survive profile save / edit / cancel, state reconstruction, and exam-preparation changes; no profile or preparation write path names a class-side table, and vice versa.

## μ-C. M02 — Learn concept / action row layout (blocker, fixed)

- Cause: the catalogue rows reused `.ln-concept`, a 4-column grid whose first column is the 20px status-icon slot. With no icon, the concept name landed in that 20px column.
- Fix: one shared component, `components/ui/ConceptActionRow.tsx`, with its own layout: the name is the flexible column (`flex: 1 1 14rem; min-width: 0`) and wraps by words; the action keeps its natural width and moves below the name on narrow viewports.
- Pairing is explicit: the button's accessible name is "Añadir a mi plan: <concepto>" and it references the name element.
- Already added → "Añadido" (plus "Abrir" when the Student has the concept), instead of the same CTA. "Added" now also covers a concept placed in another of the Student's subjects, and plan entries. After a successful add the button itself becomes "Añadido".
- Topic → concept resolution is unchanged.
- Verified visually with the real stylesheet and component at desktop and 375px widths.

## μ-D. M03 — localization consistency

- Preparation plan: requirement names use the reviewed objective labels; concept names use `canonical_concept_localizations` (this is where "Conservation of momentum" still appeared); "also relevant for" uses the localized exam label.
- Levels: `SL` / `HL` are displayed as "Nivel Medio (NM)" / "Nivel Superior (NS)" (English: "Standard Level (SL)" / "Higher Level (HL)") in the Learn curriculum title, the profile wizard and summary, "Para ti" and the level buttons. The stored value stays the code.
- IB papers: "Paper 1 (no calculator)" → "Prueba 1 (sin calculadora)", "Paper 2 (GDC)" → "Prueba 2 (con calculadora gráfica)", through a governed glossary of the IB's own Spanish terms. Applied to IB only, in Learn topics and in the preparation page (areas, practice modes, mocks, structure).
- Kept official: programme / qualification names, Cambridge syllabus titles, codes and paper names.
- No runtime translation. Stored IDs and catalogue values are identical in every language.
- Still shown as stored (no catalogue label exists): Cambridge syllabus statements, PAA / PISA statements in the English UI, students' own free-text concepts, and the section descriptions inside "Qué evalúa" for structure-only IB subjects.

## μ-E. M04 — exam catalogue typeahead

- From 2 characters the search offers suggestions from the catalogue: exam family, exam / programme, canonical subject, course (variant) with its levels beneath, and syllabus codes. Example: `ana` → "Matemáticas: Análisis y Enfoques" → "Nivel Medio (NM)", "Nivel Superior (NS)".
- Suggestions match by word prefix. The existing search is unchanged and still filters by substring ("anális" → the two Math AA options).
- Choosing a suggestion only sets the picker's filter: it shows the canonical result and opens the group when grouping applies. Nothing is added or selected.
- Keyboard: Arrow Up / Down (wrapping), Enter (chooses the highlighted one; with none highlighted the typed search stays), Escape. Implemented as a combobox with a listbox popup.

## μ-F. M05 — "Para ti" provenance

- The programme / grade list is now offered only when a real Academic Profile exists (completed, or with a chosen programme). An EXAM_PREP student without a profile gets only subjects with a real source.
- Found while fixing: an exam preparation such as "Mathematics: analysis and approaches" was not being recognised as a source at all (the exam badge never matched; Mathematics appeared only through the generic list). It now resolves to its catalogue subject, so the manual case shows **Matemáticas — "Por tu preparación de examen"** and nothing else.
- Generic subjects are under "Explorar materias" (renamed from "Ver todas las materias"), which opens by default when there is no recommendation.
- Not added as sources: class / institution context (classes carry no catalogue subject link to read) and past learning (existing subjects are already "Tus materias").
- No subject is auto-activated.

## μ-G. Schema

No migration. No data was written to DEV by this delta.

## μ-H. Tests

| | |
|---|---|
| Full suite | **483 files / 8532 tests passing** (baseline 482 / 8521; +11) |
| TypeScript | clean |
| Build | `next build` successful |
| New | `tests/unit/t1-micro-delta.test.ts` — post-fix tests 1–11 |
| Updated to the new contract | `t1-final-delta` (concept row shape), `ux5-subject-create-regression` (no generic list without a profile) |
| Accessibility tooling | none in the repository; **not run, no result claimed** |

## μ-I. Final smoke checklist (DEV)

1. Sign in as **Account A** (the one that received "Diferenciales") → Mis tareas shows it, "En curso". Account B correctly shows none.
2. Account B's profile is still IB Diploma Programme / 3° Preparatoria / Mayo 2027.
3. Learn → a curriculum topic → concepts are readable; "Añadir a mi plan" works and turns into "Añadido".
4. Exam search: type `ana` → suggestions; arrows, Enter and Escape work; ignoring them still filters.
5. EXAM_PREP "Para ti": only explainable recommendations; the rest under "Explorar materias".
6. Spanish / English: levels, IB papers, concepts and requirements are consistent.
7. Cambridge June 2027 saves and survives reload.
8. Logout / login keeps profile, preparations, class enrolment and assignments.

---

# T1 — FINAL UI POLISH (post-final-smoke)

Status: **T1_FINAL_UI_POLISH = TECH_PASS / READY_FOR_VISUAL_CONFIRMATION**. T1 is **not** DONE. T2 not started. Stage and Production untouched. No migration; no DEV data written.

Baseline: DEV `/api/version` = `1b38bd7`; work continued on `remediation/t1-micro-delta`.

| Item | Cause | Fix |
|---|---|---|
| **M02b** — topic collapsed after "Añadir a mi plan" | The topic's open state lived only in the browser's `<details>`; the data refresh after an add could remount the section and lose it. | The expanded topics are now controlled state, mirrored per subject in session storage (optional; guarded). A successful add marks its topic open before refreshing in place. The clicked concept becomes "Añadido" + "Abrir"; siblings stay visible with their own button. No navigation, so scroll is kept. |
| **M05b** — "Informática" collapsing letter by letter in "Para ti" | The row was a single flex line and the provenance badge (now a longer text) took the width; the name was allowed to break anywhere. | The shared recommendation row is a two-column grid: subject (flexible, wraps by words) and arrow (right); the provenance badge sits under the subject at its natural width. The whole row stays one button. Checked in a browser at desktop and 375px. |
| **M03b** — "Prueba 3 (GDC, problem solving)" | The glossary matched whole parentheses, so a comma list was missed. | Qualifiers are resolved term by term: "Prueba 3 (con calculadora gráfica, resolución de problemas)". Unknown terms stay as stored. |
| **M03c** — "Group 1: Matemáticas y Ciencias" in English | The catalogue's Spanish group name was the only one carried on an objective. | Objectives now carry the catalogue's group names in both languages for display; AICE Diploma parts too. The stored preparation context is unchanged. |
| **M06** — active Cambridge 9618 preparation showing "You can add it to your preparation" | The badge came from catalogue capability alone. | The badge is resolved from the actual preparation state: an objective already in the preparation shows "En tu preparación / In your preparation". Capability badges (structure, practice, mocks, plan) are unchanged. Display only. |

Tests: **483 files / 8536 passing** (+4 focused tests in `tests/unit/t1-micro-delta.test.ts`); one older source guard updated for the badge; `tsc` clean; `next build` OK. Accessibility tooling: none in the repository; not run.

Visual confirmation (DEV):
1. Learn → expand a topic → "Añadir a mi plan" on one concept → the topic stays open, that row shows "Añadido" + "Abrir", the others keep their button.
2. Add Subject → "Para ti": "Informática" reads on one line with "Por tu preparación de examen" beneath and the arrow at the right.
3. Spanish, IB Math AA HL preparation → "Prueba 3 (con calculadora gráfica, resolución de problemas)".
4. English, a Cambridge AS & A Level row or preparation → "Group 1: Mathematics and Sciences".
5. My preparations → Cambridge Computer Science 9618 shows "In your preparation" with "View my preparation".

---

# T1 — FINAL LOCALIZATION RESIDUAL (M03d)

Status: **T1_LOCALIZATION_FINAL = TECH_PASS / READY_FOR_VISUAL_CONFIRMATION**. T1 is **not** DONE. No migration, no data writes, Stage / Production untouched.

Baseline: DEV `/api/version` = `c2f8924`; work continued on `remediation/t1-micro-delta`.

**Cause.** Cambridge publishes its syllabuses in English only, so the catalogue had no Spanish label for Cambridge components or requirement statements, and the component display path only handled IB.

**Fix.**
- New governed data, `catalog/cambridge-localization.ts`: reviewed Spanish display names for Cambridge components, keyed by the exact stored component name ("Paper 1 — Pure Mathematics 1" → "Prueba 1 — Matemáticas Puras 1"; "Component 3 — Team Project" → "Componente 3 — Proyecto en equipo"; "Paper 2 (Extended, non-calculator)" → "Prueba 2 (Extended, sin calculadora)").
- `catalog/objective-localization.ts`: reviewed Spanish labels for 86 Cambridge requirement statements, keyed by objective code ("Pure 1 · Differentiation (stationary points and their nature)." → "Puras 1 · Derivación (puntos estacionarios y su naturaleza).").
- One display path, `localizeComponentLabel(body, label, locale)`, now serves IB and Cambridge on the preparation page (areas, practice modes, mocks, "Qué evalúa") and in Learn topics. The page has no body-specific branch.
- These are StudyUs display labels, not official Cambridge translations.

**Coverage.** Every component and statement of the Cambridge syllabuses with loaded requirements: 9709 Mathematics, 9702 Physics, 9701 Chemistry, 9700 Biology, 9708 Economics, 9093 English Language, 9239 Global Perspectives & Research, and IGCSE 0580 Mathematics. Checked read-only against the DEV catalogue: 131 requirement rows, 0 statements and 0 components without a label.

**Fallback (by design).** A component or statement without a reviewed label is shown exactly as stored, whole and unchanged. This applies today to the catalogue-only Cambridge syllabuses (for example Computer Science 9618: "Paper 1 — Theory Fundamentals"), whose paper names remain in English until they are reviewed.

**Unchanged.** Syllabus codes, qualification and tier names (AS Level, A Level, Core, Extended), syllabus titles ("Mathematics (9709) · AS Level"), canonical IDs, catalogue data and everything stored. English UI shows the stored English labels. No runtime translation.

**Re-checked.** IB Spanish "Prueba 3 (con calculadora gráfica, resolución de problemas)"; Cambridge English "Group 1: Mathematics and Sciences".

Tests: **483 files / 8539 passing** (+3 focused tests in `tests/unit/t1-micro-delta.test.ts`; one earlier assertion that expected no Cambridge label was updated); `tsc` clean; `next build` OK. Accessibility tooling: none; not run.

Visual confirmation (DEV, Spanish UI): open a Cambridge Mathematics 9709 preparation → "Qué evalúa" and the recommendations show "Prueba 1 — Matemáticas Puras 1", "Puras 1 · Derivación…", "Prueba 4 — Mecánica", "Probabilidad y Estadística 1 · La distribución normal." Switch to English → the original English labels.

---

# T1 — LAST LOCALIZATION PATH (recommendation card)

Status: TECH_PASS, deployed to DEV. T1 is **not** DONE. No migration, no data writes, no architecture change. M03d was not reopened.

**What the English row was.** Not the requirement statement: it is the catalogue **concept** mapped under the requirement ("Mechanics: energy, work and power", with a colon), a different catalogue entity from the statement ("Mechanics · Energy, work and power."). The card title and "Qué evalúa" show the statement, which was already localized. In DEV, 56 of 168 concepts (the Cambridge AICE and PISA additions) have no stored Spanish label, so the concept fell back to its stored English name.

**Fix.** The requirement-statement function cannot label a concept (it is keyed by requirement code), so the shared *concept*-label function was completed instead:
- The repository already had one governed concept-label list (used by the operator seed). It now lives with the app (`learning-plan/canonical-concept-labels.ts`), the seed imports it, and the 56 missing concepts were added to it. No second map was created.
- `canonicalConceptLabels` (the one function the plan, "Qué evalúa" and Learn topics already use) resolves: stored localization → governed list → stored name.
- Nothing is written to the database. Running the seed later would store the same labels; it is not required for the display.

**Result (checked against the real DEV preparation, read-only).** Spanish: "Mecánica · Energía, trabajo y potencia." / "Prueba 4 — Mecánica" / "Mecánica: energía, trabajo y potencia". English: unchanged stored labels. All 168 catalogue concepts now have a Spanish label through one of the two sources.

**Not changed (out of this path).** A concept the Student has already added to their own learning is labelled through the stored localization only (Home / Learn lists); for the 56 concepts above that still needs the seed to be run.

Tests: **483 files / 8540 passing** (+1 focused test with the exact Cambridge recommendation shape); `tsc` clean; `next build` OK.
