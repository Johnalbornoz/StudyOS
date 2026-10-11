# L11_ENTITLEMENTS — Report

Run date: 2026-10-11 (UTC).

## LANE

| | |
|---|---|
| Lane | `L11_ENTITLEMENTS` |
| Mode | Code and tests. Non-schema work packages EN-1, EN-2, EN-3 of `L3R1_REPORT.md` |
| Worktree | `/Users/jalbornoz/PROYECTOS/studyos-l11-entitlements` |
| Branch | `feat/l11-entitlements` (new, local only, created from `4fb45b0`) |

## STATUS

`READY_FOR_ORCHESTRATOR_REVIEW`

Three decisions are open for the Orchestrator (section "Decisions needed"). None blocks Stage or the pilot. Two of them must be ruled before payments are switched on.

## BASE SHA

`4fb45b09` — HEAD of `fix/security-p1-remediation`, verified with `git log -1 4fb45b0` before the worktree was created.

## FINAL SHA

The single commit on `feat/l11-entitlements` whose parent is `4fb45b0`. Run `git rev-parse feat/l11-entitlements`.

## FILES CHANGED

New application code (4):

- `src/lib/entitlements/learning-gate.ts` — the shared licence enforcement point (EN-2)
- `src/lib/entitlements/unlicensed-policy.ts` — the written definition of unlicensed mode, as data (EN-2)
- `src/lib/entitlements/provider-events.ts` — what a provider event may do; checkout reference format (EN-3)
- `src/lib/entitlements/mercadopago-signature.ts` — webhook signature verification (EN-3)

Modified application code (11):

- `src/services/payment.service.ts` — checkout and webhook rewritten on the new rules; `isLiveBillingActor`
- `src/app/api/webhooks/mercadopago/route.ts` — signature required
- `src/app/api/payments/checkout/route.ts` — verified primary email; `409 SUBSCRIPTION_NOT_PURCHASABLE`
- `src/app/api/billing/subscription/route.ts`, `src/app/api/billing/reactivate/route.ts` — live-payer check
- `src/app/api/learning/guided-practice/route.ts`
- `src/app/api/concepts/[id]/explanation/route.ts`
- `src/app/api/concepts/[id]/interactive-formula/route.ts`
- `src/app/api/learning-debt/error-guidance/route.ts`
- `src/app/api/cognitive/transfer/submit/route.ts`
- `src/app/api/student/teacher-interventions/[id]/start/route.ts`

The last six each gained one call to the shared gate (EN-2). They are the "routes listed in L4-10" that `L3R1_REPORT.md` names under EN-2.

New tests (6): `tests/unit/l11-unlicensed-policy.test.ts`, `l11-provider-events.test.ts`, `l11-payment-webhook.test.ts`, `l11-mercadopago-webhook-signature.test.ts`, `l11-billing-live-payer.test.ts`, `l11-sponsored-access-admin-grant.test.ts`.

Modified existing tests (6 files, fixtures only, no assertion changed):

- `tests/unit/f3-api-routes-security.test.ts`, `tests/unit/l4r1-billing-self-reactivation.test.ts` — `isLiveBillingActor` mocked as live
- `tests/unit/f11c1-student-api-routes-security.test.ts`, `tests/unit/track-a-routes.test.ts`, `tests/unit/lx4p-perf-r1e-guide-independence.test.ts` — the Student has an account and is licensed (gate mocked open)
- `tests/unit/payment-never-grants-parent-relationship.test.ts` — the mocked Clerk user has a verified primary email

Documentation (3): `docs/implementation/f3/F3_UNLICENSED_MODE.md`, `docs/orchestration/status/L11_STATUS.md`, `docs/orchestration/reports/L11_REPORT.md`.

No migration, schema, script, environment variable, flag or deployment was changed. Nothing was pushed.

## LOCKS USED

- **`ENTITLEMENTS_AND_PAYMENTS`** — held on the Orchestrator's launch message. `LOCKS.md` at `chore/orchestration-control-plane` `99bec29` does not list this lock and there is no `tasks/L11_*.md`, so the file and the launch message disagree. Everything under `src/lib/entitlements/**`, `src/services/payment.service.ts`, `api/billing/**`, `api/payments/**` and `api/webhooks/mercadopago` was changed under it.
- `SCHEMA_AND_MIGRATIONS` — not held, not used. No schema change was needed, so no `SCHEMA_CHANGE_REQUEST` is filed.
- `SHARED_FOUNDATION`, `STAGE_RUNTIME`, `PRODUCTION`, `INTEGRATION_MERGE` — not used.

