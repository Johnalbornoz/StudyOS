# L4R1_SECURITY_REMEDIATION — Report

Run date: 2026-10-11 (UTC).

## LANE

| | |
|---|---|
| Lane | `L4R1_SECURITY_REMEDIATION` (continuation of `L4_RBAC_SECURITY_AUDIT`, authorized by the Orchestrator) |
| Mode | Code and tests, limited to four P1 findings |
| Worktree | `/Users/jalbornoz/PROYECTOS/studyos-security-p1-remediation` |
| Branch | `fix/security-p1-remediation` (new, local only, created from `integration/q1-paa-bank-readiness`) |
| Audit it remediates | `audit/rbac-security` @ `23818f1` — not modified, not amended |

## STATUS

`READY_FOR_ORCHESTRATOR_REVIEW`

## BASE SHA

`3031e03fea90ad3cbe941c1b506c4d19d8f96142` — HEAD of `integration/q1-paa-bank-readiness`, verified with `git rev-parse` (clean tree) before the worktree was created.

## FINAL SHA

The single commit on `fix/security-p1-remediation` whose parent is `3031e03`. Run `git rev-parse fix/security-p1-remediation` for the value.

## ACCEPTANCE GATES

| Gate | Result |
|---|---|
| UPCOMING_ASSESSMENT_IDOR | PASS |
| TRANSFER_SUBMIT_IDOR | PASS |
| BILLING_REACTIVATION_BYPASS | PASS |
| ADMIN_PRIMARY_EMAIL_RESOLUTION | PASS |
| NEW_SECURITY_TESTS | PASS (3 files, 40 tests) |
| EXISTING_SECURITY_TESTS | PASS (full suite 519 files, 9,290 tests; 6 existing tests needed fixture updates, listed below) |
| TYPECHECK | PASS (`tsc --noEmit`, no output) |
| BUILD | PASS (`next build`, exit 0, 228 static pages) |
| P1_SECURITY_BLOCKERS_REMAINING | 0 of the four authorized |
| ADMIN_ROUTE_HELPER_COVERAGE | 36/36 allowlist-only routes now use the helper; 87/87 admin routes go through either the canonical guard (51) or the helper (36) |

Every gate was verified by unit tests and static checks only. Nothing was exercised against a real database, Clerk instance or deployed environment.

## FILES CHANGED

New (5):

- `src/lib/admin/admin-identity.ts` — the verified-primary-email helper
- `src/lib/entitlements/self-reactivation.ts` — the self-reactivation rule
- `tests/unit/l4r1-admin-primary-email.test.ts`
- `tests/unit/l4r1-billing-self-reactivation.test.ts`
- `tests/unit/l4r1-object-ownership-idor.test.ts`

Modified application code (45):

- `src/app/api/assessments/upcoming/route.ts`
- `src/app/api/exam-readiness/score/route.ts`
- `src/app/api/cognitive/transfer/submit/route.ts`
- `src/app/api/billing/reactivate/route.ts`
- `src/lib/entitlements/index.ts`
- `src/lib/admin/authorization.ts`
- `src/lib/identity/workspace-entry.ts`
- `src/app/dashboard/layout.tsx`
- `src/app/dashboard/admin/[studentId]/page.tsx`
- 36 route files under `src/app/api/admin/{assessment,catalog,concepts,curriculum,diagnostics,learner-state,readiness,students,subjects,teaching}` — the same mechanical change in each (email resolution only)

Modified existing tests (4 files, fixtures only):

- `tests/unit/admin-authorization.test.ts`, `tests/unit/admin-onboarding-routing.test.ts`, `tests/unit/dashboard-layout-role-redirect.test.ts` — the mocked Clerk user gained `primaryEmailAddressId` and a verified `emailAddresses` entry (the old shape had an empty `emailAddresses` list, which can no longer authorize anything)
- `tests/unit/f3-api-routes-security.test.ts` — `@/lib/db` mocked; the two `suspended` fixtures gained a running paid period so they stay a legitimate reactivation

Documentation (2): `docs/orchestration/status/L4R1_STATUS.md`, `docs/orchestration/reports/L4R1_REPORT.md`.

No schema, migration, script, environment, flag or Clerk setting was changed.

## LOCKS USED

- **SHARED_FOUNDATION (not activated).** Four of the changed files sit in its scope (`src/lib/admin/*`, `src/lib/entitlements/*`, `src/lib/identity/workspace-entry.ts`). They were changed under the Orchestrator's explicit L4-R1 authorization for these four findings, not under the lock. Nothing else in that scope was touched.
- `SCHEMA_AND_MIGRATIONS`, `STAGE_RUNTIME`, `PRODUCTION`, `INTEGRATION_MERGE`: not used.

## TESTS

