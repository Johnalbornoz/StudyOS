# Canonical Audit Test Matrix

**Baseline (pre-audit, unmodified):** `npx vitest run` → 255 test files, 4637 tests, all passing.

**Post-audit (test-only additions, zero production code changed):** 262 test files, 4724 tests — **4716 passing, 8 failing**. The 8 failures are the audit's own evidence trail for two confirmed BLOCKER findings (AUDIT-001, AUDIT-002); every other new test passes, confirming the areas it covers are policy-compliant. No pre-existing test was modified or weakened.

New files, all under `tests/unit/audit-canon-v2-*.test.ts`:

| File | Tests | Pass | Fail |
|---|---|---|---|
| `audit-canon-v2-practice-consistency.test.ts` | 19 | 12 | 7 |
| `audit-canon-v2-retain-two-strike.test.ts` | 12 | 11 | 1 |
| `audit-canon-v2-transfer-classification.test.ts` | 11 | 11 | 0 |
| `audit-canon-v2-learn-prove-misconception.test.ts` | 22 | 22 | 0 |
| `audit-canon-v2-legacy-fabrication.test.ts` | 6 | 6 | 0 |
| `audit-canon-v2-feature-gate-and-ui-authority.test.ts` | 10 | 10 | 0 |
| `audit-canon-v2-full-scenarios.test.ts` | 7 | 7 | 0 |
| **Total** | **87** | **79** | **8** |

## A. Policy truth tables / boundary matrix

