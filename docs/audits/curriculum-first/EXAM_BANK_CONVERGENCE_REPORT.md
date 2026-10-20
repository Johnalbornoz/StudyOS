# Track B — Exam Bank convergence (2026-10-13)

Branch `feat/curriculum-first-learning`, worktree `studyos-curriculum-first`. P0 fallback: `https://study-93bbo8o25-study-so.vercel.app` at `f1436f7` (not touched).

## Status

| Step | Result |
|---|---|
| P0.5 timed AD_HOC | PASS on DEV with the real provider (scenario T1–T6, 28/28). Not yet exercised in a browser on Preview. |
| P0.5 legacy copy | FIXED. The exam simulation setup states that only certified exam questions are used (5 locales). |
| 1. Migration inventory | Done. See the order below. |
| 2. QF V5.1 import | PASS. Merge of the `53abc42` line (it sits on 20 earlier QF / EA commits Track B did not have); exactly the five known test conflicts. |
| 3. QF V5.2 import | PASS. 46 files byte-for-byte; `step4b-pilot-slice.ts` sha256 identical to the frozen worktree. |
| 4. Migration slot and proof | PASS. `20261122_1200` is the next free slot; nothing renamed; promoted byte-identical. |
| 5. Exam runtime integration | **NOT DONE.** See "Why step 5 stopped". |
| 6. PAA readiness | Through the authority, offline: Math exam practice, reduced mock and challenge READY; full mock NOT_READY (REDUCED blueprint). In the Student runtime: NOT_READY, because the bank is not persisted. |
| 7. Shared envelopes | Not started. |

## Timed AD_HOC

A generated item recorded no duration, so every candidate was `DURATION_UNKNOWN` and a timed AD_HOC could never be fitted. A generated item now states a nominal response time from its own question type and difficulty (`assessment-foundation/nominal-response-time.ts`), applied where the Student's own items are loaded. A Certified Exam Bank item never reads it.

"Time limit" in this runtime is a budget the selection must fit; the planned time of every frozen item is recorded. There is no countdown that ends the attempt: none existed before and none was added.

## Migration order

Track B before the import: 88 files, ledger 89 on DEV and Preview (last three `20261121_1000`, `20261122_1000`, `20261122_1100`).

| File | Line | Fresh database | DEV / Preview |
|---|---|---|---|
| `20261121_1000_student_scheduled_assessments.sql` | Track B | 87 | applied |
| `20261121_1100_qf51_construct_core_lineage.sql` | QF V5.1 | 88 | **pending**, applies after the two below |
| `20261122_1000_learner_concept_curriculum_provenance.sql` | Track B | 89 | applied |
| `20261122_1100_canonical_concept_reviewed_aliases.sql` | Track B | 90 | applied |
| `20261122_1200_qf52_exam_bank_certification_coverage.sql` | QF V5.2 | 91 | **pending** |

The QF V5.1 file sorts before two migrations the hosted databases already hold. The runner applies pending files whatever their position, so the hosted order differs from the fresh order. `scripts/track-b-exam-bank-migration-proof.sh` proves both on throwaway Postgres (`APPLY_ORDER=LEXICAL` and `ENVIRONMENT`): no prefix collision, no object lost, re-application safe, 0 rows inserted, 58/58 model assertions, strongest eligibility view invariant PASS.

Neither file has been applied to DEV or Preview.

## Why step 5 stopped

Exam Core delivers rows of `approved_items`. Everything that decides whether an exam can be offered or started reads those rows or readiness persisted from them: the Exam Prep cards, the catalogue capabilities, the instance route, form freezing for mocks and challenge, exposure memory, canonical exam evidence. The designed way for the certified supply to reach it is the one QF V5.2 left as "not done": persist the governance graph and the item instances (migrations 88 and 91), then materialise each instance as a bank row published by inherited certification.

The fit is good. The PAA Matemáticas blueprint in the database has 12 targets over five objectives whose codes are the governed bucket ids (`paa.mat.aritmetica` 3, `algebra` 3, `geometria` 3, `datos` 2, `probabilidad` 1), with no question type or difficulty restriction.

It was not done in this session for three reasons, each of them a decision and not a defect:

1. **It records certification decisions in a database.** The model refuses a certified core, adapter or envelope without a certification row by a qualified reviewer. Loading it means writing a reviewer qualification and the 11 recorded Step 4B approvals as rows attributed to the reviewer. That is the reviewer's act to authorise.
2. **It changes the Preview database the fallback uses.** A new Preview with exam delivery needs migrations 88 and 91 and Exam Bank rows on Preview. They are additive and proven, but `f1436f7` reads the same database, and 91 replaces the bank's publish guard.
3. **The writer does not exist.** `materialize()` is pure; no code persists the graph. It is a loader of about fifteen guarded tables plus the bank rows, to be proven on throwaway Postgres before DEV.

A code-only shortcut (serving instances computed in process) was mapped and rejected: it needs a new item source the response table's CHECK constraint refuses, loses exposure memory and canonical exam evidence, and cannot fill a frozen mock form.

## Other things to know

- **A historical freeze moved.** `src/lib/catalog/concept-identity.ts` is in the frozen closure of the QB-R2E and QB-R2F generation runs, and Track B changed it for reviewed aliases (already live on the fallback). The stored manifests were not re-stamped. The file is named with its reason in `tests/unit/qb-freeze-moved-files.ts`; the tests still assert every other frozen file is byte-identical and that the freeze refuses a re-run at HEAD.
- **QF V5.1 "one Student supply policy"** is now stated as the supply policy of the Exam Bank only. `tests/unit/track-b-exam-bank-boundary.test.ts` pins one vocabulary and no shared supply, and that nothing outside the Exam Bank imports it yet.
- Three assertions of the imported QF tests that assumed no `20261122` migration existed were updated; they also pin the promoted migration's sha256.
- `git diff --check` reports a blank line at end of file in two imported QF documents. They were left as imported.

## Validation at `a772a3e`

Full unit suite 588 files, 10,974 tests passed (6 skipped); typecheck clean; production build passes; ephemeral migration proof PASS in both orders; QF V5.2 offline run reproduces its artefacts (`QF52_ARTEFACTS = CURRENT`, capacity 822); DEV runtime scenarios 28/28 (run at `b26f8e6`).

## Preview

`https://study-60wi1e0k5-study-so.vercel.app` (`dpl_HHFrDdLxyKyfnSC6nMSEfHJRkvKw`) carries `b26f8e6`: the fallback plus the two P0.5 fixes, no Exam Bank code and no pending migration. It answers `/api/version`. It has had no authenticated run, so it does not supersede `f1436f7`.