Outside the lock, by the EN-2 file list in the accepted plan: the six L4-10 route files. Existing shared helpers were called and not edited: `isOwner`, `isActiveParentOf` (`src/lib/authorization`), `ownStudentId` (`src/lib/exam-core/route-auth.ts`), `resolveVerifiedPrimaryEmail` (`src/lib/admin/admin-identity.ts`).

## TESTS

| Command | Result |
|---|---|
| `npx tsc --noEmit -p .` | exit 0, no output |
| `env -u DATABASE_URL -u DATABASE_URL_UNPOOLED -u POSTGRES_URL npx vitest run tests/unit/l11-*.test.ts` | 6 files, 110 tests passed |
| Same six files with the 11 modified source files temporarily restored to `4fb45b0` | 37 of 109 failed across 4 files (every webhook, payer, signature, live-payer and route-gate test). Sources restored; all passed again |
| `env -u DATABASE_URL ... npx vitest run` (full suite), first run after the code change | 6 existing files failed, 31 tests, all from the new gates (stale fixtures, listed above) |
| Full suite after the fixture updates, default 5 s timeout (final code) | **FAILED: 5 files, 7 tests** of 525 files / 9,400 tests. Six are `Test timed out in 5000ms` and one is an assertion in `lx4p-perf-r1c-openai-rewire.test.ts`; all five files (`blueprint-v2-bp1-parity`, `blueprint-v2-bp4a`, `blueprint-v2-slot-contract`, `cognitive-level-generation`, `lx4p-perf-r1c-openai-rewire`) are untouched by this lane. The machine's load average was 22 to 33 during the run (other lanes running). An earlier default-timeout run failed a different set of 8 untouched files, 12 of 13 by timeout |
| Full suite, `--testTimeout=60000 --hookTimeout=60000` (final code) | **525 files, 9,400 tests passed**, exit 0 |
| `env -u DATABASE_URL ... npx next build` (final code) | exit 0; compiled; 228/228 static pages |
| HTTP E2E suites, any DEV / Stage / Production access, a real Mercado Pago sandbox | NOT_RUN |

The default-timeout failures are recorded as observed. I read them as load-induced because the set of failing files changed between runs, none is a file this lane touched, and the same code passes with a longer timeout; that reading is `NOT_VERIFIED` on an idle machine. The Orchestrator should re-run the default command when the other lanes are quiet.

Every result is from unit tests, static checks and a build. Nothing ran against a real database, Clerk instance, Mercado Pago account or deployed environment. The webhook tests use an in-memory `subscriptions` row with the real state machine and the real provider-event rules; they assert on what is written.

Acceptance tests named in `L3R1_REPORT.md`:

| WP | Acceptance case | Test |
|---|---|---|
| EN-2 | Unlicensed student: every "paid" route returns 403 `ENTITLEMENT_REQUIRED` | `l11-unlicensed-policy` › "an unlicensed Student is refused on every D-8(a) route gated by L11" (6 routes, behaviour); "every PAID route enforces the learning licence" (all 25, source) |
| EN-2 | Every "free" route is not gated | › "FREE_IN_DEMO (content setup) and CONTINUATION routes carry no licence check" (source only; not exercised over HTTP) |
| EN-3 | Unsigned POST: rejected | `l11-mercadopago-webhook-signature` › "an unsigned POST is rejected and the handler never runs", "a forged signature is rejected", "with no secret configured every POST is rejected" |
| EN-3 | Student on a time-limited admin grant starts a checkout: grant expiry still applies | `l11-payment-webhook` › "a student on a time-limited grant: a pending / authorized / paused / cancelled preapproval leaves every field as the administrator set it", "...so the grant expiry still applies" |
| EN-3 | Provider cancellation: access ends at period end | › "active: access continues to the end of the paid period, then ends" |
| EN-3 | Payer bound on payment, tied to a live relationship | › "a parent starting a checkout does not rewrite the payer…", "authorized: activates, records the event, and binds the linked parent as payer", "a parent whose relationship ended before the payment is NOT bound"; `l11-billing-live-payer` (5 tests) |
| L4-R1 | Admin suspension / revocation cannot be self-reversed | `l4r1-billing-self-reactivation` (16 tests, unchanged assertions, all pass); `l11-payment-webhook` › "an administrator suspension is not reversed by a later authorized preapproval or payment"; `l11-sponsored-access-admin-grant` › "ending sponsorship is final for everyone but an administrator" |

