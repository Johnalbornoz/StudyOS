# F14 — Student Assignment Experience (Workstream B)

## What was built

- `/dashboard/assignments` — lists the Student's own pending Teacher interventions via the real, already-certified `getStudentPendingTeacherInterventions` (F11-C1). Renders `effectiveStatus` (ASSIGNED/IN_PROGRESS/COMPLETED/CANCELLED/EXPIRED, server-derived from `due_at` — never computed client-side) via `StatusBadge`/`toneForInterventionStatus`, unchanged from F13.
- `StartAssignmentButton` (`'use client'`) — mints a client-side idempotency key and POSTs to the real, unmodified `POST /api/student/teacher-interventions/[id]/start` (the single dispatcher covering all four intervention types per F11-C2's own explicit design: "reusing the same route for every intervention type... never a second Student execution route"). Routes the student to the correct next surface based on the server's own `executionReference`.
- `/dashboard/assignments/practice` + `PracticeRunner` (`'use client'`) — for CONCEPT/SKILL/COMPETENCY assignments.
- One new, small, additive API route: `GET /api/quizzes/session/[quizId]` — a thin, owner-only adapter over the already-certified `getQuizSession` (`quiz-persistence.service.ts`), sanitized through the exact same `toClientQuestion` helper `/api/quizzes/generate-and-take` itself uses (the correct answer/order/pairing is stripped identically — verified by a dedicated regression test).

## Why a new route and a new runner component, not an edit to the existing `/dashboard/quiz` page

`reconcileCompletionsForStudent` (F11-C1) checks the *exact* `execution_reference` quizId the execution service created when the Student clicked "Start" — completion is only ever detected by reading that specific `quiz_sessions` row back. The existing self-service `/dashboard/quiz` page has no "resume this exact quizId" capability today (its `resumeQuizId` param is narrowly wired to one unrelated verification-resume flow, not general session loading); its only real entry path is `subjectId`-driven *generation* of a brand-new quiz. Using that page as-is for an assignment would silently generate an *orphaned* second quiz whose completion the intervention would never observe — a real correctness bug, not merely a UX rough edge.

Two options were considered:
1. Extend the existing, large (1,100+ line), already-certified `/dashboard/quiz` page's internal state machine (teaching-stage choreography, canonical v1 launch markers, hints, relaunch-nonce remount logic) to add a "load an existing quizId" branch.
2. Build a new, small, purpose-built "Assignment Practice" surface that only does what a reinforcement assignment actually needs: fetch the already-generated questions, collect answers, submit.

Option 2 was chosen. This environment cannot safely run a live authenticated dev-server check (see F14_ENVIRONMENT_PROVENANCE_REPORT.md — the same constraint F13 hit), so a blind, unverifiable edit to a complex, already-certified, heavily-tuned page was judged materially riskier than net-new, independently-testable code with zero surface area touching the existing page. `PracticeRunner` deliberately supports fewer question-type affordances than the full self-service page (no hints, no teaching-stage choreography) — a disclosed, intentional simplification, not a hidden gap.

## Grading — 100% delegated, never re-implemented

`PracticeRunner` renders each `answerFormat` (`single_choice`/`multi_choice`/`text`/`matching`/`ordering`/`classification`) with a minimal, correct input control, encodes the answer into the exact string format `gradeStructuredAnswer` (`quiz-generation.service.ts`) already expects (verified by reading that function directly — e.g. `matching` → `JSON.stringify({[left]: right})`, `multi_choice` → comma-joined ids), and submits via the real, unmodified `POST /api/quizzes/generate-and-take` (submit branch: `{studentId, quizId, answers}`). No grading, scoring, or mastery-update logic exists in `PracticeRunner` itself — enforced by `tests/unit/f14-experience-completion-source-guard.test.ts`.

- EXAM assignments route to `/dashboard/exam-prep/attempt/[attemptId]` (Workstream A's own new page) using the server's real `executionReference` (a `simulationAttempt.id`) — no second exam UI was built.

## Nav badge (a deliberate, disclosed simplification)

The global shell's "My Assignments" badge count uses a new, cheap, read-only `countPendingTeacherInterventionsForStudent` — deliberately **not** the real `getStudentPendingTeacherInterventions`, because that function also runs `reconcileCompletionsForStudent` (a write path); running a reconciliation UPDATE on every single page load across the whole app was judged an unacceptable cost for a nav badge. The badge is therefore an approximate hint (may count a lazily-EXPIRED row once extra until the Assignments page's own real read reconciles it) — exactly the same honesty standard as the existing debt/notification badges.

## Verification

`tsc --noEmit` clean; `next build` clean; regression-guarded by `tests/unit/f14-experience-completion-source-guard.test.ts` (no grading logic in `PracticeRunner`, no raw `correctAnswer` returned by the new session route, real delegation to `/api/quizzes/generate-and-take` confirmed by source inspection).