| Command | Result |
|---|---|
| `env -u DATABASE_URL -u DATABASE_URL_UNPOOLED -u POSTGRES_URL npx vitest run tests/unit/l4r1-*.test.ts` | 3 files, 40 tests passed |
| Same three files with the six fixed source files temporarily restored to `3031e03` | 18 of 40 failed — every denial test for all four findings. Fixes then restored; 40 passed again |
| `env -u DATABASE_URL ... npx vitest run` (full suite, no `.env` in worktree) | first run: 6 failures in 4 existing files (stale fixtures, see FILES CHANGED); after fixture updates: 519 files, 9,290 tests passed |
| `npx tsc --noEmit -p .` | no output |
| `npx next build` (no database configured) | exit 0; compiled; 228/228 static pages |
| HTTP E2E suites `scripts/operations/track-a-*-e2e-http.ts` | NOT_RUN — ENVIRONMENT_WRITE_RISK |
| Any DEV, Stage or Production access | NOT_RUN |

Build note: the first build attempt failed because Turbopack rejects a symlinked `node_modules`. The symlink was replaced with a copy-on-write clone of the canonical worktree's `node_modules` (git-ignored, left in place so the checks can be re-run).

Required regression cases and where they are:

| Area | Case | Test |
|---|---|---|
| Upcoming assessment | own subject allowed | `l4r1-object-ownership-idor` › "own subject is allowed…" |
| | foreign subject denied | › "a foreign subject is denied with the same 404…" |
| | foreign state not mutated | › "foreign state is neither read nor mutated…" |
| | nonexistent id safe | › "a nonexistent or malformed id is safe…" |
| Transfer | own remediation allowed | › "own remediation step is allowed and completed" |
| | foreign remediation denied | › "a foreign remediation step is denied (404)…" |
| | foreign state unchanged | › "foreign state is unchanged…" |
| Billing | legitimate self-reactivation preserved | `l4r1-billing-self-reactivation` › "legitimate self-reactivation still works…", "legitimate past_due -> active still works" |
| | admin suspension cannot be reversed | › "an admin suspension cannot be reversed" |
| | admin revocation cannot be reversed | › "an admin grant revocation cannot be reversed" |
| | no entitlement basis cannot create access | › "no valid entitlement basis cannot create access" |
| Admin email | primary at index 0 works | `l4r1-admin-primary-email` › "primary at index 0 => works" |
| | unverified secondary at 0, verified primary at 1 | › "unverified secondary at index 0 + verified primary at index 1…" |
| | verified secondary at 0, verified primary at 1 | › "verified secondary at index 0 + verified primary at index 1…" |
| | unresolved primary id denied | › "unresolved primary id => deny…" |
| | unverified primary denied | › "unverified primary => deny" |
| | non-allowlisted primary denied | › "non-allowlisted primary => deny" |
| | allowlisted verified primary allowed | › "allowlisted verified primary => allow…" |

The IDOR tests run the real guards in `src/lib/auth.ts` and the real assessment service against an in-memory database, and assert on the SQL actually issued. They are not a substitute for a two-student test against a real database.

## FINDINGS

### 1. `GET /api/assessments/upcoming?subjectId=` — fixed (L4-01)

- The route now calls the existing `verifySubjectAccess(studentId, subjectId)` before `getNextOccurrence`. A foreign, nonexistent or malformed subject id returns the same `404 NOT_FOUND`, and no calendar read or roll-forward write is issued for it (`src/app/api/assessments/upcoming/route.ts`).
- **Also fixed: `GET /api/exam-readiness/score`.** It passed an unverified `subjectId` to the same function. The audit folded it into L4-01, so the same check was added there. It is one extra file beyond the route named in the authorization.
- `getNextOccurrence` itself is unchanged. Its three other callers pass a subject id taken from an already-verified request or the caller's own quiz session.

### 2. `POST /api/cognitive/transfer/submit` — fixed (L4-02)

- The route now calls the existing `verifyRemediationStepAccess(studentId, remediationStepId)` directly after the student check, before the safety gate, grading or any write. A foreign or nonexistent step returns `404 NOT_FOUND`. This mirrors `cognitive/explain/submit`.
- Not changed: the route still accepts a client-supplied `conceptId` / `subjectId` when no server task instance exists, and has no licence check (audit items L4-10 and L4-19, outside the four findings).

### 3. `POST /api/billing/reactivate` — fixed (L4-03), with a rule the Orchestrator should confirm

The route owner check was not enough: any owner or payer could move `suspended → reactivated`. The new rule is in `src/lib/entitlements/self-reactivation.ts`:

| Subscription state | Self-reactivation |
|---|---|
| `suspended`, row set by an administrator (`manually_set_by_admin` — a grant, a revoked grant, a manual override) | Denied, `ADMIN_CONTROLLED` |
| `suspended`, last suspension recorded with an administrator as actor (`subscription_events`) | Denied, `ADMIN_SUSPENDED` — even with a running paid period or a later payment |
| `suspended`, not admin-caused, with a paid period still running or a `SUCCEEDED` payment after the suspension | Allowed → `reactivated` |
| `suspended`, not admin-caused, no such basis | Denied, `NO_ENTITLEMENT_BASIS` |
| `past_due`, row set by an administrator | Denied, `ADMIN_CONTROLLED` |
| `past_due`, paid row | Allowed → `active` (unchanged; `past_due` already grants access, so this creates none) |
| Anything else | `409 NOT_REACTIVATABLE` (unchanged) |

