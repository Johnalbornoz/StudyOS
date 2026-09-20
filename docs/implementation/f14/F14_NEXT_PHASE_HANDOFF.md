# F14 — Next Phase Handoff

## What F14 delivered

- The FIRST real Student-facing Exam Prep UX (`/dashboard/exam-prep*`), consuming F9's fully-certified-but-previously-UI-less readiness/simulation engines, with a real platform-vs-learner-not-ready distinction and honest score-projection presentation.
- The FIRST real Student-facing Assignment UX (`/dashboard/assignments*`), consuming F11-C1..C4's fully-certified-but-previously-UI-less execution orchestration, including a new, small, correctness-critical `GET /api/quizzes/session/[quizId]` adapter that lets a Student resume the *specific* quiz session an assignment created (required for completion-reconciliation to work at all).
- A real F9-sourced replacement for the Parent dashboard's legacy readiness percentage, using an already-built (F10) but never-wired-in route.
- Institution UX completion: Grades, Classes, Teachers, Coverage, Readiness — all five consuming already-certified F12 backends, none newly built.
- Two real bugs found and fixed (an unmapped 500-producing error, a generic-error Teacher form) and two pre-existing date-drift test failures root-caused and fixed.
- A concrete, evidence-based environment-provenance finding (a real credential file in a sibling worktree), safely investigated with zero secret exposure.

## What F15 should build on top of this, in priority order

1. **Full item-by-item simulation-attempt exam-taking UI** (`IVG-F14-01`) — the single largest remaining gap. The attempt lifecycle (start/pause/resume/abandon, real F9 backend) is complete; only the actual question-rendering/response-recording surface is missing.
2. **A curriculum-structure-version / exam-version list endpoint** (`IVG-F14-02`) so the Institution Coverage/Readiness pages can use a real picker instead of a raw-ID form.
3. **Institution Teachers display names** — add a name join to `InstitutionTeacherSummary` (a small, real backend gap, not a UI decision).
4. **Resolve `IVG-F12-04`** (MIN_COHORT_POLICY) before any pilot institution relies on the Learners or Readiness pages.
5. **Rotate/remove the `f0s-security/.env.local` credentials** (`IVG-F14-06`) — an operator action, not a code change.
6. **Execute the full `F14_IVG_DEFERRED_TEST_REGISTER.md`** once a safe, isolated authenticated Preview/staging environment exists.

## What F15 should NOT do

- Do not build a second Student exam-taking surface alongside a future full item-by-item one — extend the existing attempt-status page, don't duplicate it.
- Do not extend the legacy `assessment_occurrences.exam_readiness`/`exam-readiness.service.ts` surface into any new page — F9 remains the only readiness source for anything new.
- Do not remove `parent.service.ts`'s inert `examReadiness` field without first re-checking its other real consumers (`dashboard/admin/[studentId]/page.tsx`, `/api/learners/[id]/summary`).
- Do not merge to `main`, deploy Production, or modify Production environment variables from this phase's own work.
