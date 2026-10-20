# QB-R1B — Governance Deployment & Saber Competency / Attribution Foundation

Branch `feat/qb-r1b-saber-attribution` (on top of QB-R1A `c542fd7`), merged into `integration/q1-paa-bank-readiness`. No qualification was granted, no review recorded, no PRIMARY attribution written for any candidate, nothing published in the Curriculum structure, and Kognity was not accessed.

## 1. Locked decisions

| Decision | Value |
|---|---|
| Saber remediation | `OPTION_C_PLUS_B`: canonical competencies for the three objectives, item-level PRIMARY attribution for the eight candidates. Option A is not used |
| Unattributed items | `UNATTRIBUTED_ITEM_APPROVAL = NOT_ALLOWED`. The subject of an objective is not enough to approve a question with no PRIMARY concept |
| Sequencing | `PRIMARY_ATTRIBUTION_BEFORE_APPROVAL = REQUIRED` |
| PAA Mathematics | `PAA_MATH_CANONICAL_SUBJECT = Matemáticas`. *Matemáticas* and *Mathematics* stay separate; neither is inferred from the other |
| Grants | none without real identities: `REAL_REVIEWER_IDENTITIES_AVAILABLE = NO`, `READY_FOR_REAL_QUALIFICATION_GRANTS = NO` |

## 2. Saber competencies

The canonical competency model is the `competencies` table with reviewed `objective_competency_mappings`, written through the Curriculum bootstrap boundary from the curated catalogue (`dev-learning-catalog.ts`) and the reviewed links (`objective-learning-links.ts`).

No existing competency is a true equivalent. *Razonamiento matemático* is the whole discipline's reasoning (47 objectives of several exams map to it); *Problem Solving* and *Reasoning / Justification* are generic, unmapped entries without a definition. Three competencies were added, the smallest set that says what the exam says:

| Objective | Canonical competency | Code |
|---|---|---|
| `saber.interpretacion` | Interpretación y representación | `icfes.saber11.mat.interpretacion` |
| `saber.formulacion` | Formulación y ejecución | `icfes.saber11.mat.formulacion` |
| `saber.argumentacion` | Argumentación | `icfes.saber11.mat.argumentacion` |

`Competency ≠ Concept`, enforced:

- the three objectives have a competency link and no concept or skill link; a test fails if one is added;
- coverage, pilot eligibility, the reviewer scope and the attribution writer do not read competency tables (test);
- the attribution table references `canonical_concepts` only, and the writer refuses a competency id (`CONCEPT_NOT_FOUND`, certified on a database);
- a Saber item's review scope stays without a subject after the mapping: it is still not approvable.

`SABER_FALSE_CONCEPT_MAPPING = NONE`. Objective ids are unchanged; items, targets and attempts reference them as before.

## 3. Attribution proposals for the eight Saber candidates (read-only; nothing written)

Proposed by reading each item; the answer keys were re-worked and agree with the stored key. Concepts are existing canonical concepts of *Matemáticas*. A qualified reviewer decides.

| Item key (version) | Competency | Stem, in short | Key | Content category | Candidate PRIMARY | Possible SUPPORTING | Confidence | Rationale |
|---|---|---|---|---|---|---|---|---|
| `qb.saber.argumentacion.52fc43dc03` (v1) | Argumentación | A student solves (x²−9)/(x−3)=6 by cancelling x−3 and concludes x=3; how many valid solutions are there? | A (0) | Álgebra y cálculo | Ecuaciones racionales, con radicales y con valor absoluto | Polinomios y factorización | High | The point is the excluded value of a rational equation |
| `qb.saber.argumentacion.cd009f77a3` (v2) | Argumentación | Survey of 50 students by transport; which procedure correctly gives the non-motorised percentage? | B (46%) | Estadística | Porcentajes | Representación e interpretación de datos | Medium | Part-of-whole percentage; the data come from a frequency list, so a reviewer may prefer the data concept |
| `qb.saber.formulacion.24a8685760` (v2) | Formulación | 4 arepas need 300 g of flour; how much for 10? | D (750 g) | Álgebra y cálculo | Proporcionalidad | Variación directa e inversa | High | Direct proportion, fourth value |
| `qb.saber.formulacion.3d04bf73f9` (v2) | Formulación | 180 tickets at 8,000 and 12,000 pesos raise 1,840,000; how many student tickets? | D (80) | Álgebra y cálculo | Sistemas de ecuaciones | Ecuaciones lineales | High | Two unknowns, two linear conditions |
| `qb.saber.formulacion.aca89de0b2` (v1) | Formulación | 36 of 150 surveyed clients would use delivery; estimate for 1,000 clients | B (240) | Estadística | Proporcionalidad | Población, muestra y tipos de variables; Porcentajes | Medium | Solved as a proportion; the context is inference from a sample |
| `qb.saber.formulacion.f318dfdb74` (v2) | Formulación | Triangular sign, base 1.8 m, height 1.2 m; 1 L of paint per 0.5 m² | B (2.16 L) | Geometría | Área y perímetro | Proporcionalidad | High | Area of a triangle, then a rate |
| `qb.saber.interpretacion.1af76e7a3a` (v1) | Interpretación | Three classes collected 12, 18 and 10 kg; what percentage did the 18 kg class collect? | B (45%) | Estadística | Porcentajes | Fracciones | High | Part-of-whole percentage |
| `qb.saber.interpretacion.d1bb446253` (v1) | Interpretación | A plan has 18 GB and uses 1.5 GB a day; after how many days are 6 GB left? | B (8 days) | Álgebra y cálculo | Ecuaciones lineales | Rectas y funciones lineales | High | Linear model solved for the unknown. The reviewer may also question the competency: this reads as formulation rather than interpretation |

