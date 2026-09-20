# F15 — Performance Baseline

## What was actually measured (real Preview infrastructure, single-run samples only)

Using `performance.getEntriesByType('navigation')` in a real browser against the real Preview deployment (`https://study-eyk5bqcsj-study-so.vercel.app`), unauthenticated marketing page only (the only page reachable given the Clerk misconfiguration — see F15_PREVIEW_CERTIFICATION.md):

| Run | Locale | TTFB | DOMContentLoaded | Full load | Transfer size |
|---|---|---|---|---|---|
| 1 | `/es` | 63.4ms | 538.9ms | 985.0ms | 7,365 bytes |
| 2 | `/en` | 63.1ms | 355.0ms | 616.3ms | 7,278 bytes |

**These are two single runs, not a percentile and not an average of a real sample size.** No p50/p95 claim is made anywhere in this document — the task's own explicit instruction ("Do not fabricate percentile statistics from tiny samples") is followed literally: 2 data points is not a distribution.

## What was NOT measured (every authenticated flow the task lists)

Student dashboard, Exam Prep page, Readiness request, Exam/session start, Question/session fetch, Answer submission, Final submit, Teacher class roster, Teacher student detail, Institution overview, Institution readiness, Workspace switch — **none of these could be measured**, because every one requires authentication, and Preview's authentication is misconfigured (F15_PREVIEW_CERTIFICATION.md) plus this agent's own categorical restriction on credential entry (F15_AUTHENTICATED_E2E_REPORT.md).

## Query-shape characterization (static, by source inspection — extends F14's own)

- The new `getNextSimulationItem` (item-resolution.service.ts) issues a small, bounded number of queries per item: one `getObjectiveTarget` (PK lookup), one `resolveActivityMetadataForObjective` (3 parallel PUBLISHED-mapping lookups), one `resolveStudentConceptForCanonicalConcept` per candidate canonical concept (bounded by the mapping's own `canonicalConceptIds.length`, typically 1), one `concepts.subject_id` lookup, one AI generation call, one `UPDATE simulation_attempts`. No per-item N+1 loop across the whole exam — each item is resolved independently, on its own request, exactly once (the idempotent re-fetch guard prevents a refresh from re-running this whole chain).
- `getInstitutionDiagnosticSummary`/`getInstitutionInterventionSummary` (this phase's MIN_COHORT_POLICY fix) each added exactly ONE more query (a `COUNT(DISTINCT student_id)` for the cohort-size check) — not a new N+1 pattern, a single additional aggregate query per call.
- No new sequential-call chain was introduced anywhere this phase; every new multi-step resolution (`item-resolution.service.ts`) uses direct, necessary sequential dependencies (each step's input is the previous step's real output — e.g., you cannot resolve a concept before resolving the objective), not an avoidable serialization of independent work.

## Bundle-size characterization

`next build`'s own manifest was inspected; no new third-party dependency was added this phase (only `next` itself was version-bumped for the dependency-security fix — see F15_SECURITY_HARDENING_REPORT.md). New Client Components (`ItemRunner`, `QuestionAnswerFields`) use only React + `next/navigation`, matching every other F13/F14 Client Component's own footprint.

## Load/concurrency characterization

No load testing (against Preview or otherwise) was performed this phase — the same authentication blocker prevents driving multiple concurrent authenticated sessions. Expected bottlenecks, reasoned from the real architecture (not measured):
- **`checkRateLimit`'s in-memory map** (F15_SECURITY_HARDENING_REPORT.md) is per-process — on a multi-instance Vercel deployment, this means the effective rate limit is `limit × instance_count`, not a true global cap. Acceptable for a small, contained pilot; a real gap for anything larger (see F15_RESIDUAL_RISK_REGISTER.md).
- **`db.ts`'s connection pool** uses `pg`'s default max size (10) with a 2s connection timeout and 15s statement timeout — unchanged this phase, reasonable for pilot-scale concurrent Students, untested at real concurrency.
- **AI generation calls** (`generatePracticeQuestions`, now also called from the new exam-item resolution path) are the single most likely latency/cost bottleneck under real concurrent load, already bounded by `operational-limits.ts`'s own per-minute/per-day caps (unchanged, re-verified this phase).

## IVG registration

`IVG-F15-06`: real authenticated-flow latency measurement, once Preview auth is fixed and a safe test identity is available. `IVG-F15-07`: any real concurrency/load characterization beyond static reasoning.
