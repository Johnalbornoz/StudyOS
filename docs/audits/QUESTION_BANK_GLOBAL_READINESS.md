# Question Bank — global readiness

Computed by `qf-v5-readiness-1` from the governed blueprints and the Student-eligible inventory of the global
bank. Inventory on 2026-10-11: **0 Student-eligible certified items** (DEV and Stage; see
`QUESTION_BANK_2K_EXECUTION.md`).

Readiness takes two inputs, blueprints and the global bank. It takes no Student, no per-Student cache and makes no
generation call (`familyReadiness(family, sections, bank)`).

| Family | Eligible | Practice | Reduced mock | Full mock | Repeatable full mock | Challenge | Coverage |
|---|---|---|---|---|---|---|---|
| PAA | 0 | NOT_READY | NOT_READY | NOT_READY | NOT_READY | NOT_READY | 0 % |
| PISA | 0 | NOT_READY | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_READY | 0 % |
| IB | 0 | NOT_READY | NOT_READY | NOT_READY | NOT_READY | NOT_READY | 0 % |
| Cambridge | 0 | NOT_READY | NOT_READY | NOT_READY | NOT_READY | NOT_READY | 0 % |
| AICE | 0 | NOT_READY | NOT_READY | NOT_READY | NOT_READY | NOT_READY | 0 % |
| ICFES / Saber 11 | 0 | NOT_READY | NOT_READY | NOT_READY | NOT_READY | NOT_READY | 0 % |

PISA is a competency benchmark with rotated booklets: it has practice and challenge, never a mock.

## Global bank, not Student cache

| Check | Result | Evidence |
|---|---|---|
| Readiness depends only on blueprints and the global bank | PASS (engine level) | test "a fresh Student needs nothing of their own" — with a filled global bank and no Student input, Saber practice and reduced mock are READY |
| Items that are generated, in review or rejected never count | PASS | test "items that are generated, in review or rejected never count" |
| A fresh Student on a deployed environment can start from the global bank | **NOT VERIFIED** | there is no eligible item to start from, and the V5 readiness engine is not wired to the Student runtime |
| AD_HOC concept exam reads the global bank | **NOT VERIFIED** | the AD_HOC work is uncommitted in another worktree and was left untouched |

## Remaining gap per family

Slots are item-bankable blueprint slots. "3 forms" is the repeatable-depth target.

| Family | Bankable sections | Slots (1 form) | Target (3 forms) | Gap | Sections whose full-form blueprint is not governed |
|---|---|---|---|---|---|
| PAA | 4 | 36 | 108 | 108 | 4 of 4 |
| PISA | 3 | 21 | 63 | 63 | not applicable |
| IB | 28 | 92 | 276 | 276 | 28 of 28 |
| Cambridge (0580) | 2 | 8 | 24 | 24 | 2 of 2 |
| AICE | 41 | 112 | 336 | 336 | 41 of 41 |
| ICFES / Saber 11 | 1 | 50 | 150 | 150 | 0 of 1 |
| **Total** | **79** | **319** | **957** | **957** | |

Bucket-level rows (bucket, required, available, gap, per mode) are in `QUESTION_BANK_COVERAGE_MATRIX.csv`; the
full structure is in `qb_review/QF_V5_READINESS.json`.

## Not in an item bank

173 IB sections are structure-only (not simulation capable) or coursework / oral components, and 11 AICE sections
are coursework or practical components. Nothing is generated for them and they do not block a bank gate.
