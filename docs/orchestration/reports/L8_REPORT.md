# L8_TEACHER — Report

Run date: 2026-10-11 (UTC).

## LANE

| | |
|---|---|
| Lane | `L8_TEACHER` — TE-1 and TE-2 from `L3R1_REPORT.md` section 3 / section 7 |
| Mode | Code and tests, inside the L8 ownership |
| Worktree | `/Users/jalbornoz/PROYECTOS/studyos-l8-teacher` (new) |
| Branch | `feat/l8-teacher-te1-te2` (new, local only, created from `4fb45b0`) |

No `tasks/L8_TEACHER.md` contract exists in the control-plane worktree. Scope was taken from the Orchestrator's launch message and from `L3R1_REPORT.md`.

## STATUS

`READY_FOR_ORCHESTRATOR_REVIEW`

## BASE SHA

`4fb45b093ce6ba58a4b3f82d211bea2f978e33d1` — HEAD of `fix/security-p1-remediation`, verified with `git rev-parse` before the worktree was created.

## FINAL SHA

The single commit on `feat/l8-teacher-te1-te2` whose parent is `4fb45b0`. Run `git rev-parse feat/l8-teacher-te1-te2` for the value.

## FILES CHANGED

New (7):

- `src/lib/teacher/exam-insights.service.ts` — teacher-only class exam insights (TE-2)
- `src/lib/teacher/individual-assignment.ts` — the topics the individual form may offer (TE-1)
- `src/app/dashboard/teacher/classes/[classId]/exam-insights/page.tsx` — the class exam-insights view (TE-2)
- `src/lib/i18n/teacher-l8-messages.ts` — L8 strings, five locales, standalone (not merged into `messages.ts`)
- `tests/unit/l8-teacher-te1-te2.test.ts`
- `docs/orchestration/status/L8_STATUS.md`
- `docs/orchestration/reports/L8_REPORT.md`

Modified application code (9):

- `src/app/dashboard/teacher/classes/[classId]/students/[studentId]/page.tsx` — mounts `AssignInterventionForm` (TE-1)
- `src/app/api/teacher/exam-insights/route.ts` — now calls the teacher-only service (TE-2)
- `src/app/dashboard/teacher/classes/[classId]/TeacherClassSubNav.tsx` — new "Exámenes" tab
- `src/app/dashboard/teacher/classes/[classId]/class-chrome.tsx` — takes `locale`, supplies the tab label
- `src/app/dashboard/teacher/classes/[classId]/{page,plan/page,students/page,assignments/page,progress/page}.tsx` — pass `locale` to `ClassChrome` (one attribute each, no other change)

Modified existing test (1, fixture only):

- `tests/unit/aice-pisa-security.test.ts` — mocks `getTeacherClass`, which the route now depends on. Assertions unchanged.

Not changed: `AssignInterventionForm.tsx` itself, `src/lib/authorization/**`, `src/lib/teacher/read-model.service.ts`, `src/lib/teacher/class-assignment.service.ts`, `src/lib/i18n/messages.ts`, `dashboard/layout.tsx`, navigation files, any schema, migration, environment or flag.

## LOCKS USED

NONE. No file under any lock in `LOCKS.md` was edited. Shared guards were called, not modified; L10 was not needed.

## TESTS

| Command | Result |
|---|---|
| `env -u DATABASE_URL -u DATABASE_URL_UNPOOLED -u POSTGRES_URL npx vitest run tests/unit/l8-teacher-te1-te2.test.ts` | 19 tests passed |
| Same file with `api/teacher/exam-insights/route.ts` temporarily restored to `4fb45b0` | 2 failed: "a Coordinator gets 403…" and "a Teacher of another class gets 403". Route then restored; 19 passed. See the note below on the second one |
| Targeted existing suites: `aice-pisa-security`, `f11b-teacher-intervention-api-routes-security`, `track-a-source-guards`, `f13-ux-consolidation-source-guard`, `f14-experience-completion-source-guard` | all passed (148 tests across the 6 files including the new one) |
| `env -u DATABASE_URL … npx vitest run` (full suite) | 520 files, 9,309 tests passed |
| `npx tsc --noEmit -p .` | no output |
| `npx next build` (no database configured) | exit 0; `/dashboard/teacher/classes/[classId]/exam-insights` is in the route list |
| Browser, DOM or accessibility run | NOT_RUN — needs a Clerk session and a database; Human Operator step |
| HTTP E2E suites, any DEV / Stage / Production access | NOT_RUN |