The content category is my reading; the items do not store one.

`SABER_PRIMARY_ATTRIBUTION_PROPOSALS = READY`

## 4. Attribution workflow

One writer, `setItemAttribution` (`question-bank/item-attribution.service.ts`), and one operator command. No other code writes `question_bank_item_concepts` (test).

| Rule | Enforced by |
|---|---|
| Item-version scoped | the table's key; the writer takes an item version id |
| Exactly one PRIMARY, zero or more SUPPORTING | the writer's input (one `primary`), `CONCEPT_LISTED_TWICE`, and the database's one-PRIMARY index |
| Reviewer is a person, active, not the author | `REVIEWER_IS_SYSTEM_ACCOUNT`, `REVIEWER_NOT_ACTIVE`, `REVIEWER_IS_AUTHOR` |
| Reviewer is qualified | a qualification in force for the item's exam family and the canonical subject of the PRIMARY concept they assign: `REVIEWER_NOT_QUALIFIED` |
| Nothing automatic | the concepts are named by the reviewer; the writer reads no objective mapping and proposes nothing |
| Concepts only | ids of active `canonical_concepts`; a competency id is `CONCEPT_NOT_FOUND` |
| Audited | `admin_audit_log`, action `QUESTION_BANK_ITEM_ATTRIBUTION_SET`, in the same transaction: reviewer, previous and new attribution, the qualification used, the reviewer's reason |
| Reviewed content | replaceable while the version is under review; `ATTRIBUTION_FROZEN` once it is active (database rule) |

```
npx tsx --env-file=.env.local scripts/operations/qb-item-attribution.ts show --item-version <approved item uuid>

npx tsx --env-file=.env.local scripts/operations/qb-item-attribution.ts set \
  --item-version <approved item uuid> --reviewer <user uuid> --primary <canonical concept uuid> \
  [--supporting <concept uuid>[,<concept uuid>...]] --reason "<reviewer's note>" [--write]
```

Dry run unless `--write`; DEV or an ephemeral database only. Not run on DEV. There is no admin screen for attribution yet.

`PRIMARY_ATTRIBUTION_WORKFLOW = CERTIFIED` (16 checks on a real database, in `qb-r1a-reviewer-governance-cert.sh`).

## 5. Attribution before approval

`requireReviewerQualification` — asked by `reviewVersion` before it writes — now refuses any version without a reviewed PRIMARY concept with `PRIMARY_ATTRIBUTION_REQUIRED`, before it looks at qualifications. The admin route returns it by name.

Sequence: the item exists → the reviewer inspects it → the reviewer sets PRIMARY / SUPPORTING → structural, rights and originality requirements are checked → the approving review is recorded.

One gap, stated plainly: the **database** rule of migration `20261110_1500` still accepts, as a subject, the published concept mapping of an item's objective when the item has no PRIMARY concept. The application path refuses such an approval; a direct insert by a qualified reviewer would not be refused by the database. Closing it is a one-statement change to that trigger in a new migration, which this phase did not include ("no schema migration is expected"). It needs authorization.

## 6. Qualification matrix (no human assigned)

Canonical subject identities on DEV: *Lectura crítica* `08bf2897…` (16 concepts), *Matemáticas* `043193d2…` (32), *Redacción* `995d86ca…` (6), *English* `10682e81…` (9), *Mathematics* `44b1e6cf…` (27, not used for PAA).

| Qualification needed | Why | Current candidates / future content | Human assigned? |
|---|---|---|---|
| Lectura crítica × PAA | PAA Lectura; literary concepts live in the same subject | 1 candidate; 5 Domains, 20 Topics of the production plan | NO |
| Matemáticas × PAA | PAA Matemáticas (locked subject) | 2 candidates; 4 Domains, 44 Topics | NO |
| Redacción × PAA | PAA Redacción | no candidate; 5 Domains, 5 Topics | NO |
| English × PAA | PAA Inglés; the canonical subject is named *English* | no candidate; 3 Domains, 15 Topics | NO |
| Matemáticas × ICFES | the eight Saber candidates: every proposed PRIMARY concept is in *Matemáticas*. The competency is not a reviewer subject | 8 candidates | NO |

Minimum to start pilot review: four people-subject pairs for PAA (one person may hold several), plus one for Saber. Each also needs a grantor who is another person with the grant authority. The same qualification serves attribution and approval.

## 7. PAA candidates — blockers

