# F13 — Accessibility Report

Task section 21/32 -- accessibility as acceptance, not polish. Reported honestly: what was verified by direct code inspection vs. what requires live assistive-technology testing (deferred to IVG, never claimed as PASS here).

## Inherited, already-real accessibility work (verified by direct code reading)

`LearnerShell` (unchanged by F13 except the new optional slot) already implements: keyboard-operable menu button with `aria-expanded`/`aria-controls`, a real focus trap inside the mobile drawer (`role="dialog"`, `aria-modal="true"`, Tab/Shift+Tab wrapping, Escape to close), focus restored to the trigger on close, body scroll lock while open, `aria-current="page"` on the active nav link, and distinct `aria-label`s for the sidebar nav vs. the drawer nav (so a screen reader user can tell them apart).

## New components' own accessibility properties (verified by direct code reading)

- `WorkspaceSwitcher`: `aria-haspopup="listbox"`, `aria-expanded`, `role="listbox"`/`role="option"` with `aria-selected`, a visible focus style (`:focus-visible` outline in `globals.css`), and an `aria-label` on both the trigger and the menu. The error message uses `role="alert"` so a screen reader announces it without requiring focus to move there (task section 32's "error announcements").
- `PageHeader`: renders a real semantic `<h1>` (not a styled `<div>`) so the document outline and screen-reader heading navigation both work; the breadcrumb is wrapped in `<nav aria-label="Breadcrumb">`.
- `AssignInterventionForm`: every input/select is wrapped in a `<label>` element (not a placeholder-only field), so its accessible name is always present; the submit error uses `role="alert"`.
- `StatusBadge`: never color-only (see `F13_STATUS_AND_EMPTY_STATE_MODEL.md`) — label text is always present alongside the tone color.
- `InstitutionSubNav`: a real `<nav aria-label=...>` with `aria-current="page"` on the active section link.

## Non-color-only status distinction (task section 32)

Confirmed structurally: `StatusBadge` always renders a text label; no status anywhere in the new surfaces is conveyed by a colored dot/background alone.

## What was NOT verified this phase (honestly deferred, not claimed PASS)

- Live screen-reader testing (VoiceOver/NVDA) of any new page.
- Automated axe-core/Lighthouse accessibility scoring of any new page.
- Color-contrast ratio measurement against the existing design tokens for the new components specifically (the tokens themselves are inherited, unchanged, and presumably already vetted for the mature Student experience, but this phase did not independently re-measure contrast for the new `MetricCard`/`StatusBadge` combinations).
- Full keyboard-only navigation walkthrough of the new Teacher/Institution pages in a live, authenticated browser session (blocked by the same safe-testing-environment limitation described in `F13_PREVIEW_CERTIFICATION.md`).

These are registered in `F13_IVG_DEFERRED_TEST_REGISTER.md` as `IVG-F13-04` (accessibility live/AT pass) rather than silently omitted.
