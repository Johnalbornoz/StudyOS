# F10 — Authorization Certification

Executed for real against a real, ephemeral, local-only Postgres instance via `scripts/operations/f10-parent-experience-migration-cert.sh` → `f10-lifecycle-cert-runner.ts`. Every case below is a real service/read-model call, real database rows, never a mock.

## Adversarial matrix (task §39, cases actually exercised)

| Case | Scenario | Result |
|---|---|---|
| A | Parent role alone (a profile with `user_type='parent'`, zero relationship rows) → learner data | **DENY** — `getParentLearners` returns `[]`; no learner endpoint is even reachable without a `studentId` the actor has a relationship to |
| B | PENDING relationship → learner data | **DENY** (`canAccessLearner` false, `getParentLearnerOverview` throws `ParentAccessDeniedError`) |
| C | Cross-child: Parent P (relationship only to Child A) → Child B | **DENY** |
| D | Student-initiated revoke → immediate re-check | **DENY**, immediately, no grace window |
| E | Re-request after revoke | **ALLOWED to reach PENDING again** (the BUG #2 fix — previously permanently blocked) |
| F | Multi-child: Parent with accepted A and C, request C's data while A is "active" in some other context | **ALLOW for C, correct/distinct data**, never A's data |
| G | Multi-child: same parent → unlinked Child F | **DENY**, unaffected by having 2 other active children |
| H | Payer-without-relationship → learner progress view | **DENY** |
| H′ | Payer-without-relationship → billing capability | **ALLOW** (payer status is real and independent) |
| I | Relationship-without-payer → learner progress view | **ALLOW** |
| I′ | Relationship-without-payer → billing capability | **DENY** |
| J | Accepted Parent relationship → `LEARNER_INTERVENTION_CREATE` | **DENY** — Parent permissions never include it (read-only boundary, task §40) |
| K | Concurrent duplicate accept | Converges to exactly **one** `accepted` row |
| L | Concurrent duplicate revoke | Converges to exactly **one** row, `revoked` |

Cases not listed above (e.g. multi-role Parent+Teacher route isolation, client-substituted `learnerId` on an authenticated-but-wrong actor) were not separately re-proven in this run because they exercise F2's own `canAccessLearner`/`isActiveParentOf`/`canTeacherAccessLearner` machinery unmodified — already certified in F2's own adversarial matrix — and F10 adds no new authorization primitive of its own for those dimensions to interact with differently. F10's own routes never accept a client-supplied actor id (only a `studentId` route param, always re-validated server-side).

## Server-side authorization discipline (task §29)

Every one of the 6 new `/api/parent/learners/*` routes: resolves the authenticated actor via `verifyAuth()` + `getOrCreateCanonicalUser()` (never trusts a client-supplied actor id) → calls exactly one read-model method, passing the route's `studentId` param through unchecked → the read-model method itself calls `canAccessLearner` as its own first action. No route pre-checks authorization and then "trusts" the read model; no read-model method trusts its caller. Verified both by source inspection (`tests/unit/f10-legacy-readiness-noninterference.test.ts`'s `requireAccess` assertion) and by the real-Postgres cases above.

## Verdict

**PASS.** No case above found Parent-role-alone access, cross-child leakage, a revoke that didn't take effect immediately, or a route trusting an unchecked actor/learner id.