## FINDINGS

### EN-1 — sponsored access (ruling: per-student admin grants; seats deferred)

No code was written for EN-1 and no seat model was built. The procedure the ruling names already exists: `POST /api/admin/memberships/grant-license` with `source: 'INSTITUTIONAL_LICENSE'`, a mandatory `expiresAt`, by a `STUDYUS_ADMIN`. `decideLearningAccess` treats that grant as the licence. `l11-sponsored-access-admin-grant.test.ts` pins what the procedure relies on.

**F-1 — an expired grant cannot be granted again.** `grantAdminLicense` moves the row to `active` through the state machine (`src/services/membership-admin.service.ts:343-348`). There is no `expired → active` edge (`subscription-state-machine.ts:11-46`), and a certified test pins that on purpose (`tests/unit/f3-subscription-state-machine.test.ts:73`, "rejects reviving an expired subscription directly to active"). `subscriptions` is one row per student, so there is no "new subscription" to create instead. Result: once a sponsored Student's grant has passed its expiry and been reconciled to `expired`, `grant-license` answers `409 INVALID_TRANSITION`. An extension **before** expiry works (the row is still `active`; only the expiry is rewritten). The same holds for `cancelled_at_period_end` and the legacy `canceled`.

I did not change the state machine: reversing a pinned, certified rule is a product decision (D-L11-1 below). For the pilot the operating rule is: extend each grant before it expires. The Stage test Student is licensed to 2026-10-25.

### EN-2 — unlicensed mode (ruling D-8, given in this session)

Ruling as I recorded it, in `docs/implementation/f3/F3_UNLICENSED_MODE.md` and `src/lib/entitlements/unlicensed-policy.ts`:

- **D-8(a) paid.** The learning activity itself: instructional execution, AI teaching content, AI grading, mastery and evidence.
- **D-8(b) free in demo.** AI-assisted content setup (concept suggestions, document analysis / import, concept extraction, content upload / process / search), under the existing rate limits. It unlocks none of (a).
- **D-8(c) continuation: not ruled.** The answer given covered (a) and (b). Continuation routes are unchanged.

What changed:

- One shared enforcement point, `learning-gate.ts`. It asks the existing single decision (`canUseCapability(..., 'LEARNING_FULL_ACCESS')`) and returns `403 ENTITLEMENT_REQUIRED`. An identity lookup failure refuses.
- Six routes now call it after ownership and before any work: guided practice, concept explanation, interactive formula, error-pattern guidance, transfer submit, teacher-assigned start.
- The 19 routes that already enforced were not rewritten. They call the same decision and return the same error. The policy file lists all 25 as PAID, and the test fails if one stops enforcing, if a free or continuation route starts to, or if a route enforces without being listed.

Behaviour changes to expect:

1. A demo Student opening a concept explanation, interactive formula, guided practice or error-pattern guidance now gets 403. The Student UI is not in this lane, so those components show their generic error state, not a licence prompt (see CR-L11-02).
2. A concept explanation generated while licensed is not served after the licence ends. The route cannot tell a cached read from a new generation; that distinction lives in `concept-explanation.service.ts`, outside this lane.
3. Teacher-assigned start: an actor with no Student account now gets `403 FORBIDDEN` from the route, before the dispatcher. Before, the dispatcher refused the same actor. This keeps the licence check from being skipped when `ownStudentId` returns null, which L10's SF-1 will make it do for a revoked STUDENT role.

Not done:

- `src/lib/exam-core/route-auth.ts` was not touched. Its `requireOwnerOf(..., { entitled: true })` already resolves the same decision.
- L4-10 also says two Student pages enqueue background AI generation for unlicensed students. I found the two call sites (`src/app/dashboard/today/page.tsx:209`, `src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx:147`, both `scheduleDeliveryReplenishment`). They are Student pages and a delivery service, not this lane's files (CR-L11-03).

