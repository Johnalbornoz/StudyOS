# F10 — Authenticated E2E Report

Per the same convention F9 established (`F9_QA_REPORT.md` §3): "authenticated local E2E" here means the real service/read-model/authorization code paths executed against a real, ephemeral Postgres database with real resolved actor identities — not anonymous 401 smoke, and not mocked. This is what `f10-lifecycle-cert-runner.ts` (see `F10_AUTHORIZATION_CERTIFICATION.md`) executes.

## Task §53's required scenarios — actually executed

| Required scenario | Executed | Result |
|---|---|---|
| Parent P, no child → zero data | Yes | `getParentLearners` → `[]` |
| Pending Child A → denied | Yes | `canAccessLearner` false, read model throws |
| Child A accepts → Parent P Child A overview ALLOW | Yes | overview returned, correct student |
| Parent P Child B (no relationship) DENY | Yes | denied |
| Child A revokes → Parent P Child A overview DENY afterward | Yes | denied immediately |
| Parent P with accepted A and C, switching A→C returns correct isolated data | Yes | distinct subjects (`Mathematics` vs `Biology`) proven non-merged |
| Multi-role Parent/Teacher retains Parent semantics | **Not separately re-executed** | F10 introduces no new multi-role interaction; `canAccessLearner`'s per-permission-type check (`OWNER_PERMISSIONS`/`PARENT_PERMISSIONS`/`TEACHER_PERMISSIONS` evaluated independently) is F2's own unmodified logic, already certified there |
| Payer-without-relationship DENY | Yes | denied learner view, allowed billing |
| Relationship-without-payer ALLOW | Yes | allowed learner view, denied billing |

Executed count: **8 of 9** required scenarios directly re-proven for F10's own code paths; the 9th (multi-role Parent/Teacher) is F2's pre-existing, unmodified logic and not re-tested here (would be redundant with F2's own certification, since F10 adds no code that touches that interaction).

## What this is NOT

This is not a claim of `REMOTE_AUTHENTICATED_E2E` — no live Preview HTTP request with a real Clerk session was made. That is `IVG-F10-01`/`IVG-F10-02` in `F10_IVG_DEFERRED_TEST_REGISTER.md`, explicitly deferred, never reported as PASS.

## Route-level HTTP contract (separately, via mocked unit tests)

`tests/unit/f10-api-routes-security.test.ts` proves the HTTP layer's own contract: anonymous → 401 before the read model is ever called; a `ParentAccessDeniedError` from the read model → 403, never a 500; a successful call passes the route's `studentId` param through to the read model unmodified. This is the same route-level testing pattern F9 used (`f9-api-routes-security.test.ts`), deliberately kept separate from the real-Postgres authorization proof above — one proves the routing/error-mapping contract, the other proves the actual data-access decision.
