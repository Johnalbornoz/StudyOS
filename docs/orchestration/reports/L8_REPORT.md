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

---

# L8-R1 TEACHER EXAM-PRACTICE COMPLETION — 2026-10-11 (appended run)

Follows the Orchestrator ruling "L8 accepted with remediation". `4ada891` is not amended; this run is one new commit on the same branch.

## LANE

`L8_TEACHER` / L8-R1 — worktree `/Users/jalbornoz/PROYECTOS/studyos-l8-teacher`, branch `feat/l8-teacher-te1-te2` (local only).

## STATUS

`READY_FOR_ORCHESTRATOR_REVIEW`

| Gate | Result |
|---|---|
| TEACHER_CONCEPT_ASSIGNMENT | PASS |
| TEACHER_EXAM_PRACTICE_ASSIGNMENT | PASS (unit level; not exercised against a real database or in a browser) |
| TEACHER_CLASS_SCOPE | PASS |
| COORDINATOR_TEACHER_ROUTE_BLOCK | PASS |
| CR_L8_01_SUBJECT_GAPS | OPEN |
| TESTS | 521 files, 9,338 tests passed; 28 new |
| TYPECHECK | clean |
| BUILD | exit 0 |
| L8_READY_FOR_CONVERGENCE | YES for the code. Teacher E2E certification stays blocked on CR-L8-01 |

These are the lane's own results for the Orchestrator to review, not a certification.

## BASE SHA

`4ada891` (L8 commit accepted by the ruling), parent `4fb45b0`.

## FINAL SHA

The commit on `feat/l8-teacher-te1-te2` whose parent is `4ada891`. Run `git rev-parse feat/l8-teacher-te1-te2`.

## FILES CHANGED

New (3):

- `src/lib/teacher/exam-practice-options.service.ts` — teacher-only read of the exam-practice options for one learner in one class
- `src/app/dashboard/teacher/students/AssignExamPracticeForm.tsx` — the form
- `tests/unit/l8r1-teacher-exam-practice.test.ts`

Modified (5):

- `src/app/api/teacher/interventions/route.ts` — an EXAM target must be one of those options; derives the task title
- `src/app/dashboard/teacher/classes/[classId]/students/[studentId]/page.tsx` — mounts the form
- `src/lib/i18n/teacher-l8-messages.ts` — 11 new strings, five locales
- `docs/orchestration/status/L8_STATUS.md`, `docs/orchestration/reports/L8_REPORT.md`

Not changed: `src/lib/teacher/intervention.service.ts`, `AssignInterventionForm.tsx`, `src/lib/authorization/**`, `examGapsFor`, any assessment or simulation module, any schema or migration.

## LOCKS USED

NONE.

## TESTS

| Command | Result |
|---|---|
| `env -u DATABASE_URL … npx vitest run tests/unit/l8r1-teacher-exam-practice.test.ts` | 28 passed |
| Same file with `api/teacher/interventions/route.ts` restored to `4ada891` | 7 failed: the five out-of-scope targets were accepted (200), and the two title assertions. Route restored afterwards |
| Full suite, first run after the change | 16 failures in 13 files. One real: `b2b2-legacy-blueprint-readers` (my first draft read `assessment_blueprints` directly; that guard lists every reader). The rest were 5 s timeouts under machine load (load average 35, other lanes running) |
| Fix: the read path now goes through the existing readers (`getBlueprintForVersion`, `listObjectiveTargets`, `listComponentsForVersion`); the guard test was not edited | — |
| Full suite, final | 521 files, 9,338 tests passed |
| `npx tsc --noEmit -p .` | exit 0, no output |
| `npx next build` | exit 0 |
| Browser, real database, HTTP E2E, Student-side start of the assigned task | NOT_RUN |

Acceptance tests requested by the ruling:

| Requirement | Test in `l8r1-teacher-exam-practice` |
|---|---|
| Class Teacher can view applicable options | "lists the learner's own preparation, only within the class subject"; "the subject filter is part of the queries themselves…" |
| Teacher can assign an exam-practice task to a learner in their class | "the class Teacher assigns an exam-practice task; it persists through the existing model" (asserts the `INSERT INTO teacher_interventions` values) |
| Cannot assign to a learner outside their class | "the Teacher cannot assign to a learner outside their class" (403, no insert) |
| Cannot assign using unrelated class/subject scope | "…through a class they do not teach" (403); five "cannot assign …" cases (400): other subject's objective, other subject's domain, whole-exam mini mock of a multi-subject exam, full mock, another learner's profile |
| Coordinator cannot use the endpoint/UI as a bypass | "a Coordinator cannot use the Teacher endpoint as a bypass — exam practice or concept" (403 both); options read refused for a Coordinator; the page is the teacher-only learner page (404 for anyone else, unchanged) |
| Concept reinforcement still works | "the class Teacher still assigns a concept; the exam scope check is not involved" |