| ID | Area | Fixture | Expected (Policy V2) | Actual | Status |
|---|---|---|---|---|---|
| A-01 | LEARN | score 79 | UNSATISFIED | UNSATISFIED | PASS |
| A-02 | LEARN | score 80 (exclusive bar) | UNSATISFIED | UNSATISFIED | PASS |
| A-03 | LEARN | score 81 | SATISFIED | SATISFIED | PASS |
| A-04 | LEARN | score 100 | SATISFIED | SATISFIED | PASS |
| A-05 | LEARN | wrong activity type, score 100 | UNSATISFIED | UNSATISFIED | PASS |
| A-06 | LEARN | score 100 + item misconception | UNSATISFIED | UNSATISFIED | PASS |
| A-07 | LEARN | global misconception active, stage would be LEARN | stays LEARN, no override | stays LEARN | PASS |
| A-08 | PRACTICE | `[85,90]` | SATISFIED | SATISFIED | PASS |
| A-09 | PRACTICE | `[90,50,85]` | SATISFIED | SATISFIED | PASS |
| A-10 | PRACTICE | `[100,40,40]` (policy's own example) | UNSATISFIED | **SATISFIED** | **FAIL — AUDIT-001** |
| A-11 | PRACTICE | `[40,90,60]` (policy's own example) | UNSATISFIED | **SATISFIED** | **FAIL — AUDIT-001** |
| A-12 | PRACTICE | `[80,80]` | SATISFIED | SATISFIED | PASS |
| A-13 | PRACTICE | `[80,79]` | UNSATISFIED | **SATISFIED** | **FAIL — AUDIT-001** |
| A-14 | PRACTICE | `[79,80,80]` | SATISFIED | SATISFIED | PASS |
| A-15 | PRACTICE | `[80,79,80]` | SATISFIED | SATISFIED | PASS |
| A-16 | PRACTICE | `[79,79,100]` | UNSATISFIED | **SATISFIED** | **FAIL — AUDIT-001** |
| A-17 | PRACTICE | `[40,100,100]` | SATISFIED | SATISFIED | PASS |
| A-18 | PRACTICE | `[100,100,40]` | SATISFIED | SATISFIED | PASS |
| A-19 | PRACTICE | `[40,40,100,100]` | SATISFIED | SATISFIED | PASS |
| A-20 | PRACTICE | exactly 1 attempt, score 100 | UNSATISFIED (need ≥2 attempts) | **SATISFIED** | **FAIL — AUDIT-001** |
| A-21 | PRACTICE/PROVE | consequence of A-20 | PROVE LOCKED | **PROVE UNLOCKED** | **FAIL — AUDIT-001** |
| A-22 | PRACTICE | `[79,80]` prefix | UNSATISFIED | **SATISFIED** | **FAIL — AUDIT-001** |
| A-23 | PROVE | 7/10 | UNSATISFIED, rollback to PRACTICE | UNSATISFIED, rollback | PASS |
| A-24 | PROVE | 8/10 | SATISFIED | SATISFIED | PASS |
| A-25 | PROVE | 9/10 | SATISFIED | SATISFIED | PASS |
| A-26 | PROVE | 10/10 | SATISFIED | SATISFIED | PASS |
| A-27 | PROVE | itemCount 9 or 11 | UNRESOLVED_POLICY | UNRESOLVED_POLICY | PASS |
| A-28 | PROVE | assisted | never qualifies | never qualifies | PASS |
| A-29 | PROVE | 9/10 + item misconception | blocked | blocked | PASS |
| A-30 | PROVE | retry after failure, requalify, new Prove pass | SATISFIED, old fail preserved | SATISFIED, old fail preserved | PASS |
| A-31 | PROVE | failed Prove never becomes qualifying later | confirmed | confirmed | PASS |
| A-32 | RETAIN | before 3 days | WAITING + nextEligibleAt | WAITING + nextEligibleAt | PASS |
| A-33 | RETAIN | exactly 3 days | eligible (UNSATISFIED) | eligible | PASS |
| A-34 | RETAIN | after 3 days | eligible | eligible | PASS |
| A-35 | RETAIN | attempt before gate | TEMPORALLY_INELIGIBLE, non-qualifying | TEMPORALLY_INELIGIBLE | PASS |
| A-36 | RETAIN | non-novel attempt | never qualifies | never qualifies | PASS |
| A-37 | RETAIN | Retain1 pass directly | SATISFIED | SATISFIED | PASS |
| A-38 | RETAIN | Retain1 fail, Retain2 pass (new q's, same day) | SATISFIED, PROVE untouched | **LOCKED, PROVE invalidated** | **FAIL — AUDIT-002** |
| A-39 | RETAIN | Retain1 fail, Retain2 fail (2 consecutive) | rollback to PROVE | rollback to PROVE | PASS (coincidental — current always rolls back on strike 1) |
| A-40 | RETAIN | new Prove pass after hard failure | new 3-day window from zero | new 3-day window from zero | PASS |
| A-41 | TRANSFER | 80/80/80 (overall 80, all ≥70) | SATISFIED | SATISFIED | PASS |
| A-42 | TRANSFER | 95/95/60 | FAIL (per-challenge floor) | FAIL | PASS |
| A-43 | TRANSFER | 70/70/70 | FAIL (overall floor) | FAIL | PASS |
| A-44 | TRANSFER | Case A (application-weak) | stay TRANSFER, immediate retry | stay TRANSFER, immediate retry | PASS |
| A-45 | TRANSFER | Case B (retention-weakness) | rollback to RETAIN, immediate retry | **no such case exists** | **STRUCTURAL FAIL — AUDIT-003** (proven by source audit, not a runtime assertion) |
| A-46 | TRANSFER | Case C (foundational) | rollback to earliest invalidated (PRACTICE) | rollback to PRACTICE, locks PROVE/RETAIN | PASS (directionally correct; letter-name mismatch only) |
| A-47 | TRANSFER | Case D (misconception) | rollback to earliest invalidated | rollback to PRACTICE | PASS |
| A-48 | TRANSFER | Case A never restarts 3-day wait | PROVE/RETAIN untouched | PROVE/RETAIN untouched | PASS |

## B. Evidence qualification / adapter

| ID | Area | Status |
|---|---|---|
| B-01 | REINFORCE overlay does not corrupt Practice qualification (regression guard, Section 10 exact sequence) | PASS |
| B-02 | Per-attempt `hasCriticalMisconception` structurally dead in production (no source column selected) | CONFIRMED — AUDIT-005 (P1) |
| B-03 | Global misconception resolution requires dedicated EXPLANATION/SOLO_VERIFICATION evidence, never score alone | PASS |

## C/D. Stage transition & rollback tests

Covered by section A above (A-23 through A-48) plus the full-scenario replays below.

## E/F. Retry & waiting/time tests

Covered by A-30/A-31 (Prove retry), A-32–A-40 (Retain timing/two-strike), A-38/A-39 (RETAIN retry).

## G/H. Critical misconception & Reinforce overlay tests

A-06, A-07, A-29, A-46/A-47, B-01, B-02, B-03.

## I/J. Persistence/adapter & contract authorization tests

Evidence Contract Matrix (separate deliverable) plus:

| ID | Area | Status |
|---|---|---|
| J-01 | `isCanonicalEngineV1Enabled` hard-FALSE in Production regardless of config | PASS |
| J-02 | Never "on by default" with no config | PASS |
| J-03 | FALSE unless config flag is exactly `'true'` | PASS |
| J-04 | TRUE only in non-production with the exact flag | PASS |
| J-05–08 | All 4 real call sites (session/start, generate-and-take, ConceptMission, Today) gate on the SAME function | PASS |

## K. Legacy/migration tests

| ID | Area | Status |
|---|---|---|
| K-01 | `evaluateLegacyRecognition` can grant PROVE/RETAIN/TRANSFER from OLD scores alone, zero real evidence | CONFIRMED — AUDIT-004 (BLOCKER) |
| K-02 | `buildPedagogicalMigrationBaseline` propagates all of these, not just LEARN | CONFIRMED |
| K-03 | The engine treats a persisted `LEGACY_POLICY_RECOGNITION` PROVE/RETAIN/TRANSFER as real SATISFIED, reaching CONSOLIDATED with zero `learning_evidence` rows | CONFIRMED |
| K-04 | The apply CLI passes recognitions unfiltered to `applyRecognitions` | CONFIRMED |
| K-05 | The CLI's own dry-run counters already track higher-stage counts (a live, exercised code path) | CONFIRMED |
| K-06 | Mitigating: migration/CLI never executed in any real environment (self-documented) | CONFIRMED |

## L. Prepared activity/cache tests

Not re-implemented in this audit — already exhaustively covered by `tests/unit/canon-r6-perf-r2-prove-pregeneration.test.ts` and `tests/unit/canon-r6-perf-r2r1-stale-preparation-recovery.test.ts` (both pre-existing, both green in the baseline). This audit independently re-verified, by reading `generate-and-take/route.ts` and `canonical-prepared-activity.service.ts`, that:
- pre-generation triggers only on a **fresh canonical decision** of `stage=PROVE && actionState=EXECUTABLE`, never on a raw Practice score (**PASS**);
- consumption re-verifies a fresh canonical decision, contract compatibility, and fresh novelty **before** ever trusting a prepared row (**PASS**);
- expired/stale rows are retired before a new preparation attempt (**PASS**, CANON-R6-PERF-R2R1, already certified this session).

## M. Concurrency/idempotency tests

Not re-run in this audit — `quiz-persistence.service.ts`'s `operationKey`-based idempotency (Phase 2B) and the prepared-activity unique-index + `ON CONFLICT DO NOTHING` pattern were both verified by source reading and are already covered by pre-existing, passing tests.

## N. UI canonical authority tests

| ID | Area | Status |
|---|---|---|
| N-01 | ConceptMission applies the ONE AUTHORITY RULE override when the gate is on | PASS (verified by source reading; not independently re-tested here — pre-existing coverage) |
| N-02 | Today snapshot applies the same override pattern | PASS (source-verified) |
| N-03 | `canonical-learning-progress.ts` ("the single canonical learning-progress read model") has zero wiring to the canonical engine | CONFIRMED — AUDIT-006 (P1, needs product/eng verification of its consumers) |

## O. Full scenario/replay tests

| ID | Scenario | Status |
|---|---|---|
| O-01 | Scenario 1 — Happy path, every stage transition, final CONSOLIDATED with all-V1_EVIDENCE basis | PASS |
| O-02 | Scenario 3 — Prove failure → requalification → new Prove pass, failed Prove preserved | PASS |
| O-03 | Scenario 10 — Real regression sequence (Practice 100, Prove 50, Practice 67, Practice 100) | PASS (final state matches; see AUDIT-001 for why this specific sequence is not decisive proof on its own) |
| — | Scenarios 2, 4, 5, 6, 7, 8, 9 | Covered by A-08–A-22 (Practice), A-38–A-40 (Retain), A-44–A-48 (Transfer), A-06/A-07 (misconception) respectively — not separately re-narrated as end-to-end replays to avoid duplicate coverage |
