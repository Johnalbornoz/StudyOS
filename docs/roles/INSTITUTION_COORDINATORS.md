# Track A — Institution creation and coordinators (Institution Admins)

**Status:** fixed and automated on DEV; ready for the manual gate. **Not certified.**

**Unchanged:** Stage/Preview, Production and Track B.

## 1. Root cause of the hosted DEV blocker

1. **Hosted DEV was serving a build without the feature.**
   - From before 22:56 UTC on 2026-10-01, the stable alias `study-os-env-dev-study-so.vercel.app` pointed at `dpl_GnYqmZ63voUAhVbDuQwPfXGbCZp4` (`study-5ia1gcokd`, built 17:13 UTC by another agent session — exam-prep traffic, i.e. the parallel track).
   - That build has the **Foundation** admin institutions page: a read-only list with no "create institution" form and no coordinator invitation at all.
   - Request logs prove the click never reached an API: the page was loaded (`GET /dashboard/admin/institutions` 200 ×5), and **no** `POST /api/admin/institutions` was ever received.
   - The alias had earlier been set to the Track A build (`72e2979`) and was later re-pointed by that other session.
2. **Even on the Track A build, the feature was incomplete:**
   - creation took only a *name*;
   - a coordinator could only be assigned to an account that already existed in StudyUS (`USER_NOT_FOUND` otherwise);
   - there was no invitation for a new person, no coordinator list with statuses, no institution detail page and no coordinator-side management.

**Neither cause was in authorization, the DB schema, RLS or validation.** The authorization (StudyUS admin role + allowlist) was correct, and it is now proven per role over HTTP.

**Risk kept open (P1, process):** the stable DEV alias is shared with another track's session. Re-verify `/api/version` before every manual run.

## 2. Model (frozen)

| | Kind | Notes |
|---|---|---|
| STUDENT / PARENT / TEACHER | **persona** — at most one per account | unchanged (PA-01) |
| Coordinator (INSTITUTION_ADMIN) | **capability**, per institution | Lives as an APPROVED `institution_memberships` row in an ACTIVE institution. The `user_roles` row only marks that it was granted. |
| Platform Admin (STUDYUS_ADMIN) | **capability** | Requires the role **and** the allowlist |

What follows from the model:
- A Teacher can also be a coordinator. That is still one persona.
- A coordinator may have **no persona**. Their entry (`/dashboard`) goes straight to `/dashboard/institution` (and to the institution itself if there is only one), never to `/role-select`.
- The INSTITUTION workspace exists only while the account coordinates at least one **ACTIVE** institution. A removed coordinator, or a suspended institution, closes it. Institution access (`canAccessInstitution`) also requires the institution to be ACTIVE.

## 3. What was built

**Migration `20261018_1200_track_a_institution_coordinators`** (additive, idempotent):
- **institutions profile:** `display_name`, `slug` (unique, collision-free backfill), `country` (ISO-2 check), `region`, `curriculum`, `primary_contact_name/email`, `timezone`, `locale`.
- **`institution_admin_invitations`:**
  - stores the token **hash only**;
  - email kept lower-case;
  - one PENDING invitation per (institution, email);
  - 7-day expiry;
  - statuses PENDING / ACCEPTED / REVOKED / EXPIRED.

**Service** (`src/services/institution-admin.service.ts`):

| Function | Behaviour |
|---|---|
| `createInstitutionProfile` | Duplicate name or slug → 409. Audited `INSTITUTION_CREATED`. |
| `updateInstitutionProfile` | Platform scope: everything, including name and status. Coordinator scope: descriptive fields only. Audited. |
| `inviteCoordinator` | Existing StudyUS **or Clerk** account → assigned directly (`ASSIGNED_EXISTING`, no second account, no invitation). Otherwise → one-time invitation plus a Clerk invitation email back to `/invite/coordinator/{token}`. Duplicates are idempotent. A non-ACTIVE institution → 409. A console-revoked capability → 409. |
| `acceptCoordinatorInvitation` | The signed-in account's email must be the invited one (403). Single use (409), expiry (410), revoked (410), inactive institution (409). An atomic PENDING→ACCEPTED claim, then the controlled `inviteInstitutionAdmin`. **No persona is created.** |
| `removeCoordinator` | A soft REVOKE. A coordinator cannot remove themself or the last coordinator; the Platform Admin can remove anyone. Audited. |

**Routes:**

| Who | Routes |
|---|---|
| Platform Admin (`guardAdminUsersRoute`) | `GET/POST /api/admin/institutions`, `GET/PATCH /api/admin/institutions/[id]`, `GET/POST …/[id]/coordinators`, `POST …/coordinators/[membershipId]/remove`, `POST …/coordinator-invitations/[invitationId]/revoke` |
| Coordinator of THAT institution (`requireInstitutionAdminActor`) | `GET/PATCH /api/institutions/[id]`, `GET/POST …/coordinators`, `…/remove`, `…/revoke` |
| Any signed-in account | `POST /api/coordinator-invitations/accept { token }` |

**UI:**

| Who | Pages |
|---|---|
| Platform Admin | *Instituciones* (create form with the full profile; list with status, place and coordinator counts) → *Institution detail* (Coordinadores: name · email · status · invited/accepted dates · Retirar / Anular invitación · invite form · copy-link; then the profile, including status) |
| Coordinator workspace | New tabs **Asignaturas**, **Coordinadores** and **Datos**, next to Resumen / Grados / Clases / Docentes / Solicitudes |
| Invitee | `/invite/coordinator/{token}`: which institution and which email; sign in or sign up; one-click accept; then the institution workspace |

