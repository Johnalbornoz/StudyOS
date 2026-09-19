# F10 — Multi-Role Authorization Certification Check

Executed on request against the certified F10 candidate HEAD `870f1a6` (the commit reported as PASS_TO_F11), using the same isolated worktree and real ephemeral local Postgres pattern as the rest of F10's certification.

## Result summary

**A real authorization-widening bug was found on the first run, fixed, and re-verified.** This document reports both runs, not just the final passing one.

## Environment

Local isolated F10 worktree + ephemeral PostgreSQL (unix socket, never Neon/Preview/Production). `scripts/operations/f10-multi-role-authorization-check.sh` → `f10-multi-role-authorization-check-runner.ts`.

## Fixture

User X: `PARENT` (accepted relationship to Child A) + `TEACHER` (APPROVED membership in Institution I, ACTIVE assignment to Class C). Student B is enrolled in Class C and has **zero** `parent_student_relationships` rows with User X (verified directly against the database before running any test).

## Run 1 (pre-fix, against the certified `870f1a6` code)

```
TEST 1 (PARENT+TEACHER -> accepted Parent child, via Parent Read Model): expected=ALLOW actual=PASS
TEST 2 (PARENT+TEACHER -> Teacher-only Student B, via Parent Read Model -- CRITICAL): expected=DENY actual=FAIL
TEST 3 (PARENT+TEACHER -> Teacher-only Student B, via Teacher authorization -- fixture validity): expected=ALLOW actual=PASS

MULTI_ROLE_PARENT_ISOLATION: FAIL
```

**Root cause:** `read-model.service.ts`'s `requireAccess()` called the generic `canAccessLearner(actorUserId, studentId, 'LEARNER_PROGRESS_VIEW')`. That function deliberately treats Owner/Parent/Teacher as equivalent for this permission — correct for F5–F9's routes, which legitimately want "any authorized viewer" — but wrong for a route that presents itself as Parent-scoped. User X's real, separate Teacher relationship to Student B satisfied the generic check, so the Parent-labeled route incorrectly granted access with no Parent relationship to Student B at all.

## Fix

`src/lib/authorization/index.ts::isActiveParentOf` (previously module-private, already the exact correct check — used internally by `canAccessLearner`'s own Parent branch) is now exported. `read-model.service.ts::requireAccess` calls it directly instead of `canAccessLearner`. No new authorization primitive was invented; the correct logic already existed and simply wasn't the one being called from this file. Regression test added: `tests/unit/f10-parent-multi-role-isolation.test.ts` (asserts, at the source level, that `read-model.service.ts` never imports `canAccessLearner`, and behaviorally, that a Teacher-only relationship is denied even when the generic check would allow it).

## Run 2 (post-fix, against `78fb15d`)

```
TEST 1 (PARENT+TEACHER -> accepted Parent child, via Parent Read Model): expected=ALLOW actual=PASS
TEST 2 (PARENT+TEACHER -> Teacher-only Student B, via Parent Read Model -- CRITICAL): expected=DENY actual=PASS
TEST 3 (PARENT+TEACHER -> Teacher-only Student B, via Teacher authorization -- fixture validity): expected=ALLOW actual=PASS

MULTI_ROLE_PARENT_ISOLATION: PASS
```

## Regression sweep after the fix

- Full F10 real-Postgres lifecycle certification (11 sections, 40 assertions) re-run: **unchanged, all PASS**.
- Full F2 regression suite (6 files, 58 tests): **PASS**.
- Full repository suite: **5512/5512 PASS** (3 net new: the regression test above).
- `tsc --noEmit`: clean. `next build`: clean.

## Final result

```
MULTI_ROLE_AUTHORIZATION_TEST

Environment: Local isolated F10 worktree + ephemeral PostgreSQL

Test 1: PARENT+TEACHER -> accepted Parent child
Expected: ALLOW
Actual: PASS

Test 2: PARENT+TEACHER -> Teacher-only student through Parent API
Expected: DENY
Actual: PASS (FAIL on first run, pre-fix -- see Run 1 above)

Test 3: PARENT+TEACHER -> Teacher-only student through Teacher authorization
Expected: ALLOW
Actual: PASS

MULTI_ROLE_PARENT_ISOLATION: PASS
```

## Certified fix commit

`78fb15d` on `f10/parent-experience-2` (the corrected candidate; `870f1a6` is superseded as the certified HEAD by this fix).
