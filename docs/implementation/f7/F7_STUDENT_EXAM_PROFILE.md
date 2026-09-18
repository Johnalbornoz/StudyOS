# F7 — Student Exam Profile

## Generalized shape (task §18)

| Column | Notes |
|---|---|
| `student_id` | FK → F1/F4's `students`. |
| `exam_definition_id` | FK, required — the one truly required scoping fact. |
| `exam_version_id` | **Nullable** — a learner may register intent before a specific version is decided. |
| `purpose` | Free text, e.g. "ADMISSION_PREP", "CERTIFICATION_PREP". |
| `programme_context` | Free text — which academic programme/stage this profile relates to. |
| `subject_focus` | Nullable — when the profile is subject-specific rather than whole-exam. |
| `exam_date` | **Nullable**. |
| `timezone` | **Nullable**. |
| `institution_target_id` | **Nullable** FK → `academic_organizations`. |
| `status` | `CHECK (ACTIVE\|PAUSED\|COMPLETED\|ARCHIVED)`. |

**Every field beyond `student_id`/`exam_definition_id` is nullable** — task §18's explicit
instruction ("do not require target score, institution, exam date for every framework") is
enforced structurally, not just by convention: a learner preparing for a subject assessment with
no institution stakes at all can create a fully valid profile with only an exam definition and a
purpose.

## Preparation Goal (task §19)

A separate, typed table rather than columns on the profile — because a profile may have zero,
one, or several goals of genuinely different shapes:

| Column | Notes |
|---|---|
| `student_exam_profile_id` | FK. |
| `goal_type` | `CHECK (TARGET_SCORE\|TARGET_GRADE\|PERFORMANCE_LEVEL\|COMPETENCY_TARGET)`. |
| `target_value` | Free text — interpretation depends on `goal_type` (a number for TARGET_SCORE, a grade label for TARGET_GRADE, etc.) — never forced into a numeric column that would make a grade/level goal awkward. |
| `competency_id` | Nullable FK → F4's `competencies` — populated only when `goal_type = 'COMPETENCY_TARGET'`. |

No exam type is forced into a numeric score target (task §19) — a learner whose only goal is
"reach the Grade 6 performance level" never needs a fabricated numeric equivalent.

## Authorization (task §35)

Profile read/write access reuses F1 identity + F2 authorization exactly as established:
`isOwner(actorUserId, studentId)` for the learner themself, `isActiveParentOf` for parent
visibility (governed entirely by F2's existing relationship approval state, never a new
permission), and institution/teacher access only through F2's existing scoped
`canTeacherAccessLearner`/`canAccessInstitution` functions — F7 introduces zero new
authorization primitives here, only calls the existing ones from `src/lib/authorization`.
Managing a profile is authorization (who may see/edit it), never conflated with F3 entitlement
(whether Exam Prep is a paid capability the learner is allowed to use) — those are two
independent checks composed at the call site, the same pattern F3/F4 already established for
"authorized AND entitled."
