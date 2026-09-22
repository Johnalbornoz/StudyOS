# F15 — Onboarding, Role Selection, Licensing, and Authorization Rework (2026-09-21)

**Status of this document**: this is a new, additive document, not a rewrite of any prior F15 artifact. It reconciles with, and does not contradict, `F15_FINAL_REPORT.md`, `04_IDENTITY_ROLES_AND_AUTHORIZATION.md`, and `05_STUDENT_TEACHER_PARENT_INSTITUTION_FLOWS.md` — see the short annotation blocks appended to each of those (search for "Onboarding rework, 2026-09-21") rather than a silent edit of their own conclusions.

**Branch**: `f15-c1/pilot-gate-closure`. **Worktree**: `/private/tmp/claude-501/-Users-jalbornoz-PROYECTOS-studyos/fed077fb-9c20-42da-9c5d-faf2f70bc9e2/scratchpad/f15-pilot-readiness` (the only worktree touched for this work). **Commits**: `6ef8be1`..`a85aeda` (7 commits) on top of the pre-existing `bc3fec8`/`3ad94e6` history. **HEAD at time of writing**: `a85aeda4e33c93461b5fc1a761f709f58582b7c7`.

## 0. Why this work happened

Prior to this rework, `POST /api/webhooks/clerk` (`user.created`) and `DashboardLayout`'s own fallback both silently minted a `students` row and treated **every** newly authenticated account as a Student — Clerk's authentication event was being conflated with a StudyUS role decision. Parents could unilaterally search for and link to a student by email (`POST /api/parent/link-child`). No route distinguished "has a Student role" from "has ever called `getOrCreateStudentId`." This document is the record of closing those gaps.

## 1. The model (unchanged from F1/F2/F3, now actually enforced end-to-end)

| Concept | Owning table/service | What it decides |
|---|---|---|
| **Authentication** | Clerk (external) | Who the user is. StudyUS never re-implements login. |
| **Role** | `user_roles` (F1) — `STUDENT \| PARENT \| TEACHER \| INSTITUTION_ADMIN \| STUDYUS_ADMIN` | What kind of actor this account is allowed to act as. |
| **Workspace** | `users.active_workspace` (F1) | UI context only. Switching workspace never grants a role, relationship, license, or permission (INV-F1-13/14, unchanged, re-verified this phase). |
| **Relationship** | `parent_student_relationships` (F2) | Which student a Parent may consult — only when `status='accepted'`. |
| **License/entitlement** | `subscriptions` + `canUseCapability` (F3) | Whether a Student's access is DEMO or FULL. |
| **Institutional authorization** | `institution_memberships` (F2) | Whether a Teacher/Institution-Admin request is PENDING/APPROVED/REJECTED/REVOKED. |
| **Assignment** | `teacher_assignments` (F2) | Which class/grade/subject a Teacher may actually consult, under an APPROVED membership. |

No new parallel system was created for any of these six concepts. Every fix in this phase closes a place where an existing table/service was being bypassed, mis-scoped, or never consulted — never a second identity/role/payment system.

## 2. Post-Clerk flow — before and after

**Before**: `user.created` → `upsertStudentFromWebhook` → a `students` row exists → the account can reach `/dashboard` and is treated as a Student everywhere, with no `user_roles` decision ever made.

**After**:
```
Clerk sign-up
   │
   ▼
user.created webhook  →  getOrCreateCanonicalUser(clerkId, email)
   │                         (creates ONLY `users`, zero `user_roles`)
   ▼
first authenticated /dashboard request
   │
   ▼
DashboardLayout: resolveAvailableWorkspaces(user.id) === []  ?
   │                                                    │
   │ yes                                                │ no
   ▼                                                    ▼
redirect('/role-select')                    resolve activeWorkspace, render
   │                                          that workspace's shell
   ▼
/role-select: user picks STUDENT | PARENT | TEACHER
   │
   ▼
POST /api/identity/roles/select
   → assignSelfServiceRole (writes ONE user_roles row)
   → resolveDefaultWorkspace + setActiveWorkspace (persists the
     initial workspace so the very next /dashboard load resolves
     correctly, not just this one)
   → STUDENT only: getOrCreateStudentId (the existing, unchanged,
     canonical dual-identity provisioning path — see 04)
```

