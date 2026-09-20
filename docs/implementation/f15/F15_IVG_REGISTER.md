# F15 — IVG Register (reconciled, unambiguous)

Each item has exactly ONE current state (`OPEN` / `RESOLVED` / `SUPERSEDED` / `DEFERRED` / `FAILED`) and one provenance tag. No item is silently dropped from F7–F14's own registers.

## Carried from F7–F12

| ID | State | Provenance | Requirement |
|---|---|---|---|
| IVG-F7-01 | DEFERRED | F7 | Remote Preview database's migration state confirmed before pilot use — still unverified (F15_DATABASE_AND_MIGRATION_READINESS.md) |
| IVG-F8-02 | DEFERRED | F8, extended F13/F14/F15 | Remote authenticated E2E — now covers every F15 surface too |
| IVG-F8-03 | DEFERRED | F8 | Live Preview admin accept-path |
| IVG-F9-01 | DEFERRED | F9 | AI_REAL_PROVIDER certification |
| IVG-F9-03 | DEFERRED | F9 | Idempotency conflict-recovery under real network-level retry |
| IVG-F10-01 | DEFERRED | F10 | Live Preview Parent relationship lifecycle via two real Clerk sessions |
| IVG-F10-02 | DEFERRED | F10 | Remote authenticated E2E for the Parent read-model surface |
| IVG-F12-01 | DEFERRED | F12, extended F14 | Remote authenticated E2E for the 11 F12 institution-intelligence routes |
| IVG-F12-02 | DEFERRED | F12 | Confirm F12's migration applies cleanly to the real Preview database |
| IVG-F12-03 | DEFERRED | F12 | Large-scale F12 performance characterization |
| IVG-F12-04 | **RESOLVED** | F12 → F15 | MIN_COHORT_POLICY — see ADR-F15-MIN-COHORT-POLICY.md. Evidence: real migration seeding a versioned ACTIVE policy, 7 deterministic unit tests, all 16 real-Postgres regressions re-passing including the updated F12 cert script |

## Carried from F13

| ID | State | Provenance | Requirement |
|---|---|---|---|
| IVG-F13-01 | **RESOLVED** | F13 → F15 | Official Vercel Preview deployment — see F15_PREVIEW_CERTIFICATION.md. Evidence: real deployment `dpl_B2xeHtPKgeMcZyfPoDQGDFxnqax3`, `target: null`, URL reachable and rendering |
| IVG-F13-02 | **SUPERSEDED** | F13 → F15-03 | Remote authenticated E2E for Teacher/Institution UI — folded into the broader `IVG-F15-03` (full authenticated E2E matrix), which now covers every workspace, not just Teacher/Institution |
| IVG-F13-03 | **SUPERSEDED** | F13 → F15-03 | Live authenticated visual acceptance — folded into `IVG-F15-03` |
| IVG-F13-04 | **SUPERSEDED** | F13 → F15-09 | Live accessibility pass — folded into `IVG-F15-09` (narrower, more specific: the one real gap found and fixed this phase, now needing live AT confirmation) |
| IVG-F13-05 | DEFERRED | F13, extended F14/F15 | Live, two-session cache-isolation demonstration — architecture unchanged, extended to F15's new surfaces by identical construction |
| IVG-F13-06 | **SUPERSEDED** | F13 → F15-06 | Real navigation-latency measurement — folded into `IVG-F15-06` |
| IVG-F13-07 | **RESOLVED** | F13 → F14 | Live drill-down of F9 reasonCodes in Teacher error — resolved with evidence in F14 (real gaps found: generic Teacher-form error handling, unmapped `TeacherInterventionExamProfileMismatchError`; both fixed) |

## Carried from F14

