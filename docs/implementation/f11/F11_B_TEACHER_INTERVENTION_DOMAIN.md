# F11-B — Teacher Intervention Domain

## Baseline verification (housekeeping)

`git rev-parse HEAD` → `afc3507b3fb8727fe3ace2b9dd0f85dca6c9fe19`. `git status --short` → clean. `git merge-base --is-ancestor afc3507... HEAD` → true (trivially — HEAD equals it exactly). Confirms F11-B started from the real, certified F11-A baseline.

**On the `5bc984d`/`afc3507` discrepancy raised for this baseline**: `5bc984d` was F11-A's implementation commit; `afc3507` was a follow-up documentation-only commit on the same branch that corrected the doc's own "Certified Commit SHA" line, but the doc's persisted text still self-referenced `5bc984d` (a file cannot know the hash of the commit that will contain it). The final F11-A chat report correctly cited `afc3507` as the true branch tip, and that is what F11-B has, in fact, branched from (confirmed above). No F11-A commit was rewritten or amended to resolve this — it is a documentation clarification only, recorded here.

## Objective

Resolve the F8/F11 intervention-domain collision by implementing a new, minimal `teacher_interventions` entity representing Teacher pedagogical intent + assignment, strictly separate from F8's `intervention_sessions` (execution). No change to F8's owner-only self-service model.

## Scope corrections applied (per explicit instruction)

- **No `resulting_intervention_session_id`** — the F11↔F8 execution-linking contract is deferred to a later orchestration phase.
- **No `assigned_via_class_batch_id`** — class-level batch assignment is deferred; F11-B is individual-student assignment only.
- **`class_id` is `NOT NULL`** — every intervention records the concrete class context through which the Teacher legitimately reaches the student, even when the underlying assignment is grade-wide.

## Domain Model

New table `teacher_interventions` (migration `20260928_1000_f11b_teacher_intervention_domain.sql`, purely additive, zero changes to any existing table):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `assigned_by_user_id` | uuid NOT NULL | FK → `users(id)` |
| `institution_id` | uuid NOT NULL | FK → `institutions(id)`, resolved server-side from `class_id`, never client-supplied |
| `class_id` | uuid NOT NULL | FK → `classes(id)` |
| `student_id` | uuid NOT NULL | FK → `students(id)` |
| `target_type` | text NOT NULL | `CONCEPT｜SKILL｜COMPETENCY｜LEARNING_OBJECTIVE` |
| `concept_id`/`skill_id`/`competency_id`/`learning_objective_id` | uuid, nullable | FK → their respective canonical tables; exactly one non-null, enforced by `teacher_interventions_target_consistency_check` |
| `intervention_type` | text NOT NULL | `CONCEPT_REINFORCEMENT｜SKILL_PRACTICE｜COMPETENCY_PRACTICE｜EXAM_PRACTICE` |
| `reason`, `instructions` | text, nullable | |
| `assigned_at` | timestamptz NOT NULL DEFAULT now() | |
| `due_at` | timestamptz, nullable | |
| `status` | text NOT NULL DEFAULT 'ASSIGNED' | `ASSIGNED｜IN_PROGRESS｜COMPLETED｜CANCELLED｜EXPIRED` — operational only, never an outcome judgment |
| `cancelled_at`, `cancelled_by_user_id`, `cancellation_reason` | nullable | populated iff `status='CANCELLED'`, enforced by `teacher_interventions_cancellation_check` |
| `created_at`, `updated_at` | timestamptz NOT NULL DEFAULT now() | |

Four real FK columns (not one polymorphic edge), matching F6's own stated rationale for concrete FK integrity over a single untyped reference.

## Authorization

New, deliberately separate type `TeacherInterventionPermission` (`src/lib/authorization/permissions.ts`) — **not** added to `LearnerPermission`, to prevent it from ever being reachable through the generic `canAccessLearner` composition. New function `canTeacherManageIntervention(actorUserId, studentId, permission)` (`src/lib/authorization/index.ts`) delegates entirely to `canTeacherAccessLearner` — never composed with Owner/Parent.