| Candidate | Required qualification | Reuse rights | PRIMARY concept | Topic | Originality | Pool | Blueprint cell | Structure version |
|---|---|---|---|---|---|---|---|---|
| `qb.paa.lect.evidencia.808c865076` | Lectura crítica × PAA | none | none — now also blocks approval | none | none | none | objective is a target of the legacy blueprint; no variant exists | published |
| `qb.paa.mat.algebra.851471c94a` | Matemáticas × PAA | none | none — now also blocks approval | none | none | none | same | draft: condition 5 cannot hold before the cutover |
| `qb.paa.mat.algebra.a0c44d1a82` | Matemáticas × PAA | none | none — now also blocks approval | none | none | none | same | draft |

None was approved or changed. With the new rule, a qualification alone no longer lets them be approved: attribution comes first.

## 8. Production draft package

`question-bank/production/draft-package.ts` (pure contract, validated, stores nothing). A package is the input to authoring or generation:

| Field | Carried as |
|---|---|
| Exam family, exam version | `examFamily`, `examVersionId` |
| Subject | `canonicalSubjectId` |
| Domain, Topic | `domainNodeCode`, `topicNodeCode` (structure-node codes, never names) |
| Objective | `learningObjectiveCode` |
| Target PRIMARY, intended SECONDARY concepts | `targetPrimaryConceptId`, `intendedSupportingConceptIds` |
| Exam Skill | `examSkill`, null until the Curriculum has one |
| Response format, difficulty, language, intended pool | `responseFormat`, `difficultyBand`, `language`, `intendedPool` |
| Stimulus requirement | `stimulus` (none, or kind + group size) |
| Asset requirement | `assets` |
| Provenance and authorship | `provenance` with `authorship`: a person ⇒ `STUDYUS_AUTHORED`, a model ⇒ `STUDYUS_GENERATED`; a mismatch is refused |
| Pedagogical reference metadata | `references` — the Reference Intelligence Pack |

Reference Intelligence Pack: each source has an identity (`sourceKey`), a type (`OFFICIAL_SPECIFICATION`, `OFFICIAL_SAMPLE`, `PEDAGOGICAL_REFERENCE`, `STUDYUS_INTERNAL`), its access, and a permitted-use class (`REFERENCE_ONLY`, `ADAPTATION_LICENSED`, `REPRODUCTION_LICENSED`, `ACCESS_NOT_VALIDATED`). It carries pedagogical facts restated by StudyUs, each tied to its sources and declared free of copied expression; the pack itself declares it holds no copied protected expression. A pedagogical reference can only be reference-only; a source whose access is not validated can be listed and cannot yet support a fact.

A package establishes none of: human review, PRIMARY attribution, Topic link, reuse rights, originality, pool membership, pilot eligibility. A field named `target…` or `intended…` is a request. The schema refuses unknown fields, so a package cannot carry `approved` or `reuseRights`.

`QUESTION_PRODUCTION_DRAFT_PACKAGE = CERTIFIED` as a contract. No tool writes or consumes packages yet.

`KOGNITY_ACCESS_VALIDATION = DEFERRED_TO_QUESTION_PRODUCTION`. Not accessed. When activated it enters as a `PEDAGOGICAL_REFERENCE` source, `ACCESS_NOT_VALIDATED` until access and rights are validated, then `REFERENCE_ONLY`.

## 9. Legacy certification debt

`scripts/operations/track-b-question-bank-migration-cert.sh` stops at its step 5 (`track-b-question-bank-integration.ts`): 58 checks, 5 failed.

| Check | Expectation |
|---|---|
| `PAA.reduced-mock-assembles` | the reduced mock is ready on the seeded PAA bank |
| `QUEUE.bounded-gaps-created` | exactly three bounded P1 gap requests (it gets cells for two English objectives and algebra) |
| `COVERAGE.algebra-practice-coverage-up-by-3` | three generated items raise practice coverage by three |
| `READINESS.reduced-mock-non-regression` | the reduced mock is still ready afterwards |
| `POLICY.practice-may-use-pilot` | practice may deliver a PILOT item |

Proof it predates this work: the script was run on the untouched commit `47ba817` (before Q1-R0 and QB-R1A) and fails the same five checks with the same totals.

Stale script or inconsistent product? By reading, four of the five assert behaviour that later certified decisions changed on purpose: readiness no longer counts fixture content as real (so a fixture-only PAA bank has no ready reduced mock), and practice delivers only ACTIVE or CALIBRATED versions (PILOT is not Student-facing). The script was last changed before those decisions. That makes it stale rather than evidence of a product defect; the fifth (`QUEUE.bounded-gaps-created`) was not diagnosed. This is an assessment from the code, not a fix and not a re-certification.

Consequence: the section of that script changed in QB-R1A (step 7, human reviewers and explicit grants) and the attribution step added to `qb-v2-integration.ts` here have not run end to end. The same rules are certified by `qb-r1a-reviewer-governance-cert.sh`.

`LEGACY_MIGRATION_CERT_DEBT = DOCUMENTED`
