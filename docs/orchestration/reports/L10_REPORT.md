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

---

# L10-R1 — 2026-10-11

Continuation of the lane after the Orchestrator's ruling "L10 CORE ACCEPTED / R1 REQUIRED" and the L11 dependency message (CR-L11-05, CR-L11-06). Commit `c2bcae9` was not amended; R1 is a second commit on top of it.

## LANE

`L10_SHARED_FOUNDATION`, run R1. Worktree `/Users/jalbornoz/PROYECTOS/studyos-l10-shared-foundation`, branch `feat/l10-shared-foundation` (local only).

## STATUS

`READY_FOR_ORCHESTRATOR_REVIEW`

Values requested by the ruling. These are the lane's own results, for the Orchestrator to verify:

| Gate | Value | Basis |
|---|---|---|
| L10_CORE | PASS | 527 files / 9,455 tests; typecheck clean; build exit 0; ephemeral DB 170/170 |
| CR_L7_01 | CLOSED | Unchanged since `c2bcae9`; 17 unit tests and the DB-backed checks still pass |
| CR_L9_02 | CLOSED on this branch | Lifecycle and database guard in place; 18 unit tests and the DB-backed checks pass. Cross-branch remainder is under ENROLMENT_SQL_CALLERS |
| CR_L8_01 | OPEN | As ruled: needs L8's call site and L2's subject-aware aggregates (R1 Finding 3) |
| REVOKED_STUDENT_HTTP | PASS, with one point to confirm | API: 403. Pages: redirected before rendering, never a 500 — a redirect, not a 403 page (R1 Finding 4) |
| ENROLMENT_SQL_CALLERS | BLOCKED | This branch: none left. One incompatible reader on L9's branch, and the merged line must be re-checked (R1 Finding 5) |
| MIGRATION_PREFLIGHT_READY | YES | `docs/orchestration/L10_MIGRATION_PREFLIGHT.md`; every statement executed on the throwaway database |
| L11_SCHEMA_DEPENDENCY | NONE | L11-R1 reports that EXPIRED_RENEWAL and GRANT_TO_PAID needed no schema; CR-L11-06 is solved from existing state (R1 Finding 7) |
| UNRULED_DECISIONS | D-2, D-3, D-4, D-5, D-7 (D-6 accepted for the index as built) | R1 Finding 8 |
| L10_READY_FOR_CONVERGENCE | NO | CR-L8-01 open; ENROLMENT_SQL_CALLERS blocked; licence schema not yet reviewed by L11 |

## BASE SHA

`c2bcae9` (the accepted L10 core commit), parent `4fb45b0`.

## FINAL SHA

The commit on `feat/l10-shared-foundation` whose parent is `c2bcae9`. Run `git rev-parse feat/l10-shared-foundation`.

## FILES CHANGED

New (5): `src/lib/authorization/learner-result-scope.ts`; `docs/orchestration/L10_MIGRATION_PREFLIGHT.md`; `tests/unit/l10-r1-learner-data-rulings.test.ts`, `l10-r1-revoked-student-http.test.ts`, `l10-r1-l11-dependencies.test.ts`.

Modified application code (15): `src/lib/auth.ts`, `src/lib/authorization/{index,permissions,learner-data-scope,teacher-exam-scope}.ts`, `src/lib/identity/workspace-page-guard.ts`, `src/services/membership-admin.service.ts`, `src/services/transfer-task-instance.service.ts`, `src/app/dashboard/admin/[studentId]/page.tsx`, and six routes: `api/simulation/attempts/[id]`, `…/[id]/result`, `api/teaching/interventions/[id]`, `api/teacher/exam-insights`, `api/admin/memberships/approve-payment`, `api/cognitive/transfer/submit`.

Scripts (3): `scripts/l10-ephemeral-db-test.sh`, `scripts/operations/l10-foundation-integration.ts`, `scripts/operations/track-a-teacher-e2e-http.ts` (two reads now name the open row).

Tests modified (4): `l10-guards-and-scope`, `l10-cr-l8-01-…`, `l10-cr-l9-02-…`, `aice-pisa-security`.

No migration was added or changed in R1. The chain is still the six files of `c2bcae9`.

Files outside the L10 rule edited in R1, and why: `api/cognitive/transfer/submit/route.ts` (L11 also edited it; one hunk for CR-L11-06, see R1 Finding 7) and `src/services/membership-admin.service.ts` plus its route (CR-L11-05 names them). `src/app/api/payments/checkout/route.ts` was not touched. `src/lib/exam-core/**` was not touched.

## LOCKS USED

`SHARED_FOUNDATION`, as before. `SCHEMA_AND_MIGRATIONS`: held, not exercised in R1 (no new migration). `LOCKS.md` was not re-read as updated; if it still shows the locks unassigned, the earlier discrepancy stands.

## TESTS

| Command | Result |
|---|---|
| Focused: `npx vitest run tests/unit/l10-*.test.ts` | 8 files, 162 tests passed |
| Full: `env -u DATABASE_URL -u DATABASE_URL_UNPOOLED -u POSTGRES_URL npx vitest run` | 527 files, 9,455 tests passed |
| `npx tsc --noEmit -p .` | no output |
| `npx next build` | exit 0; 229/229 static pages |
| `./scripts/l10-ephemeral-db-test.sh` — migration apply / re-apply | six files apply and re-apply; SF-10 pre-check still refuses a seeded multi-persona account |
| Same script — governed runner and ledger (`scripts/db-migrate.ts`) | before: 83 rows, last `20261112_1000`; dry run lists 6 pending; after: 89 rows, last `20261120_1500`; dry run lists 0 |
| Same script — preflight contract SQL | 20 statements before the batch, 9 after; all run; all `SELECT` |
| Same script — real guard / service checks | 170 passed, 0 failed (143 in the core run, 27 added in R1) |
| Browser, HTTP E2E, DEV / Stage / Production | NOT_RUN |
| Reverting each fix to confirm its tests fail | NOT_RUN |

One note on the ephemeral script: for the ledger step it moves the six migration files out of `database/migrations/` for a few seconds and moves them back (also on exit, through a trap). The working tree was clean afterwards.

## FINDINGS

### R1-1. D-1 final rulings as implemented

**Released result.** `isAttemptResultVisibleToStudent` (`src/lib/authorization/learner-result-scope.ts`) is now the test for a Parent or Coordinator. I read what the Student's own result page does before it renders, and the current model is:

