# Q1-R0A + QB-R1A — DEV Alignment & Reviewer Governance Bootstrap

Branch `feat/qb-r1a-reviewer-governance`, cut from the converged commit `d2109e9`. No qualification was granted, no candidate approved, no mapping written, nothing published or merged in the Curriculum, and Kognity was not accessed.

## 1. Q1-R0 closed

The stable DEV alias `https://study-os-env-dev-study-so.vercel.app` was moved to the existing immutable deployment `dpl_BUhDVXrejuDKtS8okwnh2m81NFd3` (commit `d2109e9`). Nothing was rebuilt.

| Check after the move | Result |
|---|---|
| `/api/version` on the stable URL | commit `d2109e9`, target `dev`, that deployment id |
| Database fingerprint | `2a29b99ee14a22b4` |
| Sign-in page | HTTP 200 |
| Ledger | 82 applied, 0 pending, 0 drift; last applied timestamp unchanged |
| Data snapshot (objectives, nodes, concepts, mappings, items, blueprints, instances, attempts) | hash-identical to the snapshot taken before the move |

`Q1-R0 STATUS = PASS`, `DEV_CODE_ALIGNED = YES` (for `d2109e9`; the code of this branch is not deployed).

## 2. Decisions in force

| Decision | Value |
|---|---|
| Concurrent lines | `B3 = HOLD`, `B4 = HOLD`, `B5 = HOLD_UNTIL_CERTIFIED`. Not merged, modified or deployed. Migration `20261110_1800` stays in the lineage because it is applied and byte-identical |
| PAA Mathematics structure version | `PAA_MATH_V2_1_PUBLISH = DEFERRED_TO_NEW_PAA_CUTOVER`. Mathematics items can be authored and cannot satisfy condition 5 until then |
| Canonical subjects | *Matemáticas* and *Mathematics* stay separate for qualification. One is never inferred from the other. Merging them is Curriculum work |
| Objective re-parenting | `DEFERRED_UNTIL_NEW_PAA_VERSION_CUTOVER` |
| Approvals | `APPROVAL_CAPABILITY = LOCKED` until real grants exist; `SABER_APPROVALS_WITHOUT_SUBJECT = BLOCKED_BY_DESIGN` |

## 3. Where an approving review is made

| Place | What it did | Now |
|---|---|---|
| `reviewVersion` (`question-bank/review.service.ts`) — the only code that records a review; used by the admin route and by `qb-v2-integration.ts` | inserted the review; since migration 6 the database refused an unqualified approval with a raw constraint error | asks `requireReviewerQualification` before writing: a system account, an unqualified person and an item with no determinable subject are refused by name. No alternative path |
| `POST /api/admin/question-bank/questions/[versionId]/review` | mapped database refusals to a generic rule violation | answers `REVIEWER_IS_SYSTEM_ACCOUNT`, `REVIEWER_NOT_QUALIFIED` (403) or `REVIEW_SCOPE_UNDETERMINED` (409) |
| `qb-v2-integration.ts` | took the first two **system** accounts as editor and reviewer | takes two named people from `QB_CERT_REVIEWER_IDS`; stops with `NO_QUALIFIED_REVIEWER` if they are missing, are system accounts or hold no valid PAA qualification; grants nothing |
| `track-b-question-bank-migration-cert.sh` | ran that script with system accounts | creates human fixture reviewers and a human grantor on its ephemeral database and grants through the operator procedure; asserts no system account is qualified |
| `qb-pilot-saber11.ts` | reports reviews; never approved | an approval now counts as valid only with a human, independent reviewer **and** a stamped qualification |

Where the governance schema is absent (an environment that has not received migration `20261110_1500`), `reviewVersion` behaves as before: there are no qualifications to ask for there. That is the state of that environment, not a path around the rule on DEV.

Not verified: `track-b-question-bank-migration-cert.sh` stops at its own step 5 (`track-b-question-bank-integration.ts`, 5 of 58 checks) before reaching the changed step 7. The same five checks fail on the untouched base commit `47ba817`, so the failure predates this work; the changed section of that script has therefore not run end to end. The same rules are certified by `qb-r1a-reviewer-governance-cert.sh`.

## 4. Grant contract

One grant = one person, one canonical subject, one exam family. A person may hold several.