The route, the options service, `assignTeacherIntervention` and the shared authorization functions run for real in these tests against a scripted database. The session, the database driver, the Student execution module and the mini-mock eligibility are mocked.

## FINDINGS

### 1. What the existing backend already did

`POST /api/teacher/interventions` already accepts `EXAM_PRACTICE` with an `EXAM` target (profile + `TOPIC_EXAM` / `DOMAIN_EXAM` / `MINI_MOCK` / `FULL_MOCK`), checks the profile belongs to the learner, and stores it in `teacher_interventions`. The Student starts it through `startExamReinforcementExecution`, which re-checks ownership, the PUBLISHED version and eligibility. None of that was changed. Missing were: a way for the Teacher to know which profiles and targets exist, any subject bound on the target, and a form.

### 2. What was added

- **Read path** (`listTeacherExamPracticeOptions`): class Teacher only (`getTeacherClass`), learner ACTIVE in that class and genuinely taught by the actor. It lists the learner's non-archived profiles that resolve to a PUBLISHED version, and inside each only what belongs to the class's subject:
  - topic practice — a blueprint objective with a PUBLISHED mapping to a concept of the class subject, on a supported component;
  - area practice — an academic subject linked to the class subject (`academic_subjects.canonical_subject_id`) with a supported component;
  - mini mock — only when the exam itself is an exam of the class subject, and the existing eligibility allows it.
- **UI**: "Práctica de examen" on the learner page, under the concept form. One select grouped by exam.
- **Endpoint**: for an `EXAM` target the route now requires the target to be one of those options, otherwise `400 EXAM_TARGET_OUT_OF_SCOPE`; a non-teacher gets `403`. It also sets a server-derived title ("PISA · Tema: M1 Ratios") so the task is not listed as the raw text `EXAM_PRACTICE`.

### 3. Behaviour changes on the existing endpoint

Over HTTP, a teacher can no longer assign: a full mock; a mini mock of a multi-subject exam; any exam target when the class has no linked subject; an objective or area outside the class subject. No UI sent these before. The service function `assignTeacherIntervention` is unchanged, so the F11 certification scripts that call it directly (`scripts/operations/f11*-cert-runner.ts`, which assign `FULL_MOCK` and `MINI_MOCK`) behave as before. The scope rule therefore lives at the Teacher endpoint, not inside the service — say if it should move into the service, which would change those scripts' outcomes.

### 4. Limits to know before certification

- **Objective-first profiles are not offered.** A profile with no exam definition (catalogue-only goal) cannot be started by the existing execution path, so it is left out. A learner who only has such goals shows "no exam practice available".
- **The teacher sees status, not a score, for exam practice.** `listClassAssignments` computes results only for quiz-based tasks. An exam-practice task shows assigned / in progress / completed. Showing the score needs a change in `class-assignment.service.ts` and falls under the same learner-data-scope question as CR-L8-01. Not done.
- **Full mock is deliberately not offered** from the Teacher surface (it creates an official mock). One-line change if wanted for single-subject exams.
- **Topic list is capped at 60 per exam profile**; the same cap applies to what the endpoint accepts.
- **Not run end to end.** Teacher assigns → Student starts → Student completes → Teacher sees it was only covered piecewise by unit tests. It needs fixtures with a class that has a linked subject and a learner with a definition-based profile on a PUBLISHED version.
- Earlier L8 status timestamps were typed by hand and ran a few minutes ahead of the clock; this run uses `date -u`.

## BLOCKERS

NONE for the lane. For Teacher E2E certification: CR-L8-01.

## CHANGE_REQUESTS

| # | Owner | Status | Request |
|---|---|---|---|
| CR-L8-01 | `L10_SHARED_FOUNDATION` / learner-data-scope policy (L10 requests any Assessment Engine change from L2) | **OPEN — hard dependency for Teacher E2E certification** | A Teacher sees exam gaps only within the academic subject(s) authorized by the class. A Mathematics teacher must not receive Reading gaps because the student has them. Today `GET /api/teacher/exam-insights` and the "Exámenes" view return every gap of each roster student. Needs a subject restriction in `examGapsFor` (`src/lib/exam-core/exam-gaps.service.ts`), which L8 did not modify. When it exists, L8 passes `klass.subjectId` from `getTeacherClassExamInsights` — one call site |
| CR-L8-02 | `L10_SHARED_FOUNDATION` (SF-4) | Ruled: keep the 403 | Coordinator stays refused on `GET /api/teacher/exam-insights`; `canAccessClass` not broadened. The wider scope work is L10's |