| Condition on the Student's page | Effect |
|---|---|
| attempt is not `COMPLETED` | no result page (redirect to the attempt) |
| the Student removed it from history (`hidden_at`, or its instance is `DELETED`) | not found |
| no result row yet | page shows "pending" |
| result `INVALIDATED` | page shows the result with a warning |

So "scored and not invalidated" was **not** equivalent to Student-visible, in both directions. My earlier rule hid invalidated results that the Student does see, and — the real defect — showed a Parent a scored result that the Student had removed from their own history. Both are fixed: visible means submitted and not removed; the result is passed with its own status. A unit test pins those page conditions against the page's source so drift fails. The predicate is a mirror in shared code; a single exported one in the exam core would be better (CR-L10-08).

One consequence to be aware of: a Parent or Coordinator now sees an `INVALIDATED` result, flagged as such, because the Student does.

**Parent and Coordinator.** Unchanged in substance: summary only, item review always removed. A draft or in-progress attempt returns nothing.

**Coordinator.** Kept off the nine routes behind `LEARNER_PROGRESS_VIEW` / `LEARNER_PROFILE_VIEW`; a test asserts each still asks for one of those two. The two simulation-attempt routes serve a Coordinator a released summary, as before.

**Teacher.** `teacherSubjectScopeForLearner` returns the canonical subjects of the classes the teacher is authorized for in which this learner is actively enrolled. On top of that:

| Surface | What a Teacher gets now |
|---|---|
| `simulation/attempts/[id]/result` | Only for a submitted, Student-visible attempt. Objectives whose published concepts belong to the teacher's subject, each with only those concepts. Overall and section scores: withheld. Item review: withheld. If nothing in the attempt is in the subject: 404 |
| `simulation/attempts/[id]` | 403 (it only carries exam-wide state and scores, which cannot be attributed to a subject) |
| `teaching/interventions/[id]` | The session and its item-level attempts only when the session's concept maps (MATCHED) to a subject the teacher holds for that learner; otherwise 403 |

**What this means in practice, stated plainly:** on exam attempts a Teacher currently receives **no item-level review at all**. A review item carries nothing that ties it to an objective or a subject, so it cannot be sliced, and the ruling says to hide what cannot be sliced. Returning in-subject items needs the exam core to expose the objective (or subject) of each review item — CR-L10-08. Intervention attempts are single-concept, so those are returned when in subject.

**Not done.** Subject scoping for a Teacher on the remaining whole-learner routes (`learners/[id]/summary`, `readiness`, `readiness/[id]`, `diagnostics`, `diagnostics/[id]/explain`, `exam-profiles`, `simulation/eligibility`, `learning/session-eligibility`). A teacher of any class the learner is in can still read those across subjects, and I have still not read their payloads. This is the open part of L4-14 and needs a decision on whether it is in L10's R-scope.

### R1-2. Teacher goals and AICE entries

`getTeacherClassExamGaps` now also returns `goals` (empty), `aice` (empty) and `withheld`. There is no governed link from an exam goal or an AICE syllabus to a canonical subject, and a multi-subject exam goal cannot be sliced, so both are hidden from the Teacher surface. The route on this branch no longer reads them from the exam bridge, and a guard test fails on any Teacher file that calls `examGoalsFor` or reads the AICE plan tables. Restoring them per subject needs an attribution in the exam core (CR-L10-01, widened).

### R1-3. CR-L8-01 — still OPEN, as ruled

Nothing in R1 closes it. State of the two parts:

1. **L8 uses the shared entry point.** Not done; L8's branch. The guard tests in `l10-cr-l8-01` (direct `examGapsFor`, direct `examGoalsFor`, AICE tables) fail on the merged line until L8's `exam-insights.service.ts` calls `getTeacherClassExamGaps`. CR-L10-03, now including goals and AICE.
2. **L2 provides subject-aware filtering.** Not done; L2's code. CR-L10-01.

### R1-4. Revoked or inactive Student — where the 500 actually was

Correction to the core report: the 32 callers of `getOrCreateStudentId` are **not** API routes. They are 31 Server Component pages and the dashboard layout. No file under `src/app/api` calls it; every Student API route uses `requireStudentId` or `verifyStudentAccess` and already answers 403. CR-L10-02 to L6 is withdrawn.

Solved centrally, with no Student call site edited:

| Request | Revoked Student role | Inactive account |
|---|---|---|
| Student API route | 403 from the route's own gate | 403 `ACCOUNT_NOT_ACTIVE` from the proxy, before the route; and 403 from the gate if the proxy is bypassed |
| Student page | redirected by the proxy before the page renders: to the account's other workspace, or to `/role-select` when it has no active role | redirected to `/account-suspended` |

The one change needed was in the page guard: an account with **no** active role used to be left to the layout, which redirects — but a page renders in parallel with its layout and had already thrown. The guard now sends it to role selection itself. `StudentRoleRequiredError` also carries `status = 403`, and `authFailureOf` maps it, as the shared contract for any future caller.

One page is outside the workspace guard and was fixed directly: `dashboard/admin/[studentId]/page.tsx` called `getOrCreateStudentId` for the **administrator**, only to read their interface language. An admin who is not a Student got a server error there. It now falls back to the default language.

**Point to confirm.** The ruling says "=> 403". For API requests that is exactly what happens. For page navigations the response is a 307 to a page that explains the situation, which is what the layout already did. If a literal 403 status is wanted for pages too, say so; it is a small change in the proxy but a worse experience.

Remaining exposure: if the proxy's own lookup fails, dashboard pages continue (existing fail-open behaviour for pages) and a Student page could still throw. API requests fail closed (503).

### R1-5. Enrolment SQL callers

Searched every lane worktree and the two integration lines for `ON CONFLICT (class_id, student_id)`:

| Where | Occurrences |
|---|---|
| `feat/l10-shared-foundation` | 0 in `src/` and `scripts/` (enforced by a new repository-wide test) |
| L6, L6-wave0, L7, L8, L9, L11, L12, L4-R1, `integration/q1-paa-bank-readiness`, `integration/assessment-b5-runtime-certification` | 6 each, identical, all inherited from the common base, all in five files L10 rewrote: `src/services/institution.service.ts` (2), `src/lib/institution/institution-operations.service.ts` (1), three Track A fixture scripts (1 each) |

No branch added a new one. They disappear when L10's versions of those five files are taken. L9 edited `institution-operations.service.ts`, so that file needs a hand check at merge.

One incompatible **reader** exists outside this branch: L9's `enrollmentOf` reads one row per (class, learner) with no status filter or order. After `20261120_1500` it can return a closed row while an open one exists, which would make L9's bulk pre-check misreport. Ownership change request: CR-L10-04. The new test "application code never reads "the" enrolment … without saying which one" will fail on the merged line until it is fixed.