`src/app/api/webhooks/clerk/route.ts` now calls `getOrCreateCanonicalUser` only — it cannot create a role, a `students` row, or a `profiles` row, structurally (no import of any of those provisioning functions exists in that file). `src/app/dashboard/layout.tsx` redirects to `/role-select` before resolving any workspace or calling `getOrCreateStudentId` whenever `resolveAvailableWorkspaces` returns `[]`. `/role-select` itself renders unconditionally for any authenticated caller and never redirects back to `/dashboard` on its own — a zero-role account cannot loop between the two routes.

**Test evidence**: `tests/unit/clerk-webhook-no-auto-student.test.ts`, `tests/unit/dashboard-layout-role-redirect.test.ts` (8 cases, including the fail-closed license-banner cases added this sub-phase).

## 3. Legacy-account compatibility

No account, role, payment, or relationship was deleted, reclassified, or backfilled by this phase. The redirect-to-`/role-select` behavior for a zero-role account depends entirely on `resolveAvailableWorkspaces` correctly reporting `[]` for such an account — which in turn depends on the F1 backfill migration (`20260919_1000_f1_unified_identity.sql` + its backfill script) having already run in whatever environment this reaches, so that every **pre-existing** account has at least the `user_roles` row its historical usage implies (e.g. every row that was already a `students` record gets a `STUDENT` role, `granted_via='BACKFILL'`). This was independently confirmed already done for the current Preview database during the earlier F15-C1 sub-phase (see `03_DATABASE_SCHEMA_AND_MIGRATIONS.md`) — it is **not** re-run or re-verified by this phase, and is called out explicitly here as a deployment prerequisite for any *other* environment this code reaches: **before this code is deployed anywhere the F1 backfill has not already been confirmed complete, an operator must re-run that backfill's own dry-run/verification step first**, or legitimate legacy accounts with zero `user_roles` rows will be sent to `/role-select` and asked to re-declare a role they already effectively had. This is a safe failure mode (no data loss, no wrong access — worst case is a re-click), not a silent misclassification, but it is real friction worth flagging before a wider rollout.

## 4. Student flow

- Self-registration: unchanged, direct.
- Role selection → `assignSelfServiceRole(..., 'STUDENT')` → `getOrCreateStudentId` (the pre-existing, unchanged dual-identity mint/repair path) → default workspace `STUDENT` persisted.
- **DEMO vs FULL access**: `canUseCapability(actorUserId, studentId, 'LEARNING_FULL_ACCESS')` (F3, unchanged) is the sole authority. This phase **extended enforcement** to the routes that were not yet gated:

| Route | Gate added this phase |
|---|---|
| `POST /api/tutor/message`, `GET/POST /api/tutor/conversations` | `LEARNING_FULL_ACCESS` |
| `POST /api/quizzes/generate`, `/generate-and-take`, `/hint` | `LEARNING_FULL_ACCESS` |
| `POST /api/exam-readiness/score` | `LEARNING_FULL_ACCESS` |
| `POST /api/cognitive/explain/generate`, `/transfer/generate`, `/remediation/start` | `LEARNING_FULL_ACCESS` |
| `POST /api/study-plan/generate` | `LEARNING_FULL_ACCESS` |

Read/history routes (`LEARNING_HISTORY_VIEW`) were deliberately left ungated per F3's own "history view is never revoked" design (unchanged from before this phase). Blocking is server-side in every case above — a client that hides the button but still calls the route gets a `403`, not a degraded UI.

**Visible cue** (new this phase): `src/app/dashboard/LicenseBanner.tsx`, wired into `src/app/dashboard/layout.tsx`, shows a persistent Spanish banner ("Estás en modo demostración...") across the Student shell whenever `canUseCapability` denies `LEARNING_FULL_ACCESS`, fails closed to **showing** the banner if the check itself errors, and is never shown during Focus Mode (an in-progress quiz/activity) so it cannot interrupt one. This is cosmetic — the actual block is the server-side check above, unaffected by whether the banner renders.

