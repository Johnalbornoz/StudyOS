# F15 — Support & Incident Model

A practical, minimal operating model — not a formal ITIL process, matching the task's own "keep it practical" instruction.

## Severity levels

| Severity | Definition | Example |
|---|---|---|
| **Sev 1** | Platform unavailable, or a security issue (credential exposure, an authorization bypass, cross-student/cross-institution data leak) | The Preview Clerk misconfiguration this phase found (F15_PREVIEW_CERTIFICATION.md) would be a Sev 1 if it were Production; the `f0s-security` credential exposure (F15_SECRET_AND_ENVIRONMENT_HARDENING.md) is a Sev 1-class item until rotated/removed |
| **Sev 2** | A critical academic flow is broken (Student cannot start/submit an exam, Teacher cannot assign an intervention, a Parent sees another family's data) | A regression in `item-resolution.service.ts` that made every exam item return `ITEM_UNAVAILABLE` |
| **Sev 3** | Degraded or non-critical (a slow page, a cosmetic layout break, a missing translation) | The 1440px marketing-page left-alignment observed in F15_RESPONSIVE_CERTIFICATION.md |
| **Sev 4** | Cosmetic/minor | A misaligned icon |

## Owner / detection / triage / rollback / communication / data investigation

| Aspect | Model |
|---|---|
| **Owner** | The human operator (this program has no on-call rotation or team defined anywhere in its own documentation — a single-operator pilot, honestly reflecting the actual scale of this project as observed) |
| **Detection** | Currently: the new `[pilot]`/`[ai]` structured log lines (F15_OBSERVABILITY_MODEL.md) if the operator is watching Vercel's own log stream; no alerting/paging exists (real gap, disclosed) |
| **Triage** | Grep the structured logs for the relevant `event`/`errorCode`/`route` field; cross-reference against the real-Postgres regression suite to determine if it's a regression or a genuinely new failure mode |
| **Rollback** | See F15_ROLLBACK_AND_CONTAINMENT_MODEL.md |
| **Communication** | Not formally defined — a single-operator pilot has no separate stakeholder-communication process documented anywhere in this program; a real gap for anything beyond a very small, informal pilot |
| **Data investigation** | Real-Postgres regression scripts (16, all passing) can be re-run against a COPY of the affected data (never the live pilot database directly) to reproduce a reported issue deterministically |

## What does NOT exist (disclosed, not fabricated)

No paging/alerting system, no status page, no formal incident-communication template, no on-call rotation. This program has never built one, and F15 does not invent one now — a real, honest gap for anything beyond a small, closely-operator-watched pilot. Registered as `IVG-F15-11`.
