# F3 — Residual Risk Register

| ID | Risk | Severity | Status | Notes |
|---|---|---|---|---|
| RR-F3-01 | No real MercadoPago account is configured (`MERCADOPAGO_ACCESS_TOKEN` unset) | Medium | Deferred, pre-existing since F0 | Webhook code paths are unit-tested and structurally correct, but have never processed a real provider event. Must be exercised against a real sandbox/live account before Pilot. |
| RR-F3-02 | No dunning automation | Low | Deferred, explicitly out of scope for F3 | `past_due` is a correct, entitlement-respecting state (grace-period access), but nothing currently schedules a retry or drives the eventual transition to `suspended`. A scheduled job is F4+ scope. |
| RR-F3-03 | Price Book has only 4 fixture rows (CO/COP, MX/MXN, MONTHLY/ANNUAL) | Low | Intentional, disclosed | `resolvePrice()` correctly returns `null` (never a fabricated price) for any other market — the gap is data coverage, not a logic defect. Expanding market coverage is a content/business task, not a code change. |
| RR-F3-04 | No refund/proration/coupon model | Low | Out of scope, matches task §31 | `payments` table has no `refunded_amount_cents` or discount concept. Any future refund would need a new payment row of a negative or corrective kind — not designed here. |
| RR-F3-05 | Legacy `canceled` status retained alongside the new 8-state vocabulary | Low | Intentional | The pre-F3 `canceled` value is kept in the CHECK constraint for backward compatibility with any pre-existing row, but has zero outgoing transitions in the new state machine — it is effectively frozen/legacy, not part of the active lifecycle. No existing row was found using it during migration certification. |
| RR-F3-06 | Authenticated end-to-end Preview flow (real login + real webhook) not exercised | Medium | Accepted for this phase | See `F3_PREVIEW_CERTIFICATION.md` — no real payment provider account exists to drive this; the lifecycle is instead certified against real PostgreSQL with real service calls. Should be closed before Pilot once a MercadoPago sandbox account is available. |
| RR-F3-07 | `subjects.student_id` references `profiles(id)`, not `students(id)` | Low | Pre-existing architectural quirk, not introduced by F3 | Discovered again during F3 cert-script seeding (also known from F0/F1/F2 audits). Does not affect F3's own tables but is a standing schema inconsistency worth resolving in a future data-model cleanup phase. |

## Explicitly NOT a risk (verified, not assumed)

- Suspension data loss — verified with real-row-count assertions across the full lifecycle; zero rows lost at any point.
- Payer gaining unauthorized academic access — verified negative; a payer can never obtain `LEARNING_FULL_ACCESS` regardless of payment status.
- Cross-import between F2 authorization and F3 entitlements — verified structurally absent in both directions.
- Canonical V2 pedagogical engine interference — verified structurally absent.

## Recommendation

None of the above blocks proceeding to F4. RR-F3-01 and RR-F3-06 (both tied to the absence
of a real payment-provider account) should be tracked and closed before any Pilot or
Production readiness decision, but do not affect the identity/authorization/entitlement
foundation that F4 will build on.
