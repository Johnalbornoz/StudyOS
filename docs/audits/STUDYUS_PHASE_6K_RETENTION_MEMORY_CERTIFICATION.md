# StudyUs Phase 6K — Retention & Memory Engine: Full Certification

**Date**: 2026-09-05 (6K), updated 2026-09-05 (6K-R closure)
**Scope**: End-to-end certification of Phase 6A–6J-C (the Retention & Memory Engine) and a readiness determination for a *separate, future* production release step. Step 6K-R closed 6K's one open condition (the E2E harness) without touching any product code.
**Status: CERTIFIED** (was `CERTIFIED_WITH_CONDITIONS` after 6K; the one condition — the historical E2E harness's Retention assertions and cleanup — is now resolved; see §19).
**Deployment status**: **NOT DEPLOYED. NOT PRODUCTION-ACTIVE.** Nothing in Phase 6 has been committed, pushed, applied to production, or backfilled. Production database status remains **6 applied, 1 pending (`20260906_1000_phase6_memory_state`), 0 drifted** — unchanged throughout this entire certification, including 6K-R.

This document distinguishes four states explicitly, and never conflates them:

| State | Meaning |
|---|---|
| **IMPLEMENTED LOCALLY** | Code exists in the working tree, uncommitted |
| **CERTIFIED LOCALLY** | Proven correct via isolated/ephemeral Postgres + unit tests + read-only production preview |
| **DEPLOYED** | Committed, pushed, merged — **has not happened for any Phase 6 artifact** |
| **PRODUCTION-ACTIVE** | The Phase 6 migration is applied and backfilled in production, and canonical reads are live for real users — **has not happened** |

Phase 6 is **CERTIFIED LOCALLY**. It is not DEPLOYED and not PRODUCTION-ACTIVE.

---

## 1. Phase 6 Objective

Build one canonical, deterministic, non-AI memory/retention model that:
- separates **evidenced** retention (`demonstratedRetentionScore` — "has the student proven they still know this") from **predicted** retrievability/forgetting risk (`retrievabilityNow`/`forgettingRisk` — "how likely is unaided recall right now"), and
- migrates every consumer (Phase 2 gate, Phase 4 WHAT, Digital Learning Twin, Learning Debt, Subject/Topic display) onto this model, retiring legacy formulas one governed step at a time.

## 2. Canonical Architecture

```
learning_evidence (raw source of truth)
        │
        ▼
normalizeMemoryEvidence()          [src/lib/algorithms/memory-model.ts — pure]
        │  (fails closed on missing/invalid metadata.activityType)
        ▼
projectMemoryStateFromEvidenceDetailed()   [pure replay, timestamp ASC/evidenceId ASC]
        │
        ▼
MemoryState  (concept_memory_state row)
        │                                    computeLiveMemorySignals()
        │                                    (retrievabilityNow/forgettingRisk/
        │                                     retentionDue/predictionConfidence —
        │                                     computed live, never persisted)
        ▼
memory-read.service.ts  (single shared read boundary)
   ├─ Phase2MemoryInput          → knowledge-state.service.ts (gate)
   ├─ Phase4MemorySignal         → adaptive-learning-orchestrator.service.ts (WHAT)
   ├─ TwinMemorySignal           → learner-twin/{readers,service}.ts (display)
   └─ CanonicalMemorySignal      → learning-debt / topic-hierarchy / subject aggregates
```

**Authority boundaries** (certified in Section 3 below): Phase 6 owns memory (demonstrated + predicted); Phase 2 owns the mastery gate; Phase 4 owns WHAT/activity selection; the Twin is read/aggregation only.

## 3. Memory Policy v1

Frozen, single version (`src/lib/memory-policy.ts::MEMORY_POLICY_V1`), verified against both the source constant and the migration's seed row (`tests/unit/memory-policy-db-consistency.test.ts`, parses the SQL fixture without a DB connection): policy version 1; minimum retention gap 3 days; max demonstrated-retention evidence 5 (recency weights `[1.0, 0.8, 0.64, 0.512, 0.4096]`, decay 0.8); difficulty/cognitive weighting disabled (documented no-ops, both `1.0`/`false`); stability thresholds 1 success → DEVELOPING, 3 successes → STABLE (0 → UNSTABLE, implicit); review sequence `[3, 4, 7, 14, 28, 56, 84]` days, min 3 / max 84; retrievability decay constant `k = 0.7`. Not tuned in any Phase 6 step.

## 4. Evidence Qualification & Demonstrated Retention

A **competence anchor** is any correct, unassisted INDEPENDENT/ASSESSMENT-mode event (broader than the qualifying-attempt list, by design). A **qualified retention attempt** is one of six specific activity types (`RETENTION_CHECK, SOLO_CHECK, SOLO_VERIFY, TRANSFER, CUMULATIVE_ASSESSMENT, MOCK_EXAM`), occurring at least the policy gap past the last qualifying reference point. `PRACTICE`/`REVIEW`/`DIAGNOSTIC_CHECK` never qualify, regardless of gap. `demonstratedRetentionScore` is a recency-weighted average of the last 5 qualifying attempts' `scorePercent`; PARTIAL and FAILURE outcomes are qualified attempts (they reset the consecutive-success streak and advance spacing) but are never proof of retention themselves — only qualifying **SUCCESS** outcomes raise the score. Canonical `ActivityType` is read exclusively from `learning_evidence.metadata.activityType`; the unreliable top-level `activity_type` column is never read by the normalizer (proven by a dedicated test).

## 5. Memory Stability, Retrievability, Forgetting Risk, Scheduling

`MemoryStability` (UNSTABLE/DEVELOPING/STABLE) is a pure function of the consecutive-qualifying-success streak — event-driven only, never mutated by elapsed time alone. `retrievabilityNow`/`forgettingRisk`/`daysOverdue`/`predictionConfidence` are computed **live**, on every read, from `(lastSuccessfulRetentionAt ?? initialCompetenceAnchorAt, consecutiveQualifyingSuccesses, now)` — never persisted, never influence `MemoryState` itself. `nextReviewAt` advances on every qualifying attempt (success or not) per the review-interval lookup table.

## 6. Projector (`memory-projector.service.ts`)

Runs inside the caller's own transaction (`mastery.service.ts::updateMastery`), never opens its own BEGIN/COMMIT. Sees the same call's own just-inserted (still uncommitted) evidence row. A rollback of the enclosing transaction rolls back the projection with it. Skips the write entirely when the freshly-replayed state is identical to what's persisted (no `updated_at` churn, no audit noise). Always upserts on the *first* projection for a pair — even a fully `NOT_ESTABLISHED` row is a legitimate first row — which is the reason every concept that has ever received *any* evidence now has a `concept_memory_state` row (see Section 15's E2E finding).

