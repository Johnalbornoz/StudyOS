LANE: L11_ENTITLEMENTS
STATE: READY_FOR_ORCHESTRATOR_REVIEW
LAST_UPDATE: 2026-10-11T18:24Z
BASE_SHA: 4fb45b0 (R0); fe6ecf7 (R1, accepted L11 base, not amended)
CURRENT_SHA: the R1 commit on feat/l11-entitlements whose parent is fe6ecf7 (`git rev-parse --short feat/l11-entitlements`)

CURRENT_PHASE: STOP (L11-R1)

NOW_DOING: NONE. Lane stopped.

COMPLETED:
- R0 (fe6ecf7): EN-1, EN-2, EN-3.
- R1, ruling "L11 ACCEPTED WITH NARROW R1":
  - D-8(c) continuation: an attempt started while licensed can be reopened, answered, completed and graded; no new start.
  - Expired renewal: `expired -> active`, reachable only by an admin re-grant / approval or a provider-confirmed payment.
  - Grant -> paid: active grant refuses checkout; expired grant is purchasable; a confirmed payment starts a paid period with the sponsorship kept as history.
- Report: R1 section appended to docs/orchestration/reports/L11_REPORT.md.

CURRENT_FINDINGS:
- EN_1_SPONSORED_ACCESS = PASS
- EN_2_UNLICENSED_MODE = PASS
- EN_3_PAYMENT_SAFETY = PASS
- OPEN_ATTEMPT_CONTINUATION = PASS
- EXPIRED_RENEWAL = PASS (no schema needed)
- ADMIN_SUSPENSION_PROTECTION = PASS
- GRANT_TO_PAID = PASS (no schema; three points for the Orchestrator to weigh, in the report)
- PAYMENTS_GO_LIVE_READY = NO (sandbox run, webhook secret, CR-L11-05, CR-L11-02)
- PILOT_ENTITLEMENT_READY = YES
- L11_READY_FOR_CONVERGENCE = YES
- F-5: a Transfer task has no expiry / answered marker; resubmission re-runs AI grading, mastery stays idempotent (CR-L11-06).
- F-6: `approveManualPayment` on an expired grant activates the row but access stays PERIOD_ENDED (CR-L11-05).
- F-1 (expired grant cannot be re-granted) is closed by the new edge.
- All classifications rest on unit tests, a typecheck and a build; nothing ran against a database, Clerk, Mercado Pago or a deployment.

FILES_READ:
- As R0, plus: quizzes/session/[quizId]/check, quizzes/verify, quizzes/generate-and-take (submit branch), cognitive/explain/submit, simulation/attempts/[id]/*, exams/instances/**, exams/attempts/[id], src/lib/student/teacher-intervention-execution.service.ts, src/services/explain-defend-task.service.ts, src/services/transfer-task-instance.service.ts, src/services/quiz-persistence.service.ts

FILES_MODIFIED (R1, against fe6ecf7):
- NEW src/lib/entitlements/open-attempt.ts
- src/lib/entitlements/subscription-state-machine.ts
- src/lib/entitlements/provider-events.ts
- src/lib/entitlements/learning-gate.ts
- src/lib/entitlements/unlicensed-policy.ts
- src/services/payment.service.ts
- src/app/api/quizzes/session/[quizId]/check/route.ts
- src/app/api/cognitive/explain/submit/route.ts
- src/app/api/cognitive/transfer/submit/route.ts
- src/app/api/student/teacher-interventions/[id]/start/route.ts
- NEW tests/unit/l11-open-attempt-continuation.test.ts
- tests/unit/l11-provider-events.test.ts, l11-payment-webhook.test.ts, l11-sponsored-access-admin-grant.test.ts, l11-unlicensed-policy.test.ts
- tests/unit/f3-subscription-state-machine.test.ts, tests/unit/learn-check-feedback.test.ts (assertions changed, by ruling)
- tests/unit/f11c1-student-api-routes-security.test.ts, tests/unit/track-a-routes.test.ts (fixtures only)
- docs/implementation/f3/F3_UNLICENSED_MODE.md, docs/orchestration/reports/L11_REPORT.md, docs/orchestration/status/L11_STATUS.md

TESTS:
- `npx tsc --noEmit -p .`: exit 0
- `npx vitest run tests/unit/l11-*.test.ts`: 7 files, 168 tests passed
- Full suite, default timeout, load average 5-10: 526 files, 9,460 tests passed, no timeout
- `npx next build`: exit 0, 228/228 static pages
- Mutation check (9 source files restored to fe6ecf7): 41 of 207 tests failed; restored, 207 pass
- HTTP E2E, DEV / Stage / Production, Mercado Pago sandbox: NOT_RUN

BLOCKERS: NONE

LOCK_REQUESTS: NONE. No portion was stopped for schema.

CROSS_LANE_DEPENDENCIES:
- L6: CR-L11-02 -- unlicensed instructional panels must turn `403 { error: 'ENTITLEMENT_REQUIRED' }` into a user-facing licence state, not a generic error. CR-L11-03 stands.
- L10: CR-L11-01 (clear payer on unlink), CR-L11-05 (`approveManualPayment` on an administrator-set row), CR-L11-06 (optional schema: `consumed_at` on `transfer_task_instances`). L10 changes `ownStudentId`; re-run l11, f11c1 and track-a-routes tests after it merges.
- Orchestrator: CR-L11-04 (record the lock and contract); the three points under "Grant -> paid" in the report.
- Human Operator: `MERCADOPAGO_WEBHOOK_SECRET` before payments are enabled.

NEXT: Orchestrator review of the R1 commit.

PROGRESS:
- 3/3 R1 rulings implemented (continuation, expired renewal, grant -> paid)
- 4/4 regression areas covered (continuation, expiry renewal, suspension / revocation protection, grant -> paid)
- validation 4/4: focused tests, typecheck, build, full suite at default timeout
- report appended; committed on own branch
