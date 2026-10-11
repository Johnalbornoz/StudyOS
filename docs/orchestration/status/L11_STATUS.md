LANE: L11_ENTITLEMENTS
STATE: READY_FOR_ORCHESTRATOR_REVIEW
LAST_UPDATE: 2026-10-11T19:50Z
BASE_SHA: 4fb45b0 (R0); fe6ecf7 (R1); fd9dfa6 (R2)
CURRENT_SHA: tip of feat/l11-entitlements: 92cd8fd (R2 tests) + the R2 report commit (`git rev-parse --short feat/l11-entitlements`)

CURRENT_PHASE: STOP (L11-R2, L10 integration compatibility, CR-L7-04)

NOW_DOING: NONE. Lane stopped.

COMPLETED:
- R0 (fe6ecf7): EN-1, EN-2, EN-3. R1 (fd9dfa6): continuation, expired renewal, grant -> paid.
- R2: reproduced the 9 failures on a local scratch merge of fd9dfa6 + L10 79b7f50, classified them, fixed the tests, validated both trees. No runtime change.

CURRENT_FINDINGS:
- CR_L7_04_L11 = CLOSED
- OPEN_ATTEMPT_INTEGRATION = PASS
- UNLICENSED_POLICY_INTEGRATION = PASS
- PAYMENT_SECURITY_INTEGRATION = PASS
- DETERMINISTIC_FAILURES = 0 (9 before)
- L11_FINAL_INTEGRATION_READY = YES
- The 9: STALE_TEST_FIXTURE 8, STALE_SOURCE_ASSERTION 1, REAL_RUNTIME_REGRESSION 0 (table in the report).
- L10 79b7f50 closes CR-L11-05 and CR-L11-06, and with them R1 findings F-6 and F-5.
- F-7 (observation): `isLearnerOwner` matches `students.user_id` only; L10 SF-2 also accepts an unbackfilled row by Clerk id. Such a Student would be authorized but treated as unlicensed. Fails closed; NOT_VERIFIED against data.
- R1 classifications stand (EN_1/EN_2/EN_3/continuation/renewal/suspension/grant-to-paid PASS; PAYMENTS_GO_LIVE_READY NO; PILOT_ENTITLEMENT_READY YES).

FILES_READ:
- Merged tree: src/lib/identity/access-predicates.ts, src/lib/authorization/index.ts, src/lib/exam-core/route-auth.ts, src/services/transfer-task-instance.service.ts, src/services/membership-admin.service.ts, api/cognitive/transfer/submit, api/simulation/attempts/[id]/result, tests/unit/l10-r1-l11-dependencies.test.ts

FILES_MODIFIED (R2, against fd9dfa6):
- tests/unit/l11-open-attempt-continuation.test.ts
- tests/unit/l11-payment-webhook.test.ts
- tests/unit/l11-unlicensed-policy.test.ts
- docs/orchestration/reports/L11_REPORT.md, docs/orchestration/status/L11_STATUS.md
- Outside the branch: scratch worktree /Users/jalbornoz/PROYECTOS/studyos-l11-compat-check, branch scratch/l11-l10-compat-check (local merge used as evidence; deletable)

TESTS:
- Merged tree, before fixes: full suite 3 files / 9 tests failed, no timeout
- Merged tree, after: `l11-*` 7 files / 175 passed; integration-sensitive set 33 files / 568 passed; full suite 535 files / 9,666 passed (default timeout); `tsc --noEmit` exit 0; `next build` exit 0, 229/229 pages
- feat/l11-entitlements alone: full suite 526 files / 9,467 passed; `tsc --noEmit` exit 0; `next build` exit 0, 228/228 pages
- HTTP E2E, any database or deployed environment: NOT_RUN

BLOCKERS: NONE

LOCK_REQUESTS: NONE

CROSS_LANE_DEPENDENCIES:
- L7: CR-L7-04 is closed on the L11 side; rebase on L10 79b7f50 + the L11 tip.
- L6: CR-L11-02, CR-L11-03 open. L10: CR-L11-01 open. Orchestrator: CR-L11-04; F-7 after both lanes are on the integration line.
- Human Operator: `MERCADOPAGO_WEBHOOK_SECRET` before payments are enabled.

NEXT: Orchestrator merges L10 and L11 on the integration line and re-runs the suite there.

PROGRESS:
- 9/9 failures classified and resolved
- validation 5/5 on the merged tree: focused L11, integration-sensitive, full suite, typecheck, build
- report appended; committed on own branch
