# F14 — Security & Authorization Report

## Per-route authorization matrix (every new/modified route)

| Route | Auth check | Scope check |
|---|---|---|
| `GET /api/quizzes/session/[quizId]` | `verifyAuth` | `isOwner(actor, studentId)` + `session.studentId === studentId` re-check (not just the first) |
| `POST /api/simulation/attempts/[id]/abandon` | `verifyAuth` | `canAccessLearner(actor, attempt.studentId, 'LEARNER_INTERVENTION_CREATE')` — identical to the existing pause/resume routes |
| `POST /api/teacher/interventions` (modified) | unchanged | unchanged (`assignTeacherIntervention`'s own chain); only the *error mapping* changed, not the authorization decision |
| `/dashboard/exam-prep`, `/dashboard/exam-prep/[id]`, `/dashboard/exam-prep/attempt/[id]` | `auth()` → `getOrCreateStudentId` | `studentId` always server-derived from the caller's own Clerk identity, never client-supplied; profile/attempt ownership re-checked against the fetched row |
| `/dashboard/assignments`, `/dashboard/assignments/practice` | `auth()` → `getOrCreateStudentId` | same; `getStudentPendingTeacherInterventions`'s own WHERE clause is `student_id = $1` using the server-resolved id — "there is nothing here TO leak to another student" (the function's own documented invariant, unchanged) |
| `/dashboard/institution/[id]/{grades,classes,teachers,coverage,readiness}` | `auth()` → `getOrCreateCanonicalUser` | `requireInstitutionAccess` (F12, unchanged) inside every underlying `getInstitution*` call |

## Teacher must not access arbitrary students

Unchanged this phase — F14 added no new Teacher-facing route. The one Teacher-side change (`AssignInterventionForm.tsx`'s error mapping) is presentation-only; the underlying `assignTeacherIntervention` authorization chain (`canAccessClass`, active-enrollment check, `canTeacherManageIntervention`) is untouched.

## Institution must not access another institution

Unchanged mechanism (`requireInstitutionAccess`, F12) reused verbatim by all five new pages — no new institution-scoping logic was written.

## Parent must not access unrelated children

Unchanged — the new `/api/parent/learners/[studentId]/exam-prep` fetch this phase wires in is an *existing*, already-authorized F10 route (`getParentExamPreparation` calls `requireAccess(actorUserId, studentId)` internally); F14 added no new Parent-side authorization code.

## Student must not use Teacher assignment APIs

Unchanged — `POST /api/teacher/interventions` still requires a real, verified Teacher-class-student relationship via `assignTeacherIntervention`'s own chain; nothing in F14 weakens or bypasses it. The Student-facing `POST /api/student/teacher-interventions/[id]/start` (reused, not modified) is independently `isOwner`-gated, with an explicit code comment (F11-C1, unchanged) stating a Teacher assigning an intervention never authorizes the Teacher to execute it.

## No new authorization primitive introduced

Every check above reuses an already-certified primitive (`canAccessLearner`, `isOwner`, `requireInstitutionAccess`, `getOrCreateStudentId`/`getOrCreateCanonicalUser`) from F1/F2/F9/F12. F14 introduced zero new authorization functions, zero new role/workspace concepts, and zero new session/identity mechanisms — consistent with the task's own non-negotiable invariant.

## Bug found and fixed (security-adjacent: information leak via stack trace)

`TeacherInterventionExamProfileMismatchError` previously fell through to an unhandled 500 (a raw Next.js error response, potentially including a stack trace) instead of a controlled 400 — fixed this phase (see F14_TEACHER_EXAM_INTERVENTION_SEMANTICS.md). This is a real, if minor, hardening improvement: task §27's "no stack traces to the client" is not merely a UX nicety, it also avoids leaking internal file paths/line numbers to an authenticated-but-adversarial Teacher client.

## No existence-leaking pattern introduced

Every new "not found or not yours" case (`notFound()` on a `[examProfileId]`/`[attemptId]` mismatch, `404` on the new quiz-session route) returns the identical response whether the resource doesn't exist at all or exists but belongs to someone else — matching the existing `/dashboard/teacher/students/[studentId]` precedent from F13 exactly (never a distinct "exists but forbidden" vs. "doesn't exist" signal).