Note on the base-route run: the "Teacher of another class" failure is produced by the test's roster mock, which admits everyone. On the base, the real `canAccessClass` already refused a teacher of another class. Only the Coordinator case is a real behaviour change.

`node_modules` is a copy-on-write clone of the L4-R1 worktree's (git-ignored), as in L4-R1.

Negative authorization cases:

| Surface | Case | Test |
|---|---|---|
| `GET /api/teacher/exam-insights` | Coordinator → 403, nothing read | `l8-teacher-te1-te2` › "a Coordinator gets 403 and no per-Student data is read" |
| | Teacher of another class → 403 | › "a Teacher of another class gets 403" |
| | signed out → 401; bad id / family → 400 before any read | › "signed out is 401; a malformed class id or family is 400…" |
| Service | Coordinator refused although the roster guard would admit | › "a Coordinator (institution admin) is refused although…" |
| | roster guard still applies | › "the roster guard still applies…" |
| View model | Student outside the roster never rendered | › "a Student outside the roster never produces a row…" |
| `POST /api/teacher/interventions` (unchanged route) | teacher without the relationship → 403 | existing `f11b-teacher-intervention-api-routes-security` (still passing) |

The Coordinator tests run the real `getTeacherClass` / `TEACHER_CLASS_SQL` gate against a scripted database. They are unit tests; nothing ran against a real database.

## FINDINGS

### 1. TE-1 — the form is mounted

- `AssignInterventionForm` is rendered on the class-scoped learner page, `/dashboard/teacher/classes/{classId}/students/{studentId}`, in a new `#assign-individual` block under the existing composer. The legacy URL `/dashboard/teacher/students/{studentId}` already redirects there, so both paths in the plan reach it.
- The page is already teacher-only (`getTeacherLearnerView` → `getTeacherClass` + ACTIVE enrolment + `canTeacherAccessLearner`; anything else is a 404). The form posts to the unchanged `POST /api/teacher/interventions`, which re-runs the full chain.
- **Subject scope.** The picker lists only the learner's own concepts that are matched to a topic of this class's subject and are in the learner's plan (`listIndividualAssignmentConcepts`, built from the authorized view). I did not use the existing `listLearnerConceptsForTeacher`: it returns every active subject of the learner, which would show a Maths teacher the learner's topics in other subjects.

### 2. TE-1 — the form cannot assign exam practice (acceptance gap)

`L3R1_REPORT.md` describes the form as covering "skill, competency, exam-practice" and its acceptance test is "Teacher assigns an exam-practice task". The form at `4fb45b0` posts `CONCEPT_REINFORCEMENT` only (`AssignInterventionForm.tsx:52`; its header says exam assignments were deferred). The route still accepts `EXAM_PRACTICE`, but no UI sends it.

I mounted the form as it is, as instructed. An exam-practice picker is not a mount: it needs a teacher-scoped read of the learner's exam profiles (none exists) and the simulation-type rules. Mounted today, TE-1 gives a second way to assign concept practice next to the composer, which already does that. **The Teacher assessment row of the certification is not met by this change alone.** Orchestrator decision needed: extend the form in L8 (new teacher-scoped exam-profile read in `src/lib/teacher/`), or accept concept practice for certification.

### 3. TE-2 — class exam-insights view, teacher-only