That is why the gate is BLOCKED rather than PASS: the migration is not convergence-ready until that reader is patched and the three guard tests pass on the merged line.

In this branch I also made two reads in `track-a-teacher-e2e-http.ts` name the open row.

### R1-6. CR-L11-05 — manual payment approval

`approveManualPayment` now refuses any row an administrator set (`manually_set_by_admin`): `AdminControlledSubscriptionError`, route answers `409 ADMIN_CONTROLLED_SUBSCRIPTION`. The check is before the first write, so there is no payment row, no status change and no audit entry.

This is wider than "an expired grant": it also refuses on a live grant, a revoked grant and an administrative suspension. That is the "preferred minimal behavior" as I read it, and it means a manual approval can no longer quietly lift a suspension. The working paths are unchanged: re-grant, or reactivate, through their own routes. No grant field is cleared anywhere in this function.

### R1-7. CR-L11-06 — Transfer exactly-once

**Existing state is enough; no schema.** A graded submission goes through `updateMastery` with the identity `TRANSFER :: transferTaskId :: conceptId`, which claims `learning_evidence.operation_key` under a unique index. One row with that key means the task was graded. `isTransferTaskAlreadyGraded` reads it, and the route checks it before grading: `409 TRANSFER_TASK_ALREADY_ANSWERED`, grader not invoked. A submission whose grading failed leaves no row, so the task stays open.

| Case | Result |
|---|---|
| Open valid transfer | graded once, evidence written |
| Same task submitted again | 409, no grading call |
| Task graded in an earlier session | 409, no grading call |
| Another open task of the same concept | unaffected |
| Answered state cannot be read | 500, no grading call |

**Residual, not closed.** Two first submissions of the same task sent at the same instant both read "not graded" and both reach the grader. The second evidence write is then discarded by the unique key, so there is still only one evidence row and one mastery change, but two grading calls. Closing that needs an atomic claim taken before grading, which is a marker column — schema. I did not add it because the instruction was to use existing state when it can prove "already answered", and it can. Say if the concurrent case must be closed too.

**Does L11 need a final route patch?** No new patch. The hunk is on this branch, in a file L11 also changed. In L11's version the licence gate sits just above; my check comes after it, so an unlicensed Student with an open task passes L11's gate and then mine, and one with an answered task is refused by mine. The two hunks are a few lines apart and should merge without conflict; if they do conflict, keep both, L11's first.

### R1-8. Unruled decisions, and what was built on them

Decision texts are quoted from L3R1 section 6.