| ID | State | Provenance | Requirement |
|---|---|---|---|
| IVG-F14-01 | **RESOLVED** | F14 → F15 | Full item-by-item exam-taking UX — see F15_EXAM_TAKING_EXPERIENCE.md. Evidence: new `item-resolution.service.ts` wiring 3 already-certified systems, 11 deterministic unit tests, real UI (`ItemRunner`), full suite passing |
| IVG-F14-02 | OPEN | F14 | Backend list of curriculum structure/exam versions for a real Institution Coverage/Readiness picker |
| IVG-F14-03 | OPEN | F14 | Live verification a Student's own Exam-start rejection renders legibly (blocked by the same Preview-auth issue as `IVG-F15-03`) |
| IVG-F14-04 | **SUPERSEDED** | F14 → F15-09 | Live accessibility pass for F14 surfaces — folded into the same broader accessibility gate |
| IVG-F14-05 | **SUPERSEDED** | F14 → F15-06/07 | Real navigation/query-latency measurement — folded into `IVG-F15-06`/`IVG-F15-07` |
| IVG-F14-06 | OPEN — HARD PILOT GATE | F14, re-attempted F15 | Rotate/remove the real credential-bearing `f0s-security/.env.local`. F15 attempted safe prefix-only inspection; blocked by this environment's own credential-materialization safeguard. See F15_SECRET_AND_ENVIRONMENT_HARDENING.md |

## New in F15

| ID | State | Requirement |
|---|---|---|
| IVG-F15-01 | OPEN — HARD PILOT GATE | Same substance as `IVG-F14-06`, restated as a hard gate this phase: operator must rotate/verify the exposed credentials before Pilot |
| IVG-F15-02 | OPEN — HARD PILOT GATE | Preview's Clerk configuration resolves to an unrelated application ("PMO OWN") — found by actually loading the real Preview URL. Must be fixed and re-verified before any authenticated E2E is attempted |
| IVG-F15-03 | OPEN | Full authenticated E2E matrix (Student/Teacher/Parent/Institution/multi-role/negative-authorization) — blocked by `IVG-F15-02` plus this agent's own categorical no-credential-entry rule; needs operator-supplied test credentials or operator-executed sessions |
| IVG-F15-04 | OPEN | Real-Postgres regression case for the new exam-taking IDOR matrix (currently unit-tested with mocks only) |
| IVG-F15-05 | OPEN | Thread a real per-request correlation id through the request lifecycle (utility exists, not yet wired end-to-end) |
| IVG-F15-06 | OPEN | Real authenticated-flow latency measurement (blocked by `IVG-F15-02`/`IVG-F15-03`) |
| IVG-F15-07 | OPEN | Real concurrency/load characterization |
| IVG-F15-08 | OPEN | Responsive certification for every authenticated page (only the unauthenticated marketing page was checked live) |
| IVG-F15-09 | OPEN | Live assistive-technology verification of the `aria-live` fix this phase made to `ItemRunner` |
| IVG-F15-10 | OPEN | Real backup/restore drill + documented RPO/RTO — no backup automation exists in this codebase at all |
| IVG-F15-11 | OPEN | Paging/alerting/incident-communication tooling — none exists |
| IVG-F15-12 | OPEN | Dedicated feature-flag/kill-switch set beyond the existing `AI_ENABLED` |
| IVG-F15-13 | OPEN | A dedicated `/api/health` route — none exists |

## Totals

```
Total known (all provenances, deduplicated):     37
RESOLVED:                                          4   (IVG-F12-04, IVG-F13-01, IVG-F13-07, IVG-F14-01)
SUPERSEDED:                                        6   (IVG-F13-02, IVG-F13-03, IVG-F13-04, IVG-F13-06, IVG-F14-04, IVG-F14-05 -- folded into 3 broader F15 items: IVG-F15-03, IVG-F15-06, IVG-F15-09)
OPEN / DEFERRED:                                  27   (10 carried from F7-F12, 1 from F13, 3 from F14, 13 new this phase)
FAILED:                                            0
New this phase:                                   13   (IVG-F15-01 through IVG-F15-13)
```

6 items are marked SUPERSEDED, folding into 3 broader F15 items — each superseded item is still listed individually above for traceability, so no history is lost even though the count of *distinct remaining open concerns* is lower than the raw item count.

## Hard Pilot gates among the OPEN items (task's own explicit list, cross-referenced)

`IVG-F14-06`/`IVG-F15-01` (unrotated exposed credentials) and `IVG-F15-02` (Preview auth misconfiguration) are explicitly marked **HARD PILOT GATES** above — these two, and only these two, are severe enough on their own to block a PASS_TO_PILOT recommendation regardless of how well everything else scored. See F15_RESIDUAL_RISK_REGISTER.md and the Final Decision.
