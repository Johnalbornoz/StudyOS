# Roles E2E (Track A) — Implementation

- **Base:** Foundation `2f94a1f2fba3bff10b04b933eacfde775be75672` (FOUNDATION_VERDICT=PASS, frozen).
- **Branch:** `track-a/roles-e2e`. `main`, `develop`, Preview and Production are untouched. Track B is not merged.
- **Scope:** A1 identity / single persona, A2 Parent, A3 Teacher, A4 Institution, A5 integrated flow, A6 DEV certification.
- **Product amendment PA-01 (2026-10-01):** one canonical user → ONE primary functional persona (STUDENT / PARENT / TEACHER); institution and StudyUS administration are capabilities. Recorded in `docs/foundation/ROLES_EXAMS_SHARED_FOUNDATION.md` (PA-01). This replaces the additive multi-role behaviour Track A first shipped.
- **Student stays frozen.** No Learning Engine change. Role modules assign, observe, organize and report. They never write mastery, knowledge state, evidence, retention, transfer, misconceptions or readiness (source-guarded, §6).

## 1. What was reused from the Foundation

| Area | Reused as-is | Extended in Track A |
|---|---|---|
| Identity | `users`, `user_roles`, `getOrCreateCanonicalUser`, `assignSelfServiceRole` (audited, revoked → 409), workspaces | Email backfill. `getRevokedRoles`. Explicit active workspace on role add. `/api/identity/me` reports the resolved active workspace. |
| Authorization | `isActiveParentOf`, `canTeacherAccessLearner`, `canAccessClass`, `canAccessInstitution`, `isOwner` | `requireParentProfileId` (Parent-only gate). `isTeacherOfClass` (teaches the class; never an admin). `requireInstitutionAdminActor`. |
| Parent | `parent_student_relationships`, `parent_invitations`, F10 Parent Read Model | Parent-initiated request without an existence oracle. Accepted-only child list. Invitation acceptance grants the PARENT role. |
| Institution | `institutions`, `institution_memberships`, `grades`, `classes`, `class_enrollments`, `teacher_assignments`, `createTeacherAssignment` (F3 tenant guard) | Grade, class and roster APIs. Consent-based enrollment. Re-request after REJECTED/REVOKED. Revoke limited to TEACHER. Audited decisions. |
| Assignment | `teacher_interventions` + `assignTeacherIntervention` (full per-learner chain) + F11 execution / reconciliation | Class-level publish (N interventions, one `assignment_group_id`). Results view. Scoped list and cancel. Type/target and own-concept checks. |
| Learning boundary | `updateMastery` via the Student's own practice submission (`/api/quizzes/generate-and-take`) | None. The assignment only schedules work. |
| Notifications | `notifications` table | Recipient = `users.id` + workspace, typed payload, localized rendering, mark-read, per-workspace unread badge. |
| Entitlements | `canUseCapability` (per learner) | None. Parent and teacher views never consult entitlements. |

## 2. Migration (DEV only)

Applied through the governed runner (`npm run db:migrate`): `database/migrations/20261018_1000_track_a_roles_e2e.sql`.

It is additive. It creates no table, drops no column and rewrites no row.

| Change | Why |
|---|---|
| `notifications`: add `recipient_user_id`, `workspace`, `payload`, `action_href`; make `student_id` nullable; CHECK that a recipient is present | Teachers and institution admins have no `profiles` row, so they could never be notified. Parent notifications were written but never read. |
| `teacher_interventions.assignment_group_id` (nullable) | Groups the N per-learner rows of one class assignment |
| `class_enrollments`: status `PENDING` / `DECLINED` added; `invited_by_user_id`, `responded_at`, `ended_at` added | Consent-based enrollment. Every authorization check already requires `ACTIVE`, so `PENDING` grants nothing. |
| `teacher_assignments`: CHECK that a grade or a class is set (`NOT VALID`) | A scope with neither granted nothing. The old UI created exactly such rows. |