No new change request: nothing in L8-R1 needed a shared guard or a schema change.

## MERGE RECOMMENDATION

Merge the two L8 commits together after review. Before Stage certification, run the end-to-end path above on an environment where writes are allowed, and resolve CR-L8-01.

## NEXT SAFE ACTION

Orchestrator reviews the L8-R1 commit and routes CR-L8-01 to L10.

---

# L8 FINAL MICRO-REMEDIATION — 2026-10-11 (appended run)

Follows the Orchestrator instruction "L8 final micro-remediation" on `feat/l8-teacher-te1-te2 @ fb5fe70`, with L10 complete at `79b7f50`.

## LANE

`L8_TEACHER` — worktree `/Users/jalbornoz/PROYECTOS/studyos-l8-teacher`, branch `feat/l8-teacher-te1-te2` (local only).

## STATUS

`READY_FOR_ORCHESTRATOR_REVIEW`

| Gate | Result |
|---|---|
| L8_SHARED_ENTRY_POINT | PASS |
| TEACHER_INTERVENTION_SUBJECT_SCOPE | PASS (concept and exam targets; see Finding 4 for skill / competency) |
| L8_SIDE_CR_L8_01 | CLOSED on the L8 side. CR-L8-01 itself stays OPEN until L2's subject-aware aggregate patch |
| L8_READY_FOR_FINAL_CONVERGENCE | YES |

Unit level only: nothing ran against a real database or in a browser. These are the lane's results for review, not a certification.

## BASE SHA

`fb5fe70`.

## FINAL SHA

Two new commits on the lane branch: the merge of L10 (`26eef17`, parents `fb5fe70` and `79b7f50`), then the remediation commit on top of it. Run `git rev-parse feat/l8-teacher-te1-te2`.

## FILES CHANGED

**The lane branch now contains L10.** `getTeacherClassExamGaps` exists only on the L10 line, so L8 could not compile or be tested against it from `fb5fe70`. I merged `79b7f50` into the lane branch (not into any integration branch; nothing pushed). That brings every L10 file with it, including its three migration files `20261120_1000..1200`; L8 did not author, edit or apply them. Two conflicts, both resolved to the L10 version: `src/app/api/teacher/exam-insights/route.ts` and `tests/unit/aice-pisa-security.test.ts`.

Remediation commit, new (1):

- `src/lib/teacher/concept-assignment-scope.ts` — class-subject check for a concept assignment

Remediation commit, modified (7):

- `src/lib/teacher/exam-insights.service.ts` — reads exam data only through `getTeacherClassExamGaps`
- `src/app/dashboard/teacher/classes/[classId]/exam-insights/page.tsx` — shows what the entry point returns; says what is withheld
- `src/app/api/teacher/interventions/route.ts` — concept subject check
- `src/lib/i18n/teacher-l8-messages.ts` — one string added, twelve unused removed, four reworded
- `tests/unit/l8-teacher-te1-te2.test.ts`, `tests/unit/l8r1-teacher-exam-practice.test.ts`
- `tests/unit/f11b-teacher-intervention-api-routes-security.test.ts` — fixture only (mocks the new check)

`src/app/api/teacher/exam-insights/route.ts` is L10's file, byte for byte. No L10 file was edited: not `src/lib/authorization/**`, not its tests.

## LOCKS USED

NONE. L10's shared helpers are called, not modified.

## TESTS

| Command | Result |
|---|---|
| `vitest run tests/unit/l8r1-teacher-exam-practice.test.ts` | 36 passed |
| Same file with `api/teacher/interventions/route.ts` restored to `fb5fe70` | 3 failed: different-subject concept accepted, Reading teacher able to assign the Mathematics concept, unmapped concept / subject-less class accepted. Route restored |
| `vitest run tests/unit/l8-teacher-te1-te2.test.ts` | 23 passed |
| L10's own guards on the merged branch: `l10-cr-l8-01-teacher-exam-subject-scope`, `l10-r2-teacher-whole-learner-scope`, `aice-pisa-security` | all passed, unedited. The three L10 guard tests that L10 reported as failing "until L8 switches" now pass |
| Full suite (no database) | 530 files, 9,546 tests passed |
| `npx tsc --noEmit -p .` | exit 0 |
| `npx next build` | exit 0 |
| Browser, real database, HTTP E2E | NOT_RUN |