| Input | Rule |
|---|---|
| Reviewer | a user id; a person (never a system account); active |
| Canonical subject | a `canonical_subjects` id, active. No name, no wildcard |
| Exam family | one the catalogue has (`exam_definitions.exam_family`). No wildcard |
| Granted by | a user id; a person; holds an active `STUDYUS_ADMIN` role; not the reviewer |
| Valid from | explicit timestamp |
| Valid to | optional; later than valid from |
| Revocation | by a person with the same authority, with a reason; a qualification is ended, never deleted or rewritten |

Refused by name: `WILDCARD_NOT_ALLOWED`, `SELF_GRANT`, `REVIEWER_IS_SYSTEM_ACCOUNT`, `REVIEWER_NOT_ACTIVE`, `GRANTOR_IS_SYSTEM_ACCOUNT`, `GRANTOR_NOT_AUTHORIZED`, `SUBJECT_NOT_FOUND`, `EXAM_FAMILY_NOT_FOUND`, `VALIDITY_INVALID`, `QUALIFICATION_ALREADY_HELD`. Holding the grant authority is not a qualification. There is no "all subjects" and no "all exams".

Operator procedure (`scripts/operations/qb-reviewer-qualification.ts`; DEV or an ephemeral database only; dry run unless `--write`):

```
npx tsx --env-file=.env.local scripts/operations/qb-reviewer-qualification.ts list

npx tsx --env-file=.env.local scripts/operations/qb-reviewer-qualification.ts grant \
  --reviewer <user uuid> --subject <canonical subject uuid> --exam-family <FAMILY> \
  --granted-by <user uuid> --valid-from <ISO date-time> [--valid-to <ISO date-time>] [--notes "<text>"] [--write]

npx tsx --env-file=.env.local scripts/operations/qb-reviewer-qualification.ts revoke \
  --qualification <uuid> --revoked-by <user uuid> --reason "<text>" [--write]
```

It was not run against DEV. There is no API route for grants; adding one is a product decision.

`REAL_REVIEWER_IDENTITIES_AVAILABLE = NO`. Nothing in DEV, the scripts or the configuration names a real reviewer; a platform role is not evidence of subject expertise.

## 5. PAA candidates

| Candidate | Subject | Exam family | Author | Required reviewer qualification | Other blockers |
|---|---|---|---|---|---|
| `qb.paa.lect.evidencia.808c865076` | Lectura crítica | PAA | system account `dev_seed_catalog_editor` (generated) | Lectura crítica × PAA | no rights record; no PRIMARY concept; no Topic link; no originality check; no pool; usage is practice / diagnostic / quiz only |
| `qb.paa.mat.algebra.851471c94a` | Matemáticas or Mathematics (the objective is mapped to concepts of both) | PAA | same | Matemáticas × PAA, or Mathematics × PAA | the same, and its structure version is a draft, so condition 5 cannot hold before the cutover |
| `qb.paa.mat.algebra.a0c44d1a82` | same | PAA | same | same | same |

All three passed automated validation and are `STUDYUS_GENERATED` in `PILOT`. A qualification alone would let a reviewer approve them; it would not make any of them PILOT_ELIGIBLE.

`PAA_REVIEWER_REQUIREMENTS = CERTIFIED`

## 6. Saber objectives

| Objective | Meaning | Curriculum subject → canonical subject | Blueprint targets | Items |
|---|---|---|---|---|
| `saber.interpretacion` | Interpretación y representación: understands and transforms quantitative and schematic information | Matemáticas → *Matemáticas* | 21 | 8 |
| `saber.formulacion` | Formulación y ejecución: sets up and carries out strategies to solve problems | Matemáticas → *Matemáticas* | 27 | 10 |
| `saber.argumentacion` | Argumentación: validates mathematical procedures and strategies | Matemáticas → *Matemáticas* | 14 | 7 |

The three objectives are the Saber 11 **competencies**. Each cuts across all three content categories of the exam (Álgebra y cálculo, Estadística, Geometría); the pilot specification allocates every competency to every category.

