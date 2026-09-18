# F3 — Security & QA Report

Branch: `f3/subscription-entitlement-foundation` @ `e65ba4b38f73482ca3c8ba77f9550e30a4959ff2`

## Automated test results

```
npx tsc --noEmit          -> exit 0
npx vitest run            -> 306 test files passed, 5132 tests passed, 0 failed
bash scripts/operations/f3-entitlement-migration-cert.sh
                           -> real-Postgres migration + lifecycle cert: ALL CHECKS PASSED (29 assertions)
npm run build              -> production build succeeded, 0 errors
```

## Negative / security test coverage

| Test file | What it proves |
|---|---|
| `f3-subscription-state-machine.test.ts` | All 64 (8×8) from/to combinations classified correctly; same-state, skip-ahead, and revive-from-`expired` transitions are rejected; `canceled` (legacy terminal state) has zero outgoing transitions. |
| `f3-entitlement-service.test.ts` | Full capability × status matrix; a Parent who is the registered Payer can manage billing and reactivate but can **never** obtain `LEARNING_FULL_ACCESS` even while paying (AC-F3-06); an unrecognized capability string returns `false`, never throws; a database error inside any capability check returns `false` (fail closed), never propagates. |
| `f3-payment-idempotency.test.ts` | Two deliveries of the same `(provider, provider_reference)` produce exactly one row. |
| `f3-api-routes-security.test.ts` | `/api/billing/subscription`, `/api/billing/reactivate` reject unauthenticated and non-entitled callers; an `InvalidSubscriptionTransitionError` from a race (e.g. two concurrent reactivate calls) is caught and surfaced as 409, never a 500 or an uncaught exception. |
| `f3-role-independence.test.ts` | F2's `src/lib/authorization`, `institution.service.ts`, `parent.service.ts` contain zero references to `@/lib/entitlements` or the `subscriptions` table — subscription state cannot silently leak into academic authorization. |
| `f3-canonical-v2-noninterference.test.ts` | No F3 file imports the pedagogical engine/decision/shadow modules; no F3 file issues a write to a learning-domain table; `src/lib/entitlements` issues zero `DELETE` statements; `src/lib/entitlements` and `src/lib/authorization` never import each other. |

## Live Preview smoke tests (anonymous, real HTTP, `https://study-2ei0141gc-study-so.vercel.app`)

| Route | Method | Result | Expected |
|---|---|---|---|
| `/api/version` | GET | 200, `environment: "preview"` | confirms non-Production target |
| `/api/billing/subscription` (no `studentId`) | GET | 400 `INVALID_INPUT` | input validated before auth is even consulted |
| `/api/billing/subscription?studentId=...` | GET | 401 | unauthenticated caller rejected |
| `/api/billing/reactivate` | POST (with body, no auth) | 401 | unauthenticated caller rejected |
| `/api/learning/session-eligibility?studentId=...` | GET | 401 | unauthenticated caller rejected |
| `/api/content/search`, `/api/content/process`, `/api/content/upload`, `/api/content/extract-concepts` | GET/POST | 401 | F0-S authorization fixes still hold (regression) |
| `/api/test` | GET | 404 | F0-S public-diagnostic removal still holds (regression) |
| `/role-select` | GET | 200 | F1 UI still publicly reachable (regression) |

## Findings

No new findings. The one real defect discovered during this phase (Postgres `bigint` columns
returned as strings by the `pg` driver, causing a silent price-comparison failure) was found by
the real-Postgres lifecycle certification, not by the mocked unit-test suite — this is recorded
as a process observation, not a residual defect, since it was found and fixed before this report
and is now covered by an explicit assertion in `f3-lifecycle-cert-runner.ts`.

## Conclusion

All automated gates (typecheck, full unit suite, real-Postgres migration + lifecycle
certification, production build, live Preview smoke tests) pass. No authorization or
entitlement bypass was found in this phase's own code, and no regression was found in
F0-S, F1, or F2 behavior.
