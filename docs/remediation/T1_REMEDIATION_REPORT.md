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
  - March is restricted. A governed region rule (India, Romania, from 2026) must positively allow it for that country and year; with no rule it is not offered.
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