**License sources**: individual payment, parent-paid payment, institutional license, administrative grant — all pre-existing in F3's `subscriptions` model; no new source was invented. The one real gap closed this phase: `payer_user_id` (a column F3's own migration already added but nothing wrote) is now actually populated by `createMercadoPagoCheckout`, so "who paid" is now recorded and distinct from `subscriptions.student_id` ("who owns the license") — see §6.

## 5. Parent, tutor, or coach flow

**Before**: `POST /api/parent/link-child` let a Parent supply an arbitrary child email and immediately create the relationship — a Parent-initiated, self-service link, exactly what the task forbids.

**After** — student-initiated only:
```
Student: POST /api/student/parent-invitations {email}
   → parent_invitations row, status='pending'
Parent (must sign in/up with EXACTLY that email):
   GET  /api/parent/invitations           (own verified email only, never a param)
   POST /api/parent/invitations/[id]/respond {decision: accept|decline}
   → on accept: parent_student_relationships row created (status='accepted')
```
`POST /api/parent/link-child` was **removed entirely** (the file now exports only `DELETE`, for a Parent revoking their own existing link). A Parent account with zero accepted relationships sees an explicit Spanish empty state on `/role-select` ("Todavía no tienes ninguna invitación...") — never a student dashboard, never a search box.

**New table**: `parent_invitations` (migration `database/migrations/20260921_1100_student_initiated_parent_invitation.sql`, renamed 2026-09-21 from `20260921_1000_student_initiated_parent_invitation.sql` after a real version collision with F3 was discovered — see R14 in `F15_RESIDUAL_RISK_REGISTER.md`; content unchanged) — additive, was required because the existing `parent_student_relationships` table has `parent_id` as part of a composite `PRIMARY KEY (parent_id, student_id)`, which Postgres forbids being `NULL`; there was no way to represent "invited but not yet a real parent" inside that table without either violating the PK or inventing a sentinel value, so a minimal, purpose-built invitation table was added instead of adapting the existing one. **Not yet applied to any database** — see §9.

**Enumeration safety**: `GET /api/parent/invitations` resolves the email from the caller's own Clerk session (`currentUser()`), never from a request parameter — there is no code path by which a Parent can probe for a student by email.

**Paying never substitutes the relationship**: `POST /api/payments/checkout` accepts an optional `studentId` (parent-pays-for-child); the route calls `isActiveParentOf(payer.id, studentId)` and returns `403` if false, **before** any checkout logic runs. Checkout has no code path that creates, upgrades, or bypasses `parent_student_relationships` — see `tests/unit/payment-never-grants-parent-relationship.test.ts`.

## 6. Teacher flow

Unchanged from F2's own design, now with a self-service UI (there was none before this phase):
```
Teacher: browse GET /api/institutions (ACTIVE institutions only)
   → POST /api/institutions/[id]/membership   (always PENDING, always TEACHER)
   → status visible via GET /api/teacher/my-memberships
Coordinator (INSTITUTION_ADMIN): GET  /api/institutions/[id]/memberships/pending
                                 POST .../memberships/[membershipId]/decide {APPROVED|REJECTED}
                                 POST .../memberships/[membershipId]/revoke
                                 POST .../assignments {institutionMembershipId, gradeId?, classId?, subjectLabel?}
```
While `PENDING`, the Teacher UI (`/role-select`) shows a Spanish waiting message and offers no class/student data — there is nothing else it *could* show, since `canTeacherAccessLearner` (F2, unchanged) requires `APPROVED` membership as its first condition. After `APPROVED`, a Teacher still has no learner access until a coordinator creates a `teacher_assignments` row — `canTeacherAccessLearner`'s full condition set (unchanged from F2) is: `APPROVED` membership AND `ACTIVE` assignment AND `ACTIVE` enrollment AND class/grade coverage AND same institution, joined in one SQL query, never assembled from separate trust-the-client checks.

**New this phase** (previously missing entirely — backend routes existed, zero UI consumed them):
- `GET /api/institutions` / `listActiveInstitutions()` — the browse-to-request list a Teacher needs.
- `GET /api/teacher/my-memberships` / `getMyTeacherMemberships()` — a Teacher's own status across every institution they've requested at.
- `/dashboard/institution/[institutionId]/requests` — the coordinator's PENDING-request review screen (approve/reject) plus a decided-memberships history view.
- Revoke/assign actions added to the existing `/dashboard/institution/[institutionId]/teachers` roster page.
- `listDecidedMemberships()` and `requestedAt`/`reviewedAt`/`reviewedByUserId` fields added to `InstitutionMembership` to support the above.