### EN-3 — payments (L4-11 a–d)

Payments stay inert: every path still returns early while `MERCADOPAGO_ACCESS_TOKEN` is unset.

| L4-11 defect | Before | Now |
|---|---|---|
| (a) webhook clears the admin grant | Any preapproval event set `manually_set_by_admin = false`; a checkout started on a time-limited grant ended `active` with no expiry | No provider event changes an administrator-set row: status, `manually_set_by_admin`, `grant_expires_at`, `grant_reason`, `granted_by_user_id` and the provider ids are all left alone. A row in `suspended`, `disputed`, `refunded` or `payment_under_review` is never moved by a provider event |
| (b) unsigned webhook; id concatenated into the provider URL | Any POST was processed | `x-signature` (HMAC-SHA256, `MERCADOPAGO_WEBHOOK_SECRET`) is required. Unsigned, forged, or no secret configured → `401`. The handler receives the signed `data.id`, never the body's; the id must match `[A-Za-z0-9_-]{1,64}` and is URL-encoded |
| (c) cancellations rejected | `cancelled` mapped to `canceled`, which no transition reaches | `active → cancelled_at_period_end` with `current_period_end` set from the provider's next payment date (or the stored period, or now). `past_due` / `reactivated → expired`. Only the preapproval the subscription runs on can pause or cancel it |
| (d) payer rewritten at checkout, kept after unlink | Checkout overwrote `payer_user_id` and the provider ids before any payment | Checkout writes nothing to an existing row. The payer travels in the provider reference (`student:payer`) and is bound when the provider reports `authorized` or an approved payment, only if that user is the learner or still has an accepted relationship. The two billing routes also require a live relationship for a non-owner on every request |

Also changed, because the new rules would otherwise take money for nothing:

- **Checkout is refused (`409 SUBSCRIPTION_NOT_PURCHASABLE`) when a confirmed payment could not activate the subscription**: an admin suspension, an administrator-set row, an already active subscription, or a status with no edge to `active`.
- **The webhook answers `500` on an unexpected failure** instead of always `200`, so the provider retries. Every step is idempotent. Skipped events (admin-controlled, invalid transition) still answer `200`.
- **Checkout uses the verified primary Clerk email** (`resolveVerifiedPrimaryEmail`), not `emailAddresses[0]`. This is the `payments/checkout` item of CR-L4R1-01, done here because the file is in this lane (see CROSS-LANE below).
- Provider-driven transitions now write `subscription_events` rows (`PAYMENT_CONFIRMED`, `CANCELLED`, `EXPIRED`) with no actor, so `self-reactivation.ts` still tells an administrator's suspension from anything else.

**L4-R1 protections.** `self-reactivation.ts` and the state machine are unchanged. The `l4r1-billing-self-reactivation` assertions are unchanged and pass. The webhook adds a second guarantee: a payment or an `authorized` preapproval never moves a `suspended` row.

**F-2 — with these rules, a Student who has ever had an administrative grant cannot buy.** The row stays administrator-set after the grant expires (`manually_set_by_admin` is never cleared), so checkout is refused and a provider event is ignored. Before this change the same Student could "buy" only through defect (a). Together with F-1 (no `expired → active`), the trial-to-paid path does not exist. This is correct for Stage and the pilot (payments off, grants only) and is a hard prerequisite for enabling payments (D-L11-2).

**F-3 — the legacy admin PATCH still bypasses everything.** `PATCH /api/admin/students/[id]/subscription` (`setSubscriptionStatusManually`) writes any status with no state machine, event or audit row. It lives in `payment.service.ts` but the route and its retirement are L4-05 / CR-L4R1-02 (L10). Not changed.

**F-4 — no replay window on the webhook.** The signature's `ts` is verified as part of the HMAC but not checked against the clock. A captured, validly signed notification can be replayed; it only causes the same resource to be re-fetched from the provider and re-applied, which is idempotent. A tolerance can be added once the provider's real retry timing is observed in sandbox.

### Decisions needed