| Question | Finding |
|---|---|
| Candidate canonical concepts | any of the 32 concepts of *Matemáticas*, for every objective |
| Is an existing concept a true semantic match? | **No.** A competency is not a concept. Mapping `saber.formulacion` to, say, linear equations would say the objective *is* that concept; it is a way of working applied to all of them |
| Can a concept mapping be published safely? | No. The only "complete" mapping is all three objectives to most of the subject's concepts, which makes every Saber item evidence of every concept through the objective and adds no information |
| True semantic home | objective → **competency** mappings (`objective_competency_mappings`). Candidates exist — *Razonamiento matemático*, *Problem Solving*, *Reasoning / Justification* — and none is mapped. A competency mapping does not give the reviewer rule a subject |
| Shared-framework impact of a concept mapping | the *Matemáticas* concepts are shared with PAA; a blanket mapping would make Saber evidence count toward PAA-shared concepts through the objective |

So the preferred solution, objective → concept, is not semantically justified for these objectives. The remaining options, for a decision:

| Option | What it is | Cost |
|---|---|---|
| A. Subject from the curriculum | The objective's structure version belongs to academic subject *Matemáticas*, which the Curriculum already links to canonical subject *Matemáticas* (`academic_subjects.canonical_subject_id`). The reviewer rule would accept that as a third basis, after a PRIMARY concept and a published mapping | a new migration changing the approval trigger, and the same rule in the service. An existing curriculum fact, not an invented one. It needs explicit authorization because it changes Migration 6's rule. Note: on DEV the PAA sections *Lectura* and *Inglés* have no canonical subject linked, so this basis would not cover them |
| B. Item-level PRIMARY attribution at review | each Saber item gets its real PRIMARY concept (the content it is about) from a reviewer | correct and already supported; needs a writer for attribution and a reviewer; this is what new content will do anyway |
| C. Competency mappings | publish objective → competency mappings | right for the curriculum; does not unblock approval by itself |

Recommendation: C for the curriculum's sake, and B for the eight candidates when a reviewer exists; A only if approvals of unattributed items should be possible at all. No mapping was written.

`SABER_SUBJECT_REMEDIATION_PLAN = CERTIFIED`

## 7. Question production governance

Canonical process:

```
Requirement Cell -> Reference Intelligence Pack -> Author / AI Generation -> Automated Structural Validation
-> Originality / Similarity Check -> Human SME Review -> Rights Validation -> Pool Assignment -> PILOT_ELIGIBLE
```

Fields known at creation and supplied at review are in `Q1_R0_RUNTIME_CONVERGENCE_BANK_INGESTION_READINESS.md`, section 10.

| Step | Before bank ingestion? |
|---|---|
| Requirement Cell | yes — specification work outside the bank |
| Reference Intelligence Pack | yes — as a specification; sources are registered only at ingestion |
| Author / AI Generation | yes — drafting outside the production bank |
| Automated Structural Validation | yes on drafts; it is authoritative only when run on the ingested version |
| Originality / Similarity Check | policy and tooling yes; the recorded check needs the ingested version |
| Human SME Review | rubric yes; the review itself no |
| Rights Validation | checklist yes; the record no |
| Pool Assignment | plan yes; the membership no |

Allowed now: coverage-cell specifications; authoring templates; reviewer rubric; rights checklist; originality policy; Reference Intelligence Pack specification; external drafting and generation; the PAA production backlog.

Not allowed yet: production bank ingestion; approvals; real pool assignments; real PAA frozen forms; delivery.

## 8. Kognity

`KOGNITY_ACCESS_VALIDATION = DEFERRED_TO_QUESTION_PRODUCTION`. When activated: Kognity may be used as a pedagogical reference, subject to validated access and rights. StudyOS must not copy or lightly paraphrase protected questions or text. A reference is recorded as a source with usage `REFERENCE_ONLY`; the item's provenance and its reuse rights are separate facts and are not derived from the reference. Not accessed in this phase.

## 9. Verification

| Check | Result |
|---|---|
| TypeScript | clean |
| Unit suite | 505 files / 8,992 tests, 0 failures |
| `qb-r1a-reviewer-governance-cert.sh` (ephemeral) | grant contract and approval path 33 checks; operator script refusals, dry run, write and revoke; review service 6 checks. 0 qualifications after seeds and after the rolled-back contract run |
| Production build | exit 0 |
| DEV | untouched by this branch: 0 qualifications, 0 reviews, 11 candidates unchanged |