**Known residual gap in the audit trail** (see §10): `institution_memberships` has a `UNIQUE (institution_id, user_id, membership_role)` constraint — one row per (institution, person, role). If a request is rejected and the same person is later re-approved, the row is updated in place; the coordinator's "decision history" view shows only the **current** decision (who/when), not every past one. A full append-only audit log was not built this phase — documented as a residual risk, not silently left undocumented.

## 7. Institutional coordinator

`INSTITUTION_ADMIN` (F2's existing role name) is kept as the coordinator role — no duplicate role was created, per the task's own instruction. Still never self-service: `inviteInstitutionAdmin` is gated by `isAdminEmail` at the route boundary (unchanged from F2), the only way a first coordinator is created. The coordinator UI added this phase (§6) covers: list PENDING requests (own institution only, `canAccessInstitution` scoped), approve/reject, revoke an APPROVED teacher (soft-revoke, cascades to end that teacher's `ACTIVE` assignments in the same transaction), assign to a class/grade/subject, and browse decided-membership history (with the limitation noted above).

## 8. Multi-role accounts and workspace switching

Unchanged model (F1/F13), re-verified this phase: `resolveAvailableWorkspaces` returns only workspaces backed by an `ACTIVE` role; `POST /api/identity/workspace` fails closed (`403 WORKSPACE_UNAVAILABLE`) for any workspace not in that list, and only ever writes `users.active_workspace` — no resource-authorization table. `/role-select` (rewritten this phase, in Spanish) is both the mandatory initial-signup surface and the controlled "add another role" surface — the same `POST /api/identity/roles/select` endpoint both use, whose Zod schema (`STUDENT | PARENT | TEACHER`) makes `INSTITUTION_ADMIN`/`STUDYUS_ADMIN` self-service structurally impossible to request through it.

## 9. Migration and deployment status

| Item | Status |
|---|---|
| Code (all commits `6ef8be1`..`551596e`, docs included) | Committed on `f15-c1/pilot-gate-closure`. **Deployed to Preview**: `vercel deploy` (no `--prod`) → `dpl_EtKFu6e4Zn6cREAC5HEZzkmNFobN`, `https://study-a1nzky54e-study-so.vercel.app`, confirmed `target: preview` via `vercel inspect --scope study-so` before treating this as done. Production was never touched. |
| `database/migrations/20260921_1100_student_initiated_parent_invitation.sql` (renamed 2026-09-21 from `20260921_1000_student_initiated_parent_invitation.sql` — see R14 in `F15_RESIDUAL_RISK_REGISTER.md`) | **[Update, 2026-09-21] APPLIED to the real Preview database**, via an operator-authorized temporary diagnostic route (isolated worktree, no Fase 2A functional code, removed immediately after — see R14's "APPLIED" annotation for full evidence: ledger 32→34, `parent_invitations` table + unique index confirmed present, F3 identity confirmed intact, protected-table counts unchanged). The code deployment at `dpl_EtKFu6e4Zn6cREAC5HEZzkmNFobN` above was NOT redeployed as part of this — it still predates this table existing in its own build, but since the table now exists in the shared Preview database, that live deployment's `/api/student/parent-invitations` route will now work against it (this route is part of the already-deployed onboarding rework code, not Fase 2A). Historical text below (accurate as of before this update) preserved, not deleted. Additive-only (one new table, two new indexes, no `ALTER`/`DROP` against any existing table), idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) — safe to re-run. **Certified locally, real Postgres, never Preview/Production**: `scripts/operations/f15-onboarding-parent-invitation-migration-cert.sh` (mirrors `f2-authorization-migration-cert.sh`'s own pattern) applies the FULL migration history in order on an ephemeral local instance, re-applies this migration a second time (idempotency), and functionally proves the one-pending-invitation-per-(student,email) unique index — **run 2026-09-21, ALL CHECKS PASSED; re-run after the R14 rename the same day (full history from scratch, including the renamed file and `admin_user_management`), ALL CHECKS PASSED again**. **This agent will not run it against a live database itself** (standing credential-materialization boundary from this program — no `vercel env pull`, no direct use of a live connection string) — applying it to Preview is handed to the operator as: `psql "$PREVIEW_DATABASE_URL" -f database/migrations/20260921_1100_student_initiated_parent_invitation.sql`, run only after confirming `PREVIEW_DATABASE_URL` actually points at Preview, never Production. **Concrete consequence of not running it yet**: on the live Preview deployment above, `POST /api/student/parent-invitations` and everything downstream of it (parent invite/accept/decline) will fail with a database error (`relation "parent_invitations" does not exist`) until this is applied — every other change in this phase (role-select, webhook fix, dashboard redirect, license banner, coordinator UI) reads only pre-existing tables and is unaffected. |
| F1 backfill (pre-existing, not part of this phase) | Already confirmed complete on the current Preview database (§3) — this is what makes the zero-role redirect safe on the deployment above; re-confirm before deploying this code to any *other* environment. |

## 10. Residual risks (additive to `F15_RESIDUAL_RISK_REGISTER.md`, not a replacement of it)

1. **Coordinator decision history is last-decision-only, not append-only** (§6). Low severity (no access-control gap — every *current* decision is still correctly enforced), but a coordinator cannot today see "this person was rejected twice before being approved." Mitigation if needed: a new `institution_membership_decisions` append-only log table, additive, not built this phase.
2. **Migration not yet applied anywhere** (§9) — the entire student→parent invitation flow is inert (returns DB errors) until an operator applies it to Preview.
3. **Mercado Pago is not connected** (`MERCADOPAGO_ACCESS_TOKEN` unset, pre-existing from before this phase, unchanged) — checkout correctly returns `503 PAYMENT_NOT_CONFIGURED` rather than fabricating a payment, but no real license purchase (self or parent-for-child) can complete end-to-end until an operator connects a real Mercado Pago account and sets the credential in Vercel's own environment config.
4. **Non-Spanish locales' institution sub-navigation** shows the Spanish word "Solicitudes" as a fallback label for the new "Requests" tab on the 9 pre-existing institution pages that were not individually touched to pass a localized label (only the new `requests` page itself is fully localized) — a cosmetic, non-security gap, not a functional one.

## 11. Test evidence index (this phase)

- `tests/unit/clerk-webhook-no-auto-student.test.ts` — webhook never auto-creates a Student.
- `tests/unit/dashboard-layout-role-redirect.test.ts` (8 cases) — zero-role redirect, no redirect loop, demo/no-license banner shown/hidden/fail-closed.
- `tests/unit/f10-link-child-enumeration.test.ts` (rewritten), `tests/unit/parent-invitation-accept-decline.test.ts` — student-initiated invite flow, email-match enforcement, no enumeration.
- `tests/unit/payment-never-grants-parent-relationship.test.ts` — paying for a child requires an already-accepted relationship and never creates one.
- `tests/unit/premium-entitlement-gating.test.ts` and per-route additions to `explain-generate-route-adaptive-teaching.test.ts`, `hint-route-permission.test.ts`, `study-plan-route.test.ts`, `transfer-novelty-route.test.ts`, `transfer-route-identity.test.ts`, `uxcanon-r1-transfer-sequencing.test.ts` — every newly-gated premium route denies without `LEARNING_FULL_ACCESS`.
- `tests/unit/f2-institution-membership.test.ts` (`listDecidedMemberships` case added) — coordinator audit view is institution-scoped and excludes PENDING.
- Full repo suite: **362 test files / 5708 tests passing**, `tsc --noEmit` clean, `npm run build` clean — all re-verified after every commit in this phase, most recently after commit `a85aeda`.

## 12. What this document does not claim

This phase did not: apply the new migration anywhere, connect a real payment provider, build a full append-only membership-decision audit log, or execute a live authenticated end-to-end session as a real Teacher/Parent/Coordinator user (this code IS now deployed to Preview, §9, but not yet exercised live by a human). Per this program's own standing rule, **the Pilot is not declared closed by this document** — see the reconciliation annotation appended to `F15_FINAL_REPORT.md`.
