# F14 — Accessibility Report

Code-level verification only — no live assistive-technology or automated-scoring (axe-core/Lighthouse) pass was performed, for the same environment-safety reason documented throughout this phase (see F14_ENVIRONMENT_PROVENANCE_REPORT.md). This is disclosed, not claimed as a live pass. Registered as `IVG-F14-04`, mirroring F13's own `IVG-F13-04`.

## Inherited, unchanged accessibility infrastructure

Every new page renders inside the existing, already-accessible `LearnerShell` (focus trap, keyboard-operable drawer, `aria-current` nav, skip-to-content semantics) — none of it was modified except the additive `FOCUS_MODE_PREFIXES`/`ICONS` entries documented in F14_NAVIGATION_AND_ROUTE_MAP.md.

## Per-surface code-level properties

- **Semantic headings**: every new page uses `PageHeader` (a real `<h1>`) for its title, and `<h2>` for sub-sections (dimensions, results, etc.) — no heading level is skipped.
- **Form labels**: every input in `StartSimulationPanel`, the Institution Coverage/Readiness `<form method="GET">`, and `PracticeRunner`'s answer controls is wrapped in a `<label>` with the control as a direct child (implicit label association) — never a floating placeholder standing in for a label.
- **Buttons vs. links**: navigation uses `<Link>`/`<a>` (Grades → Classes, sub-nav tabs, breadcrumbs); state-changing actions use `<button type="submit">`/`<button type="button">` — never a `<div onClick>`.
- **Status semantics, never color-only**: every status (readiness overall/dimension, intervention/attempt status) renders through `StatusBadge`, which always pairs a color token with a distinct text label (task's own "non-color-only status" requirement, unchanged from F13's own established pattern) — `toneForDimensionStatus` (new this phase) follows the identical convention.
- **Error announcements**: every new error message (`StartSimulationPanel`, `StartAssignmentButton`, `AttemptControls`, `PracticeRunner`, `AssignInterventionForm`'s improved mapping) renders inside `<p role="alert">`, consistent with F13's own established pattern.
- **Accessible names for icon-only elements**: the two new nav icons (`ClipboardCheck`/`ClipboardList`) render inside `LearnerShell`'s existing `NavList`, which already pairs every icon with its resolved text label (never an icon-only, unlabeled link) — no new icon-only control was introduced.
- **Reduced-width navigation**: no changes were made to `LearnerShell`'s responsive drawer/breakpoint logic; the two new PRIMARY nav items render through the same `NavList` component at every viewport width, inheriting the existing mobile drawer behavior without any new CSS.
- **Tables**: the new Institution Classes/Teachers pages deliberately use the existing `.list-card`/`.list-row` pattern (matching every other F13 institution list), not an HTML `<table>` — consistent with the rest of this codebase's list presentation, not a new accessibility pattern to separately verify.

## Not verified live (disclosed)

Keyboard-only end-to-end traversal of the new multi-step flows (Assignments → Start → Practice → Submit → Results; Exam Prep → Start Simulation → Attempt controls), focus order after a client-side `router.push`, and screen-reader announcement of dynamically-appearing content (e.g. `PracticeRunner`'s per-question controls rendering after an async fetch) were not exercised against a real browser or assistive technology this phase.
