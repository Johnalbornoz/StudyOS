# F3 — Next Phase Handoff

Certified SHA for F4 to branch from: `e65ba4b38f73482ca3c8ba77f9550e30a4959ff2`
(branch `f3/subscription-entitlement-foundation`, pushed to `origin`)

## What F4 inherits

- **Identity** (F1): `users` / `user_roles`, role-selection at registration.
- **Authorization** (F2): `src/lib/authorization` — `canAccessLearner(actorUserId, learnerId, scope)`, institutions/classes/relationships model. Unaffected by F3.
- **Entitlement** (F3, this phase): `src/lib/entitlements` — `canUseCapability(actorUserId, learnerId, capability)` for `LEARNING_FULL_ACCESS`, `LEARNING_HISTORY_VIEW`, `BILLING_MANAGE`, `SUBSCRIPTION_REACTIVATE`. Subscription state machine with 8 states. Price Book and normalized Payments.
- **Composition pattern**: any future feature that needs both an academic relationship and paid access should call both `canAccessLearner` (F2) and `canUseCapability` (F3) independently and AND the results at the call site — see `src/app/api/learning/session-eligibility/route.ts` for the reference implementation. Do not merge the two services.

## Non-negotiable invariants F4 must continue to respect

1. Identity, role, and F2 authorization must never depend on subscription/entitlement state — a user's role and academic relationships exist independent of whether they have ever paid.
2. Suspension/expiration must never delete or mutate learning history (`learning_evidence`, `mastery_records`, or any Canonical V2 table). Any new F4 feature that touches learner state on a subscription-status change must be proven with the same before/during/after row-count technique used in `f3-lifecycle-cert-runner.ts`.
3. `src/lib/entitlements` and `src/lib/authorization` must remain structurally independent — no cross-imports. Extend the `f3-role-independence.test.ts` / `f3-canonical-v2-noninterference.test.ts` pattern for any new cross-cutting concern F4 introduces.
4. Every new entitlement-bearing capability must go through `canUseCapability`, must fail closed (return `false`, never throw) on any internal error, and must never fabricate a default price/status.
5. Any new subscription status or transition must be added to the explicit `ALLOWED_TRANSITIONS` whitelist in `subscription-state-machine.ts` — never inferred, never open-ended.

## Suggested F4 starting points (not prescriptive — F4's own spec governs)

- Dunning automation for `past_due` → `suspended` (RR-F3-02).
- Real MercadoPago sandbox integration test once a provider account exists (RR-F3-01, RR-F3-06).
- Expanding the Price Book beyond the 2 current markets, if the business requires it (RR-F3-03) — a data change, not a schema change.

## What F4 must NOT assume

- That a payment provider is live in any environment — it is not, in Preview or Production, as of this handoff.
- That `canceled` (legacy 4-state value) participates in the active state machine — it does not; treat any row still in that state as needing a one-time manual/data migration decision, not automatic handling.