- Denials return `403 { error: 'REACTIVATION_NOT_PERMITTED', reason }`. A lookup failure denies.
- A successful self-reactivation now writes a `REACTIVATED` row to the existing `subscription_events` table with the caller as actor. No schema change.
- The `SUBSCRIPTION_REACTIVATE` capability (what `GET /api/billing/subscription` reports) applies the same rule, so the Billing page is not told a reactivation is available when the route would refuse it.

Two consequences to confirm:

1. **In today's code every `suspended` row is created by an administrator** (`suspendMembership`, `revokeLicenseGrant`). So in practice self-reactivation from `suspended` is now always refused, and only an admin can restore it. The allowed branch exists for a future non-payment suspension path.
2. **`past_due → active` without payment evidence is preserved.** It does not create access, but it lets a student clear a past-due label. I left it because the authorization asked to preserve existing legitimate self-reactivation; say if it should require a payment too.

### 4. Admin authorization no longer reads `emailAddresses[0]` — fixed (L4-05, email part only)

- New single helper, `src/lib/admin/admin-identity.ts`: `resolveVerifiedPrimaryEmail(user)` follows `primaryEmailAddressId` → the `emailAddresses` entry with that exact id → `verification.status === 'verified'` → trim and lowercase. Any step that does not resolve yields `null`. `isAllowlistedAdminUser(user)` compares that to the existing allowlist. There is no fallback to index 0 and no use of a secondary address.
- Migrated to it: all 36 allowlist-only routes, the admin student page, the canonical gate `requireStudyUSAdmin` (which protects the other 51 routes and 16 pages), and both callers of the admin-role bootstrap (`dashboard/layout.tsx`, `workspace-entry.ts`).
- A source-guard test fails if any admin route, admin page or `src/lib/admin` file reads `emailAddresses[0]` or calls `isAdminEmail` directly again, and pins the 51 + 36 = 87 route split.
- Behaviour change to expect: an administrator whose primary email is not verified in Clerk is now denied everywhere, including the admin console.

Deliberately not changed (scope lock): the 36 routes still authorize by allowlist alone, without the `STUDYUS_ADMIN` role, account status, rate limit or audit. A revoked admin role still passes them. That is the rest of L4-05.

### Residual `emailAddresses[0]` fallbacks outside admin authorization

Not touched, because they are not admin authorization and several sit in parent, institution and payment code:

- `src/app/dashboard/layout.tsx:77` and `src/lib/identity/workspace-entry.ts:60` — the email used to create or backfill the `users` row (not used for the admin decision any more)
- `src/lib/auth.ts` `resolveClerkIdentity`, `src/lib/identity/display-identity.ts`
- `src/app/api/parent/invitations/**`, `src/app/api/payments/checkout/route.ts`, coordinator invitation acceptance

The parent and coordinator invitation matches are the ones with security weight: the same index-0 behaviour could let an account claim an invitation addressed to an email it has only added, not verified. See CR-L4R1-01.

## BLOCKERS

NONE.

## CHANGE_REQUESTS

| # | Lock | Files | Change needed | Why not done here |
|---|---|---|---|---|
| CR-L4R1-01 | SHARED_FOUNDATION | `src/lib/auth.ts` (`resolveClerkIdentity`), `src/app/api/parent/invitations/route.ts`, `src/app/api/parent/invitations/[id]/respond/route.ts`, `src/services/institution-admin.service.ts` (coordinator acceptance), `src/app/api/payments/checkout/route.ts` | Use the same verified-primary resolution for invitation matching and identity; remove the remaining index-0 fallbacks | Outside the four authorized findings; relationship and payment code |
| CR-L4R1-02 | SHARED_FOUNDATION | the 36 routes, `src/app/dashboard/admin/[studentId]/page.tsx` | Move them to `guardAdminUsersRoute` and audit their mutations (audit CR-L4-02) | Explicitly excluded: "replace email allowlist with the final DB ADMIN privilege model" |
| CR-L4R1-03 | SHARED_FOUNDATION (product decision first) | `src/lib/entitlements/self-reactivation.ts`, `src/app/api/billing/reactivate/route.ts` | Decide whether `past_due → active` needs payment evidence, and whether a non-admin suspension path will exist | Product rule, not a defect fix |

The audit's other change requests (CR-L4-01, -03 to -10) are unchanged and still open. CR-L4-11 is closed by this branch.

## MERGE RECOMMENDATION

Merge `fix/security-p1-remediation` into `integration/q1-paa-bank-readiness` after review. It is one commit on top of the current HEAD, so it applies cleanly today. The B5 line (`integration/assessment-b5-runtime-certification`) has the same four defects (L3 F-00: the lines do not differ in these files) and will need the same commit; I did not test a cherry-pick onto it.

Before Stage certification, one runtime check is worth doing on an environment where writes are allowed: two real students, one calling the three fixed routes with the other's ids.

## NEXT SAFE ACTION

Orchestrator reviews the commit and confirms the two billing consequences in Finding 3.
