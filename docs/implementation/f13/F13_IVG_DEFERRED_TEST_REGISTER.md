# F13 — Integrated Verification Gate (IVG) Deferred Test Register

Reconciles and continues `F12_IVG_DEFERRED_TEST_REGISTER.md` (task §42). No prior entry is silently removed. New F13-specific deferrals are appended, categorized per task's own scheme (AUTH / REMOTE_DB / AI_PROVIDER / PREVIEW / RESTORE / PERFORMANCE / OPERATIONS / OTHER).

## Carried forward from F7–F12

| ID | Category | Requirement | Status |
|---|---|---|---|
| IVG-F7-01 | REMOTE_DB | Remote Preview database's actual migration state confirmed before pilot use | **STILL OPEN, EXTENDED** — now also covers F13's own zero new migrations (none added this phase, so no NEW schema-state risk, but the pre-existing one for F11-B through F12's migrations is unresolved) |
| IVG-F8-01 | AI_PROVIDER | Superseded by IVG-F9-01 | unchanged |
| IVG-F8-02 | AUTH | Remote authenticated E2E matrix against live Preview | **STILL OPEN, EXTENDED** — now also covers F13's own new Teacher/Institution UI routes, which share existing, already-certified authorization primitives |
| IVG-F8-03 | AUTH | Live Preview admin accept-path | **STILL OPEN** |
| IVG-F9-01 | AI_PROVIDER | AI_REAL_PROVIDER certification | **STILL OPEN** |
| IVG-F9-03 | OPERATIONS | Idempotency conflict-recovery under real network-level retry | **STILL OPEN** |
| IVG-F10-01 | AUTH | Live Preview Parent relationship lifecycle via two real Clerk sessions | **STILL OPEN** |
| IVG-F10-02 | AUTH | Remote authenticated E2E for the Parent read-model surface | **STILL OPEN** |
| IVG-F12-01 | AUTH | Remote authenticated E2E for the 11 F12 institution-intelligence routes | **STILL OPEN, EXTENDED** — now also covers the NEW UI pages consuming them |
| IVG-F12-02 | REMOTE_DB | Confirm F12's own migration applies cleanly to the real Preview database | **STILL OPEN** |
| IVG-F12-03 | PERFORMANCE | Large-scale (thousands-of-learners) F12 performance characterization | **STILL OPEN** |
| IVG-F12-04 | OTHER | Real, approved MIN_COHORT_POLICY product decision | **STILL OPEN** — directly relevant to F13's own Institution Learners page, which will render the OPEN_DECISION empty state in Production until this is resolved |

## New in F13

| ID | Category | Requirement | Why deferred | Risk if not executed | Planned IVG execution | Pass criteria |
|---|---|---|---|---|---|---|
| IVG-F13-01 | PREVIEW | Official Vercel Preview deployment of F13 | No Vercel CLI/`.vercel` project linkage available in this environment (identical limitation to F12) | Low — local build/typecheck/domain regression all pass; this adds only remote-environment confirmation | At IVG time, verify canonical StudyUS project linkage, deploy without `--prod`, confirm environment=preview/target=null/commit=F13's final SHA | Preview environment shows the new Teacher/Institution nav and pages render without error for a real test account |
| IVG-F13-02 | AUTH | Remote authenticated E2E for the new Teacher/Institution UI pages specifically (as opposed to their underlying API routes, already covered by IVG-F12-01/extended-F8-02) | Same remote-authentication limitation as every prior AUTH deferral, now also covering the UI layer itself (route rendering, `notFound()` behavior, redirect behavior) | Low-medium — the authorization DECISION is proven by the underlying certified services (re-run unchanged this phase); this adds confidence only that the PAGE correctly translates a denial into `notFound()`/redirect in a live session | At IVG time, drive a real Teacher account against a wrong class, a real Institution admin against a foreign institution, in a live browser | Each renders a genuine 404/redirect, never a raw error or partial data leak |
| IVG-F13-03 | OTHER | Live, authenticated visual acceptance pass (task section 44) across Student/Parent/Teacher/Institution journeys | No safe, isolated authenticated test environment available in this session (see `F13_PREVIEW_CERTIFICATION.md`) | Medium — structural/compile-time verification is real but does not substitute for seeing the actual rendered pages with real data | At IVG time (ideally against the Preview deployment from IVG-F13-01), walk each journey and compare against `F13_JOURNEY_CERTIFICATION.md`'s own expectations | Navigation, terminology, responsive behavior, and states match this document's claims |
| IVG-F13-04 | OTHER | Live accessibility pass (screen reader + automated scoring) of the new Teacher/Institution pages | No AT/axe-core tooling available in this environment | Medium — code-level accessibility properties are real (see `F13_ACCESSIBILITY_REPORT.md`) but unverified end-to-end | At IVG time, run axe-core/Lighthouse and a manual VoiceOver/NVDA pass | No critical/serious automated violations; core flows operable by keyboard + screen reader |
| IVG-F13-05 | OTHER | Live, two-session cache-isolation demonstration (role switch / authorization revoke reflected on next load) | Same safe-testing-environment limitation | Low — the architecture guarantees this (no client cache exists to go stale, verified by code reading); this adds only a live demonstration | At IVG time, revoke a membership in one session and confirm the next request in another session is denied | Matches `F13_CACHE_ISOLATION_REPORT.md`'s own architectural claim |
| IVG-F13-06 | PERFORMANCE | Real navigation-latency measurement for the new Teacher/Institution pages against seeded, realistic data | No authenticated environment available | Low — no evidence of a problematic query pattern (N+1, sequential waterfalls) was found; this is a confirmation, not a known risk | At IVG time, measure p50/p95 for dashboard load, role switch, student/institution navigation | Documented as a real baseline, not fabricated |
| IVG-F13-07 | OTHER | Live drill-down parsing of F9's `reasonCodes` in the Teacher Exam-assignment error response (to distinguish PLATFORM_NOT_READY / LEARNER_NOT_READY / MORE_EVIDENCE_NEEDED in the UI, task section 12) | Not built this phase — the current form shows one generic error message for any rejection reason | Low-medium — the underlying guard is real and unbypassable (F11-C4); only the ERROR MESSAGE'S specificity is a UX gap, not a safety gap | F14/next iteration: parse the real error body's reasons and render the correct distinct message | The three cases render visibly different, honest messages |

## Discipline

No entry above is silently upgraded to PASS anywhere in this phase's reports. `F13_QA_REPORT.md`'s test-layer matrix marks `REMOTE_PREVIEW_SMOKE`/`REMOTE_AUTHENTICATED_E2E`/`VISUAL_ACCEPTANCE` as `DEFERRED`, never `PASS`.