- **Idempotent.** Every statement is safe to re-apply.
- **Rollback.** Documented in the migration header.
- **Certification.** `scripts/operations/track-a-roles-migration-cert.sh` runs on an ephemeral Postgres. It covers: apply, idempotency, constraint behaviour, the documented rollback, and re-apply. Result: all pass.
- **DEV ledger.** 42 applied, 0 pending, 0 drift.
  - One of the 42 is Track B's `20261019_1000_track_b_exam_core_verticals`. A parallel session applied it to the shared DEV DB, and it is not in this branch.
  - The runner reports it applied and not drifted.
  - Track A neither reads nor depends on it.

## 3. Functional flows

### A1 Identity — single primary persona (PA-01)

- **First entry:** an account with no persona sees `/role-select` once and chooses exactly ONE persona (the server refuses a second: 409 `PERSONA_EXISTS`, one transaction serialized on the user row). It then lands in that persona's workspace / onboarding.
- **Afterwards, never role selection again.** `/role-select` becomes an account page whose primary action is **"Ir a mi espacio de {persona}"** (e.g. *Ir a mi espacio de Profesor*). A Teacher also sees the institutional authorization status. Nobody is stranded there after approval.
- **No "Añadir otro rol", no persona switcher.** The shell shows the account's persona as a plain label. Capabilities (Institución, Administración) are navigation links; `/dashboard/institution/**` and `/dashboard/admin/**` render in their capability context and every other page renders in the persona. A stored capability workspace never displaces the persona.
- **Capabilities are not personas.** An institution admin or StudyUS admin may also hold one persona; the capability never counts as "another role" and is never selectable. Self-service still refuses INSTITUTION_ADMIN / STUDYUS_ADMIN (400).
- **Revoked persona:** never re-granted, still blocks choosing another (`PERSONA_EXISTS`), explained on the account page.
- **Admin console:** a persona is assigned only when the account has none active; changing persona = revoke, then assign (deliberate).
- **Parent invitations:** accepting grants PARENT only to an account without a persona (`PERSONA_CONFLICT` otherwise).
- **One inbox per account:** notifications of the persona plus its capabilities, scoped per (user, workspace).
- **DEV data:** two real DEV accounts held two personas (`i***@gmail.com` STUDENT+TEACHER, `p***@jalbornoz.com` TEACHER+PARENT). Normalized deterministically, DEV only, nothing deleted: keep the persona carrying data, else the earliest granted; soft-revoke the rest (audited `ROLE_REVOKED`, reason `TRACK_A_SINGLE_PERSONA_DEV_NORMALIZATION`). Result: STUDENT kept for `i***`, TEACHER kept for `p***`. Script: `scripts/operations/track-a-single-persona-normalize.ts` (dry run by default).

Also fixed earlier in A1: an admin granting STUDENT to another account used to copy the admin's email and name onto the new student row; it now resolves the target through the Clerk Backend API.

### A2 Parent

1. The Parent sends a request by the child's account email. The response is identical whether or not the email belongs to a student.
2. A match creates a `pending` relationship and notifies the Student.
3. The Student accepts or declines in Notifications.
4. On acceptance, the Parent sees the child through the F10 read model: subjects, practice coverage, attention areas (fixed categories), exam preparation and recent activity.
5. The child switcher lets a Parent with several children change context.
6. Revoking is available to either side.

The flow is read-only throughout. Pending requests are never listed with the child's identity. At most 10 requests may be outstanding.

**Fixes in this area:**

- The Parent page used to POST to a retired route (405).
- The legacy children list exposed pending children.
- Parent routes did not check for the PARENT role.

### A3 Teacher

1. The Teacher requests membership of an ACTIVE institution. It is PENDING, and the home page shows an explicit pending state.
2. The institution approves.
3. The institution assigns a class or grade.
4. The Teacher sees the roster.
5. The Teacher publishes a class assignment: a catalog topic resolved to each learner's own MATCHED concept. Learners without that concept are reported, never guessed.
6. The Teacher reads each learner's outcome. Status is reconciled from the canonical activity, and the result is the activity's own grades.
7. Per-learner assignment uses a picker of the learner's own concepts. Cancelling is scoped to classes the Teacher teaches.

**Fixes in this area:**

