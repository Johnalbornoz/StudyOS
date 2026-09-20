# F13 — Next Phase Handoff

## What F13 delivered

- A real, workspace-aware global shell: F1's already-certified `resolveAvailableWorkspaces`/`getActiveWorkspace`/`setActiveWorkspace` are now actually consumed by the UI for the first time, via a new `WorkspaceSwitcher` and per-workspace nav-group builders, extending (never replacing) the existing, already-accessible `LearnerShell`.
- The FIRST real Teacher workspace UI (classes → roster → student detail → assign Concept/Skill/Competency/Exam), consuming F11-A/B's fully-certified-but-previously-UI-less backend.
- The FIRST real Institution workspace UI (overview, learners, interventions, attention areas), consuming F12's fully-certified-but-previously-UI-less backend.
- A real bug found and fixed: the Teacher intervention assignment route's missing EXAM target schema branch.
- Four new shared presentation primitives (StatusBadge, EmptyState, MetricCard, PageHeader) wrapping the existing design tokens, plus ~65 new i18n keys across all 5 existing locales.
- A precise, evidence-based Legacy UX Containment inventory, correcting a materially unreliable initial automated-exploration pass.

## What F14 should build on top of this, in priority order

1. **Student-facing Teacher-assignment + Exam Prep UI** (task section 10/11) — the highest-value remaining gap: both are fully real, certified backends with zero Student-facing UI. Reuse `StatusBadge`/`toneForReadinessStatus`/`MetricCard` directly.
2. **Institution Grades/Classes/Teachers/Coverage/Readiness pages** — same pattern as the four pages this phase built; Coverage/Readiness need a "list available structures/exam versions" read model added first (a small, real backend gap, not a design problem).
3. **Parent legacy-readiness migration** (`F13_LEGACY_UX_CONTAINMENT.md`'s own documented path) — build a Parent-facing F9 readiness summary function and retire `assessment_occurrences.exam_readiness` from the Parent card.
4. **Resolve `IVG-F12-04`** (a real, approved MIN_COHORT_POLICY decision) before any pilot institution relies on the Learners page.
5. **Execute the full `F13_IVG_DEFERRED_TEST_REGISTER.md`** once a safe, isolated authenticated Preview/staging environment with real Vercel CLI access exists — this is the single biggest lever to convert this phase's "structurally verified, live-unverified" status into a genuinely complete certification.

## What F14 should NOT do

- Do not build a second role/workspace resolution mechanism — `resolveAvailableWorkspaces`/`setActiveWorkspace` (F1) are the only ones that should ever exist.
- Do not let the new Teacher/Institution pages' own convenience (direct service imports) become an excuse to skip re-authorization in a future page — every page must independently re-verify, exactly as every page in this phase does.
- Do not extend the legacy `assessment_occurrences.exam_readiness`/`exam-readiness.service.ts` surface into any new page — F9 remains the only readiness source for anything new (INV-F13-09/10 is structurally guarded and should stay that way).
- Do not merge to `main`, deploy Production, or modify Production environment variables from this phase's own work — explicitly out of scope per the STOP condition.