## 7. Backfill (`knowledge-state-backfill.service.ts` / dry-run preview)

Default `dryRun: false` requires an explicit opt-in for a real (non-preview) run; keyset-resumable cursor (`student_id, concept_id`); idempotent upsert (re-running finds zero candidates the second time — proven in isolated validation); never fabricates a historical `decision_events` transition (`skipAudit` semantics unchanged); never mutates source evidence, Mastery, or Knowledge State outside the one projected row. The dry-run preview (`previewOne`, migrated in Step 6J-B2) reconstructs state via a pure replay of `learning_evidence` directly — it never reads `concept_memory_state`, so it produces a correct answer even before backfill/live projection has ever run for a pair.

## 8. Phase 2 Integration

`recalculateConceptKnowledgeState` sources the Retention dimension exclusively from `getPhase2MemoryInput(...).demonstratedRetentionScore` — a direct passthrough, no transformation, no second weighting, no fallback. A missing `concept_memory_state` row is an invariant violation (the live path always runs the projector first, in the same transaction) and is allowed to throw, rolling back rather than silently substituting a legacy value. `classifyRetention()` no longer exists (deleted Step 6J-B2). `minimum_retention` remains exclusively Phase 2's own threshold. Predicted fields (`forgettingRisk`, `retrievabilityNow`) are structurally excluded from `Phase2MemoryInput`'s type — a compile-time guarantee, not just a convention.

## 9. Phase 4 Integration

`adaptive-learning-orchestrator.service.ts` is the sole IO layer; `adaptive-learning-policy.ts` is the sole ranking/BAND authority. `RETENTION_REVIEW_DUE` and `FORGETTING_RISK` signals source from `getPhase4MemorySignalsForStudent` (one batch query per student) — never from `mastery_records.next_review_date` or the legacy `spaced-repetition.ts` formula. `WAITING_FOR_RETENTION` remains Phase 2's own `validationReadiness` output. BAND values, ranking, activity-selection policy, `FORGETTING_RISK_THRESHOLD` (50), and `RETENTION_REVIEW_LOOKAHEAD_DAYS` (7) are all unchanged from their Step 6H-B values.

