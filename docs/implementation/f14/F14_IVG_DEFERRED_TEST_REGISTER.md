# F14 — Integrated Verification Gate (IVG) Deferred Test Register

Reconciles and continues `F13_IVG_DEFERRED_TEST_REGISTER.md`. No prior entry is silently removed. Every carried item is re-evaluated with fresh evidence where F14's own work changed the picture.

## Carried forward from F7–F13

| ID | Category | Requirement | Status |
|---|---|---|---|
| IVG-F7-01 | REMOTE_DB | Remote Preview database's migration state confirmed before pilot use | **STILL OPEN** — F14 added zero new migrations, no new schema-state risk introduced |
| IVG-F8-02 | AUTH | Remote authenticated E2E matrix against live Preview | **STILL OPEN, EXTENDED** — now also covers F14's new Student Exam Prep/Assignments/Institution Grades-Classes-Teachers-Coverage-Readiness routes |
| IVG-F8-03 | AUTH | Live Preview admin accept-path | **STILL OPEN** |
| IVG-F9-01 | AI_PROVIDER | AI_REAL_PROVIDER certification | **STILL OPEN** |
| IVG-F9-03 | OPERATIONS | Idempotency conflict-recovery under real network-level retry | **STILL OPEN** |
| IVG-F10-01 | AUTH | Live Preview Parent relationship lifecycle via two real Clerk sessions | **STILL OPEN, EXTENDED** — now also covers the newly-wired Parent Exam Prep card |
| IVG-F10-02 | AUTH | Remote authenticated E2E for the Parent read-model surface | **STILL OPEN** |
| IVG-F12-01 | AUTH | Remote authenticated E2E for the 11 F12 institution-intelligence routes | **STILL OPEN, EXTENDED** — now also covers the 5 new Institution UI pages consuming them |
| IVG-F12-02 | REMOTE_DB | Confirm F12's migration applies cleanly to the real Preview database | **STILL OPEN** |
| IVG-F12-03 | PERFORMANCE | Large-scale F12 performance characterization | **STILL OPEN** |
| IVG-F12-04 | OTHER | Real, approved MIN_COHORT_POLICY product decision | **STILL OPEN, NOW DIRECTLY BLOCKS TWO MORE PAGES** — F14's new Institution Readiness page renders the same OPEN_DECISION empty state as the existing Learners page until this is resolved |
| IVG-F13-01 | PREVIEW | Official Vercel Preview deployment | **STILL OPEN** — no Vercel CLI/`.vercel` linkage available in this environment either |
| IVG-F13-02 | AUTH | Remote authenticated E2E for the F13 Teacher/Institution UI pages | **STILL OPEN, EXTENDED** — now also covers F14's own new pages under the same surfaces |
| IVG-F13-03 | OTHER | Live authenticated visual acceptance pass | **STILL OPEN, EXTENDED** — now also covers Exam Prep/Assignments/the 5 new Institution pages/the migrated Parent card |
| IVG-F13-04 | OTHER | Live accessibility pass (screen reader + automated scoring) | **STILL OPEN, EXTENDED** — see F14_ACCESSIBILITY_REPORT.md |
| IVG-F13-05 | OTHER | Live, two-session cache-isolation demonstration | **STILL OPEN** — architecture unchanged, extended to new surfaces by identical construction (see F14_CACHE_AND_CONTEXT_ISOLATION.md) |
| IVG-F13-06 | PERFORMANCE | Real navigation-latency measurement | **STILL OPEN, EXTENDED** — see F14_PERFORMANCE_BASELINE.md |
| IVG-F13-07 | OTHER | Live drill-down of F9 `reasonCodes` in Teacher Exam-assignment error | **RESOLVED WITH EVIDENCE, SUPERSEDED** — see F14_TEACHER_EXAM_INTERVENTION_SEMANTICS.md: the original framing assumed an assignment-time eligibility check that does not exist; the real gaps (generic Teacher-form error handling, an unmapped `TeacherInterventionExamProfileMismatchError`) were found and fixed this phase. Replacement item: `IVG-F14-03` (below). |

## New in F14

| ID | Category | Requirement | Why deferred | Planned execution | Pass criteria |
|---|---|---|---|---|---|
| IVG-F14-01 | OTHER | Full item-by-item simulation-attempt exam-taking UI (rendering a frozen `SimulationPlan`'s real assessment items, timing, `POST /api/simulation/attempts/[id]/responses`) | Genuinely large, separate surface; no existing UI anywhere renders a `SimulationPlan`; judged out of scope for this phase alongside everything else | F15 or a dedicated phase | A Student can complete a full item-by-item simulation attempt end to end and see a real, non-hollow score |
| IVG-F14-02 | OTHER | A backend "list available curriculum structure versions / exam versions" read model for the Institution Coverage/Readiness pages, so a real picker can replace the current raw-ID GET form | No such list function exists anywhere in the codebase today (verified by inspection) | F15 | Institution admin can pick a structure/exam version from a real list, no id-pasting required |
| IVG-F14-03 | OTHER | Live verification that a Student's own Exam-start rejection (real F9/structural `reasons`) renders legibly end-to-end in a real browser | Same environment-safety constraint as every other live-authenticated item this phase | At IVG time, against a real Preview/staging environment | The rejection message a Student actually sees matches the server's real `reasons`, not a generic fallback |
| IVG-F14-04 | OTHER | Live accessibility pass (screen reader + automated scoring) for the F14-specific new surfaces | No AT/axe-core tooling available in this environment | At IVG time | No critical/serious automated violations; new flows operable by keyboard + screen reader |
| IVG-F14-05 | PERFORMANCE | Real navigation/query-latency measurement for the new Exam Prep/Assignments/Institution pages against seeded, realistic data | No authenticated environment available | At IVG time | Documented as a real baseline, not fabricated |
| IVG-F14-06 | REMOTE_DB / OPERATIONS | Confirm the real credential-bearing `f0s-security/.env.local` (see F14_ENVIRONMENT_PROVENANCE_REPORT.md) is rotated or removed | Cannot be verified or acted on without risking the same unverified-connection uncertainty this item is about | Human operator action, outside this session's scope | Credentials confirmed rotated/revoked or the file deleted |

## Discipline

No entry above is silently upgraded to PASS. `IVG-F13-07` is the one item marked RESOLVED this phase, and only with direct code-level evidence cited in its own document — every other carried item remains exactly as open as F13 left it, extended in scope where F14's own new surfaces genuinely widen what it covers.
