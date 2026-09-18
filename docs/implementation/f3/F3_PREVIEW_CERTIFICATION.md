# F3 — Preview Certification

## Deployment

- Branch: `f3/subscription-entitlement-foundation` @ `e65ba4b38f73482ca3c8ba77f9550e30a4959ff2`
- Vercel project: `study-so/study-os`
- Deployment: `https://study-2ei0141gc-study-so.vercel.app`
- Target: `null` (Preview — explicitly **not** Production; confirmed via `/api/version` → `"environment":"preview"`)
- Build: succeeded, 0 errors, standard `vercel deploy --non-interactive` pipeline (no custom build flags)

## What was verified live, against the real deployment (not mocked, not local)

1. **Environment identity** — `/api/version` returns `environment: "preview"`, proving this is not the Production target.
2. **F3 route authentication** — `/api/billing/subscription`, `/api/billing/reactivate`, `/api/learning/session-eligibility` all reject unauthenticated requests (400 for missing required input, 401 once a `studentId` is supplied without auth). No new route is reachable anonymously.
3. **F0-S regression** — the three previously-fixed authorization gaps (`/api/content/search`, `/api/content/process`, `/api/content/upload`, `/api/content/extract-concepts`) still return 401 to anonymous callers; the public `/api/test` diagnostic still returns 404.
4. **F1 regression** — `/role-select` still renders (200) for anonymous visitors, as expected for the registration flow.

## What was NOT verified live (and why)

- Authenticated end-to-end flows (an actual Clerk-signed-in Parent paying for a Student, receiving a real MercadoPago webhook, seeing the billing page update) were **not** exercised against Preview, because:
  - `MERCADOPAGO_ACCESS_TOKEN` is not configured in this (or any) environment per the F0 and F3-assessment audits — there is no real payment provider account to drive a live webhook against.
  - Creating real authenticated sessions against Preview would require live Clerk test credentials, which are out of scope for an anonymous smoke test and risk creating persistent test accounts in a shared environment.
  - The full authenticated lifecycle (unpaid → active → past_due → suspended → reactivated → active, plus cancelled_at_period_end → expired) **was** verified end-to-end against real PostgreSQL via `f3-lifecycle-cert-runner.ts`, using the real service functions (not mocks) — this is the strongest verification available without a configured payment provider and is the mechanism the task's own §21 anticipates for exactly this situation.

## Conclusion

Preview deployment is live, healthy, and correctly gated. Authentication/authorization
behavior for every new F3 route matches design intent, and no regression was introduced
in earlier phases' security posture. The commercial-logic lifecycle itself is certified
against real PostgreSQL rather than against live Preview, because no real payment
provider is configured — this is disclosed here and in the residual risk register rather
than glossed over.