| Decision | Question, as written in L3R1 | Work package | State |
|---|---|---|---|
| D-3 | "Are independent teachers in scope for this release" | SF-11 (and TE-4) | Not started. Nothing built |
| D-4 | "Parent and Teacher onboarding: which fields" | SF-8 (and PA-4, TE-5) | Built under an assumption — see below |
| D-5 | "Minors and guardian consent (product and legal)" | SF-9 | Not started. Nothing built |
| D-6 | "One persona per account, or several" | SF-10 | Built; the R1 ruling accepts "one ACTIVE persona per account" |
| D-7 | "Self-serve institution creation and institution-provisioned student accounts" | SF-13 | Not started. Nothing built |
| D-2 (not in the ruling's list; it is the decision SF-12 depends on) | "Institution-sponsored access: a seat model now, or per-student admin grants as the accepted Stage procedure" | SF-12 (and EN-1, IN-4) | Built under an assumption — see below |

Exactly what exists for the three that were implemented:

**SF-8 (D-4 unruled).** Table `user_role_onboarding`: one row per (account, role), role limited to `PARENT` or `TEACHER`, a `completed_at` timestamp, and `profile` as a JSON object with no fixed fields. Service `role-onboarding.service.ts`: read state; save the JSON; mark complete once (only if the account holds that role ACTIVE; completing again keeps the first timestamp). Assumption made: **none about fields** — the JSON is stored as given and not validated. Nothing calls the service; no screen exists; no existing Parent or Teacher has a row. Reversing it is dropping one empty table and one unused file.

**SF-10 (D-6).** Unique index `uq_user_roles_one_persona`: at most one row per account among `STUDENT`, `PARENT`, `TEACHER` **with status ACTIVE**. Revoked rows are not counted, so an administrator's "revoke, then grant another persona" still works. `STUDYUS_ADMIN` and `INSTITUTION_ADMIN` are not covered: an administrator or coordinator may hold one persona as well. The migration refuses to apply if any account already has two ACTIVE personas and changes no data. The admin console maps the index violation to its existing `PERSONA_EXISTS` error. This matches the R1 ruling.

**SF-12 (D-2 unruled).** Table `institution_student_memberships`: one row per (institution, learner), `ACTIVE` while the learner has at least one ACTIVE enrolment in a class of that institution, `ENDED` otherwise. It is written only by a database trigger on `class_enrollments`; no application code writes it or reads it. A pending or declined enrolment creates no membership. It is backfilled from today's ACTIVE enrolments. Assumption made: that the Institution → Student relationship should be **derived from enrolment** rather than managed on its own (no "member of the institution without a class", no separate invitation). On top of it, the EN-1 tables (`institution_licenses`, `institution_license_seats`) assume a **seat model**: a seat count per licence, one ACTIVE licence per institution, a seat attached to a membership and released when the membership ends. Nothing reads those tables; they license nobody. If D-2 is ruled as "per-student admin grants", all three tables are unused and can be dropped by a follow-up migration with no data loss.

SF-9, SF-11 and SF-13 were not started and will not be until ruled.

### R1-9. Preflight contract for L5

`docs/orchestration/L10_MIGRATION_PREFLIGHT.md`. Read-only SQL in five groups: ledger before / after (83 → 89 rows, `20261112_1000` → `20261120_1500`) and object-name collisions; accounts without an ACTIVE role row, split by role and by cause; accounts with more than one ACTIVE persona; pending parent invitations older than 30 days and the shape the migration assumes; enrolment data against the new constraints, including the `ON CONFLICT` code search. Each check is marked BLOCKER, BLOCKER (deploy) or RECORD, with its pass condition, and there is a summary sheet for L5 to return. Post-apply checks are included.

Every statement was executed against the throwaway database by `scripts/l10-ephemeral-db-test.sh` (sections 0–4 before the batch, section 5 after), and the script asserts they are all `SELECT`. The numbers they return there are fixture numbers and mean nothing; what was verified is that they run and that check 2.1 finds the account `20261120_1400` refuses.

I did not access any shared environment.

### R1-10. L11 reconciliation

- `SCHEMA_AND_MIGRATIONS` stays with L10. No migration was added in R1.
- L11-R1's report states that EXPIRED_RENEWAL and GRANT_TO_PAID passed and that none of its rulings needed schema, with one optional request (CR-L11-06), resolved above without schema. So nothing from L11 changes the chain today.
- Still open with L11: its review of `20261120_1200` (CR-L10-07). Until L11 confirms or amends that structure the chain should not be frozen.
- No entitlement logic was added in L10. `payments/checkout/route.ts` was not touched.

## BLOCKERS

NONE for the lane's own work. For convergence:

- **L8:** switch its exam-insights service to `getTeacherClassExamGaps` (CR-L10-03).
- **L2:** subject-aware aggregates, and subject attribution for goals, AICE syllabi and review items (CR-L10-01, CR-L10-08).
- **L9:** patch `enrollmentOf` (CR-L10-04).
- **L11:** review the licence schema (CR-L10-07).
- **L5:** run the preflight contract.
- **Orchestrator:** rule D-2, D-3, D-4, D-5, D-7; confirm the page-redirect behaviour (R1-4); say whether the concurrent Transfer case (R1-7) and Teacher scoping on the remaining whole-learner routes (R1-1) are in scope.

## CHANGE_REQUESTS

| # | Owner | State after R1 |
|---|---|---|
| CR-L7-01 | L10 | CLOSED |
| CR-L9-02 | L10 | CLOSED on this branch; cross-branch remainder is CR-L10-04 |
| CR-L8-01 | L10 + L8 + L2 | OPEN |
| CR-L11-05 | L10 | Implemented (R1-6) |
| CR-L11-06 | L10 | Implemented from existing state, no schema; one residual stated (R1-7) |
| CR-L10-01 | L2 | OPEN, widened: subject option on `examGapsFor` for domain / objective aggregates **and** a subject attribution for exam goals and AICE syllabi |
| CR-L10-02 | L6 | WITHDRAWN (no API route was affected; solved centrally) |
| CR-L10-03 | L8 | OPEN, widened: gaps, goals and AICE all through `getTeacherClassExamGaps`; the view must handle `withheld` |
| CR-L10-04 | L9 | OPEN: `enrollmentOf` must use `getClassEnrollmentState`; a message for "must be invited again" |
| CR-L10-05 | L7 | OPEN (cosmetic): show `OWN_EMAIL` / `ALREADY_LINKED` |
| CR-L10-06 | L5 | Replaced by the preflight contract |
| CR-L10-07 | L11 | OPEN: review `20261120_1200` |
| CR-L10-08 (new) | L2 | `src/lib/exam-core/`: (a) export one canonical "is this attempt's result visible to the Student" predicate, used by the Student page and by shared authorization; (b) expose the learning objective (or subject) of each result review item, so an in-subject item review can be returned to a Teacher. Until then shared code mirrors (a) under a pinning test and withholds (b) |

## MERGE RECOMMENDATION

Do not converge yet. When the open items above are done, merge order matters in two places: L10 before or together with L8 and L9 (their guard tests live in L10), and code together with the six migrations.

Expected hand-resolved files are the four listed in the core report, plus `src/app/api/cognitive/transfer/submit/route.ts` with L11 (keep both hunks).

## NEXT SAFE ACTION

Orchestrator reviews the R1 commit and routes CR-L10-01, -03, -04, -07 and -08.

---

# L10-R2 — 2026-10-11

Finalization run after the Orchestrator's ruling "L10-R2 FINALIZATION". `e094c5a` was not amended; R2 is a third commit.

## LANE

`L10_SHARED_FOUNDATION`, run R2. Worktree `/Users/jalbornoz/PROYECTOS/studyos-l10-shared-foundation`, branch `feat/l10-shared-foundation` (local only).

## STATUS

`READY_FOR_ORCHESTRATOR_REVIEW`

Values requested by the ruling (the lane's own results, for the Orchestrator to verify):

```
L10_CORE = PASS
D2_SEAT_MODEL = DEFERRED
D3_INDEPENDENT_TEACHERS = DEFERRED
D4_ONBOARDING_MODEL = PASS
D5_MINOR_CONSENT = DEFERRED_LEGAL_GATE
D6_PERSONA_MODEL = PASS
D7_SELF_SERVE_INSTITUTION = DEFERRED

CR_L7_01 = CLOSED
CR_L9_02 = CLOSED
CR_L8_01 = OPEN

TEACHER_WHOLE_LEARNER_SCOPE = PASS
REVOKED_STUDENT_HTTP = PASS
TRANSFER_CONCURRENT_EXACTLY_ONCE = PASS
ENROLMENT_SQL_L10 = PASS
CR_L9_ENROLMENT_LOOKUP = OPEN

MIGRATION_CHAIN_CLEAN = YES
MIGRATION_PREFLIGHT_READY = YES
EXPECTED_LEDGER_BEFORE = 83 rows, last version 20261112_1000
EXPECTED_LEDGER_AFTER  = 86 rows, last version 20261120_1200

L11_SCHEMA_DEPENDENCY = NONE
L10_READY_FOR_CONVERGENCE = YES, with the three convergence requirements below
```

**What "YES" means here.** L10 has no remaining work of its own. Converging it is still conditional on work in other lanes, and the merged line will not be green until that work lands — by design, because the guard tests live in L10:

1. L8 switches to the shared entry point (CR-L10-03). Until then three tests in `l10-cr-l8-01-…` fail on the merged line.
2. L9 fixes `enrollmentOf` (CR-L9-ENROLMENT-LOOKUP below). Until then one test in `l10-cr-l9-02-…` fails on the merged line.
3. L5 runs the preflight contract before the three migrations reach any shared database.

CR-L8-01 itself stays OPEN after convergence until L2's subject-aware aggregates exist. If "ready for convergence" must mean "nothing external outstanding", read this as NO.

## BASE SHA

`e094c5a` (L10-R1, accepted), parent `c2bcae9`.

## FINAL SHA

The commit on `feat/l10-shared-foundation` whose parent is `e094c5a`. Run `git rev-parse feat/l10-shared-foundation`.

## FILES CHANGED

Migrations: three deleted, two renumbered, headers updated (R2 Finding 1).

- Deleted: `20261120_1100_sf12_institution_student_memberships.sql`, `20261120_1200_en1_institution_licenses.sql`, `20261120_1300_sf8_role_onboarding_state.sql`
- Renamed: `20261120_1500_cr_l9_02_enrollment_history.sql` → `20261120_1100_…`; `20261120_1400_sf10_single_persona_constraint.sql` → `20261120_1200_…`
- Unchanged name: `20261120_1000_sf7_parent_relationship_lifecycle.sql`

Deleted application code (1): `src/lib/identity/role-onboarding.service.ts`.

New (2): `src/lib/authorization/teacher-subject-scope.ts`, `tests/unit/l10-r2-teacher-whole-learner-scope.test.ts`.

Modified application code (15): `src/lib/authorization/learner-result-scope.ts`; `src/lib/teacher/read-model.service.ts`, `src/lib/teacher/intervention.service.ts` (one query); `src/services/transfer-task-instance.service.ts`, `src/services/institution.service.ts` (one ORDER BY, one comment); routes `api/cognitive/transfer/submit`, `api/learners/[id]/summary`, `api/readiness`, `api/readiness/[id]`, `api/diagnostics`, `api/diagnostics/[id]/explain`, `api/exam-profiles`, `api/simulation/eligibility`, `api/learning/session-eligibility`, `api/teaching/interventions/[id]`.

Scripts (3), docs (3: this report, status, preflight contract), tests modified (14: the six L10 files, three migration-list pins, four route-security mocks, three Transfer route tests — details under TESTS).

## LOCKS USED

`SHARED_FOUNDATION`. `SCHEMA_AND_MIGRATIONS`: used to remove and renumber un-applied migration files. No migration was applied to any shared database.

## TESTS

| Command | Result |
|---|---|
| Focused: `npx vitest run tests/unit/l10-*.test.ts` | 9 files, 196 tests passed |
| Full: `env -u DATABASE_URL -u DATABASE_URL_UNPOOLED -u POSTGRES_URL npx vitest run` | 528 files, 9,489 tests passed |
| `npx tsc --noEmit -p .` | no output |
| `npx next build` | exit 0; 229/229 static pages |
| Ephemeral DB — apply / re-apply | three files apply and re-apply; SF-10 pre-check refuses a seeded multi-persona account and leaves its rows |
| Ephemeral DB — governed runner and ledger | before 83 rows, last `20261112_1000`; dry run 3 pending; after 86 rows, last `20261120_1200`; dry run 0 pending |
| Ephemeral DB — preflight contract SQL | 21 statements before the batch, 6 after; all run; all `SELECT` |
| Ephemeral DB — real guard / service checks | 178 passed, 0 failed |
| First full-suite run after the R2 code changes | 24 failures in 8 existing files: route tests whose mock of `@/lib/authorization` lacked `resolveLearnerReadScope`, three Transfer route tests whose database mock had no connection for the claim, and the AI import-graph guard (fixed by moving the gate into a module with no exam-core import). No behaviour regression |
| Browser, HTTP E2E, DEV / Stage / Production | NOT_RUN |

DB-backed concurrent regression (ruling requirement), in `scripts/operations/l10-foundation-integration.ts`, against real Postgres:

| Check | Result |
|---|---|
| 8 simultaneous first submissions of one task | exactly 1 grading invocation; 1 `COMPLETED`, 7 `IN_PROGRESS`; 1 evidence row; no lock left |
| 3 requests arriving while the first is still grading | all refused at once, no grading |
| A later request | `ALREADY_ANSWERED`, no grading |
| Grader throws | error reaches the caller; no lock left; no evidence; the retry grades |
| The holder's connection is closed without commit or rollback | the next submission grades |

## FINDINGS

### R2-1. Migration chain — rebuilt as three files

| File | Content |
|---|---|
| `20261120_1000_sf7_parent_relationship_lifecycle` | unchanged since core |
| `20261120_1100_cr_l9_02_enrollment_history` | was `1500`; content unchanged |
| `20261120_1200_sf10_single_persona_constraint` | was `1400`; content unchanged. Last on purpose: it has a pre-check that can stop it, and nothing depends on it |

Removed, with nothing left behind in code:

| Removed | Ruling | Also removed |
|---|---|---|
| `institution_licenses`, `institution_license_seats`, their two triggers | D-2: seat model deferred | — |
| `institution_student_memberships` and its trigger on `class_enrollments` | D-2: it existed only to carry a seat | — |
| `user_role_onboarding` | D-4: no free-form profile JSON; onboarding rests on existing typed identity and relationships | `role-onboarding.service.ts` (nothing called it) |

The batch now creates **no table**. It adds four columns, three indexes, one trigger function, and replaces one constraint. A test asserts the batch contains no licence, seat, membership, onboarding, consent, age or Transfer-marker schema, and that no application code names any removed object.

No completion marker was kept for D-4. Nothing reads one, and the ruling's model (Parent: account + relationship flow; Teacher: account + institution membership + class authorization) needs none.

Because the old drafts were never applied anywhere, renumbering is safe. The preflight contract gained check 0.5: the four removed tables and the three superseded version numbers must not exist in any database.

**Ledger.** Before L10: **83** rows, last `20261112_1000`. After L10: **86** rows, last `20261120_1200`. Versions added, in order: `20261120_1000`, `20261120_1100`, `20261120_1200`. Verified through `scripts/db-migrate.ts` on the throwaway database.

### R2-2. Decisions D-2 to D-7 — what the branch now does

| Decision | Ruling | In the branch |
|---|---|---|
| D-2 | Per-student admin / institution grants for the pilot; seat model deferred | No seat, licence or membership schema. Sponsored access is whatever L11's existing admin grant does; L10 adds nothing |
| D-3 | Independent teachers out of scope | Nothing built. Teacher access requires an ACTIVE TEACHER role, an ACTIVE institution and an authorized class (SF-1, SF-3), and for learner data also the class's subject |
| D-4 | No free-form JSON; onboarding from typed identity and relationships | Table and service removed. No onboarding state is stored by L10. A Teacher cannot assert an institution, class or subject: all three come from membership and assignment rows a coordinator writes |
| D-5 | Deferred legal gate | Nothing built. No consent or age field anywhere in the batch |
| D-6 | One ACTIVE primary persona; admin and coordinator are privileges | `uq_user_roles_one_persona` over ACTIVE `STUDENT` / `PARENT` / `TEACHER` rows only. `STUDYUS_ADMIN` and `INSTITUTION_ADMIN` are not in the index. DB-checked: second ACTIVE persona refused; revoke-then-grant allowed; a coordinator privilege beside a persona allowed |
| D-7 | No self-service institution creation | Nothing built |

SF-9, SF-11, SF-12 and SF-13 are deferred and not started (SF-12's draft was removed). EN-1 and IN-4 from L3R1 depended on the seat model and are deferred with it.

### R2-3. Teacher whole-learner scope — audit and result

One gate, `canReadLearnerRoute` (`src/lib/authorization/teacher-subject-scope.ts`), now fronts every learner-wide read route. For a reader who reaches the learner only as a Teacher, each route declares what its payload is: learner-wide (refused) or about one concept (allowed only inside a subject the teacher holds for that learner).

| Surface | Payload | Teacher now |
|---|---|---|
| `GET /api/learners/[id]/summary` | every subject of the learner, debts, upcoming exams | refused |
| `GET /api/readiness`, `GET /api/readiness/[id]` | exam-wide readiness snapshots | refused |
| `GET /api/exam-profiles` | the learner's exam goals | refused |
| `POST /api/simulation/eligibility` | exam-wide eligibility | refused |
| `GET /api/learning/session-eligibility` | learner-wide | `authorized: false` |
| `GET /api/diagnostics?conceptId=` | diagnoses of one concept | only when that concept is in subject |
| `GET /api/diagnostics/[id]/explain` | one diagnosis | only when its concept is in subject |
| `GET /api/teaching/interventions/[id]` | one session and its attempts | only in subject (R1) |
| `GET /api/simulation/attempts/[id]` | exam-wide state and scores | refused (R1) |
| `GET /api/simulation/attempts/[id]/result` | per-objective results | in-subject objectives only (R1) |
| `getTeacherStudentOverview` (`/api/teacher/students/[id]/overview`) | counts over the whole learner, plus exam readiness | counts over in-subject concepts only; readiness `WITHHELD` |
| `getTeacherClassExamGaps` (`/api/teacher/exam-insights`) | gaps, goals, AICE | gaps in subject; goals and AICE withheld (R1) |

"In subject" always means: the concept has a MATCHED catalogue mapping to a canonical concept whose subject is the subject of an ACTIVE class, in an ACTIVE institution, that the actor teaches and the learner is actively enrolled in. A concept with no confirmed mapping is in nobody's subject.

A test asserts that no route under `src/app/api` still calls the unsliced check with a read permission; the only remaining `canAccessLearner` calls ask for the owner-only permission. The owner and an accepted Parent are unaffected. A Coordinator is refused on every rule.

Also found and fixed during the sweep: `listTeacherClassIdsForActor` in `src/lib/teacher/intervention.service.ts` was a third copy of the "classes this actor teaches" query and had none of the SF-1 / SF-3 conditions, so a teacher of two institutions kept reading intervention rows of a suspended one.

Read and judged already subject- or class-scoped, **not changed**: `getTeacherLearnerView` and `listClassLearnerAttention` (driven by the class subject's topics), `class-progress.service.ts` (class concepts; exam dates filtered to the class subject), `listTeacherInterventionsForStudent` (only classes the actor teaches). I read their scoping logic, not every field they return.

One item outside a read path, not changed: `POST /api/teacher/interventions` checks that a concept target belongs to the learner, not that it belongs to the class's subject (L8 reported this). It is a write, in L8's area.

### R2-4. Transfer concurrent exactly-once — no schema

`runTransferSubmissionExclusively` (`src/services/transfer-task-instance.service.ts`) wraps the grading call and the evidence write in the submit route.

- **The claim** is a transaction-scoped advisory lock on a dedicated connection, keyed by the task's own evidence identity, taken with `pg_try_advisory_xact_lock` so it never waits. This is the mechanism the activity launch lock already uses, for the reason documented there (a session-level lock is unsafe behind the Neon pooler).
- **Order inside the claim:** read the persisted answer state, then grade, then write evidence. The evidence is committed before the claim is released.
- **Second request, deterministically:** while the first is grading → `409 TRANSFER_TASK_SUBMISSION_IN_PROGRESS`; after it → `409 TRANSFER_TASK_ALREADY_ANSWERED`. Neither grades.
- **One outcome:** one grading invocation, one evidence row (the unique operation key still stands behind it).
- **Crash / retry:** the claim persists nothing. If the process dies or grading throws, the transaction ends and the lock goes with it; no evidence exists, so the task is still open. There is no lease and nothing to clean up.

Two things to know:

1. **Cost.** One pooled connection is held, idle in a transaction, for the length of one grading call. The grading code itself uses other connections. With the default pool size, many simultaneous Transfer gradings on one instance could exhaust the pool; the launch lock has the same property today. If that is a concern at pilot volume, the alternative is a lease column (schema), which I did not add because existing state suffices.
2. **Merge with L11.** L11 changed the same route above this block. My change re-indents the grading block inside the wrapper. If the merge conflicts, keep L11's licence gate where it is and keep the grading inside `runTransferSubmissionExclusively`. L11 needs no further patch.

### R2-5. Enrolment lifecycle

**L10's own branch (ENROLMENT_SQL_L10 = PASS).** No `ON CONFLICT (class_id, student_id)` in `src/` or `scripts/`; no later migration re-creates the constraint; no read by (class, learner) without a status filter or order; every insert into `class_enrollments` is in the lifecycle module. Four repository-wide tests assert this.

**Convergence conflict-resolution requirements for L5** (also written into the preflight contract, check 4.6). Every other lane branch, and both integration lines, still carry the six inherited occurrences. When merging, take L10's version of the enrolment hunks in:

- `src/services/institution.service.ts` (2: `enrollStudent`, `inviteStudentToClass`)
- `src/lib/institution/institution-operations.service.ts` (1: `enrollActive`) — L9 also edited this file; resolve by hand
- `scripts/operations/track-a-fixtures.ts`, `track-a-learning-plan-e2e-http.ts`, `track-a-curriculum-v2-e2e-http.ts` (1 each)

then re-run the search on the merged line.

**CR-L9-ENROLMENT-LOOKUP (OPEN, owner L9).** `enrollmentOf(classId, studentId)` in L9's `src/lib/institution/institution-operations.service.ts` runs `SELECT status FROM class_enrollments WHERE class_id = $1 AND student_id = $2` and takes the first row. After `20261120_1100` a pair can have one open row and several closed ones, so that row is arbitrary.

Required selection semantics:

1. If the pair has an OPEN row (`status IN ('PENDING', 'ACTIVE')`), that row is the current enrolment. There is at most one (unique index `uq_class_enrollments_one_open`).
2. Otherwise the current state is the **most recent** CLOSED row (`status IN ('ENDED', 'DECLINED')`), by `created_at DESC`, then `id DESC`.
3. Otherwise there is no enrolment.

Equivalent SQL: `… ORDER BY (status IN ('PENDING', 'ACTIVE')) DESC, created_at DESC, id DESC LIMIT 1`. Preferably call the existing `getClassEnrollmentState(classId, studentId)` from `src/services/institution.service.ts`, which returns `{ open, lastClosed }` with exactly these rules.

What L9's bulk add must then report: `open` present → `ALREADY_ENROLLED`; no `open` and `lastClosed.status = 'DECLINED'` → `PREVIOUSLY_DECLINED`; no `open` and `lastClosed.status = 'ENDED'` → `PREVIOUSLY_ENDED`; neither → proceed with the single add. An open row always wins over any closed one: a learner who declined once and was later invited again is `ALREADY_ENROLLED` (pending), not `PREVIOUSLY_DECLINED`.

### R2-6. Page authorization

No change. API 403 and page 307 stay as accepted.

### R2-7. CR-L8-01

OPEN, unchanged. L10 maintains the boundary (`getTeacherClassExamGaps`); `src/lib/exam-core/**` was not edited.

## BLOCKERS

NONE for the lane.

## CHANGE_REQUESTS

| # | Owner | State |
|---|---|---|
| CR-L7-01 | L10 | CLOSED |
| CR-L9-02 | L10 | CLOSED |
| CR-L8-01 | L8 + L2 (boundary kept by L10) | OPEN |
| CR-L11-05 | L10 | Implemented (R1) |
| CR-L11-06 | L10 | Implemented; sequential and concurrent, no schema |
| CR-L9-ENROLMENT-LOOKUP (was CR-L10-04) | L9 | OPEN — semantics in R2-5 |
| CR-L10-01 | L2 | OPEN — subject-aware domain / objective aggregates in `examGapsFor`; subject attribution for exam goals and AICE syllabi |
| CR-L10-03 | L8 | OPEN — gaps, goals and AICE through `getTeacherClassExamGaps`; handle `withheld`; note `getTeacherStudentOverview` now returns `latestReadinessStatus: 'WITHHELD'` and a `subjectScope` field |
| CR-L10-05 | L7 | OPEN (cosmetic) — show `OWN_EMAIL` / `ALREADY_LINKED` |
| CR-L10-07 | L11 | WITHDRAWN — the licence schema was removed |
| CR-L10-08 | L2 | OPEN — one exported Student-visibility predicate; the objective or subject of each result review item |

## MERGE RECOMMENDATION

L10 can enter convergence under the three requirements in STATUS. Order: L10 before or together with L8 and L9; code together with the three migrations; preflight before any shared database.

Hand-resolved files to expect: `api/teacher/exam-insights/route.ts` and `tests/unit/aice-pisa-security.test.ts` (L8); `src/lib/institution/institution-operations.service.ts` (L9); `tests/unit/e2e-object-authorization.test.ts` (L6); `api/cognitive/transfer/submit/route.ts` (L11).

## NEXT SAFE ACTION

Orchestrator reviews the R2 commit and routes CR-L10-03 to L8 and CR-L9-ENROLMENT-LOOKUP to L9.

---

# CR-L8-01 GLOBAL CLOSE — 2026-10-11

Run after the Orchestrator's instruction "CLOSE CR-L8-01 GLOBAL".

## LANE

`L10_SHARED_FOUNDATION`, closing run for CR-L8-01 across L2, L8 and L10.

| | |
|---|---|
| Worktree | `/Users/jalbornoz/PROYECTOS/studyos-cr-l8-01-close` (new) |
| Branch | `fix/cr-l8-01-global-close` (new, local only) |
| Built from | L8 `8569b81` (which already contains L10 `79b7f50`), plus a local merge of L2 `f54cc14` |

The three inputs were on two unrelated branches, and the change needs all three in one tree, so I made a new branch rather than commit into any lane's branch. No lane branch, integration branch or input commit was modified.

## STATUS

`READY_FOR_ORCHESTRATOR_REVIEW`

```
L2_SUBJECT_AGGREGATES = PASS
L10_TEACHER_BRIDGE_SUBJECT_SCOPE = PASS
L8_DOMAIN_OBJECTIVE_DISPLAY = PASS
CR_L8_01 = CLOSED
FULL_SUITE = 531 files, 9,579 tests passed
TYPECHECK = clean (no output)
BUILD = exit 0, 229/229 static pages
READY_FOR_FULL_PRODUCT_CONVERGENCE = YES for these three inputs; see the two caveats below
```

Caveats on the last line:

1. It covers what I ran: this branch (L10 + L8 + L2). None of the three inputs is on `integration/stage-convergence` yet, and I did not attempt that merge, so conflicts with the B5 line there are unknown.
2. The L8 page change is not browser-verified (no environment available to this lane).

Of the items L10 was tracking from other lanes, L9's enrolment lookup is fixed on L9's branch (`620a76c`); the L5 preflight is still to be run before any shared database migration.

## BASE SHA

`8569b81` (L8), which contains `79b7f50` (L10). L2 input: `f54cc14`.

## FINAL SHA

Two commits on `fix/cr-l8-01-global-close`: the merge of `f54cc14` (`941cd29`) and the closing commit on top of it. Run `git rev-parse fix/cr-l8-01-global-close`.

## FILES CHANGED

By this run (besides the merge of L2's five files, which are unchanged):

- `src/lib/authorization/teacher-exam-scope.ts` (L10)
- `src/lib/teacher/exam-insights.service.ts`, `src/app/dashboard/teacher/classes/[classId]/exam-insights/page.tsx`, `src/lib/i18n/teacher-l8-messages.ts` (L8)
- `tests/unit/l10-cr-l8-01-teacher-exam-subject-scope.test.ts` (rewritten), `tests/unit/l8-teacher-te1-te2.test.ts`
- `scripts/operations/l10-foundation-integration.ts`
- this report, `docs/orchestration/status/L10_STATUS.md`

`src/lib/exam-core/**` was not edited; it is L2's `f54cc14` as merged.

## LOCKS USED

`SHARED_FOUNDATION` for the entry point. The three L8 files were edited because the instruction asks for the L8 display to be restored in this run. No migration, no shared database.

## TESTS

| Command | Result |
|---|---|
| Focused L2 / L8 / L10: `npx vitest run tests/unit/l2-*.test.ts tests/unit/l8*.test.ts tests/unit/l10-*.test.ts tests/unit/aice-pisa-security.test.ts` | 13 files, 304 tests passed |
| Full: `env -u DATABASE_URL -u DATABASE_URL_UNPOOLED -u POSTGRES_URL npx vitest run` | 531 files, 9,579 tests passed |
| `npx tsc --noEmit -p .` | no output |
| `npx next build` | exit 0; 229/229 static pages |
| L2's DB certification on this merged tree: `scripts/operations/l2-cr-l8-01-subject-gaps-cert.sh` (throwaway Postgres 18) | `L2_CR_L8_01_SUBJECT_GAPS_CERT = PASS`, 18 checks, the real `examGapsFor` query |
| L10's DB suite on this merged tree: `scripts/l10-ephemeral-db-test.sh` (throwaway Postgres 14) | ledger 83 → 86; integration 179 passed, 0 failed |
| Browser, HTTP E2E, DEV / Stage / Production | NOT_RUN |

The seven required regressions, all in `tests/unit/l10-cr-l8-01-teacher-exam-subject-scope.test.ts` unless noted:

| # | Requirement | Test |
|---|---|---|
| 1 | Mathematics Teacher receives only Mathematics domain / objective / concept aggregates | "domain, objective, concept and per-student aggregates are all present, and all Mathematics" |
| 2 | Reading objectives / gaps of the same learner are absent | "no Reading concept, objective, domain or count anywhere in the Mathematics teacher's response" |
| 3 | Multi-subject exam returns only the authorized subject slice | "one exam (PAA) holds both subjects…" and "an objective mapped to concepts of BOTH subjects contributes only its in-subject slice to each teacher" |
| 4 | Class with no linked subject returns empty scoped aggregates, never unscoped | "200 with every aggregate empty", "the bridge was asked with an EMPTY scope…", "fails closed even if the bridge ignored the scope" |
| 5 | Coordinator cannot use the Teacher route | "GET /api/teacher/exam-insights => 403 for the institution's own coordinator; nothing is read" |
| 6 | Institution / internal unscoped caller remains compatible | "omitting canonicalSubjectIds is still the unscoped behaviour…", "the Institution route still calls the bridge without a subject scope…"; and L2's own unit and DB tests |
| 7 | L8 concept / exam assignment subject-scope tests remain green | `l8-teacher-te1-te2.test.ts` (22) and `l8r1-teacher-exam-practice.test.ts`, run in the focused set |

How the unit tests reach the bridge: `examGapsFor` is replaced by a stand-in built from L2's own exported pure functions (`subjectScopeOf`, `scopeGapRowsToSubjects`, `aggregateGapRows`) over fixture gap rows of one multi-subject exam. So the subject cut and the aggregation in those tests are L2's real code; only the SQL fetch is replaced. The SQL itself is covered by L2's DB certification, which I ran on this merged tree.

## FINDINGS

### 1. L10 shared entry point

`getTeacherClassExamGaps` now always passes `canonicalSubjectIds` to `examGapsFor`:

| Class | Passed |
|---|---|
| has a canonical subject | `[canonicalSubjectId]` |
| has no governed canonical subject | `[]` (the bridge returns nothing) |

It is never omitted on this path. Before, a class without a subject short-circuited without calling the bridge; it now calls with `[]` as instructed, and still returns empty whatever comes back.

Preserved: the teacher-only gate (`resolveTeacherClassScope`, never an institution admin), the ACTIVE-roster limit, and fail-closed behaviour.

The earlier concept-level cut in this file is gone, because the bridge now does the cut. What replaced it is a check of the bridge's answer:

- if any returned concept is not of the requested subject, the **whole** answer is discarded (its domain and objective rows would be unscoped too);
- if any returned learner is outside the class roster, the whole answer is discarded;
- if the subject lookup fails, nothing is returned.

So a regression in the bridge shows up as an empty view, not as a leak.

`withheld` is now `['EXAM_GOALS', 'AICE_ENTRIES']`; `subjectScope.objectiveAggregates` reads `'SUBJECT_SCOPED'`.

### 2. L8 exam insights

- The service still reads exam data only through `getTeacherClassExamGaps`. A test fails on any Teacher file that calls `examGapsFor` or `examGoalsFor`, or reads the AICE plan tables.
- The page renders again: gaps by area (`byDomain`), by objective (`byObjective`), by topic (`byConcept`) and per student.
- Goals and AICE entries are not rendered; the notice now names only those two.
- Messages: `l8.exams.domains.title` and `l8.exams.objectives.title` restored in the five locales with their original wording; `l8.exams.withheld` reworded in the five locales.

One number changed meaning and I adjusted L8 for it: the bridge's per-student `gaps` is the count of in-subject gap **objectives**, while the page labels the per-student figure as **topics**. `examInsightsByStudent` now shows the number of in-subject gap concepts under that label, so the label and the number agree.

### 3. What a Mathematics teacher gets, on the fixture

One multi-subject exam; one learner with a Mathematics gap, a Reading gap, an objective mapped to both subjects, and an objective with no published concept:

| | Unscoped (institution) | Mathematics teacher |
|---|---|---|
| Gap objectives | 4 | 2 (the Mathematics one and the mixed one) |
| Areas | 4 | 2 |
| Concepts | Mathematics and Reading | Mathematics only |
| The unmapped objective | present | absent |

### 4. Still not available to a Teacher

Exam goals and AICE entries (no governed subject mapping), and item-level review on exam attempts (a review item carries no subject). These are separate from CR-L8-01 and remain as described in the R1 / R2 sections (CR-L10-08).

## BLOCKERS

NONE.

## CHANGE_REQUESTS

| # | State |
|---|---|
| CR-L8-01 | CLOSED on `fix/cr-l8-01-global-close` |
| CR-L10-01 (L2: subject-aware aggregates) | CLOSED by `f54cc14` for domain / objective aggregates. The part about a subject attribution for exam goals and AICE syllabi remains open |
| CR-L10-03 (L8: use the shared entry point) | CLOSED by `a93b809` and this run |
| CR-L10-08 (L2: Student-visibility predicate; subject of review items) | OPEN |

## MERGE RECOMMENDATION

Use `fix/cr-l8-01-global-close` as the convergence input for L8 + L10 + L2 together: it supersedes `8569b81`, `79b7f50` and `f54cc14` taken separately. Merging the three separately would leave `teacher-exam-scope.ts` calling the bridge without the subject option.

## NEXT SAFE ACTION

Orchestrator reviews the two commits on `fix/cr-l8-01-global-close`.
