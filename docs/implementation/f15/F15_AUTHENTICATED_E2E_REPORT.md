# F15 — Authenticated E2E Report

## Status: NOT PERFORMED — honestly reported, not fabricated

No authenticated journey (Student, Teacher, Parent, Institution, or multi-role) was executed against Preview or any other environment this phase. This section explains precisely why, since the reason is more specific and more encouraging than F13/F14's own "no safe environment" — real progress was made, but two independent blockers remain.

## Blocker 1: Preview's Clerk configuration is broken

See F15_PREVIEW_CERTIFICATION.md — the Preview deployment's sign-in page renders as an unrelated Clerk application ("PMO OWN"), not StudyUS. Attempting to sign in against this would not exercise StudyUS's own authentication or authorization at all, and touching an unrelated tenant's real Clerk application was correctly avoided. `IVG-F15-02`.

## Blocker 2: this agent cannot create accounts or enter credentials

Independent of environment safety, this agent operates under a fixed rule: it does not create accounts or enter passwords/credentials on the user's behalf, in any environment, safe or not. This means even a correctly-configured Preview would not, by itself, unlock fully automated E2E — it would still require either:
- the operator supplying already-existing, disposable test credentials for each role (Student/Parent/Teacher/Institution admin/a real multi-role identity), which this agent could then use to drive the browser and report results, or
- the operator executing the journeys themselves, optionally with this agent guiding/narrating each step.

Neither was available this session.

## What WAS verified live (the honest, bounded scope of what's real)

- The Preview deployment's public, unauthenticated marketing page renders correctly (Spanish locale).
- The Preview deployment's `/sign-in` page renders (revealing the Clerk misconfiguration above) — a genuine, useful negative finding from real infrastructure.
- No further live pages were loaded once the auth blocker was identified, to avoid wasting effort on a path already known to be blocked.

## What remains verified only structurally (not live), same discipline as F13/F14

Every journey the task lists (Student self-service, Teacher → Student assignment, Parent, Institution, multi-role, and the negative-authorization matrix) is verified at the code/architecture level in F15_EXAM_SESSION_INTEGRITY.md, F15_AUTHORIZATION_NEGATIVE_TEST_REPORT.md, and by the 16/16 real-Postgres regression certifications (which DO exercise real authorization logic against a real, ephemeral Postgres database — including several of the exact negative-authorization cases the task asks for, e.g. the F12 cert script's Case D "Institution A admin → Institution B = DENY," Cases E/F class isolation, Cases U/V/W Parent/Teacher-alone/multi-role denial). This is real evidence, but it is not the same as a live, authenticated, rendered-in-a-browser end-to-end walkthrough, and this report does not claim it is.

## IVG registration

`IVG-F15-03`: full authenticated E2E matrix (Student self-service, Teacher→Student assignment, Parent, Institution, multi-role, negative authorization) — deferred pending (1) the Preview Clerk fix (`IVG-F15-02`) and (2) operator-supplied test credentials or operator-executed sessions. Carries forward and supersedes `IVG-F8-02`/`IVG-F13-02` in scope (now also covering every F15-built surface) without closing them.
