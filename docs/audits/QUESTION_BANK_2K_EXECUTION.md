# Question Bank 2K — execution report

Run date 2026-10-11. Branch `feat/question-factory-v5` (worktree `studyos-qf-v5`), base `1a214f0`.

## Result

| | |
|---|---|
| `STUDENT_ELIGIBLE_CERTIFIED_ITEMS` | **0** |
| `TARGET_2000` | **FAIL** |
| Raw candidates generated | 0 |
| Provider calls | 0 |
| Spend | 0.00 USD (no budget authorised) |
| Production touched | NO |

The target was not attempted with content, and no standard was lowered to approach it. What was built is the
factory that can pursue it; what stopped the run is listed below, each item with the decision it needs.

## Why no item was generated

1. **No budget.** `QB_GENERATION_BUDGET_USD` was not provided. Section 28 of the brief says that in that case the
   engine, validation infrastructure, coverage analysis and plan are completed and no provider spend is incurred.
   The previous authorisation (30.00 USD) stands at 29.97 spent. `run.ts generate` refuses with
   `BUDGET_NOT_AUTHORIZED` before reading a key.
2. **Items written by this session were deliberately not used to fill the bank.** An item authored and then
   "independently" solved and judged by the same model in the same session is not independently verified, which is
   the exact weakness the Canary exposed. Doing it 2,000 times would have optimised the report.

## What blocks automatic promotion even with a budget

These are governance rules already locked in this repository. The brief's `AUTO_APPROVE → Student eligible` path
contradicts them, and they were not weakened.

| Rule in force | Where | Effect |
|---|---|---|
| An APPROVED review must come from a non-system reviewer who is not the author, holds a qualification for the subject and family, on a version with one explicit PRIMARY concept | migration `20261112_1000`, trigger `question_bank_review_authority_guard()` | A pipeline cannot approve. DEV and Stage hold 0 reviewer qualifications and 0 approved reviews. |
| `STUDYUS_GENERATED` can never go `VALIDATED → ACTIVE` | `lifecycle.ts` | Generated content needs a human approval to become deliverable. |
| Only `STUDYUS_OWNED`, `LICENSED_FOR_USE`, `OFFICIALLY_AUTHORIZED` rights deliver | `question-eligibility.ts`, migration `20261110_1000` | DEV and Stage hold 0 deliverable rights rows. Each promoted item needs one. |
| A profile must be `CERTIFIED` to feed evidence-bearing content | `assessment-system-profile.ts` | Every profile, old and V5, is provisional. |
| Schema and migrations are single-writer | orchestration `LOCKS.md` | A machine-certification path needs a migration this lane may not write. |
| Next live run closed until human calibration completes | `qb-post-canary/next-run-gate.ts` | The 37-item human calibration sample from the Canary is unanswered. |

Promotion also needs each item to carry a PRIMARY canonical concept. The governed blueprints carry objective
codes, not concept ids, for most families; V5 specifications therefore have empty `conceptIds` outside the PAA
backlog. An item without a concept cannot be approved (`PRIMARY_ATTRIBUTION_REQUIRED`).

## Is 2,000 the right number?

The governed blueprints do not ask for 2,000 items.

| | Items |
|---|---|
| Item-bankable blueprint slots, one form, all families | 319 |
| Same at repeatable depth (3 forms) | 957 |
| Raw candidates planned for that, at an assumed 80 % yield | 1,266 |
| PAA full bank already certified as a requirement (Q1: 2 full forms, 1 reduced, 61 concepts × 7) | 865 |

Reaching 2,000 certified items honestly means governing more blueprint first: full-length blueprints for IB,
Cambridge and AICE papers (today every one is a reduced demonstration blueprint of 1–7 slots per paper), and
binding the PAA 865-item plan to the runtime blueprint. Generating 2,000 items against 319 slots would produce
six or more near-interchangeable items per slot, which the duplicate gate is built to reject.

## Existing bank audit (read-only, 2026-10-11)

Queried in read-only sessions. Both ledgers are at 86 migrations.

| Class | DEV | Stage (Preview DB) | Basis |
|---|---|---|---|
| `CERTIFIED_CURRENT` | 0 | 0 | no approved review, no deliverable rights row, no reviewer qualification anywhere |
| `TEST_FIXTURE_ONLY` | 477 | 410 | provenance `FIXTURE`, published and lifecycle `ACTIVE`; excluded from Student delivery by provenance |
| `REVIEW_REQUIRED` | 12 | 0 | `STUDYUS_GENERATED`: 11 in `PILOT`, 1 in `REPAIR_REQUIRED`; none human reviewed |
| `ARCHIVE` | 13 | 0 | `STUDYUS_GENERATED`, `SUPERSEDED` |
| `BLOCKED` | 7 | 0 | `STUDYUS_GENERATED`, `REJECTED` |
| Total versions | 509 | 410 | |

No fixture was reclassified. Fixtures stay fixtures.

The audit covers the governed Question Bank tables. The learning path's per-Student question cache is a separate
supply and was not audited here.

## What was delivered

| Commit | Content |
|---|---|
| `adc8c0c` | merge of the post-Canary V5 line onto the release candidate (clean) |
| `57ac642` | V5 core: profiles, item/specification, deterministic stages, pipeline, batch control, readiness |
| this commit | prompt policy, specification planner, batch engine, budget-gated runner, artifacts, reports |

Preview: **not deployed**. The gate in section 44 requires bank validation to pass; there is no bank to validate,
and this branch changes nothing a Student would see. It also does not contain the uncommitted AD_HOC work that
lives in `studyos-stage-convergence`, so a Preview built from it would be missing that feature.

## Cost of the run that was not made

Estimates on the lanes' assumed (deliberately high) prices of 5 / 30 USD per million input / output tokens.

| | Typical | Worst case the guard reserves |
|---|---|---|
| One C1 batch (20 items, one cluster) | ≈ 2 USD | 18 USD |
| C1 for all 21 clusters (420 items) | ≈ 42 USD | 385 USD |
| The full plan (1,266 raw candidates) | ≈ 125 USD | 1,158 USD |

The guard asks for the worst case of the next batch before starting it, so a budget near the typical figure stops
a little early rather than overrunning.

## To resume

```bash
QB_GENERATION_BUDGET_USD=<n> OPENAI_API_KEY=... ANTHROPIC_API_KEY=... npx tsx scripts/operations/qf-v5/run.ts generate --run qf5-001 --phase C1 --cluster ICFES.SABER11
```

Pass only those three variables; never `--env-file` an application `.env`. The run writes under
`docs/audits/qb_review/` and ingests nothing.