- The intervention list exposed other classes' and other institutions' rows.
- The Teacher saw a stale IN_PROGRESS status.
- "Continue" generated a new quiz on every click.
- Quizzes were always generated in English.
- An all-or-nothing generation failure stored an **empty** activity. It now returns a retryable 503 and writes nothing.
- The practice score showed 1500%.

### A4 Institution

The Institution Admin owns the structure (product decision). The admin can:

- create grades and classes, under the institution's own grades only;
- staff a class with approved teachers;
- invite students by email, with consent: the student accepts in Notifications;
- remove or withdraw enrollments;
- approve, reject or revoke teacher requests (TEACHER only; audited; the teacher is notified).

The StudyUS admin creates institutions and assigns each institution's admin by email. Both actions are audited.

**Manual-gate fix (identity of requesters):** the StudyUS admin inbox ("Membresías institucionales pendientes") and the institution's own requests page now show WHO is asking — *Nombre · email* (email alone when no name), then role, institution and date — resolved server-side from the membership's own user (StudyUS records, then the Clerk profile), only for rows the viewer is already authorized to see. The Clerk ↔ StudyUS inconsistency rows show name / email / state / roles with a link to the user's admin page instead of an anonymous "internal account".

**Fixes in this area:**

- The teacher-assignment UI created scope-less (useless) assignments.
- Raw user ids were shown instead of emails.
- Approve/Reject were unstyled 22 px buttons that swallowed errors.
- Admins could revoke another admin.
- Rejected teachers could never request again.
- A StudyUS admin's link pointed into a workspace that returns 404 for them.

### A5 Integrated flow

1. Institution A admin creates a grade and class.
2. The admin approves Teacher A and assigns the class.
3. The admin invites Student A, and Student A accepts.
4. Teacher A publishes "Linear Equations".
5. Student A sees it under *Mis tareas*, starts it (owner only) and submits the practice.
6. `updateMastery` records the evidence through the canonical engine.
7. The Teacher sees COMPLETED with the graded result (*n de 20 correctas*).
8. Parent A, linked by consent, sees the activity in the summary.

Exam assignment is deferred to the cross-track integration.

## 4. Notifications (single architecture)

| Notification | Recipient |
|---|---|
| Parent request | Student |
| Accepted / declined | Parent |
| Teacher request | Institution admins |
| Approved / rejected / revoked | Teacher |
| Class assigned | Teacher |
| Class invitation | Student |
| Enrollment accepted / declined | Inviting admin |
| New assignment | Student |

Every workspace has its inbox at `/dashboard/notifications`, with mark-read and an unread badge. Messages render in the reader's locale from type + payload.

## 5. Tests and evidence scripts

- **Unit:** `tests/unit/track-a-*.test.ts` (65 tests): services, routes, source guards, i18n.
- **Fixtures:** `scripts/operations/track-a-fixtures.ts`. DEV only, enforced twice (DB fingerprint and Clerk instance).
  - Creates 9 Clerk test identities (`+clerk_test@example.com`, no password) and the fixture world, through real services.
  - Issues short-lived backend session tokens and sign-in tickets.
  - `cleanup` removes everything.
- **E2E:** `scripts/operations/track-a-e2e-http.ts`. Real HTTP and real Clerk sessions.
  - Covers A1–A5, 42 security cases, 14 authenticated page renders of the 12-step journey, and 13 data-integrity checks.
  - Runs locally or against hosted DEV. Hosted DEV uses an existing automation bypass secret supplied by env.

## 6. Known deferred items

| Item | Class |
|---|---|
| Exam assignment (EXAM target) in the class composer | Deferred to cross-track integration |
| F12 institution intelligence pages (learners, coverage, readiness, interventions, attention) show engineering-English explainability strings; raw UUID inputs on coverage / readiness | P2 (certified F12 surfaces, outside Track A changes) |
| DRAFT state for assignments (publish is one step) | P3 (Foundation §16 non-blocking) |
| Institution seat / licence model | P3 (Foundation §16 non-blocking) |
| `scripts/e2e-cognitive-loop.ts` throws `INVALID_CURRENT_TRANSFER_EVIDENCE`; identical at the base SHA (pre-existing script drift) | P3 (not Track A) |
| Membership decision history keeps only the latest decision per (institution, user, role) | P3 (pre-existing) |
