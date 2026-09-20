# F15-C1 — Technical Debt Triage (2026-09-20)

Evaluates the remaining open backlog against Pilot readiness specifically, per the explicit instruction not to convert every deferred item into code automatically, and to keep Pilot and Production criteria clearly separate. One item was judged worth implementing now (`/api/health`); everything else is deferred below with an explicit owner and closure criterion — none silently dropped.

| Item | IVG / Risk | Pilot-blocking? | Production-blocking? | Decision | Owner | Closure criterion |
|---|---|---|---|---|---|---|
| `TRAINING_TIMED`/`OFFICIAL_SIMULATION_TIMED` enforcement | R4 | Only if timed modes are offered to real pilot users | No | **DEFER** — restrict pilot cohort to `UNTIMED` attempts only (already the phase's own tested path) | Exam-Taking UX | Timer UI + server-side enforcement built and unit-tested before any pilot user is offered a timed mode |
| Institution structure/exam-version picker | IVG-F14-02 | Yes, for real institution-admin usability | No | **DEFER** — acceptable if the pilot's institution admins are operator-assisted during onboarding | Institution Intelligence | A real picker UI backed by a real curriculum/exam-version list endpoint |
| Per-question exam-result breakdown | R11 | No | No | **DEFER** — data (`byComponent`) already exists and is ready; UI surfacing is a pure enhancement | Exam-Taking UX | UI built consuming the existing `getSimulationScoreSummary` data |
| Correlation ID end-to-end | IVG-F15-05 | No | Yes, for real incident debugging at scale | **DEFER** — acceptable for a small, closely-watched pilot where logs are read manually | Observability | Correlation id generated at request entry and threaded through every downstream log call |
| `/api/health` | IVG-F15-13 | No (but cheap and valuable) | Yes | **DONE this sub-phase** — see `src/app/api/health/route.ts` | Operations | Closed |
| Monitoring/alerting/incident comms | IVG-F15-11 | No | Yes | **DEFER** — acceptable for a pilot the operator watches directly; no tooling exists to wire up cheaply | Operations | A real paging/alerting integration (e.g. on top of the new `/api/health`) |
| Kill switches beyond `AI_ENABLED` | IVG-F15-12 | No | Yes, beyond a small pilot | **DEFER** — `AI_ENABLED=false` already provides real partial containment for the highest-risk (AI-generation) failure mode | Operations | Dedicated flags for Exam Prep / Teacher assignments / Institution Intelligence |
| Distributed rate limiting | R5 | No | Yes, beyond a small pilot | **DEFER** — acceptable at single/low-instance pilot scale (per-process limit is real, just not multi-instance-aware) | Rate limiting / infra | Redis-backed (or equivalent) shared limiter |
| Backup/restore drill + RPO/RTO | IVG-F15-10 / R6 | Recommended, not a hard code-level gate | Yes | **DEFER, but recommend before real pilot data accrues** — this is an operator/infra action, not a code change | Database operations | Operator identifies the DB provider's own backup offering and rehearses one real restore |
| Authenticated-flow latency | IVG-F15-06 | Yes, for full confidence | Yes | **PENDING E2E** — no longer blocked by Clerk; will be measured as part of the authenticated E2E session (Section 2C) | QA | Real latency numbers captured during the authenticated E2E run |
| Concurrency/load characterization | IVG-F15-07 | No, for a small pilot cohort | Yes, beyond small pilot | **DEFER** | Performance | A real load test against Preview at realistic pilot concurrency |
| Authenticated responsive certification | IVG-F15-08 | Yes, for full confidence | No | **PENDING E2E** — will be checked live during the authenticated E2E session using the existing 3-width methodology from the unauthenticated check | QA | 3 widths checked live on every authenticated page |
| Real AT verification of `aria-live` fix | IVG-F15-09 | No | Yes, for a genuine accessibility certification | **DEFER** — code-level fix already shipped and follows standard practice | Accessibility | Live screen-reader confirmation |
| Two-real-session cache/context isolation | IVG-F13-05 | Yes, for full confidence | Yes | **PENDING E2E** — this is exactly what the authenticated E2E session's multi-role/cache-isolation cases will exercise | QA | Two real concurrent authenticated sessions confirmed not to leak context |
| Real AI provider + network-retry recovery | IVG-F9-01 / IVG-F9-03 | No | Yes | **DEFER** — existing AI gateway timeout/cost-cap/allowlist controls already re-verified working (F15); this item is about a live network-partition rehearsal specifically | AI Gateway | A real, observed recovery from an injected network-level retry against the real provider |

## Summary

- **1 item closed this sub-phase**: `/api/health`.
- **4 items are not deferred but PENDING** — they roll directly into the authenticated E2E session already planned next (Section 2C of this closure): authenticated latency, authenticated responsive, cache/context isolation, and (implicitly) real authenticated-flow defect-finding.
- **10 items remain DEFERRED**, each with a named owner and an explicit, checkable closure criterion — none converted into speculative code this sub-phase, per the instruction to prioritize only what Pilot actually needs.
- **Pilot vs Production separation preserved throughout**: several items (distributed rate limiting, kill switches, monitoring/alerting, concurrency/load) are explicitly marked acceptable for a *small, closely-operator-watched pilot* while still flagged as real Production requirements — the two bars are not conflated anywhere in this table.
