# F3 — Commercial Reconciliation Report

Branch: `f3/subscription-entitlement-foundation` @ `e65ba4b38f73482ca3c8ba77f9550e30a4959ff2`
Base: `f2/institutions-relationships-permissions` @ `0eff6bad2161c671d5b700df1052a90f34e99d4e`

## Purpose

Reconciles what F3 actually built against the target commercial domain described in the
task specification and `F3_COMMERCIAL_ARCHITECTURE.md`, item by item.

## Reconciliation

| Target concept | Built | Where |
|---|---|---|
| Plan (MONTHLY / ANNUAL) | Yes — `subscriptions.plan`, CHECK-constrained | migration `20260921_1000_f3_...sql` |
| Price Book (explicit per-market pricing) | Yes — `price_book` table, `resolvePrice()` returns `null` for unsupported markets, never a fabricated fallback | `src/lib/entitlements/price-book.service.ts` |
| Subscription state machine (8 states, explicit transitions) | Yes — `ALLOWED_TRANSITIONS` whitelist, `assertValidTransition` throws on any non-listed pair | `src/lib/entitlements/subscription-state-machine.ts` |
| Payer separation (Payer ≠ Learner) | Yes — `subscriptions.payer_user_id`, independently settable at `ensureSubscription()` time; verified in real-Postgres cert that payer and learner are two distinct `users` rows | `src/lib/entitlements/subscription.service.ts` |
| Normalized Payments | Yes — `payments` table, one row per provider event, `UNIQUE(provider, provider_reference)` idempotency | migration + `payment.service.ts` |
| Canonical Entitlement authority | Yes — single exported `canUseCapability(actorUserId, learnerId, capability)`, all 4 capabilities routed through it, fails closed on any internal error | `src/lib/entitlements/index.ts` |
| Authorization/Entitlement separation (never merged) | Yes — `src/lib/entitlements` and `src/lib/authorization` never import each other (proven structurally in `f3-role-independence.test.ts` and `f3-canonical-v2-noninterference.test.ts`) | tests |
| Suspension never deletes history | Yes — real-Postgres cert proves zero `learning_evidence`/`mastery_records` rows lost, student row and STUDENT role grant untouched, across the full suspend/reactivate cycle | `f3-lifecycle-cert-runner.ts` |
| Reactivation restores from preserved state | Yes — mastery score (75) proven byte-identical before and after suspension+reactivation | `f3-lifecycle-cert-runner.ts` |
| Webhook safety (never crash, always ack) | Yes — `handleMercadoPagoWebhook` wraps every status transition in try/catch for `InvalidSubscriptionTransitionError`; unrecognized event types are a no-op | `src/services/payment.service.ts` |

## Explicitly out of scope for F3 (per task §30/31 and carried into the residual risk register)

- Real MercadoPago checkout UI / actual provider account configuration (`MERCADOPAGO_ACCESS_TOKEN` remains unset in this environment).
- Proration, refunds, coupons/discounts, multi-currency FX conversion.
- Dunning automation (retry scheduling for `past_due`) — the state exists and is entitlement-correct, but no scheduled job drives the transition.
- Any enforcement inside the Canonical V2 pedagogical engine — F3 entitlement checks are applied only at the API-route boundary; the engine itself is untouched, per non-interference requirement.

## Conclusion

Every target commercial-domain concept named in the task specification has a corresponding,
independently testable implementation. No scope was silently dropped; every simplification
(price book as 4 fixture rows, dunning left as a future job) is named above and in the
residual risk register rather than left implicit.
