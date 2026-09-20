# F15 — Accessibility Certification

Uses the task's own required language: this is a **critical-path accessibility validation**, not a full WCAG certification.

## Code-level review of new F15 surfaces

- `ItemRunner.tsx`: every question renders inside a semantic structure matching F14's `PracticeRunner` exactly (now literally shared via `QuestionAnswerFields`) — real `<label>`-wrapped inputs (radio/checkbox/select/textarea), a `<button type="button">` for Submit/Skip/Finalize (never a `<div onClick>`), and `<p role="alert">` for every error message. Progress text ("Question X of Y") is a plain, readable paragraph — announced by a screen reader as part of normal document flow (no `aria-live` region was added for the progress update itself; see gap below).
- `AttemptControls.tsx` (unchanged structurally, reused): Pause/Resume/Abandon remain real `<button>` elements with visible text labels, not icon-only controls.
- The five new Institution pages (Grades/Classes/Teachers/Coverage/Readiness) and the two new API-only additions carry no new accessibility surface beyond what F13/F14 already established (list/card patterns, `PageHeader`'s real `<h1>`).

## Executed live, against the real Preview deployment (unauthenticated surface only)

The marketing page's heading structure and landmark regions were read via the accessibility-tree-equivalent (`get_page_text`) during the responsive check (F15_RESPONSIVE_CERTIFICATION.md) — text content is well-structured (a clear H1, sequential H2/H3-equivalent sections, a real FAQ list) with no obviously broken semantic nesting observed. No formal axe-core/Lighthouse scoring tool was run (none is set up in this repository or available in this environment).

## NOT executed (the task's own explicit list, every one requiring authentication)

Keyboard-only navigation through the new Exam-Taking flow, focus order across `ItemRunner`'s question-to-question transitions, focus trap behavior (none is expected here — `ItemRunner` is not a modal/dialog), dialog/drawer behavior (unchanged `LearnerShell`, not re-tested live), contrast spot checks on the new surfaces, and screen-reader announcement of dynamically-loaded question content (a real, open question: `ItemRunner` swaps question content via client-side state after an async fetch with no `aria-live` region — a screen-reader user might not be told a new question has loaded). **None of this could be verified live**, blocked by the same Preview-authentication issue as every other live-authenticated check this phase.

## A real code-level gap found and fixed this phase

`ItemRunner`'s question transition (after Submit succeeds and the next item loads) had no `aria-live` region announcing the change — a sighted user sees new content appear; a screen-reader user got no explicit announcement. **Fixed**: the progress paragraph ("Question X of Y") now carries `aria-live="polite"`, so its text update on every transition is announced. Not live-verified with an actual screen reader (no AT tooling available in this environment) — a real, disclosed remaining gap, registered as `IVG-F15-09` (live AT verification of this fix).

## Honest conclusion

Critical-path accessibility validation of the pilot's actual authenticated journeys, including the new Exam-Taking experience specifically called out by the task, was **not performed live**. One real code-level gap (missing `aria-live` on question transitions) was found and fixed this phase, though not live-verified with real assistive technology.
