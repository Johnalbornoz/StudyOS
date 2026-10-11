# L10_SHARED_FOUNDATION — Report

Run date: 2026-10-11 (UTC).

## LANE

| | |
|---|---|
| Lane | `L10_SHARED_FOUNDATION` |
| Mode | Code, schema (migration files only) and tests |
| Worktree | `/Users/jalbornoz/PROYECTOS/studyos-l10-shared-foundation` |
| Branch | `feat/l10-shared-foundation` (new, local only, created from `fix/security-p1-remediation` @ `4fb45b0`) |
| Plan implemented | `L3R1_REPORT.md` section 3, L10 rows, plus three Orchestrator change requests received during the run (CR-L7-01, CR-L9-02, CR-L8-01) |

## STATUS

`READY_FOR_ORCHESTRATOR_REVIEW`

Summary of what is and is not in the branch:

| Item | State |
|---|---|
| SF-1 guard hardening | Done |
| SF-2 one student resolver | Done in code. The count of `students` rows with `user_id IS NULL` on Stage was not available (L5); the resolver handles such rows either way |
| SF-3 teacher guard status | Done |
| SF-4 learner-data scope (D-1) | Done for the shared guards, the three routes whose payload I read, and Teacher exam gaps. See Findings 4 and 5 for what was interpreted and what was left |
| SF-5 workspace page guard | Done (in the proxy) |
| SF-6 verified primary email for invitations | Done. L4-13 (coordinator invite assigns an existing account at once) not done |
| SF-7 parent relationship lifecycle | Done, except email delivery (D-10, unruled) and an admin console button (route and service only) |
| SF-8 role onboarding carrier | Carrier and service done. D-4 is unruled, so profile fields are an opaque JSON object |
| SF-10 one persona per account | Done as a database index over ACTIVE persona rows. D-6 was not re-ruled; this encodes the rule already in the code |
| SF-12 institution–student membership | Done (derived by trigger) |
| EN-1 licence table (schema only) | Done without a spec from L11; L11 must review it |
| SF-9, SF-11, SF-13 | Not started. Gated on D-5, D-3, D-7 |
| CR-L7-01 | Done |
| CR-L9-02 | Done |
| CR-L8-01 | The visibility rule holds and the four regressions pass on this branch. Two follow-ups stay open (Finding 5) |

Nothing was applied to DEV, Stage or Production. Nothing was pushed or merged.

## BASE SHA

`4fb45b093ce6ba58a4b3f82d211bea2f978e33d1` (`4fb45b0`), verified with `git rev-parse` in the new worktree before any edit; tree clean.

## FINAL SHA

The single commit on `feat/l10-shared-foundation` whose parent is `4fb45b0`. Run `git rev-parse feat/l10-shared-foundation`.

## FILES CHANGED

New application code (8):

- `src/lib/identity/access-predicates.ts` — the shared SQL predicates (ACTIVE account + ACTIVE role; one owner match) and the one student resolver
- `src/lib/identity/account-status-gate.ts` — account status gate used by the proxy
- `src/lib/identity/workspace-page-guard.ts` — pure page-workspace decision used by the proxy
- `src/lib/identity/verified-email.ts` — the verified-primary-email resolver (moved from the admin module, which re-exports it)
- `src/lib/identity/role-onboarding.service.ts` — SF-8 service
- `src/lib/authorization/learner-data-scope.ts` — result-payload shaping by scope
- `src/lib/authorization/teacher-exam-scope.ts` — Teacher exam gaps: teacher-only, roster-only, subject-only
- `src/app/api/admin/parent-relationships/end/route.ts` — admin ends a parent relationship

Modified application code (22):