Requested regressions (all in `l8r1-teacher-exam-practice`, route + real `assignTeacherIntervention` + real L10 guards against a scripted database):

| Case | Test | Result |
|---|---|---|
| same learner + matching class subject | "same learner + matching class subject => assigned…" | 200, row inserted |
| same learner + different subject | "same learner + different subject => refused…" | 400 `CONCEPT_NOT_IN_CLASS_SUBJECT`, nothing inserted |
| learner outside class | "learner outside the class => refused…" | 403, nothing inserted |
| Coordinator | "Coordinator => refused" | 403, nothing inserted |

Also covered: the Reading teacher can assign that Reading concept in the Reading class and cannot assign the Mathematics one; a teacher of another class gets 403; a concept with no confirmed subject and a class with no linked subject are refused; an in-subject concept that is not the learner's own is still refused by the existing ownership check. The exam-practice restrictions from L8-R1 are unchanged and their tests still pass.

## FINDINGS

### 1. Exam insights now go through the shared entry point

- `getTeacherClassExamInsights` (page) calls `getTeacherClassExamGaps`; the route is L10's and calls it directly. No L8 file calls `examGapsFor` or `examGoalsFor` or reads the AICE tables any more.
- Preserved: teacher-only access (the entry point's `resolveTeacherClassScope`, plus `getTeacherClass` for the page), Coordinator 403 on the route and not-found on the page, class scope (ACTIVE roster), subject scope (the entry point's cut to the class subject).

### 2. What the Teacher sees changed as a consequence

The entry point withholds area totals, objective totals, exam goals and AICE entries. So the "Exámenes" view now shows: active students, students with gaps, gaps by topic, and per student the number of gap topics and their names — all within the class subject. Gone from the view: "exams this class is preparing", gaps by area, gaps by objective, each student's exam goals and dates, AICE plan entries, and the exam-family filter (it was built from the area totals). The page states that these are not shown yet. A class with no linked subject shows the existing "no subject" notice.

### 3. Concept reinforcement is bound to the class subject

`POST /api/teacher/interventions` with a concept target now requires: the actor teaches the class (`resolveTeacherClassScope`, never an institution admin), the learner is ACTIVE in it, and the concept's canonical subject (through its matched catalogue mapping) equals the class's subject. Otherwise `403 FORBIDDEN` (not the teacher of that learner in that class) or `400 CONCEPT_NOT_IN_CLASS_SUBJECT`. It fails closed: a concept with no confirmed canonical match cannot be assigned through this endpoint, and neither can anything in a class with no linked subject. Ownership of the concept is still checked by `assignTeacherIntervention`.

As with the exam rule in L8-R1, the check is at the endpoint, not inside `assignTeacherIntervention`, so the F11 certification scripts that call the service directly are unaffected. The class composer (`POST /api/teacher/classes/{id}/assignments`) already enforced the class subject.

### 4. Not covered: skill and competency targets

The same endpoint accepts `SKILL_PRACTICE` and `COMPETENCY_PRACTICE`. Those targets are catalogue rows, not learner concepts, and I found no subject bound for them; they are still accepted for any learner the teacher teaches. No UI sends them. The instruction covered concepts and exam practice only, so this is unchanged — say if it should be refused at the endpoint until a subject link exists.

### 5. Merge note for convergence

Because L10 is already an ancestor of this branch, converging L8 after L10 is a fast-forward-style merge with no conflict in the two files above. Converging L8 before L10 would bring L10 along with it.

## BLOCKERS

NONE for the lane.

## CHANGE_REQUESTS

| # | Owner | Status |
|---|---|---|
| CR-L8-01 | L10 (boundary) / L2 (exam-core aggregate) | **OPEN.** L8 side closed: L8 reads only through `getTeacherClassExamGaps`. Area and objective totals, exam goals and AICE entries stay withheld until L2's subject-aware patch lands; when it does, only L10's entry point and the L8 view change |
| CR-L10-03 (L10 → L8: use the shared entry point; handle `withheld`) | L8 | Done in this run |
| CR-L8-02 | L10 | Ruled earlier; Coordinator 403 kept |

## MERGE RECOMMENDATION

Converge L10 first, then this branch. Before Stage certification, run on a writable environment: class teacher opens "Exámenes"; assigns an in-subject concept; is refused an out-of-subject one; Coordinator is refused on both.

## NEXT SAFE ACTION

Orchestrator reviews the two new commits.
