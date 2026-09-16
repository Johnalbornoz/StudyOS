# Canonical State Transition Matrix

Legend: **POLICY** = what Policy V2 requires. **CURRENT** = what `src/lib/pedagogical-engine/engine.ts` actually does today (verified by reading the code and, where noted, by an executable test in the audit suite). A row is flagged **⚠ GAP** when POLICY and CURRENT diverge.

| # | Current state | Event | Conditions | POLICY next state | CURRENT next state | Rollback | Wait | Reason code(s) |
|---|---|---|---|---|---|---|---|---|
| 1 | LEARN | LEARN_CHECK submitted | score ≤ 80 | LEARN (unsatisfied) | ✅ matches | — | none | `INSUFFICIENT_SCORE` |
| 2 | LEARN | LEARN_CHECK submitted | score > 80, no misconception | PRACTICE | ✅ matches | — | none | `PASSING_SCORE` |
| 3 | LEARN | LEARN_CHECK submitted | score > 80, item-level misconception | LEARN (unsatisfied) | ✅ matches | — | none | `CRITICAL_MISCONCEPTION` |
| 4 | PRACTICE | 1st valid Practice attempt, score ≥ 80 | only 1 attempt exists | **PRACTICE (unsatisfied)** — 2 of last 3 needed | ⚠ **PROVE (satisfied on 1 attempt)** | — | none | — | **AUDIT-001 (BLOCKER)** |
| 5 | PRACTICE | 3 valid attempts, 2 of last 3 ≥ 80 (e.g. `[100,40,40]`→only 1 of 3) | — | PRACTICE unsatisfied | ⚠ satisfied (any 1 qualifying attempt is sticky) | — | none | — | **AUDIT-001 (BLOCKER)** |
| 6 | PRACTICE | 2 of last 3 valid attempts ≥ 80 | — | PROVE unlocked | ✅ matches in the cases where a single attempt already happens to coincide | — | none | `PASSING_SCORE` |
| 7 | PROVE | Prove submitted, itemCount ≠ 10 | — | UNRESOLVED, never pass/fail | ✅ matches | — | none | `UNRESOLVED_POLICY` |
| 8 | PROVE | Prove submitted, score < 80 (genuine, non-premature) | — | rollback to PRACTICE, requires 2-of-3 requalification | ✅ rollback direction matches; requalification rule itself is AUDIT-001-affected | `PROVE_FAILURE_RETURN_TO_PRACTICE` | none | `FAILED_ATTEMPT` |
| 9 | PROVE | Prove submitted, score ≥ 80, independent, correct contract | RETAIN (WAITING, 3-day gate) | ✅ matches | — | 3 days | `PASSING_SCORE` |
| 10 | RETAIN | before eligibleFrom | any Retain attempt submitted | rejected (TEMPORALLY_INELIGIBLE), status stays WAITING/UNSATISFIED per `now` | ✅ matches | — | remaining | `TEMPORALLY_INELIGIBLE` |
| 11 | RETAIN | 1st Retain attempt at/after eligibleFrom, score < 80 | — | **RETAIN stays reachable; 2nd attempt immediately, new questions, no wait** | ⚠ **immediate rollback to PROVE; a subsequent 2nd attempt is rejected as premature** | ✅(current) `RETENTION_FAILURE_RETURN_TO_PROVE` / ❌(policy) should not rollback yet | policy: none / current: full Prove rebuild | **AUDIT-002 (BLOCKER)** |
| 12 | RETAIN | 2nd **consecutive** Retain failure | — | rollback to PROVE, new 3-day window only after a NEW qualified Prove | ✅ matches (coincidentally, since current always rolls back on any single failure) | `RETENTION_FAILURE_RETURN_TO_PROVE` | new 3-day window after new Prove | `FAILED_ATTEMPT` |
| 13 | RETAIN | qualifying Retain (score ≥80, novel, independent, itemCount=10) | — | TRANSFER unlocked | ✅ matches | — | none | `PASSING_SCORE` |
| 14 | TRANSFER | failure, no special signal (application-weak) | — | stay TRANSFER, immediate retry, no wait | ✅ matches (`CASE_A_TRANSFER_APPLICATION_WEAK`) | `CASE_A_TRANSFER_APPLICATION_WEAK` → TRANSFER | none | `FAILED_ATTEMPT` |
| 15 | TRANSFER | failure, retention-weakness diagnostic | — | rollback to **RETAIN**, immediate retry, no wait | ⚠ **no such case exists at all** — the engine has no signal or rollback target for this | — (structurally impossible today) | — | **AUDIT-003 (BLOCKER)** |
| 16 | TRANSFER | failure, `transferFoundationalFailureIndicated: true` | — | rollback to earliest invalidated (normally PRACTICE) | ✅ matches (`CASE_B_FOUNDATIONAL_FAILURE`, despite the letter mismatch vs. policy's own A/B/C/D naming) | rollback to PRACTICE, locks PROVE/RETAIN | full rebuild required | `FAILED_ATTEMPT`/`MISSING_REQUIRED_REASONING` |
| 17 | TRANSFER | failure, item-level critical misconception | — | rollback to earliest invalidated | ✅ matches (`CASE_C_CRITICAL_MISCONCEPTION` → PRACTICE) | rollback to PRACTICE, locks PROVE/RETAIN | full rebuild required | `CRITICAL_MISCONCEPTION` |
| 18 | TRANSFER | qualifying Transfer (overall ≥80 AND every challenge ≥70) | — | CONSOLIDATED | ✅ matches | — | none | `PASSING_SCORE` |
| 19 | any | live `activeCriticalMisconception=true` | stage would otherwise be ≠ LEARN | forced to PRACTICE, REINFORCE overlay | ✅ matches (blunt global override; underlying `requirements[]` still reflects each stage's own historical satisfaction) | — (no dedicated rollback object; visible only via `reasonCodes`) | none | `CRITICAL_MISCONCEPTION` |
| 20 | any (migration) | legacy recognition seeded for PROVE/RETAIN/TRANSFER from OLD mastery scores, zero real evidence | — | must never happen ("higher stages must not be fabricated") | ⚠ **can happen** — `evaluateLegacyRecognition` computes it and the one apply CLI persists it unfiltered (not yet executed anywhere) | — | — | **AUDIT-004 (BLOCKER)** |

## Summary of gaps in this matrix

- **AUDIT-001** (rows 4–6): PRACTICE has no "2 of last 3" window; a single qualifying attempt is sticky-satisfied.
- **AUDIT-002** (row 11): RETAIN has no two-strike counter; any single failure immediately rolls back to PROVE, denying the policy-mandated immediate second chance.
- **AUDIT-003** (row 15): TRANSFER has no Case B (retention-weakness → RETAIN rollback) at all — neither the diagnostic signal nor the rollback target exists in the type system.
- **AUDIT-004** (row 20): the legacy migration/backfill layer can fabricate PROVE/RETAIN/TRANSFER satisfaction from old mastery scores alone; not yet executed against any real environment.

Every other row in this matrix is verified correct by an executable test in the audit suite (`tests/unit/audit-canon-v2-*.test.ts`).