- `src/lib/auth.ts`, `src/lib/exam-core/route-auth.ts`, `src/lib/authorization/index.ts`, `src/lib/authorization/permissions.ts`
- `src/proxy.ts`
- `src/services/parent.service.ts`, `src/services/user-admin.service.ts`, `src/services/institution.service.ts`
- `src/lib/admin/admin-identity.ts`, `src/lib/admin/audit.ts` (one audit action, one target type)
- `src/lib/notifications/role-notifications.service.ts` (one notification type)
- `src/lib/teacher/class-assignment.service.ts` (`TEACHER_CLASS_SQL` only), `src/lib/teacher/read-model.service.ts` (class gate and class list only)
- `src/lib/institution/institution-operations.service.ts` (`enrollActive` and the first lines of `addStudentToClass` only; see Finding 7)
- Routes: `api/parent/invitations`, `api/parent/invitations/[id]/respond`, `api/coordinator-invitations/accept`, `api/student/parent-invitations`, `api/simulation/attempts/[id]`, `api/simulation/attempts/[id]/result`, `api/teaching/interventions/[id]`, `api/teacher/exam-insights`

Migrations (6, new): `database/migrations/20261120_1000` to `20261120_1500` (Finding 6).

Scripts (5): new `scripts/l10-ephemeral-db-test.sh` and `scripts/operations/l10-foundation-integration.ts`; three Track A fixture scripts changed by one statement each so they no longer name the dropped enrolment constraint (`track-a-fixtures.ts`, `track-a-learning-plan-e2e-http.ts`, `track-a-curriculum-v2-e2e-http.ts`).

Tests: 5 new files (`tests/unit/l10-*.test.ts`, 109 tests) and 18 existing files updated (listed under TESTS).

Documentation (2): `docs/orchestration/status/L10_STATUS.md`, this report.

No environment, flag, Clerk setting or deployed database was touched.

## LOCKS USED

| Lock | What was done under it |
|---|---|
| `SHARED_FOUNDATION` | All guard, identity, relationship and membership-lifecycle changes above |
| `SCHEMA_AND_MIGRATIONS` | Six migration **files** authored. None applied to any shared database. They were applied only to a throwaway local Postgres instance created and destroyed by `scripts/l10-ephemeral-db-test.sh` |

**Discrepancy to reconcile.** `LOCKS.md` at `studyos-orchestration` @ `99bec29` still shows `SCHEMA_AND_MIGRATIONS = UNASSIGNED` and `SHARED_FOUNDATION = not activated`. `LOCKS.md` says a lock is held only when that file says so. I worked under the assignment in the launch message. The file should be updated to match, or this branch treated accordingly.

Not used: `STAGE_RUNTIME`, `PRODUCTION`, `INTEGRATION_MERGE`, `QUESTION_BANK_CORE`, `ASSESSMENT_ADAPTATION`.

Files outside the L10 rule that I edited, and why:

- `src/lib/institution/institution-operations.service.ts` (L9): two functions, named by L9's own CR-L9-02 as the files needing the change.
- `src/app/api/teacher/exam-insights/route.ts` and `src/lib/teacher/read-model.service.ts` (L8 area): the SF-4 row lists the read model; the route needed the scoped call for CR-L8-01.
- Three route files under `api/simulation` and `api/teaching` and `api/student/parent-invitations`: the SF-4 row lists the `canAccessLearner` routes; CR-L7-01 names the invitation route.
- Tests owned by other lines that pin a migration list or a route count (below).

`src/lib/exam-core/exam-gaps.service.ts` (L2) was **not** edited; see CR-L10-01.

## TESTS

| Command | Result |
|---|---|
| `npx tsc --noEmit -p .` | no output |
| `env -u DATABASE_URL -u DATABASE_URL_UNPOOLED -u POSTGRES_URL npx vitest run` | 524 files, 9,402 tests passed |
| `./scripts/l10-ephemeral-db-test.sh` | baseline + 82 prior migrations applied; the six L10 migrations applied and re-applied (idempotent); SF-10 pre-check refused a seeded multi-persona account and left its rows untouched; integration script: 143 passed, 0 failed |
| `npx next build` (no database configured) | exit 0; 229/229 static pages |
| First full-suite run after the code changes | 34 failures in 18 existing files. All were fixtures matching the old SQL, mocks missing a new export, or count pins. None was a behaviour regression. Listed below |
| Browser check of the proxy changes | NOT_RUN. No `.env` in this worktree, and the main checkout's `.env.local` points at the Production database |
| HTTP E2E suites (`scripts/operations/track-a-*-e2e-http.ts`) | NOT_RUN — they write to DEV |
| Any DEV, Stage or Production access | NOT_RUN |
| Reverting each fix to confirm its tests fail | NOT_RUN (L4-R1 did this; I did not) |

