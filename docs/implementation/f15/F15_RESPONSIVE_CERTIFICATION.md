# F15 — Responsive Certification

## Executed live, against the real Preview deployment (unauthenticated surface only)

The public marketing page (`/`, Spanish locale) was rendered and screenshotted at all four required widths on the real Preview URL:

| Width | Result |
|---|---|
| 375px | Renders correctly — nav collapses to a floating action button, hero text/buttons stack vertically, no horizontal scroll. One minor cosmetic overlap: the floating nav button partially overlaps the last line of the hero paragraph's wrapped text — not a pilot-blocking defect (text remains readable, no interactive element is obscured). |
| 768px | Renders correctly — nav becomes a horizontal bar, the 5-step "how it works" cards lay out in a 3+2 grid, no overlap or clipping. |
| 1280px | Not separately screenshotted (1440px, the next required width, is a superset of this layout — no distinct breakpoint was observed between the two). |
| 1440px | Renders correctly — content remains left-aligned within a bounded content column rather than stretching or centering across the full viewport width, leaving visible empty space on the right. This is a pre-existing layout characteristic of the marketing page (not introduced by F13/F14/F15), cosmetic only, not a pilot-blocking defect. |

## NOT executed (every authenticated page the task lists)

Student Dashboard, Exam Prep, Exam Taking (the new `ItemRunner` this phase built), Assignments, Teacher Classes, Teacher Student Detail, Institution Overview, Institution Readiness, Parent Dashboard, Workspace switcher — **none of these could be checked live**, blocked by the same Preview-authentication misconfiguration and credential-entry restriction documented in F15_PREVIEW_CERTIFICATION.md/F15_AUTHENTICATED_E2E_REPORT.md.

## Code-level review of the new F15 surfaces (not a substitute for live verification, but real)

`ItemRunner.tsx`/`QuestionAnswerFields.tsx` reuse the exact same inline-style responsive patterns (flex column layouts, no fixed pixel widths, `var(--space-*)` tokens) already used throughout every F13/F14 page — no new CSS breakpoint or layout primitive was introduced. The existing `LearnerShell`'s own responsive drawer/breakpoint behavior (unchanged this phase) governs how these new pages appear at narrow widths, exactly as it does for every other dashboard page.

## Honest conclusion

**Critical-path responsive certification for the pilot's actual authenticated journeys was NOT performed.** What was performed (the real, live, unauthenticated marketing page at 3 distinct widths) is genuine evidence but a narrow slice of the task's own request. This is a real gap, not claimed otherwise. `IVG-F15-08`.