## 10. Digital Learning Twin Integration

`ConceptView.memory` (the full Phase 6 detail) and `SubjectView.memorySummary`/`LearnerModel.memoryOverview` (batch aggregates, null-excluding) are built exclusively from `TwinMemorySignal`. `RetentionSignal` (the older, narrower type) keeps `retentionScore` as the Knowledge State mirror; `forgettingRisk`/`nextReviewAt` remain Phase-6-sourced and are retained *specifically* because `getDecisionContext` still constructs `DecisionContext.retention` from them for three real consumers (`remediation.service.ts`, `cognitive-diagnosis.service.ts`, `tutor-strategy.service.ts`); `lastRetrievalAt` was deleted in 6J-B2 (zero readers anywhere). `demonstratedRetentionScore` and `retrievabilityNow` are never conflated; `memoryStatus` and `masteryState` are separate enums population from separate authorities.

## 11. Learning Debt / Subject / Topic Hierarchy

Migrated in 6J-B1 onto `CanonicalMemorySignal` (a neutral read excluding both `demonstratedRetentionScore` and any priority/rank field). `daysSinceLastSuccessfulRetention`/`forgettingRisk` are `number | null`; null is never fabricated as 0/Infinity/100 and never treated as "satisfied." Recent `mastery_records` practice alone is explicitly **not** retention proof — only a genuine `lastSuccessfulRetentionAt` counts.

## 12. Legacy Retirement Boundary — the central 6J-C finding

Steps 6H-A/6J-A's original "zero callers" audits searched only `src/app`/`src/services` and were **factually incomplete** — they missed `scripts/`, `tests/`, and a prior phase's own permanent-fixture contract. The corrected, precise statement, certified fresh in this step:

| Symbol | Production authority | Retained because |
|---|---|---|
| `classifyRetention` | — (deleted, 6J-B2) | n/a |
| `getLearnerConceptState` | **NO** | Phase 1C-R's own **permanent** before/after regression fixture (`docs/audits/STUDYUS_PHASE_1C_R_CANONICAL_CONSUMER_CLOSURE.md` §10), enforced by `canonical-learner-model-boundary.test.ts` (scoped to `src/` only); also called by `scripts/e2e-cognitive-loop.ts` (a caller that doc never accounted for) |
| `getRetention` | **NO** | sole caller is `getLearnerConceptState`, above |
| `today-plan.service.ts` (`getTodayPlan`/`getBestNextAction`) | **NO** | zero `src/app`/`src/services` importers (confirmed fresh); sole real caller is `scripts/e2e-cognitive-loop.ts`, wired to `npm run test:e2e` |
| Scheduler `RETENTION_REVIEW_DUE`/`getRetentionDue` | **NO** | orchestrator explicitly skips this `DueItemType` since Step 6H-B; sole real consumer is the same e2e script |
| `calculateForgettingRisk` | **NO** | callers are `today-plan.service.ts` and `getRetention`, both above |
| `calculateReviewIntervalDays` | **YES, partially** | also called internally by `calculateNextReviewDate` (production, `mastery.service.ts:455`) — this one export has a genuine live role, alongside its fixture-only callers |
| `calculateNextReviewDate` | **YES** | production compatibility writer for `mastery_records.next_review_date` |
| `priority-engine.service.ts`, `WhyThis.tsx` v1 | — (deleted, 6J-B2) | zero callers anywhere, including scripts |

**`LEGACY_PRODUCT_MEMORY_AUTHORITY_REMAINS = NO`** — every retained item above is a documented permanent fixture, a manual dev/E2E script, or (for `calculateReviewIntervalDays`) a compatibility writer — never a live decision or display path.

## 13. Production Impact — Read-Only Snapshot (this step, fresh)

```
TOTAL_LEARNING_EVIDENCE_ROWS = 15
PAIRS_TOTAL = 5
PAIRS_WITH_COMPETENCE_ANCHOR = 1
QUALIFIED_RETENTION_ATTEMPTS_TOTAL = 0
RETENTION_PROOFS_TOTAL = 0
CURRENT_VALIDATED_MASTERY_COUNT = 0
```
Production carries a tiny amount of real data and currently has **zero** `VALIDATED_MASTERY` concepts — so the Step 6G grandfathering rule does not apply today. This can change before an eventual release step; the gate must be re-run immediately before any real cutover.

## 14. Migration Status