What the two kinds of test cover. The unit tests run the real guards and services against mocked or in-memory databases and assert on the SQL issued and on outcomes. The ephemeral script runs the same real functions against a real Postgres 14 with the full schema, which is where the SQL itself, the triggers and the unique indexes are actually exercised. It caught one real defect in my own work: a fixture step that set an `ENDED` enrolment back to `ACTIVE` was refused by the new trigger.

New test files:

| File | Tests | Covers |
|---|---|---|
| `l10-guards-and-scope.test.ts` | 51 | SF-1 to SF-6 |
| `l10-cr-l7-01-parent-invitation.test.ts` | 17 | CR-L7-01, SF-7 |
| `l10-cr-l8-01-teacher-exam-subject-scope.test.ts` | 13 | CR-L8-01 |
| `l10-cr-l9-02-enrollment-lifecycle.test.ts` | 14 | CR-L9-02 |
| `l10-schema-batch.test.ts` | 14 | migration series structure |

Regressions each change request asked for:

| Request | Case | Test |
|---|---|---|
| CR-L7-01 | own email refused | `l10-cr-l7-01` › "409 OWN_EMAIL, nothing written…" and "compared in the canonical normalized form…" |
| | already-active parent email refused | › "409 ALREADY_LINKED, nothing written" |
| | existing pending invitation, no duplicate | › "the same invitation is returned (alreadyPending), one row, one notification" |
| | unrelated valid email, flow preserved | › "200, a pending invitation with an expiry…" |
| CR-L9-02 | ended + coordinator add | `l10-cr-l9-02` › "the learner is INVITED again; nothing becomes ACTIVE; the ENDED row is untouched" |
| | declined + coordinator add | › "the learner is INVITED again; the DECLINED row stays…" |
| | history preserved | › "leave, re-invite, decline, re-invite, accept: every closed row survives, in order" |
| | canonical pending / acceptance | › "after a departure: PENDING grants nothing, and only the Student's acceptance makes it ACTIVE" |
| | active existing, no duplicate | › "every entry point answers "already", and no row is added" |
| | bulk non-reactivating | › "the single add, once per address over a mixed list…" |
| CR-L8-01 | class + matching subject visible | `l10-cr-l8-01` › "the Mathematics teacher sees the Mathematics gap…" |
| | class + different subject hidden | › "…receives nothing of the same student's Reading gaps -- no concept, no objective, no domain, no count" |
| | unrelated class hidden | › "a teacher of another class gets 403 and the bridge is never queried…" |
| | Coordinator cannot bypass | › "GET /api/teacher/exam-insights => 403 for the institution's own coordinator; nothing is read" |