| # | Decision | Needed for | Lane recommendation |
|---|---|---|---|
| D-8(c) | May a Student finish an attempt or quiz that was open when the licence ended | Closing EN-2 | Allow finishing; refuse new starts. That is today's behaviour, so no change is needed if ruled this way |
| D-L11-1 | Renewal after expiry: add `expired → active` (and `cancelled_at_period_end → active`) for an admin grant, a manual approval and a verified provider authorization | The pilot, as soon as one grant lapses before it is extended; payments | Add both edges. It reverses a pinned F3 rule, so the lane did not |
| D-L11-2 | Grant-to-paid conversion: when and how a paid subscription takes over from an administrative grant | Enabling payments | Convert on a provider-verified `authorized` preapproval once the grant is no longer running; never from `suspended` |

Confirmations of L4-R1's two open points (CR-L4R1-03) are still the Orchestrator's; this lane left both as L4-R1 shipped them.

## BLOCKERS

NONE for this lane.

Before payments are enabled on any environment (not a Stage or pilot blocker):

- **Human Operator:** set `MERCADOPAGO_WEBHOOK_SECRET` alongside `MERCADOPAGO_ACCESS_TOKEN`. Without it every notification is rejected with 401.
- **Orchestrator / product:** D-L11-1 and D-L11-2.
- A sandbox run against a real Mercado Pago account: the signature manifest, `next_payment_date`, and whether a subscription charge carries the preapproval's `external_reference` are implemented from the provider's documentation and are `NOT_VERIFIED` against the live API.

## CHANGE_REQUESTS

No `SCHEMA_CHANGE_REQUEST`. Nothing in EN-1 (as ruled), EN-2 or EN-3 needed schema.

| # | Lock / owner | Files | Change needed | What this lane did instead |
|---|---|---|---|---|
| CR-L11-01 | `SHARED_FOUNDATION` (L10, SF-7) | `src/services/parent.service.ts` | When a relationship is revoked or declined, clear `subscriptions.payer_user_id` where it names that parent | Enforced at use: a stored payer without a live relationship is refused on both billing routes and is not re-bound by the webhook. The stale id stays in the row |
| CR-L11-02 | L6 Student UI | `ConceptExplanationPanel.tsx`, `ConceptExplanationDisclosure.tsx`, `InteractiveFormulaWidget.tsx`, `quiz/TeachingIntro.tsx`, `learning-debt/ErrorPatternList.tsx`, `assignments/StartAssignmentButton.tsx` | Show the licence prompt on `403 ENTITLEMENT_REQUIRED` instead of the generic error | Nothing; server enforcement only |
| CR-L11-03 | L6 Student pages / delivery service | `src/app/dashboard/today/page.tsx:209`, `src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx:147` | Do not schedule delivery replenishment (background AI generation) for an unlicensed Student | Recorded only |
| CR-L11-04 | Orchestrator | `LOCKS.md`, `tasks/` | Record `ENTITLEMENTS_AND_PAYMENTS` and the L11 contract | Worked on the launch message |

### Cross-lane notes

- **L10 (`feat/l10-shared-foundation`, uncommitted, read-only look at 18:00Z).** It is moving `resolveVerifiedPrimaryEmail` to `src/lib/identity/verified-email.ts` with a re-export from `admin-identity.ts`, and changing the body of `ownStudentId`. Both keep the signatures this lane calls. `src/app/api/payments/checkout/route.ts` is listed in CR-L4R1-01; it is already done here, so L10 should not edit it.
- **No file overlap** with the working trees of L6, L7, L8, L9 or L10 at 18:00Z (`git status` and `git diff --name-only 4fb45b0 HEAD` in each).
- `src/app/api/student/teacher-interventions/[id]/start/route.ts` is a Student route touched for EN-2; L8 owns `api/teacher/**`, not this file.

## MERGE RECOMMENDATION

Merge `feat/l11-entitlements` after `fix/security-p1-remediation`; it is one commit on top of `4fb45b0`. It does not depend on L10. If L10 merges first, expect no textual conflict; re-run `tests/unit/l11-*.test.ts` and `tests/unit/f11c1-*.test.ts` after the merge because L10 changes `ownStudentId`.

Review the EN-2 behaviour change (demo Students lose concept explanations and guided practice) with CR-L11-02 in mind: without the UI change a demo Student sees a generic error on those panels.

## NEXT SAFE ACTION

Orchestrator rules D-8(c) and D-L11-1. Until D-L11-1 is ruled, the Human Operator extends each pilot grant before its expiry date.
