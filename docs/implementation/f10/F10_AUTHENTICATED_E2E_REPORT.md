# F10 — Authenticated E2E Report

Per the same convention F9 established (`F9_QA_REPORT.md` §3): "authenticated local E2E" here means the real service/read-model/authorization code paths executed against a real, ephemeral Postgres database with real resolved actor identities — not anonymous 401 smoke, and not mocked. This is what `f10-lifecycle-cert-runner.ts` (see `F10_AUTHORIZATION_CERTIFICATION.md`) executes.

## Task §53's required scenarios — actually executed

| Required scenario | Executed | Result |
|---|---|---|
| Parent P, no child → zero data | Yes | `getParentLearners` → `[]` |
| Pending Child A → denied | Yes | `isActiveParentOf` false, read model throws |
| Child A accepts → Parent P Child A overview ALLOW | Yes | overview returned, correct student |
| Parent P Child B (no relationship) DENY | Yes | denied |
| Child A revokes → Parent P Child A overview DENY afterward | Yes | denied immediately |
| Parent P with accepted A and C, switching A→C returns correct isolated data | Yes | distinct subjects (`Mathematics` vs `Biology`) proven non-merged |
| Multi-role Parent/Teacher retains Parent semantics | **Yes** (added after a targeted follow-up request — see below) | ALLOW for the accepted Parent child, DENY for a Teacher-only student, ALLOW for that same student via the Teacher path (fixture-validity check) |
| Payer-without-relationship DENY | Yes | denied learner view, allowed billing |
| Relationship-without-payer ALLOW | Yes | allowed learner view, denied billing |

Executed count: **9 of 9** required scenarios directly re-proven for F10's own code paths.

### Correction: the multi-role row above was originally marked "not separately re-executed"

This report originally reasoned that F2's `canAccessLearner` per-permission-type composition was "F2's own unmodified logic," so a multi-role Parent+Teacher scenario didn't need separate re-testing. **That reasoning was incomplete.** `canAccessLearner`'s composition is correct and unmodified — the actual risk was in F10's OWN code: the Parent Read Model's `requireAccess()` called that generic composed check directly, which meant a real Teacher relationship could satisfy a Parent-labeled route's authorization. A later, explicitly requested certification check (`F10_MULTI_ROLE_AUTHORIZATION_CHECK.md`) executed this scenario for real, found it FAILED on the first run, and the fix (calling F2's `isActiveParentOf` directly instead) is what makes the row above now correctly say "Yes." The lesson generalizes: "this reuses an already-certified primitive" is not the same claim as "this scenario has been tested against this specific new call site" — the two were conflated in the original version of this report.

## What this is NOT

This is not a claim of `REMOTE_AUTHENTICATED_E2E` — no live Preview HTTP request with a real Clerk session was made. That is `IVG-F10-01`/`IVG-F10-02` in `F10_IVG_DEFERRED_TEST_REGISTER.md`, explicitly deferred, never reported as PASS.

## Route-level HTTP contract (separately, via mocked unit tests)

`tests/unit/f10-api-routes-security.test.ts` proves the HTTP layer's own contract: anonymous → 401 before the read model is ever called; a `ParentAccessDeniedError` from the read model → 403, never a 500; a successful call passes the route's `studentId` param through to the read model unmodified. This is the same route-level testing pattern F9 used (`f9-api-routes-security.test.ts`), deliberately kept separate from the real-Postgres authorization proof above — one proves the routing/error-mapping contract, the other proves the actual data-access decision.