Each of those cases also runs in the ephemeral-database script, except the bulk case, which there is the single add called three times (L9's bulk function is not on this branch).

Existing tests changed, and why:

| File | Change |
|---|---|
| `admin-user-management.test.ts` | Case 18 asserted "Clerk ban fails → database status never written". That order is now reversed on purpose (Finding 1). Rewritten, plus a reactivation case |
| `auth-identity-and-subject-access.test.ts` | Fixtures return the resolver's row shape; one new case for a revoked existing student |
| `e2e-object-authorization.test.ts`, `l4r1-object-ownership-idor.test.ts` | Fake database matched the old ownership SQL by regex |
| `f8-api-routes-security.test.ts`, `f9-api-routes-security.test.ts`, `track-b-routes-and-guards.test.ts` | Mock of `@/lib/authorization` gained `resolveLearnerReadScope` |
| `f10-link-child-enumeration.test.ts` | Mocked Clerk user gained a verified primary address |
| `parent-invitation-accept-decline.test.ts` | One more query in the accept transaction |
| `student-onboarding-gate.test.ts` | "Proxy does not query the database for non-Student routes" is no longer true by design; replaced by "one read-only query each" and "webhooks, internal and unauthenticated requests are never queried" |
| `track-a-services.test.ts` | Invitation insert no longer an upsert |
| `aice-pisa-security.test.ts`, `f11-teacher-read-model-source-guard.test.ts` | Teacher exam insights go through the shared entry point; read model imports the teacher-only gate |
| `f8-canonical-v2-noninterference.test.ts` | The grant table moved to `permissions.ts` |
| `l4r1-admin-primary-email.test.ts` | Admin route pin 87 → 88 (51 + 36 → 52 + 36) |
| `b2-readiness-architecture.test.ts`, `exam-platform-v2-integration-matrix.test.ts`, `ea1-assessment-adaptation.test.ts` | Migration list pins extended by the six L10 files (82 → 88). These belong to other lines; any new migration has to move them |

## FINDINGS

### 1. SF-1 — guards now deny on a revoked role or a non-ACTIVE account

Two layers.

**In each guard's own query.** `activeRoleSql` (`src/lib/identity/access-predicates.ts`) adds "account ACTIVE and this role ACTIVE" to the relationship query, so there is no extra round trip. Applied to `verifyStudentAccess`, `isOwner`, `ownStudentId`, `isActiveParentOf`, `verifyParentAccess`, `canTeacherAccessLearner`, the teacher branch of `canAccessClass`, `TEACHER_CLASS_SQL`, `getTeacherAssignedClasses`, `canAccessInstitution` and the new `isCoordinatorOfLearner`. `requireActor`, `requireStudentId` and `requireParentProfileId` check the account status directly. Helper signatures are unchanged.

**In the proxy, for account status.** API routes authenticate through four different entry points (126 files call `verifyAuth`, 19 `requireActor`, 58 `auth()` directly, the rest per-area helpers), so no single helper sees every request. The proxy does, and already had database access for the onboarding gate. An authenticated API request from an account whose `users.status` is not `ACTIVE` now gets `403 ACCOUNT_NOT_ACTIVE` before the route runs. Webhooks, `internal/*`, `health` and `version` are exempt.

Things to know:

- **Cost.** Every authenticated API request now does one indexed read in the proxy, and every dashboard page one (previously only Student pages did).
- **Failure mode.** If the status lookup fails, API requests get `503` (fails closed). Dashboard pages keep the earlier behaviour: the request continues and the layout re-checks.
- **`getOrCreateStudentId` is no longer unconditional for an existing student.** 32 files under `src/app` call it with no other role check. It now throws `StudentRoleRequiredError` for a revoked or suspended student. Those callers deny, but as an uncaught error (500), not a 403. Making them answer 403 means switching them to `requireStudentId`, which is Student-lane code. See CR-L10-02.
- **Suspension order reversed.** `suspendUser` and `archiveUser` now write the database status first, then ban in Clerk; `reactivateUser` unbans first, then writes. A partial failure therefore always leaves the account denied, and is audited (`clerkSyncFailed`). Before, a Clerk failure left the database untouched.
- **Accounts that will newly be denied.** Any learner, parent, teacher or coordinator whose relationship rows exist but whose `user_roles` row is missing or not ACTIVE. That is the intended effect for revoked roles, but it also hits any legacy account the identity backfill missed. I could not count them. See CR-L10-06 — this should be checked before the branch reaches an environment with real users.

Evidence: `l10-guards-and-scope.test.ts` (SF-1 blocks); ephemeral run, checks "SF-1 …" (revoke → deny on next call, re-grant → allow, suspend without Clerk → deny).

### 2. SF-2 — one resolver; SF-3 — teacher guard status

- SF-2: `STUDENT_OWNER_MATCH_SQL` is the one join between `students` and `users` (`user_id`, or the same Clerk identity when `user_id` was never backfilled). `verifyStudentAccess`, `getOrCreateStudentId`, `isOwner` and `ownStudentId` all use it. Ephemeral check: an unlinked student gets the same id from both families.
- SF-3: teacher access now requires `institutions.status = 'ACTIVE'` and `classes.status = 'ACTIVE'` in `canTeacherAccessLearner`, `canAccessClass` (teacher branch), `TEACHER_CLASS_SQL`, `getTeacherAssignedClasses` and `resolveTeacherClassScope`. A coordinator still reaches an archived class, so it can be administered. Ephemeral checks: suspend institution → all teacher guards false; restore → true; archive class → false.

### 3. SF-5 and SF-6

- **SF-5.** `decideWorkspacePageGuard` runs in the proxy. A page under `/dashboard/parent`, `/teacher` or `/institution` requires that workspace; every other dashboard page is a Student page; `/dashboard`, `/dashboard/notifications` and `/dashboard/admin/**` are not guarded here (admin pages keep `requireStudyUSAdmin`, and the allowlisted admin's role is bootstrapped by the layout, which runs after the proxy). A wrong-workspace request redirects to the account's own home; a non-ACTIVE account goes to `/account-suspended`. NOT_VERIFIED in a browser.
- **SF-6.** Parent invitation list and respond, and coordinator invitation accept, match on the verified primary email only; an unverified one gets `403 EMAIL_NOT_VERIFIED` and nothing is written. `resolveClerkIdentity` lost its `emailAddresses[0]` fallback. Remaining index-0 reads are display or account-row backfill only (`dashboard/layout.tsx:77`, `workspace-entry.ts:60`, `display-identity.ts`, `payments/checkout` which is L11's, two account pages, `identity-reconciliation.service.ts`).

### 4. SF-4 — what D-1 became in code

`LEARNER_READ_SCOPE` in `src/lib/authorization/permissions.ts` is the one table:

| Relationship | Progress / profile | Gaps | Released result summary | Item-level detail | Act in the learner's work |
|---|---|---|---|---|---|
| Owner | yes | yes | yes | yes | yes |
| Parent | yes | yes | yes | no | no |
| Teacher | yes | yes | yes | yes | no |
| Coordinator | no | yes | yes | no | no |

**Interpretations I made, for you to confirm or reverse (each is one line in that table):**

1. **Teacher gets item-level detail.** The ruling says "assessment detail required for teaching" and names the "no raw item-level" restriction only for Parent and Coordinator. I read that as including the per-question review.
2. **Coordinator is not given the two older permissions.** The eleven `canAccessLearner` routes behind `LEARNER_PROGRESS_VIEW` / `LEARNER_PROFILE_VIEW` stay closed to coordinators, because I did not read every payload and would not widen access on unread routes. A coordinator does newly pass the two simulation-attempt routes, as a released summary only.
3. **"Released" means the result row is `SCORED`.** An unscored or `INVALIDATED` result is not shown to anyone but the owner.

Applied to routes: `simulation/attempts/[id]/result` (review removed without detail permission), `simulation/attempts/[id]` (non-owners get status and released scores, not the attempt's working state), `teaching/interventions/[id]` (attempts withheld from a Parent). The institution permission argument is now honoured: `canAccessInstitution` refuses a value outside its list, and the teacher branch of `canAccessClass` only satisfies `TEACHER_ASSIGNMENT_MANAGE`.

**Not done under SF-4:**

- Subject scoping for a Teacher on the other `canAccessLearner` routes (readiness, diagnostics, summary, exam profiles). Only exam gaps are subject-scoped (Finding 5). A teacher of any class the learner is in can still read those across subjects. L4-14 is therefore only partly closed.
- The payloads of `readiness/[id]`, `diagnostics`, `diagnostics/[id]/explain`, `learning/session-eligibility` and `simulation/eligibility` were not read. NOT_VERIFIED whether any returns item-level content to a Parent.
- `api/institutions/[id]/intelligence/exam-insights` was left as it is. Under D-1 a coordinator may see per-student summaries, so its per-student AICE summary is within the ruling.

### 5. CR-L8-01 — Teacher exam gaps by class and subject

`getTeacherClassExamGaps` (`src/lib/authorization/teacher-exam-scope.ts`) is the single entry point. It resolves the actor as a teacher of the class through `resolveTeacherClassScope` (TEACHER membership only, never an institution admin), limits learners to the class's ACTIVE roster, and cuts the result to the class's `canonical_subject_id`. The Teacher read model's class gate uses the same teacher-only function, so a Coordinator is refused on the roster route as well (this is CR-L8-02).

The four required regressions pass.

**The limit, stated plainly.** `examGapsFor` (L2's) returns aggregates with no subject option. Only concepts carry a subject, so the cut is made at concept level and fails closed:

| Field | Now |
|---|---|
| `byConcept`, `perStudent.concepts` | kept only for concepts of the class's subject |
| `perStudent.gaps` | number of in-subject gap **concepts**. It used to be the number of gap **objectives** across every subject |
| `byDomain`, `byObjective` | **empty**. Their rows cannot be attributed to a subject from the aggregate |
| a gap whose objective has no published concept mapping | hidden |
| a class with no linked subject | no gaps at all |

So the rule "a Mathematics teacher must not receive Reading gaps" holds, but the Teacher loses the domain and objective lists until L2 adds a subject option (CR-L10-01).

**Two follow-ups before I would call it closed on the integration line:**

1. L8's committed service (`src/lib/teacher/exam-insights.service.ts`, not on this branch) calls `examGapsFor` directly. It must call `getTeacherClassExamGaps` instead. A source-guard test in `l10-cr-l8-01` fails on any Teacher file that calls `examGapsFor` directly, so the merged line will not pass until this is done. CR-L10-03.
2. Goals and AICE entries in the same response are **not** subject-scoped. The request named exam gaps; goals are the learner's personal exam targets. Say if they should be cut too.

I am recording CR-L8-01 as **implemented on this branch, regressions passing, not yet verified on a line that contains L8**.

### 6. Schema batch — six migrations, one series

| File | Content | Decision status |
|---|---|---|
| `20261120_1000_sf7_parent_relationship_lifecycle` | `parent_invitations.expires_at` (30 days, backfilled from `created_at`), status `expired`; relationship default `'accepted'` → `'pending'`; `request_count`; `ended_by_user_id`, `ended_reason` | — |
| `20261120_1100_sf12_institution_student_memberships` | New table, one row per (institution, learner), kept in step with ACTIVE enrolments by a trigger; backfilled | D-2 unruled; this is a carrier only |
| `20261120_1200_en1_institution_licenses` | `institution_licenses`, `institution_license_seats`; seat limit, same-institution and membership checks enforced by trigger; seats released when a membership ends | No spec received from L11; D-2 unruled |
| `20261120_1300_sf8_role_onboarding_state` | `user_role_onboarding` (PARENT, TEACHER) | D-4 unruled; profile is JSON |
| `20261120_1400_sf10_single_persona_constraint` | Partial unique index: one ACTIVE persona per account | D-6 not re-ruled |
| `20261120_1500_cr_l9_02_enrollment_history` | `class_enrollments_unique` replaced by "one OPEN row per learner per class"; trigger refuses any status change on an `ENDED` or `DECLINED` row | CR-L9-02 |

Points that matter when these are applied:

- **Old pending parent invitations expire at once.** The backfill gives each existing invitation `created_at + 30 days`. Any pending invitation older than that is refused from then on. The Student can send it again.
- **SF-10 refuses to apply if any account holds two ACTIVE personas.** It changes no data. It is second to last so the first four do not depend on it, but `1500` sorts after it; if `1400` stops, `1500` is still pending. The read-only count to run first is in the file header.
- **SF-10 covers ACTIVE rows only.** My first version covered every status; that would have broken the admin console's "revoke the persona, then grant another" flow, so I narrowed it. The stricter self-service rule (a revoked persona still counts) stays in application code.
- **`1500` breaks any SQL that says `ON CONFLICT (class_id, student_id)`.** I changed the two application writers and three Track A fixture scripts. Any script outside this repository state, or on another branch, that uses that clause will fail after the migration.
- **`1500` is not rollback-safe once used.** The old unique constraint cannot be restored after a learner has two rows for one class.
- **EN-1 tables license nobody.** Nothing under `src/lib/entitlements` reads them (asserted by a test).

### 7. CR-L9-02 — closed enrolments are history

The lifecycle lives in `src/services/institution.service.ts`: `getClassEnrollmentState`, `enrollStudentDirectly`, `inviteStudentToClass`, `enrollStudent`. A learner with an `ENDED` or `DECLINED` row for a class is always invited again (a new `PENDING` row) and must accept; the old row is never updated. The database enforces both halves (Finding 6).

Consequences in L9's file, which I changed in two places only:

- `addStudentToClass`: a learner with a closed row in this class goes down the invitation path even when they are an active student of the institution.
- `enrollActive` (used by "enrol in another class" and "move"): refuses with `INVALID_STATE` when the target class has a closed row for that learner. A refused move ends nothing. `INVALID_STATE` is an existing code with a generic message; a specific one needs L9's i18n file.
- Unchanged on purpose: for an institution student, `enrollActive` still completes a `PENDING` invitation to `ACTIVE` without the Student's click. That was the behaviour before and the ruling is about closed rows. Say if that should also require acceptance.

**Integration note for L9's branch.** L9's `enrollmentOf` reads one row per (class, learner) with no ordering. After `1500` there can be several, so its bulk pre-check (`PREVIOUSLY_DECLINED`, `PREVIOUSLY_ENDED`) could read the wrong one. It should use `getClassEnrollmentState`. See CR-L10-04.

**CR-L9-04 (acknowledge the Student as an actor on ACTIVE → ENDED).** Acknowledged. The closed-row trigger and the membership trigger both treat a Student-initiated ending like any other; the ephemeral run ends an enrolment and checks the membership ends and the seat is released.

### 8. SF-7 and CR-L7-01 — parent relationship

- `inviteParentByEmail` refuses the Student's own email (`OWN_EMAIL`) and an email that already has accepted access (`ALREADY_LINKED`); the route answers `409` with that code. A repeat for a pending email returns the same invitation with `alreadyPending: true`. Addresses are stored trimmed and lowercased.
- Revoking or declining a relationship cancels pending invitations to that parent. Accepting an invitation is refused when it predates the ending of the relationship, when it has expired, or when an administrator ended the relationship. This is the L4-07 scenario; it is in both test layers.
- A parent can request the same learner at most three times in total (`MAX_LINK_REQUESTS_PER_LEARNER`), silently.
- `POST /api/admin/parent-relationships/end` on the canonical admin guard, audited as `PARENT_RELATIONSHIP_ENDED`.
- An invitee who already has a Parent account gets an in-app notification (`PARENT_INVITATION_RECEIVED`).

Not done: invitation tokens and email (D-10; there is no mail provider); a button in the admin console; uniform responses for the class-invitation and coordinator-invite oracles in L4-16.

One caller to tell: L7's `ParentAccessCard` (not on this branch) will now receive `409 OWN_EMAIL` / `409 ALREADY_LINKED`. CR-L10-05.

### 9. Not done from the L4 list routed to L10

- L4-13 (coordinator invite assigns an existing account immediately, on a stored email). Changing it alters the `ASSIGNED_EXISTING` outcome L9's coordinator page reads; it needs to be done together with L9.
- L4-22 (admin lifecycle hygiene) and CR-L4-02 / CR-L4R1-02 (the 36 allowlist-only admin routes).
- CR-L4R1-03 (billing reactivation rule) is L11's.

## BLOCKERS

NONE for this lane.

For the work to go further:

- **Orchestrator:** update `LOCKS.md`; confirm or reverse the three D-1 interpretations in Finding 4; rule D-2, D-4, D-6 (the schema for them is in place but built on assumptions); route CR-L10-01 to L2.
- **L5:** the counts in CR-L10-06, before this reaches any environment with real accounts.
- **Human Operator:** browser pass on the proxy changes (wrong-workspace redirects, suspended account, a normal Student session).

## CHANGE_REQUESTS

Received and handled in this run:

| # | From | State |
|---|---|---|
| CR-L7-01 | Orchestrator | Implemented; four regressions pass (Finding 8) |
| CR-L9-02 | Orchestrator | Implemented; six regressions pass (Finding 7) |
| CR-L8-01 | Orchestrator | Implemented on this branch; four regressions pass; two follow-ups open (Finding 5) |
| CR-L8-02 | L8 | Implemented: Teacher read models are teacher-only |
| CR-L9-04 | L9 | Acknowledged (Finding 7) |

Raised by this lane:

| # | Lock / owner | Files | Change needed | What I did instead |
|---|---|---|---|---|
| CR-L10-01 | Exam core (L2) | `src/lib/exam-core/exam-gaps.service.ts` (`examGapsFor`) | A `canonicalSubjectIds` option that restricts gap objectives, inside the query, to those mapped to concepts of the given subjects, so domain and objective aggregates and the objective count can be returned per subject | Cut at concept level in shared code and withheld the two aggregates |
| CR-L10-02 | L6 (Student routes) | The 32 files under `src/app` that call `getOrCreateStudentId` with no `requireStudentId` / `verifyStudentAccess` | Use `requireStudentId` and answer 403 on null | The helper now refuses; those callers deny with an uncaught error |
| CR-L10-03 | L8 | `src/lib/teacher/exam-insights.service.ts`, `dashboard/teacher/classes/[classId]/exam-insights/page.tsx` | Call `getTeacherClassExamGaps` instead of `examGapsFor`; handle empty `byDomain` / `byObjective` and the changed meaning of `perStudent.gaps` | Provided the entry point and a failing guard test for the merged line |
| CR-L10-04 | L9 | `src/lib/institution/institution-operations.service.ts` (`enrollmentOf`), institution i18n | Read enrolment state through `getClassEnrollmentState`; add a message for "must be invited again" | Used `INVALID_STATE` |
| CR-L10-05 | L7 | `src/app/dashboard/profile/ParentAccessCard.tsx`, its i18n file | Show `OWN_EMAIL` and `ALREADY_LINKED`; optionally use `alreadyPending` | Route returns the codes |
| CR-L10-06 | L5 (read-only) | Stage and DEV databases | Counts of: students with `user_id IS NULL`; students whose account has no ACTIVE STUDENT role; accepted parent relationships whose parent has no ACTIVE PARENT role or whose `profiles.user_id` is NULL; APPROVED teacher / coordinator memberships whose account lacks the ACTIVE role; accounts with two ACTIVE personas; pending parent invitations older than 30 days; any SQL using `ON CONFLICT (class_id, student_id)` | Could not read any shared database |
| CR-L10-07 | L11 | `database/migrations/20261120_1200_en1_institution_licenses.sql` | Review the licence and seat structure against EN-1 before building on it; send changes back to L10 as a follow-up migration | Built the smallest structure that satisfies the EN-1 acceptance test |

## MERGE RECOMMENDATION

Do not merge before the Orchestrator has reviewed Findings 1, 4, 5 and 6. This is the lane's recommendation only.

If it is merged, expect hand-resolved conflicts with the Wave 0 branches:

| With | File | Resolution |
|---|---|---|
| L8 | `src/app/api/teacher/exam-insights/route.ts` | Take L8's route; apply CR-L10-03 in L8's service |
| L8 | `tests/unit/aice-pisa-security.test.ts` | Keep both mocks |
| L9 | `src/lib/institution/institution-operations.service.ts` | Keep L9's additions; keep this branch's `enrollActive` and the first lines of `addStudentToClass`; apply CR-L10-04 |
| L6 | `tests/unit/e2e-object-authorization.test.ts` | Keep this branch's ownership regex |

Order: the six migrations are applied only by whoever holds `SCHEMA_AND_MIGRATIONS` for the target database, after the CR-L10-06 counts. Code and migrations must ship together: the code expects `expires_at`, `request_count`, `ended_by_user_id`, `user_role_onboarding` and the enrolment index.

## NEXT SAFE ACTION

Orchestrator reviews the commit and rules on the three D-1 interpretations in Finding 4.