The Phase 6 migration (`database/migrations/20260906_1000_phase6_memory_state.sql`) is **pending** in production (unchanged: 6 applied, 1 pending, 0 drifted) and was **not applied** in this step. It was validated fresh, this step, against a disposable ephemeral Postgres instance: clean apply, reproducible (a second `db-migrate.ts` run is a clean no-op), `memory_policies` v1 seed row matches `MEMORY_POLICY_V1` exactly, `concept_memory_state`'s FK constraints (student_id/concept_id → `students`/`concepts`), CHECK constraints (`memory_status` enum, `demonstrated_retention_score` 0–100 range), and `UNIQUE(student_id, concept_id)` were all proven to correctly reject bad data.

## 15. Test / Certification Evidence

- `npx tsc --noEmit`: **clean**.
- `npx vitest run`: **114 test files, 1631 tests, all passing**.
- `npm run build`: **clean**, no warnings.
- `npm run db:repro-test`: **PASS** (baseline reproducibility, ephemeral-only).
- `npm run db:migration-test`: **PASS** (generic migration-lifecycle proof, ephemeral-only; confirmed by direct experiment that its `export DATABASE_URL=<ephemeral>` line safely overrides the `.env.local`-sourced value, since Node's `--env-file` never overrides an already-exported shell variable).
- `npm run db:status` (read-only, production): **6 applied, 1 pending, 0 drifted** — unchanged.
- **`npm run test:e2e`**: see §19 — originally failed on Scenarios C/D plus a cleanup FK error (root-caused to the harness's own pre-Phase-6 fixture code); **closed in Step 6K-R, now passing in full (7/7 scenarios, 113/113 assertions, zero residue)**.

## 16. Retained Compatibility Fixtures

See Section 12's table. None constitutes a competing product authority.

## 17. Production Activation Prerequisites (NOT performed here)

1. Apply the Phase 6 migration to production
2. Verify the `memory_policies` v1 seed row landed correctly
3. Verify `concept_memory_state` schema/constraints in production
4. Run the production memory backfill in **WRITE** mode (currently only dry-run-certified)
5. Verify full (student, concept) pair coverage post-backfill
6. Re-run the Phase 6 production impact preview (Section 13) — numbers will have changed
7. Re-run the `VALIDATED_MASTERY` release gate against the post-backfill count
8. Phase 4 canonical-memory smoke test after backfill
9. Twin canonical-memory smoke test after backfill
10. Authenticated learner smoke test for every affected flow
11. Monitor for projector/transaction failures after release

## 18. Unresolved, Non-Blocking Items

- ~~`scripts/e2e-cognitive-loop.ts`'s evidence-seeding helpers and `cleanup()` need updating for Phase 6~~ — **resolved in Step 6K-R** (§19).
- Schema debt (not Phase 6 blockers): `mastery_records.next_review_date` (still written, no longer canonical Phase 4 timing), `mastery_policies.retention_min_gap_days` (DB column retained, runtime TS field removed in 6J-B2), any dead legacy `concept_knowledge_state` timestamp/review columns identified in 6J-A.
- Pre-existing (not Phase 6, not fixed in 6K-R): `decision_events`/`ai_execution_events` rows created by this E2E script's own runs are never explicitly deleted by `cleanup()`; both tables' `student_id` column is deliberately unconstrained and `concept_id`/`subject_id` use `ON DELETE SET NULL`, so this does not block cleanup (confirmed by schema inspection) — it only leaves harmless, FK-orphaned audit rows behind, a residue class that predates Phase 6 entirely and was out of this step's scope.

## 19. Step 6K-R — E2E Harness Compatibility Closure

**Objective**: bring `scripts/e2e-cognitive-loop.ts` into Phase 6 compatibility without changing any product code or product semantics.

**Original failure, root-caused precisely (not guessed)**: the script's evidence-seeding helpers (`giveEvidence`, `backdateFirstEvidence`) predate Phase 6 and never passed a `metadata` object to `updateMastery`, so Phase 6's normalizer (`metadata.activityType`-only, no fallback) treated every row they wrote as unqualifiable — no anchor ever formed, `demonstratedRetentionScore` stayed null regardless of the scenario's backdated gap. Separately, `hasValidOperationKey` (required for both anchor eligibility and qualified-attempt eligibility) was also always false, since these helpers never supplied an `identity`, so `operation_key` was always `NULL`. The cleanup FK error had the same root: `concept_memory_state` (a table that postdates this script) is unconditionally upserted on every `updateMastery` call, and `cleanup()` never deleted from it.

**Harness changes (`scripts/e2e-cognitive-loop.ts` only — zero product files touched)**:
- `giveEvidence` gained an optional `activityType?: ActivityType` parameter (stamped into `metadata.activityType` only when supplied — every pre-existing call site that omits it behaves byte-identically to before) and now always supplies a real, randomly-generated `identity` (`operationType: 'RECORD_EVIDENCE'`), giving every row a genuine `operation_key`.
- `backdateFirstEvidence` gained a required `activityType: ActivityType` parameter and now writes a genuine competence anchor (`result='correct'`, `ai_assistance_type='NONE'`, a real `metadata.activityType`, a real `operation_key`) instead of a bare, unqualifiable timestamp marker — this is the canonical replacement for the pre-Phase-6 "any evidence sets a timestamp" mechanism, not a weakening of it.
- **Scenario C**: the backdated row became a real `SOLO_CHECK` anchor (score 85, was 42); its existing `CUMULATIVE_ASSESSMENT`/`TRANSFER` evidence (already correct, unassisted, real production `sourceType`s) was additionally tagged with the matching canonical `ActivityType`, making it a genuine qualified retention attempt. Result: `demonstratedRetentionScore` real and passing (82, ≥ policy's 75).
- **Scenario D**: the backdated row became a real `SOLO_CHECK` anchor (score 88, was 42). The old "HINT-assisted evidence drags Retention down" mechanism was identified as a **stale, pre-Phase-6 invariant** — `isQualifiedRetentionAttempt` requires `aiAssistanceType === 'NONE'`, so HINT-assisted evidence is invisible to Phase 6, not a failing signal, under the canonical model. The old HINT cluster was left in place (it still legitimately fails Transfer, unchanged) and one new, deliberate, **unassisted** `SOLO_VERIFY` attempt at a clearly-failing score (55) was added — a real signal Phase 6 actually sees. Result: `demonstratedRetentionScore` real and correctly failing (55 < 75), Independence unaffected (still ≥ 80, since the new unassisted row's score was chosen to keep the average safely clear of the threshold despite necessarily also pooling into Independence).
- `cleanup()` now deletes `concept_memory_state` by `student_id` alongside `concept_knowledge_state`, before the per-subject `concepts` delete — the exact FK ordering fix.
- `cleanup()`'s residue check now explicitly re-verifies zero `concept_memory_state` rows remain for the run's own student ids, not just zero `students` rows.
- `main()` now catches a scenario error and a cleanup error **separately** — a cleanup failure can no longer prevent the `RESULT: N passed, M failed` line from printing, and both are reported distinctly if they occur.
- **Safety guard added**: `main()`'s first action is `requireExplicitDatabaseWriteConsent()`, which refuses to open any database connection unless `E2E_ALLOW_DATABASE_WRITES=true` is set, printing a clear, non-secret explanation otherwise. A distinct `TEST_DATABASE_URL`-style DB selector (separate from `DATABASE_URL`) was considered and rejected: `@/lib/db`'s connection pool is constructed at ES-module import time, before any code in this script can run, so making a separate variable actually take effect would require splitting the script into a bootstrap + implementation file — a structural change beyond this step's "harness compatibility" scope. The consent flag achieves the same safety goal (fail before the first write, never silently run against whatever `DATABASE_URL` already is) without that restructuring.

**Isolated re-run result (ephemeral Postgres only; `.env.local` never modified; scratch env file deleted after)**: all 7 scenarios (A/B/C/D/E/F/G) passed — **113 passed, 0 failed**. Cleanup succeeded with an explicit, separate proof of zero `concept_memory_state` residue. Production `db:status` unchanged throughout (6 applied, 1 pending, 0 drifted); zero production writes.

**Idempotency of `cleanup()`**: not re-verified via a second live run (the full run above is expensive — real LLM calls). Every statement in `cleanup()` is a plain `DELETE FROM x WHERE column = $1` (never ordinal/positional), which is idempotent by construction in Postgres — re-running it against already-empty tables deletes zero rows and raises no error. This was also implicitly exercised across the 7 heterogeneous scratch students in the run above, several of which never populated every table `cleanup()` touches.

**Product code changed**: **NONE.** Every fix is confined to `scripts/e2e-cognitive-loop.ts`. `PRODUCT_CODE_CHANGE_REQUIRED = NO`.