- New tab "Exámenes" on every class page → `/dashboard/teacher/classes/{classId}/exam-insights`: summary counts, exams the class prepares, gaps by area / objective / topic (top 10 each), an exam-family filter, and one row per student (exam goals and dates, number of gap objectives, topics to reinforce, AICE plan entries) with a link to the learner page.
- Page and route share `getTeacherClassExamInsights`. It gates on `getTeacherClass` (APPROVED TEACHER membership + ACTIVE assignment covering the class) and then calls the existing roster guard.

### 4. Ruling applied — behaviour change on an existing route

Before: `GET /api/teacher/exam-insights` authorized through `getTeacherClassRoster` → `canAccessClass`, which admits the institution's admins, so a Coordinator received per-student gap concepts and goals (L4-06).
Now: a Coordinator gets `403 FORBIDDEN` on this route and a 404 on the page. The response shape for the teacher is unchanged.

This was done inside L8 files only, by putting the existing teacher-only helper in front. `canAccessClass` is untouched, so **SF-4 is still open for every other caller** of it (`getTeacherClassRoster`, the other `api/teacher/classes/**` read routes). I found no script or UI that called this route as a Coordinator (`grep` over `src/` and `scripts/`).

### 5. Open scope question — gaps are not filtered by the class's subject

The ruling says "authorized classes/subjects". I enforced the class boundary (which students). The content is not filtered by subject: `examGapsFor` returns each roster student's gaps across every exam they have a scored attempt in, so a Maths teacher sees a student's reading gaps from the same exam. That is the route's behaviour since before this lane. Filtering properly needs a subject option on `examGapsFor` (`src/lib/exam-core/`, not L8) because the area and objective aggregates cannot be re-cut afterwards. See CR-L8-01.

### 6. Smaller observations

- `GapAggregate.studentsWithResults` counts students with at least one gap, not students with a scored attempt (`exam-gaps.service.ts:82`, rows are gap rows only). The view labels it "with exam gaps" and says "no exam gaps recorded" for the others, so it does not claim a student has no results.
- `POST /api/teacher/interventions` checks that a CONCEPT target belongs to the learner, not that it belongs to the class's subject. The new picker cannot produce such a request; a hand-built one can. Not changed (outside TE-1/TE-2).
- AICE readiness is returned by the route as before but not shown in the view: it is a platform capability state, not a student result.

## BLOCKERS

NONE for this lane.

## CHANGE_REQUESTS

| # | Lock / owner | Files | Change needed | What I did instead |
|---|---|---|---|---|
| CR-L8-01 | Exam core (not a role lane); product ruling D-1 first | `src/lib/exam-core/exam-gaps.service.ts` (`examGapsFor`) | If D-1 means a teacher sees only gaps in their class's subject: an option to restrict gaps to objectives of one canonical subject | Enforced the class boundary only; documented in Finding 5 |
| CR-L8-02 | `SHARED_FOUNDATION` (L10, SF-4) | `src/lib/authorization/index.ts` (`canAccessClass`), `src/lib/teacher/read-model.service.ts` | The Coordinator exclusion is enforced on this one route from L8 code. The shared guard still admits Coordinators to the other teacher read models | Nothing in shared code |

## MERGE RECOMMENDATION

Merge after review; one commit on top of `4fb45b0`. Before merging, confirm the Coordinator 403 on `GET /api/teacher/exam-insights` is wanted now rather than with SF-4. File overlap with the other Wave 0 lanes: none expected (`dashboard/teacher/**`, `api/teacher/exam-insights`, two new `src/lib/teacher/` files, one new i18n file, one existing test fixture).

Human Operator check on an environment with fixtures: as a class teacher, open a class → "Exámenes", then a student → "Práctica individual", at phone and desktop widths; as that institution's Coordinator, request the same exam-insights URL and expect not-found.

## NEXT SAFE ACTION

Orchestrator reviews the commit and rules on Finding 2 (exam-practice assignment) and Finding 5 (subject filter).
