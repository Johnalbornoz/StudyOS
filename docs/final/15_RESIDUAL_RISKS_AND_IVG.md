# 15 — Residual Risks and IVG (Issue/Verification Gap) Register

**Reconciliation rule**: every item below has exactly ONE current state. Where a finding was later resolved, the historical finding is preserved (so nothing is silently erased from the record) but clearly marked superseded, with the reason it no longer applies — never left ambiguous between two states.

## Hard gates (block Pilot on their own, regardless of everything else)

| ID | Description | Current state | Evidence |
|---|---|---|---|
| R1 / `IVG-F14-06` / `IVG-F15-01` | 5 credentials in a local, never-committed `.env.local` remain un-rotated | **OPEN — `OPERATOR_ACTION_REQUIRED`** — **[FASE 0 FREEZE, 2026-09-21]: "sole remaining hard gate" is retracted, not merely re-worded.** A manual exam-flow test the same day showed the seeded exam catalog fails to produce a usable exam (`MINI_MOCK`, 1 question, "no equivalent concept found", skip-only) — a second, independent Pilot blocker that exists regardless of credential rotation. See `docs/implementation/f15/F15_PHASE0_ACCEPTANCE_FREEZE.md` for the full reconciliation and the newly-frozen `NOT_CERTIFIED` states for roles/student-license/parent/teacher/institution/multi-role. | [08_SECURITY_AND_PRIVACY.md](08_SECURITY_AND_PRIVACY.md) |

## Resolved (superseded historical findings — preserved, not deleted)

| ID | Historical finding | Why it no longer applies | Evidence |
|---|---|---|---|
| R2 / `IVG-F15-02` | Preview's Clerk configuration resolved to an unrelated application ("PMO OWN") | Operator corrected the Preview-scope Clerk keys (Production untouched); re-verified live and independently on **three separate subsequent deployments**, each correctly showing "Sign in to StudyOS_App" with Development mode | [08_SECURITY_AND_PRIVACY.md](08_SECURITY_AND_PRIVACY.md), [09_DEPLOYMENT_ENVIRONMENTS_AND_RELEASE.md](09_DEPLOYMENT_ENVIRONMENTS_AND_RELEASE.md) |
| `IVG-F7-01` | Remote Preview database's migration state was unverified since F7 | Repaired in place (15→32 migrations) and independently re-verified live via a temporary diagnostic route, twice | [03_DATABASE_SCHEMA_AND_MIGRATIONS.md](03_DATABASE_SCHEMA_AND_MIGRATIONS.md) |
| `IVG-F12-02` | F12's own migration's clean application to the real Preview database was unconfirmed | Confirmed present and applied in the same repair batch; all 16 real-Postgres regressions (including the F12 cert script) still pass | [03_DATABASE_SCHEMA_AND_MIGRATIONS.md](03_DATABASE_SCHEMA_AND_MIGRATIONS.md) |
| `IVG-F13-01` | No official Preview deployment existed | A real, repeatable Preview pipeline exists and boots correctly | [09_DEPLOYMENT_ENVIRONMENTS_AND_RELEASE.md](09_DEPLOYMENT_ENVIRONMENTS_AND_RELEASE.md) |
| `IVG-F13-07` | Live drill-down of F9 reasonCodes in a Teacher-facing error | Resolved in F14 — generic error handling and an unmapped error type both fixed | `docs/implementation/f14/` |
| `IVG-F14-01` | Full item-by-item exam-taking UX did not exist | Built in F15, 11 unit tests, real UI | [06_EXAM_READINESS_AND_INTERVENTIONS.md](06_EXAM_READINESS_AND_INTERVENTIONS.md) |
| `IVG-F12-04` | MIN_COHORT_POLICY was an undecided product question | Resolved with a real, versioned, documented decision (minimum 10) | [06_EXAM_READINESS_AND_INTERVENTIONS.md](06_EXAM_READINESS_AND_INTERVENTIONS.md) |
| `IVG-F15-13` | No `/api/health` endpoint existed | Implemented, tested, live-verified | [10_OPERATIONS_MONITORING_AND_INCIDENTS.md](10_OPERATIONS_MONITORING_AND_INCIDENTS.md) |

## Open, deferred with explicit owner and closure criterion (none Pilot-blocking on their own)

| ID | Description | Owner | Closure criterion | Pilot-blocking? | Production-blocking? |
|---|---|---|---|---|---|
| R3 / `IVG-F15-03` | Full authenticated E2E unexecuted | QA | Execute the matrix in [13_PILOT_RUNBOOK.md](13_PILOT_RUNBOOK.md) | Yes — in progress | Yes |
| R4 | Timed exam modes accepted but not enforced/displayed | Exam-Taking UX | Timer UI + server-side enforcement built and tested | Only if timed modes are offered | No |
| R5 / rate limiting | Per-process, not distributed | Rate limiting/infra | Shared (Redis-backed) limiter | No, small pilot scale | Yes |
| R6 / `IVG-F15-10` | No backup/restore automation, no RPO/RTO | Database operations | Operator rehearses one real restore | Recommended, not hard-gated | Yes |
| `IVG-F15-05` | Correlation ID not end-to-end | Observability | Wired through every downstream log call | No | Yes |
| `IVG-F15-11` | No paging/alerting tooling | Operations | Real alerting integration | No | Yes |
| `IVG-F15-12` | No kill switch beyond `AI_ENABLED` | Operations | Feature-level flags | No | Yes, beyond small pilot |
| `IVG-F15-06` | Authenticated-flow latency unmeasured | QA | Rolls into the E2E session | Yes, for full confidence | Yes |
| `IVG-F15-07` | Real concurrency/load unmeasured | Performance | A real load test at Production concurrency | No, small cohort | Yes |
| `IVG-F15-08` | Authenticated responsive uncertified | QA | Rolls into the E2E session | Yes, for full confidence | No |
| `IVG-F15-09` | No real assistive-technology verification | Accessibility | Live screen-reader confirmation | No | Yes, for a genuine accessibility certification |
| `IVG-F13-05` | Two-real-session cache/context isolation unexercised | QA | Rolls into the E2E session | Yes, for full confidence | Yes |
| `IVG-F9-01` / `IVG-F9-03` | Real AI-provider network-retry recovery unrehearsed | AI Gateway | A real, observed recovery from an injected network-level retry | No | Yes |
| `IVG-F14-02` | No curriculum/exam-version picker for Institution | Institution Intelligence | Real picker UI + list endpoint | Yes, for real admin usability | No |
| R11 | Per-question exam-result breakdown UI minimal | Exam-Taking UX | UI built on already-real `byComponent` data | No | No |

## Explicitly NOT a residual risk (proven, not assumed)

- Zero domain behavior regressed across 16 phases — every prior real-Postgres certification re-run and passing at every subsequent phase.
- No secret has ever been exposed, printed, or committed to git by any action in this program's history (verified directly, repeatedly).
- No migration has ever dropped or destructively altered an existing column.
- No live/authenticated result has ever been declared PASS without actually executing it.
- The Preview database migration gap and the Preview Clerk misconfiguration are both now closed with independently re-verified live evidence, not operator assertion alone.

## Totals (this package, 2026-09-20)

```
Hard gates remaining:      1  (credential rotation)
Resolved this program:     8  (listed above, historical findings preserved)
Open/deferred, non-blocking-alone: 15 (listed above, each with owner + closure criterion)
Fabricated or silently-upgraded findings: 0
```
