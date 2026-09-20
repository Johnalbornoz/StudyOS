# F13 — Responsive Model

## Inherited responsive chrome (INV-F13-22, task section 31)

Every new Teacher/Institution page renders inside the SAME `LearnerShell` every Student page already uses — a fixed sidebar at ≥1024px, a sticky top bar + slide-in drawer below it. This chrome was already real and working before F13 (verified by direct code reading: explicit `@media (max-width: 1023px)` rules in `globals.css`, `lx-shell`/`lx-sidebar`/`lx-topbar`/`lx-drawer` classes). Adding the `workspaceSwitcher` slot required no new breakpoint — it renders inside both the desktop sidebar and the mobile drawer identically (same JSX, same CSS), so it is never hidden on a small viewport.

## New page content layout

Every new page's own card grids use `display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))` (Overview's metric cards) — a CSS pattern that reflows to a single column on narrow viewports without a dedicated mobile stylesheet or JS-based breakpoint logic. Lists (`teacher.classes`, `teacher.roster`, `institution.learners` distributions) use `.list-card`/`.list-row`, which are already a simple vertical flex layout with no fixed-width columns to overflow on mobile.

## What was verified vs. what is deferred

**Verified**: the app boots and the shell renders correctly in a live browser at default desktop viewport (see `F13_PREVIEW_CERTIFICATION.md`) — this is a genuine, if limited, live check, not merely a code-reading claim.
**Deferred to IVG**: authenticated, live-browser testing of the new Teacher/Institution pages at tablet/mobile viewport widths specifically. This environment has no safe, isolated way to sign in as a real Teacher/Institution-admin test account against a live dev server without connecting to a database whose identity/safety could not be confirmed in this session (see `F13_PREVIEW_CERTIFICATION.md`'s own explanation) — attempting authenticated interaction was judged an unacceptable risk rather than a shortcut worth taking. The CSS-level reasoning above is real and load-bearing (the same responsive primitives already certified-by-usage for the mature Student experience are reused verbatim), but it is not the same as a live, authenticated, multi-viewport visual pass.
