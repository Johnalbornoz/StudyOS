LANE: L11_ENTITLEMENTS
STATE: READY_FOR_ORCHESTRATOR_REVIEW
LAST_UPDATE: 2026-10-11T18:08Z
BASE_SHA: 4fb45b0
CURRENT_SHA: the single commit on feat/l11-entitlements whose parent is 4fb45b0 (`git rev-parse --short feat/l11-entitlements`)

CURRENT_PHASE: STOP

NOW_DOING: NONE. Lane stopped.

COMPLETED:
- READ TASK, VERIFY BASELINE (4fb45b0, new worktree, clean), VERIFY OWNERSHIP.
- EN-1 (ruling: per-student admin grants, seats deferred): no code, no seat model; procedure pinned by tests; finding F-1.
- EN-2: D-8(a) and D-8(b) ruled by the Orchestrator in session. Shared gate + written definition; 6 L4-10 routes gated; 6 content-setup routes recorded as free in demo.
- EN-3: signed webhook; provider events never touch admin grants or admin decisions; cancellations honoured; payer bound on payment and tied to a live relationship.
- Report: docs/orchestration/reports/L11_REPORT.md.

CURRENT_FINDINGS:
- F-1: an expired grant cannot be granted again (no `expired -> active` edge; pinned by tests/unit/f3-subscription-state-machine.test.ts:73). Extend pilot grants before expiry.
- F-2: a Student who has ever had an administrative grant cannot buy (row stays administrator-set). Prerequisite for enabling payments, not for Stage.
- F-3: legacy `PATCH /api/admin/students/[id]/subscription` still bypasses the state machine (L4-05, L10).
- F-4: no replay window on the webhook signature (idempotent processing).
- LOCKS.md does not list ENTITLEMENTS_AND_PAYMENTS; no tasks/L11 contract.

FILES_READ:
- Control plane (CONTROL_PLANE, LOCKS, OBSERVABILITY, reports/README), L3R1_REPORT, L4R1_REPORT, L4_REPORT
- src/lib/entitlements/**, src/services/payment.service.ts, src/services/membership-admin.service.ts, api/billing/**, api/payments/**, api/webhooks/mercadopago, api/admin/memberships/grant-license, the L4-10 routes, src/lib/authorization/index.ts, src/lib/exam-core/route-auth.ts, src/lib/admin/admin-identity.ts, docs/implementation/f3/**
- Read-only: `git status` / `git diff` in the L6, L7, L8, L9, L10 worktrees (overlap check)

FILES_MODIFIED:
- NEW src/lib/entitlements/learning-gate.ts
- NEW src/lib/entitlements/unlicensed-policy.ts
- NEW src/lib/entitlements/provider-events.ts
- NEW src/lib/entitlements/mercadopago-signature.ts
- src/services/payment.service.ts
- src/app/api/webhooks/mercadopago/route.ts
- src/app/api/payments/checkout/route.ts
- src/app/api/billing/subscription/route.ts
- src/app/api/billing/reactivate/route.ts
- src/app/api/learning/guided-practice/route.ts
- src/app/api/concepts/[id]/explanation/route.ts
- src/app/api/concepts/[id]/interactive-formula/route.ts
- src/app/api/learning-debt/error-guidance/route.ts
- src/app/api/cognitive/transfer/submit/route.ts
- src/app/api/student/teacher-interventions/[id]/start/route.ts
- NEW tests/unit/l11-unlicensed-policy.test.ts, l11-provider-events.test.ts, l11-payment-webhook.test.ts, l11-mercadopago-webhook-signature.test.ts, l11-billing-live-payer.test.ts, l11-sponsored-access-admin-grant.test.ts
- tests/unit/f3-api-routes-security.test.ts, l4r1-billing-self-reactivation.test.ts, f11c1-student-api-routes-security.test.ts, track-a-routes.test.ts, lx4p-perf-r1e-guide-independence.test.ts, payment-never-grants-parent-relationship.test.ts (fixtures only)
- NEW docs/implementation/f3/F3_UNLICENSED_MODE.md
- NEW docs/orchestration/status/L11_STATUS.md, docs/orchestration/reports/L11_REPORT.md

TESTS:
- `npx tsc --noEmit -p .`: exit 0
- `npx vitest run tests/unit/l11-*.test.ts`: 6 files, 110 tests passed
- Mutation check (11 source files restored to 4fb45b0): 37 of 109 L11 tests failed; restored, all pass
- Full suite, `--testTimeout=60000 --hookTimeout=60000`: 525 files, 9,400 tests passed
- Full suite, default 5 s timeout: FAILED 5 files / 7 tests, all in files this lane did not touch, 6 by timeout, with load average 22-33 from other lanes. Needs a re-run on a quiet machine
- `npx next build`: exit 0, 228/228 static pages
- HTTP E2E, DEV / Stage / Production, Mercado Pago sandbox: NOT_RUN

BLOCKERS: NONE

LOCK_REQUESTS: NONE. No SCHEMA_CHANGE_REQUEST was needed.

CROSS_LANE_DEPENDENCIES:
- Orchestrator: D-8(c) continuation; D-L11-1 renewal after expiry; D-L11-2 grant-to-paid conversion (last two before payments are enabled).
- L10: CR-L11-01 (clear payer on unlink, SF-7). `payments/checkout/route.ts` item of CR-L4R1-01 is done here; L10 should not edit that file. L10's in-progress changes to `ownStudentId` and `resolveVerifiedPrimaryEmail` keep the signatures this lane calls.
- L6: CR-L11-02 (licence prompt on 403 ENTITLEMENT_REQUIRED), CR-L11-03 (background generation for unlicensed Students).
- Human Operator: `MERCADOPAGO_WEBHOOK_SECRET` before payments are enabled; extend pilot grants before expiry.

NEXT: Orchestrator review.

PROGRESS:
- 3/3 work packages addressed: EN-1 (no code, by ruling), EN-2 (a and b enforced; c not ruled), EN-3 (L4-11 a-d)
- 4/4 EN-3 acceptance cases covered by tests; 2/2 EN-2 acceptance cases covered (free list by source check only)
- report written; committed on own branch
