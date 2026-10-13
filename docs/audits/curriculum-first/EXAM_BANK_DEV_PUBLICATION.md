# Track B — Exam Bank loader and DEV materialisation (2026-10-13)

Branch `feat/curriculum-first-learning`. Scope authorised: throwaway Postgres and DEV. Preview, Stage and Production were not touched.

## What exists now

| Piece | Where |
|---|---|
| Publication plan (pure) | `src/lib/exam-bank/publication-plan.ts` |
| Bank projection (instance to bank version and back) | `src/lib/exam-bank/bank-projection.ts` |
| Loader (transactional, idempotent, fail-closed, dry run) | `src/lib/exam-bank/publication.service.ts` |
| CLI, fingerprint-gated, dry run by default | `scripts/operations/exam-bank/publish-certified-supply.ts` |
| Live eligibility of a bank version, by deployment scope | `src/lib/exam-bank/delivery-scope.ts` |
| Throwaway proof | `scripts/exam-bank-publication-proof.sh` |
| DEV runtime scenarios | `scripts/operations/exam-bank/exam-runtime-scenarios.ts` |
| Migration | `database/migrations/20261123_1000_exam_bank_core_derived_authorship.sql` |

## Certification provenance

| Provenance | What carries it | Count |
|---|---|---|
| HUMAN | The 11 recorded Step 4B decisions, copied field by field (reviewer `INTERNAL_PILOT_REVIEWER`, decided `2026-10-13T12:11:00Z`, the recorded evidence hashes); 3 qualification scopes granted as recorded | 11 decisions |
| HUMAN | Objects whose governed content hash equals a recorded approval: 2 cores, 2 adapters, 2 envelopes, the IB blueprint | 7 objects |
| AUTOMATED | Every other eligible object, decided by `policy:HUMAN50_POLICY_V1`: 8 cores, 8 envelopes, the PAA blueprint (`qf52-2`) | 17 objects |
| INHERITED_DETERMINISTIC | Every item instance. No person reviewed an instance; none is recorded as if one had | 326 instances |

No human decision was created. The PAA blueprint a person approved is version `step4b-pilot-1`; the one in force is `qf52-2`, which nobody reviewed, so it is published as automated and the old approval is kept as recorded.

## Throwaway proof

`EXAM_BANK_PUBLICATION_PROOF = PASS`. DEV-equivalent state (baseline + 88 migrations, ledger 89), then the three pending migrations through the real runner (ledger 92).

- refuses a database without the migrations; blocks all 296 rows when the certified concept catalogue is absent;
- dry run reports 1,967 rows and keeps none; first apply writes 1,967; second apply writes 0;
- 11 human decisions, 7 human-certified objects, 8 automated cores decided by the policy, 0 automated decisions attributed to a person;
- a different content under an existing identity is a conflict and nothing is written;
- a core-derived version authored by a person, or one whose difficulty was edited, is refused by the database.

## DEV

Ledger 89 before, 92 after (`20261121_1100`, `20261122_1200`, `20261123_1000`).

The load ran as three restartable increments, each preceded by a dry run that matched it: 1,375 rows, then 296 reuse-right records, then 296 concept attributions (with 296 lifecycle events). A final apply wrote 0 rows.

| | DEV |
|---|---|
| Certified cores | 10 (2 human, 8 automated) |
| Certified adapters | 2 |
| Certified renderers | 10 |
| Certified instances, eligible in PILOT_PREVIEW | 326 |
| Eligible in PRODUCTION | 0 |
| Materialised Exam Bank items | 296 (álgebra 120, aritmética 60, geometría 60, probabilidad 30, datos 26) |
| Effective exam capacity (distinct recognition classes among them) | 296 |
| Not materialised | 30 IB instances whose working is marked: they stay certified instances with no bank row |

The 822 of the offline report is what the certified envelopes can render. 296 is what is persisted and deliverable.

## Exam runtime

Exam Core delivers and scores as before; it reads bank rows. Added: a core-derived row is deliverable only while its certified instance is eligible in the deployment's scope. The scope is the server setting `EXAM_BANK_DELIVERY_SCOPE`; anything but an explicit `PILOT_PREVIEW` is `PRODUCTION`, where nothing of this supply is eligible. The check runs in every exam reader of the bank, in both readiness readers, when a frozen form starts and when a held item is retrieved.

Catalogue readiness comes from the existing bank-health snapshot with `QUESTION_BANK_READINESS_MODE=ENFORCE`. The loader refreshes the snapshot after a committed publication.

DEV scenarios, 35/35:

| | Result |
|---|---|
| Exam Practice | READY. Offered by the catalogue, 12 questions from certified supply in their own buckets, 9 of 12 scored as answered, evidence `EXAM_ASSESSMENT` on the item's own concept, 0 provider calls, a second practice repeats none of the first 12. |
| Reduced Mock | Runs end to end for the Matemáticas component: a frozen 12-position form (3/3/3/2/1), started as `REDUCED_MOCK`, scored, evidence `EXAM_ASSESSMENT`. **Not offered by the Student catalogue**, which offers a PAA mock only as the whole package of four components. |
| Challenge | Runs end to end for the Matemáticas component. **Not verifiably harder**: Exam Core defines a challenge by a calibrated difficulty index, certified items carry a 1–5 difficulty and no calibrated index, and none was invented. The form records `CHALLENGE_BAND_NOT_REACHED`. Not offered by the catalogue, for the same reason as the mock. |
| Full Mock | NOT_READY. A full Matemáticas form (55 positions) does not assemble; no attempt started as `FULL_MOCK`. |
| Eligibility | An open incident on one envelope withdrew its items at once and a frozen form holding one did not start; resolved, the form was eligible again. |
| Boundary | Four completed attempts, 48 questions: 0 provider calls, no Learning or Internal Assessment item written, no Exam Bank row written. |