`assignTeacherIntervention` re-runs the full chain explicitly, exactly as required — never inferred from stored ids alone:
1. Resolve `institution_id` from `class_id` (fails closed if the class doesn't exist).
2. `canAccessClass(actor, classId, ...)` — Teacher can access this exact class.
3. `class_enrollments` — the student has an ACTIVE enrollment in **this exact class** (not merely "some class this teacher teaches").
4. `canTeacherManageIntervention` (→ `canTeacherAccessLearner`) — an independent, genuine Teacher relationship to this learner (catches the case `canAccessClass` alone would miss: it also admits Institution Admins, who are not necessarily this student's real teacher).

`LEARNER_INTERVENTION_CREATE` and F8's owner-only route/permission set are untouched — confirmed by a source guard test.

## API Surface

| Route | Method | Permission |
|---|---|---|
| `/api/teacher/interventions` | POST | `TEACHER_INTERVENTION_ASSIGN` |
| `/api/teacher/students/[studentId]/interventions` | GET | `TEACHER_INTERVENTION_VIEW` |
| `/api/teacher/interventions/[id]/cancel` | POST | `TEACHER_INTERVENTION_CANCEL` |

Each route resolves the actor, validates input (zod, including a discriminated union on `target`), delegates entirely to the domain service, and maps `TeacherInterventionAccessDeniedError`→403, `TeacherInterventionNotFoundError`→404, `TeacherInterventionInvalidTargetError`→400 (a well-formed but nonexistent target id is a clean 400, never a raw FK-violation 500).

## Test Matrix

```
AUTOMATED_DOMAIN_UNIT: 5545 executed / 5545 passed (20 net new)
REAL_POSTGRES (F11-B): 21 assertions -- ALL PASS on first run
  - happy-path assign/view/cancel lifecycle + idempotent re-cancel
  - required cases 1-7 (role-alone, wrong class, wrong institution, revoked membership, ended assignment, ended enrollment)
  - multi-role PARENT+TEACHER isolation (both directions) + fixture-validity proof
  - OWNER (self) relationship denial
  - class-roster leakage denial (wrong class_id for a real, differently-classed student)
  - migration idempotency (second application, no error)
  - 2 real DB-level CHECK constraint proofs (target-type mismatch rejected at the database; invalid target FK mapped to a clean domain error)
F2_REGRESSION: 6 files/58 tests unit + real-Postgres cert -- PASS, unchanged
F10_REGRESSION: 5 files/31 tests unit + real-Postgres cert + multi-role check -- PASS, unchanged
F11A_REGRESSION: 2 files/13 tests unit + real-Postgres cert -- PASS, unchanged
FULL_REPO_SUITE: 5545/5545 PASS
TSC: clean
BUILD: clean, all 6 teacher routes present
```

## Bugs Found

None. Applying F10's and F11-A's own lesson from the start (Teacher-specific primitives only, never the generic composed check) meant no widening bug was found in either F11-A or F11-B.

## Compatibility

F8's `/api/teaching/interventions*`, `intervention_sessions`, `intervention_attempts`, and `LEARNER_INTERVENTION_CREATE` are completely untouched — zero lines changed, confirmed by the source guard test and by F8's own (untouched) test files continuing to pass unmodified within the full 5545-test run.

## Open Decisions Carried Forward

- The F11↔F8 execution-link (deferred `resulting_intervention_session_id`) and class-batch assignment (deferred `assigned_via_class_batch_id`) remain explicitly unimplemented, per instruction, for a future orchestration phase.
- `getActiveExamProfile`-equivalent duplication note (F10_NEXT_PHASE_HANDOFF.md, F11_A doc) is unaffected by this phase.

## Certified Commit SHA

Recorded after commit — see final report §M.