No raw ids or enums are shown on any of these screens (checked over HTTP).

**DEV-only fixture Platform Admin.** The allowlist is a single real email, so automation needs a non-person admin. `studyus-ta-platform-admin+clerk_test@example.com` is allowlisted **only** when the Clerk key is a test key **and** the target is hosted `dev` (or a local run). It is never allowlisted on Preview or Production (unit-tested), and the canonical STUDYUS_ADMIN role is still required on top.

## 4. Evidence

| Check | Result |
|---|---|
| Unit (full) | 6,648 / 6,648 at the candidate (25 new in `track-a-institution-coordinators.test.ts`; workspace-resolver test updated to the ACTIVE-institution rule) |
| Migration cert (ephemeral PG) | ALL CHECKS PASSED (idempotent, slug backfill, duplicate slug, ISO-2, one pending invite, lower-case email, rollback + re-apply) |
| Institution / coordinator E2E (`track-a-institution-e2e-http.ts`) | 100 / 100 locally; hosted run in the release message |
| Roles E2E / Teacher E2E (regression) | 170 / 170 and 104 / 104 locally on the same build |

**What the institution E2E covers (C1–C16 + DB audit):**
- Create authorization: Platform Admin 201 / Institution Admin, Teacher, Parent, Student, StudyUS-capability student 403 / anonymous 401, 0 rows.
- Full profile stored; duplicate 409; invalid country/timezone 400; DRAFT institution cannot get coordinators.
- New coordinator: invite, duplicate invite, token never stored, wrong account 403, anonymous 401, accept, accept again, used by another 409, inviter notified.
- Capability-only entry goes to the institution workspace and every section renders.
- Expired invite 410; a person who signed up becomes the existing-account path.
- Coordinator actions: edit descriptive data only (name/status ignored); grade; class with subject; sees the pending teacher as *Nombre · email*; approves; assigns; the teacher sees the class.
- Coordinator management: cannot remove self; removes another (soft); the removed one loses access and workspace; invites a new person.
- Existing Teacher becomes coordinator of B: no duplicate account, no invitation row, still one persona, cannot add another.
- Isolation A↔B over 8 endpoints each, plus pages; a coordinator is not a Platform Admin and cannot self-grant it.
- Suspend → access and workspace gone, invites 409; reactivate → restored.
- Revoke an invitation; revoke from another tenant 404.
- DB audit:
  - max one persona per account;
  - no duplicate emails;
  - one pending invite per email;
  - accepted invites have a membership;
  - coordinator memberships carry the capability;
  - slugs set;
  - every audit action present;
  - TA institutions untouched.

## 5. Manual package (hosted DEV)

Prepared state: `teacher-reset` (which also runs `institution-reset`), so the Teacher package (Teresa, `TEACHER_E2E_MANUAL_PACKAGE.md`) and this one are independent:
- no *Institution E2E* institutions;
- `coord-a` / `coord-x` not signed up;
- `coord-b` = Teacher without coordination.

The sign-in links are one-time and handed over separately. The Platform Admin can be the operator's own allowlisted account or the fixture admin.

| # | Who | Action | Expected | Query (read-only) |
|---|---|---|---|---|
| 1 | Platform Admin · `/dashboard/admin/institutions` | Create **Institution E2E A** (country CO, Bogotá, curriculum, ACTIVE, contact, America/Bogota, Español) | Lands on the detail page, *Activa*, no coordinators | `SELECT name,status,slug,country,timezone,locale FROM institutions WHERE name LIKE 'Institution E2E%'` |
| 2 | Platform Admin · detail page | Invite **Andrea Coordinadora A** · `studyus-ta-coord-a+clerk_test@example.com` | "Invitación enviada…"; the row shows *Invitación pendiente* with the date; *Copiar enlace de invitación* | `SELECT email,status,expires_at FROM institution_admin_invitations` |
| 3 | Andrea · invitation link (fresh browser profile) | Create the account with that email (or the prepared one-time link), then **Aceptar invitación** | Lands directly in *Institution E2E A* (Resumen); never on role selection | `SELECT status,accepted_at FROM institution_admin_invitations`; membership APPROVED |
| 4 | Andrea · Grados / Clases | Create **3º Preparatoria**; class **Matemáticas 3A** with **Mathematics** | Visible in Clases and Asignaturas | `SELECT g.name,c.name,cs.name FROM classes c …` |
| 5 | Tomás Docente B (Teacher) · `/dashboard/teacher` | Request **Institution E2E A** | Pending | membership PENDING |
| 6 | Andrea · Solicitudes | See **Tomás Docente B · email** → **Aprobar** | Approved | membership APPROVED |
| 7 | Andrea · class page | Assign Tomás to *Matemáticas 3A* | Tomás listed; Tomás sees the class | `teacher_assignments` ACTIVE |
| 8 | Bernardo (Teacher) · Platform Admin invites his email to a second institution | — | "La persona ya tenía cuenta…"; Bernardo keeps *Profesor* and gains *Institución* in navigation | one persona row + coordinator membership |
| N | Andrea opens Institution E2E B's URL / `/dashboard/admin/institutions` | — | Not found / not allowed | — |