Regression on the same DEV database: Learning, AD_HOC, timed AD_HOC and scheduled AD_HOC 28/28, with the Exam Bank row counts identical before and after.

## Decisions taken that need a second look before Preview

1. **A third migration.** `20261123_1000` replaces the bank's authorship guard. The existing guard required a human author for every StudyUs-authored version; a rendered row has none, and recording a person would attribute a machine's rendering to them. A core-derived version is now authored by the technical identity and must be the copy of its eligible instance.
2. **A second writer of concept attribution.** The project had one governed writer of `question_bank_item_concepts`, a qualified reviewer. The loader is now a second: it copies the primary concept the instance was certified with, resolved through the certified PAA catalogue, recorded by the technical identity. It reads no objective mapping. Without it the canonical evidence loop writes no exam evidence.
3. **Core certification version in the database.** The rendered lineage carries `UNCERTIFIED-DEV-TEST` (instances are rendered in the library's test use). The database column holds the core's own certification, `HUMAN50_POLICY_V1:HUMAN_CERTIFIED` or `HUMAN50_POLICY_V1:AUTOMATED_CERTIFIED_PILOT`. The lineage digest is stored unchanged.
4. **Bank row labels.** `usage_eligibility` PRACTICE and REDUCED_MOCK, `exam_alignment` MOCK_READY. The items are numeric entry; the PAA is mostly selected response.
5. **Explanation text.** Exam Core requires one; an instance has none. It is stated as the keyed answer and nothing more.

## Left on DEV by the scenarios

Four resolved rows in `assessment_envelope_incidents` (the simulated incident of each run; the table is the audit of incidents). No fixture Student remains.

## Preview promotion, when authorised

1. Apply the three migrations to the Preview database.
2. Dry run, then apply, the loader (`AUTHORISED_TARGETS` must be extended deliberately; Preview is not in it).
3. Deploy with `EXAM_BANK_DELIVERY_SCOPE=PILOT_PREVIEW` and `QUESTION_BANK_READINESS_MODE=ENFORCE`.

The code at this tip must not be deployed against a database without migration `20261121_1100`: the exam readers name its columns.

## Preview candidate (2026-10-13, after the five decisions were approved)

Decisions applied in code: a key is not an explanation (projection 2: `explanationStatus: NONE`, empty text); the generation lineage and the publication certification are two records, both kept; a challenge is offered only where Student-deliverable content has calibrated difficulty. DEV was brought to projection 2 by superseding the 296 earlier versions (a version is never rewritten); a further apply wrote 0 rows.

| | |
|---|---|
| Database | `neondb_trackb_exam`, a new database on the Preview Neon endpoint, cloned by `pg_dump` from the Preview database (which was only read). Fingerprint `4c249c68e0627b9f`. Row counts identical to the source at clone time. |
| Fallback's database | Unchanged: ledger 89, no QF table, 410 bank versions, 75 evidence rows, before and after. |
| Ledger | 89 before, 92 after (the three DEV-proven migrations, through the real runner). |
| Loader | dry run 1,967 planned and none kept; apply 1,967; second apply 0; 0 conflicts. |
| Provenance | 11 recorded human decisions; 7 human-certified objects; 17 automated; 0 automated decisions attributed to a person. |
| Supply | 326 certified instances persisted; 296 Exam Bank items materialised; 296 runtime-eligible in PILOT_PREVIEW; 0 in PRODUCTION. Renderable certified capacity (what the envelopes can render, not the bank's size): 822. |
| IB | 30 instances CERTIFIED_NOT_DELIVERABLE: constructed response / rubric scoring is not supported by Exam Core. Kept certified, not materialised, not downgraded. |
| Deployment | `https://study-9znz4dfn5-study-so.vercel.app` (`dpl_3h5cHGKeP8F9AJVF9VkypSZqopt3`), SHA `b44686c`, with `EXAM_BANK_DELIVERY_SCOPE=PILOT_PREVIEW`, `QUESTION_BANK_READINESS_MODE=ENFORCE`, bound to the clone. `/api/version` and the database diagnostics confirm SHA, database and ledger 92. |
| Exam runtime on the clone (service level) | 35/35: practice READY from certified supply (12 governed positions, frozen, scored, `EXAM_ASSESSMENT` evidence on the item's own concept, exposure recorded, second attempt repeats none, 0 provider calls); reduced-mock engine runs for the Matemáticas component; the catalogue does not offer a PAA mock; challenge not offered (no calibrated difficulty); full mock does not assemble. |

Authenticated browser E2E on the new host is pending the operator's sign-in.
