LANE: L6_STUDENT
STATE: READY_FOR_ORCHESTRATOR_REVIEW
LAST_UPDATE: 2026-10-11T19:35Z
BASE_SHA: 24810e7 (canonical L6 base for this run; first run based on 4fb45b0)
CURRENT_SHA: the single commit on feat/l6-student-wave0 whose parent is 24810e7; run `git rev-parse feat/l6-student-wave0`

CURRENT_PHASE: STOP

NOW_DOING: nothing

COMPLETED:
- first run (24810e7, not amended): ST-3, ST-4
- this run: CR-L11-02 -- Student instructional surfaces show an access-required state on 403 ENTITLEMENT_REQUIRED
  - shared: src/lib/lx/access-required.ts, src/components/ui/AccessRequiredNotice.tsx, src/lib/i18n/l6-access-messages.ts
  - wired: concept explanation, error-pattern guidance, guided practice, transfer (start + submit), explain (start + submit), teacher-assigned start, add-concept explanation step
- report: dated section appended to docs/orchestration/reports/L6_REPORT.md

CURRENT_FINDINGS:
- AddConceptTab printed the server's raw error code to the Student (`throw new Error(explainBody.error)`); with the L11 gate that would have been the literal text ENTITLEMENT_REQUIRED. Fixed for the gate; other codes still print as before.
- two surfaces not changed because they are in the B5 diff (Wave 0 must-not-touch): src/app/dashboard/subjects/[id]/ConceptList.tsx (explanation on the subject page) and src/app/dashboard/quiz/page.tsx (per-question check and hint). Both show their existing generic copy, not the raw code.
- the L11 gate is not on this branch; the UI was built and tested against the contract (403 + { error: 'ENTITLEMENT_REQUIRED' }), not against L11's routes.

FILES_READ: feat/l11-entitlements @ fd9dfa6 (learning-gate.ts, route diffs, L11_REPORT.md) via git show; the Student surfaces listed below; StartSessionButton.tsx, session-launch-outcome.ts, quiz/page.tsx (read only), billing/page.tsx (read only)

FILES_MODIFIED:
- src/lib/lx/access-required.ts (new)
- src/lib/i18n/l6-access-messages.ts (new)
- src/components/ui/AccessRequiredNotice.tsx (new)
- src/app/dashboard/subjects/[id]/ConceptExplanationPanel.tsx
- src/app/dashboard/subjects/[id]/concepts/[conceptId]/ConceptExplanationDisclosure.tsx
- src/app/dashboard/subjects/[id]/AddConceptTab.tsx
- src/app/dashboard/learning-debt/ErrorPatternList.tsx
- src/app/dashboard/quiz/TeachingIntro.tsx
- src/app/dashboard/cognitive/transfer/page.tsx
- src/app/dashboard/cognitive/explain/page.tsx
- src/app/dashboard/assignments/StartAssignmentButton.tsx
- src/app/dashboard/assignments/page.tsx (one prop)
- tests/unit/l6-cr-l11-02-access-required.test.ts (new)
- tests/unit/lx4p-perf-r1-parallel-runtime.test.ts (one pinned type string)
- docs/orchestration/status/L6_STATUS.md, docs/orchestration/reports/L6_REPORT.md

TESTS:
- vitest tests/unit/l6-cr-l11-02-access-required.test.ts: 40 passed
- mutation check: with the panel's accessRequired branch disabled, 1 of 40 failed; restored
- vitest full suite (no DATABASE_URL): first run 2 failures in existing source-text tests caused by this change (fixed: one edit reverted, one pinned string updated); final run 522 files, 9,348 tests passed
- tsc --noEmit: no output
- next build: exit 0, 228/228 static pages
- browser: NOT_RUN (not required in this lane)

BLOCKERS: NONE

LOCK_REQUESTS: NONE

CROSS_LANE_DEPENDENCIES: L11 (feat/l11-entitlements @ fd9dfa6) supplies the gate these states react to. No file overlap with L11's diff.

NEXT: Orchestrator review

PROGRESS: CR-L11-02: 7/7 targeted surfaces wired; 2 surfaces left for after B5 convergence (ConceptList.tsx, quiz/page.tsx)
