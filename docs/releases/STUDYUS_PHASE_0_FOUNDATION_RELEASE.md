# StudyUs Phase 0 Foundation Release

Date: 2026-08-31. This is the release manifest for the commit that closes Phase 0F's blocking finding: the entire Phase 0 working tree, committed and deployed as one coherent, already-certified release.

---

## Release Objective

Turn the certified local StudyUs working tree (Phases 0A through 0F) into the production application version, with zero new features, zero threshold/algorithm/prompt changes, and zero database schema changes (the Phase 0E2 migration is already live — see Phase 0E2-P).

## Source HEAD Before Release

```
Branch: main
Commit: af847a61281f6d6e44e951c6047351f9101762da
Date:   2026-08-24 17:54:22 -0600
Subject: merge: reconcile duplicate remote rendering commits
```

This commit predates every Phase 0 sub-phase (0A began 2026-08-26).

## Files Included

**34 modified tracked files**, **54 new files** — see `docs/audits/STUDYUS_PHASE_0G_PRODUCTION_ALIGNMENT.md` §4 for the full per-file classification table. Summary by area:
- `src/lib/ai/` (9 files) — canonical AI gateway, adapters, prompt registry, execution audit sink.
- `src/lib/audit/` (4 files) — decision-event canonical write path and read service.
- `src/lib/auth.ts` — Phase 0C identity contract documentation + `verifySubjectAccess` fix.
- `src/lib/mastery-format.ts`, `src/services/progress-overview.service.ts` — the pre-Phase-0 mastery-scale hotfix and Progress V2 dashboard.
- `database/` — baseline snapshot, migration ledger, the one governed migration, governance docs.
- `scripts/db-*.ts`, `scripts/db-*.sh` — migration runner/status/reproducibility/migration-test tooling.
- 19 modified `src/services/*.ts` files — AI-call migrations (0E1) and decision-event instrumentation (0E2).
- 4 modified `src/app/api/**/route.ts` files — AI context + decision-event wiring.
- 4 modified `src/app/dashboard/**` pages — Progress V2 (pre-Phase-0 hotfix).
- 23 new `tests/unit/*.test.ts` files + 1 modified pre-existing test.
- 8 new `docs/audits/*.md` + `docs/architecture/*.md` + `docs/adr/*.md` reports.

## Phases Represented

0A (audit, no code) · 0B (audit, no code) · 0C (identity fix) · 0D (DB governance) · 0E1 (AI gateway) · 0E2 (audit trail) · plus the pre-Phase-0 mastery-scale/Progress-V2 hotfix that this whole arc built on top of.

## Database Migrations Required

**NONE.** `database/migrations/20260831_1400_ai_execution_and_decision_audit.sql` was already applied to production in Phase 0E2-P. This release is application-code-only; it does not run, and does not need to run, any migration.

## Production Database Status (at release time)

```
Applied:  STUDYUS_BASELINE_2026_08, 20260831_1400_ai_execution_and_decision_audit
Pending:  0
Drifted:  0
```

## Validation Results

```
TypeScript:          npx tsc --noEmit          -> clean, exit 0
Tests:                 npx vitest run            -> 64 test files, 727 tests, all passed
Build:                  npm run build             -> exit 0
DB reproducibility:    npm run db:repro-test     -> REPRODUCIBILITY_TEST = PASS
Migration test:         npm run db:migration-test -> MIGRATION_TEST = PASS
```

All re-run immediately before staging, on the exact working tree being released.

## Known Accepted Risks

(Carried forward from Phase 0F §18, unchanged by this release — this release does not fix any of them, only ships the code that was already certified around them.)

1. Dual `students`/`profiles` identity architecture — stable, documented, tested compatibility model.
2. No DB-level range CHECK on `mastery_records.mastery_score`.
3. No lint tooling configured.
4. `tests_disabled/` (12 files) remains excluded from the active suite.
5. Two coexisting deployment-target artifacts (`Dockerfile` + Vercel project); Vercel confirmed as the real live target for this release.

## Rollback Considerations

- **Application code**: a Vercel rollback to the previous deployment (built from commit `af847a6`) is safe and instantaneous via Vercel's own promote/rollback mechanism.
- **Database**: the two new tables (`ai_execution_events`, `decision_events`) are purely additive. **Rolling application code back does NOT require, and must NOT trigger, dropping either table** — no code in this release or its predecessor issues a `DROP TABLE` against them, and no future rollback should either. An application-code rollback and this migration are fully independent; the old application code simply ignores the two new tables' existence.
- **No other schema change** is part of this release, so no other rollback consideration applies.

## Foundation Invariants (F01-F12)

Carried forward unchanged from Phase 0F §17 — this release does not alter any of them, it only makes the code that upholds them (F04, F07, F08 in particular) actually reach production:

| ID | Invariant |
|---|---|
| F01 | One canonical concept id (`concepts.id`) |
| F02 | Evidence before mastery |
| F03 | AI does not assign mastery directly |
| F04 | Structured high-risk AI output must be validated |
| F05 | Mastery algorithm remains deterministic |
| F06 | Assisted performance is distinguishable from independent evidence |
| F07 | Every important state-changing decision is auditable |
| F08 | Every AI execution is identifiable by provider/model/prompt/version |
| F09 | Schema changes use governed migrations |
| F10 | No automatic migrations during app startup/build |
| F11 | Student identity compatibility invariant must be respected |
| F12 | Raw student/AI content is not persisted in cross-engine audit tables |
