# QF V5.2 EXAM BANK SOURCE — scope classification (2026-10-13)

Official designation of the frozen worktree below: **QF V5.2 EXAM BANK SOURCE**, status COMPLETE_OFFLINE / FROZEN.
It is not Track B. Its code is imported into Track B later, after Learning + Internal Assessment P0 is green in DEV
and Preview; this table is the import guide.

Worktree `studyos-qf-step4b` (`feat/qf-step4b-real-content-governance` @ `53abc42`), 2 modified + 13 untracked paths.
Read only: nothing in that worktree was changed by this block.

| Path | Class | Note |
|---|---|---|
| `src/lib/assessment-instance/v52/certification-policy.ts`, `certification-engine.ts`, `instance-certification.ts` | KEEP_FOR_EXAM_QF | automated certification, Human-50 policy |
| `v52/rights-provenance.ts`, `v52/object-governance.ts`, `v52/audit.ts` | KEEP_FOR_EXAM_QF | rights, governance, audit sampling |
| `v52/inventory-recovery.ts`, `v52/library-batch.ts` | KEEP_FOR_EXAM_QF | exam inventory recovery and batch production |
| `library/constructs.ts`, `library/catalogue.ts`, `library/parametric.ts`, `pilot/step4b-pilot-slice.ts` | KEEP_FOR_EXAM_QF | construct library and pilot slice |
| `renderer-envelope.ts`, `adapter-reconciliation.ts`, `certification.ts` | KEEP_FOR_EXAM_QF | renderer envelopes, adapter reconciliation |
| `strategy-proportion-missing-value.ts`, `strategy-quadratic-solve.ts`, change to `strategy-quadratic-factorising.ts`, `index.ts` | KEEP_SHARED | parametric strategies and numeric evaluation; usable by exam items and, later, deterministic Learning templates |
| `scripts/operations/qf-step4b/*`, `scripts/operations/qf-v52/run.ts`, `scripts/qf-step4b-ephemeral-db-test.sh`, `tests/unit/qf51-step4b-real-content-governance.test.ts` | KEEP_FOR_EXAM_QF | |
| `docs/exams/question-factory/step4b/*`, `v52/*` incl. `proposed/20261122_1200_qf52_exam_bank_certification_coverage.sql` | KEEP_FOR_EXAM_QF | the proposed migration version collides in date with `20261122_1000/_1100` already applied to DEV and Preview; renumber after them |
| `v52/supply-authority.ts` — exam part (`ExamUse`, blueprint classes, eligibility re-decided at selection) | KEEP_FOR_EXAM_QF | |
| `v52/supply-authority.ts` — "THE global Student supply authority ... asked by every consumer: Practice, AD_HOC, scheduled AD_HOC"; `ConceptSupplyRequest.consumer = PRACTICE / AD_HOC / SCHEDULED_AD_HOC`; `DELIVERY_KINDS` `PRACTICE`, `AD_HOC` | OBSOLETE_UNIVERSAL_SUPPLY_ASSUMPTION | re-scope to exam consumers only; Practice and AD_HOC are supplied by `src/lib/assessment-supply` |
| `v52/coverage.ts` — concept demand units `PRACTICE`, `AD_HOC_QUICK/BALANCED/DEEP`, `SCHEDULED_AD_HOC` | OBSOLETE_UNIVERSAL_SUPPLY_ASSUMPTION | coverage measures exam content: keep `EXAM_PRACTICE`, `REDUCED_MOCK`, `FULL_MOCK`, `CHALLENGE`, blueprint buckets |
| `docs/.../QF52_COVERAGE.json`, `QF52_CERTIFIED_SUPPLY.json`, `QF52_REPORT.md` figures that count Practice / AD_HOC demand | OBSOLETE_UNIVERSAL_SUPPLY_ASSUMPTION | regenerate after the re-scope |

Not done here: the import and the re-scope. The frozen source was read, not changed.
