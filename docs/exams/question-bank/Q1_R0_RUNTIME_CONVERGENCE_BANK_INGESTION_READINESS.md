# Q1-R0 — Runtime Convergence & Bank-Ingestion Readiness

Branch `integration/q1-paa-bank-readiness`. Converges CURR-PAA (`473d0eb`) and B2-B2 (`5847002`) on the B2-B1 base (`47ba817`), aligns the repository with the DEV migration ledger, wires pilot-eligibility condition 5, and defines what remains before real Question Bank ingestion. No objective was re-parented, no qualification granted, no item, variant, form, pool, stimulus or rights record created.

Locked: `PAA_OBJECTIVE_REPARENTING = DEFERRED_UNTIL_NEW_PAA_VERSION_CUTOVER`. `paa.red.cohesion` stays a legacy-only dependency until that cutover; the concept *Cohesión y conectores* is untouched.

## 1. Concurrent B3 / B4 / B5 work (read-only audit)

| | B3 | B4 | B5 |
|---|---|---|---|
| Branch | `feat/assessment-b3-evidence-loop` | `feat/assessment-b4-unified-student-experience` | `integration/assessment-b5-runtime-certification` |
| HEAD | `b8e58e9` | `1211fd3` | `2926c29` |
| Worktree | clean | clean | clean |
| Base | `621b101` (B2 core checkpoint) | B3 + frozen T1 line | B4 + Q1 line + B2-A + B2-B1 (`47ba817`) |
| Migrations | `20261110_1000_assessment_snapshot` | same | renamed `20261110_1800_assessment_snapshot` (the eight B2-B1 files took 1000–1700); applied to DEV from this line |
| Scope | B0-U universal curriculum delta; FrozenAssessment snapshot, evidence plan, post-assessment state | unified Student assessment experience (views, continuation, i18n) | start and completion authorities, routes and pages behind `ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED` (off unless set), real-Postgres script |
| Own certification | B3 report | B4 report | `DEV_STATUS: FAIL (not certified)`, `STAGE_NO_GO`, `NOT_READY_FOR_RELEASE` |
| Contained in another line | in B4 and B5 | in B5 | in none |
| Overlap with Track A / B | none in source | none in source | two test files with Track A (migration-chain assertions); merges cleanly with Track B |

```
B3_CONCURRENT_STATE = PRESENT_CLEAN_CONTAINED_IN_B5 (b8e58e9)
B4_CONCURRENT_STATE = PRESENT_CLEAN_CONTAINED_IN_B5 (1211fd3)
B5_CONCURRENT_STATE = PRESENT_CLEAN_SELF_REPORTED_NOT_CERTIFIED (2926c29); one migration of it is on DEV
```

Architecture: no conflict with Q1-I2 / B2 was found. The B5 line consumes B1 coverage and the B2 solution and freezes them per attempt; it does not define pools, variants, rights, attribution or a second frozen-form table, and it does not read `exam_instances.frozen_form_id`. Two things the protected start path must reconcile later, neither a conflict today: B5's snapshot references the per-instance form JSON, while B2 persists forms in `assessment_frozen_forms`; and B5 records independence on evidence (`metadata.independenceEligible`), which is where Q1's independence rule belongs. None of the three lines was merged, modified or reset.

## 2. Migration lineage

`20261110_1800_assessment_snapshot.sql` existed only on the B5 line: written in `b8e58e9` (as `20261110_1000`), renamed in `2926c29`. The owning commit also carries B3–B5 application code, so cherry-picking it would import that uncertified line. The file was adopted byte-for-byte (same SHA-256 as the B5 file; the runner reports 0 drift against the DEV ledger). When the B5 line is merged later the file is identical on both sides.

`REPO_MIGRATION_LINEAGE = DEV_MIGRATION_LINEAGE`: 81 files + baseline = 82 ledger rows, 0 pending, 0 drift.

## 3. Source convergence

| Commit | What |
|---|---|
| `89317d2` | merge of Track B (`5847002`) |
| `095ffc8` | merge of Track A (`473d0eb`) |
| `bd16b95` | condition 5 runtime, migration `20261110_1800` adopted, two operator scripts |
| `7554acc` | merge of the frozen T1 line (`41e9676`) |

The T1 merge was not in the brief. Hosted DEV was serving `a348a4a` (the T1 freeze), two commits the B2 line did not have; deploying without them would have removed two certified T1 fixes from DEV. Certified commits were not rewritten.

Objective placement after convergence: the 20 legacy PAA objectives hang from their bootstrap section nodes, none under a hierarchy node; the legacy `v2.paa` blueprint and its targets are unchanged; new-item traceability is item version → Topic → Domain.

## 4. Condition 5 at runtime

`src/lib/assessment-foundation/pilot-eligibility.ts`. The coverage reader carries the stored link (`curriculumTrace`); `curriculumTraceVerdict` is satisfied only when:

1. a link exists (the table allows one per item version);
2. the linked node is of type `TOPIC` and active;
3. its direct parent is of type `DOMAIN`, with source `OFFICIAL`, and active;
4. the Topic is in the structure version of the item's own objective, and that version is `PUBLISHED`;
5. the Topic's structure version is inside the request's curriculum scope, when the request gives one.

Nothing is read from a label, a code or the objective's text. A legacy item fails with `TOPIC_LINK_MISSING`.

`evaluatePilotEligibility` combines the conditions this layer can see — the delivery rule with rights, stimulus and assets (1, 7, 8), human review (2), one PRIMARY concept (4), condition 5, provenance (9) — and names the five it does not decide: reviewer qualification (3, enforced by the database), response format (6), originality (10), pool (11), blueprint cell (12). It is not the whole PILOT_ELIGIBLE verdict and says so in its result. The general delivery rule (`evaluateQuestionEligibility`) is unchanged: condition 5 is a pilot condition, not a rule for every exam.

Consequence on DEV: the Matemáticas V2.1 structure version is a **draft** (the subject already had a published version from the retired `v2.paa.math` configuration). A new Matemáticas item would be traced correctly and still fail condition 5 with `STRUCTURE_VERSION_NOT_CURRENT` until Curriculum publishes that version. Publishing it supersedes the old one and belongs to the PAA version cutover.

`PILOT_ELIGIBILITY_CONDITION_5_RUNTIME = PASS` (11 unit tests; on a real database 17 new items, one per Domain, all satisfied, and legacy items refused).

## 5. Blueprint readers

Re-verified on the converged branch: 21 read statements in 17 source files, all selecting the legacy blueprint; the architecture test fails on any new unfiltered reader. (B2-B2 reported 16 files before two target readers were closed at review.)

| Script | Class | Action |
|---|---|---|
| `qb-v2-integration.ts` | MUST_FIX_BEFORE_VARIANTS — computes generation demand from a version's targets on real environments | fixed |
| `qb-mock-certification.ts` | MUST_FIX_BEFORE_VARIANTS — read-only, but would join a variant and report on the wrong blueprint | fixed |
| `exam-platform-v2-integration-cert.ts` | CERT_ONLY — ephemeral database it creates | none |
| `g6-exam-evidence-isolation-cert.ts` (3 queries) | CERT_ONLY | none |
| `f7-lifecycle-cert-runner.ts` | CERT_ONLY | none |
| `track-b-question-bank-migration-cert.sh` | LEGACY_SAFE — its own database, stopped at its own migration | none |

Both fixes use `to_jsonb(b) ->> 'purpose' IS NULL`, which is also NULL where migration `20261110_1600` is not applied (Preview is at an older ledger).

## 6. Protected start path — remaining contract (not built)

| # | Step | Contract |
|---|---|---|
| 1 | Variant slot positions | A variant's slots are `blueprint_objective_targets` rows of the variant. Needed: a B2 writer for them (draft only, beside requirements) and a reader that builds `FormPosition[]` in section order from targets + `SECTION_ORDER` / `SECTION_ITEM_COUNT` requirements. Sum of positions must equal `TOTAL_ITEM_COUNT`; refuse otherwise |
| 2 | Fidelity | Computed, never passed in: `classifyExamFormFidelity` over the assembled positions against the variant's official requirements. `FULL` only when every official count, order and response format holds; a `REDUCED` variant must carry `REDUCED_SIZE`. Stored on the form at freeze and re-derived at publish; a mismatch refuses publish |
| 3 | Eligibility at start | see revalidation below |
| 4 | Choosing the form | For (exam version, purpose): published forms of published variants, in form-number order; the first whose every item and stimulus is unexposed for the Student and passes revalidation. None left → `NO_UNSEEN_FORM`; never repair a form per Student |
| 5 | Exposure hard check | `frozenFormEligibility` with item exposure (any version of the bank item) and stimulus exposure (any member of the group, any version). Read inside the start transaction |
| 6 | Instance | One transaction: create the instance in mode MOCK, set `frozen_form_id`, derive `FULL_MOCK` / `REDUCED_MOCK` from the form, and keep the per-instance `form` JSON as a copy for existing readers until they read the form table |
| 7 | Usage | One `exam_item_usage` row per position in the same transaction, with the delivery use of the form's pool; a second start of the same form by the same Student is refused by step 5 |

`START_TIME_REVALIDATION = REQUIRED`. Revalidated for every position, inside the start transaction, against current facts:

- the item version is still the current version of its bank item, the item is not retired, and its lifecycle is still deliverable;
- B1 eligibility for the Student audience still holds: reuse rights in force today for the item version, its stimulus version and every asset; stimulus version still active, approved and current; assets active;
- the item's pool membership is still active and still the form's pool;
- the blueprint variant and the form are still `PUBLISHED`.

Any failure makes the form ineligible for everybody until it is retired and a new revision is frozen; the start path moves to the next form and reports the failed form to operations. A form is never patched. Not revalidated: attribution and the curriculum link, which are fixed with the item version.

Also for that gate: a retire path for variants and forms; and the reconciliation with the B5 line's snapshot noted in section 1.

## 7. Stimulus-group placement

Current rule: requirements in key order, groups in unit-id order, each group at the earliest run of adjacent free positions that fits, taking the largest allowed number of its questions; the existing solver then fills the rest. There is no backtracking.

Where it fails although a valid form exists (analysis of the rule, not a measurement):

- **Exact cover.** A section whose positions are all stimulus-bound needs group sizes that sum exactly to the section. Taking the largest allowed subset of each group in id order can overshoot or leave a remainder no group fits, where another choice of groups or of subset sizes fits exactly.
- **Order dependence.** Whether a form is found depends on unit ids, which mean nothing.
- **Coupled constraints.** A group chosen early can consume the only positions whose slot constraints (Domain, difficulty band) another group needs.

PAA is the worst case for this rule: Lectura (45) and Inglés reading are almost entirely passage-bound, Redacción (25) works on draft paragraphs, and three disjoint forms must be built from separate pools.

`GREEDY_GROUP_SOLVER = MUST_HARDEN_BEFORE_REAL_FORMS`

Required improvement (not implemented): group placement becomes a search inside the deterministic solver — choose a set of groups and a subset size for each such that sizes sum to the stimulus-bound positions of each section and every member fits its slot, with backtracking and a stable tie-break; report `NO_GROUP_PACKING` only after the search is exhausted or a stated budget is reached, and say which. The certification must include adversarial fixtures where greedy fails and the search succeeds.

## 8. Template-family exposure

`TEMPLATE_FAMILY_EXPOSURE = NOT_IMPLEMENTED`

What exists (DEV, read-only): `approved_items.template_fingerprint` on 458 of 509 versions, 323 distinct values, 125 of them shared by more than one bank item; `exam_item_usage` records `semantic_fingerprint` and `template_fingerprint` per delivery. `approved_item_families` is empty and no version has a family id. So a computed similarity signal exists; a reviewed family relation does not.

Protected exposure counts a delivery by item version (extended to every version of the same bank item, and to the stimulus group). A template sibling of a delivered item is treated as unseen.

Ownership:

| Part | Owner |
|---|---|
| Declaring that two bank items are variants of one family (a reviewed fact, with who decided) | Question Bank identity |
| Excluding a family when one member was delivered, for protected pools | B2 exposure, reading that fact |
| Not counting two members of a family as independent observations | B3 independence |

Future contract: the Question Bank records family membership on the bank item (one family or none; set at authoring or review; never inferred silently from a fingerprint — a fingerprint match is a prompt for a reviewer). B2 receives `familyId` on the selection unit and treats exposure of any member as exposure of all, and puts a family in one pool. B3 treats members as non-independent. No family relation was invented here.

## 9. Reviewer governance — discovery (read-only, nothing granted)

Candidates under review on DEV:

| Exam family | Config | Objective | Items | Author | Subject determinable |
|---|---|---|---|---|---|
| PAA | `v2.paa` | `paa.lect.evidencia` | 1 | system account `dev_seed_catalog_editor` | yes — *Lectura crítica* |
| PAA | `v2.paa` | `paa.mat.algebra` | 2 | same | yes — mapped concepts sit in two canonical subjects, *Matemáticas* and *Mathematics* |
| ICFES | `v2.saber11.math` | `saber.interpretacion` | 2 | same | no |
| ICFES | `v2.saber11.math` | `saber.formulacion` | 4 | same | no |
| ICFES | `v2.saber11.math` | `saber.argumentacion` | 2 | same | no |

All eleven are `STUDYUS_GENERATED`, in `PILOT`, authored by a system account, so the author-is-not-reviewer rule is met by any person.

Why the eight Saber candidates have no subject: the three Saber objectives have **no** objective → concept mapping in any status, and no item has a PRIMARY concept. The cause is one curriculum gap, not eight item problems. Either the objectives get published mappings (Curriculum) or each item gets a reviewed PRIMARY concept (Question Bank review). `SABER_APPROVALS_WITHOUT_SUBJECT = BLOCKED_BY_DESIGN` stands.

Reviewer identities found: no reviewer qualification exists. `curriculum_editorial_grants` holds three rows, all revoked, all on system seed accounts. DEV has three active `STUDYUS_ADMIN` users and seven `INSTITUTION_ADMIN` users; a platform role says nothing about subject expertise. The certification scripts use `system:cert-reviewer`, a system account, which cannot be a qualified reviewer. No script or configuration names a real reviewer.

Proposed qualification matrix (input for QB-R1):

| Reviewer | Canonical subject | Exam family | Evidence / source | Grant needed? |
|---|---|---|---|---|
| UNRESOLVED | Lectura crítica | PAA | 1 candidate on `paa.lect.evidencia` | yes |
| UNRESOLVED | Matemáticas | PAA | 2 candidates on `paa.mat.algebra` | yes |
| UNRESOLVED | Mathematics | PAA | same 2 candidates; either subject satisfies the rule today | only if the reviewer is not granted *Matemáticas* |
| UNRESOLVED | to be determined | ICFES | 8 Saber candidates; subject undeterminable | not until the subject exists |
| UNRESOLVED | Redacción, English | PAA | no candidate yet; needed for new content | at authoring |

Each row needs from governance: the person, the grantor (not the same person), and validity dates. Open question for QB-R1: *Matemáticas* (32 concepts) and *Mathematics* (27) are two canonical subjects for one discipline; a reviewer qualified in one is not qualified in the other.

`REVIEWER_GOVERNANCE_INPUTS = DISCOVERED`

## 10. Question production workflow (contract; no ingestion)

```
Requirement Cell -> Reference Intelligence Pack -> Author / AI Generation -> Automated Structural Checks
-> Originality / Similarity Check -> Human SME Review -> Rights Validation -> Pool Assignment -> PILOT_ELIGIBLE
```

| Stage | Produces | Stored in | Gate to the next stage |
|---|---|---|---|
| Requirement Cell | exam version, section, Domain, Topic, target PRIMARY concept, difficulty band, question type, stimulus need, intended pool | the request (not an item) | every field present; Topic belongs to the Domain |
| Reference Intelligence Pack | specification excerpts, concept definition, style rules, pedagogical references | `assessment_sources` rows with `source_access`; nothing copied into an item | every reference has a source row |
| Author / AI Generation | bank item + version 1; stimulus and assets when needed | `question_bank_items`, `approved_items`, `question_bank_stimuli` / versions / parts, `question_bank_assets` | provenance fixed: `STUDYUS_AUTHORED` (a person, no generation lineage) or `STUDYUS_GENERATED` (lineage kept for ever) |
| Automated Structural Checks | validation report | `approved_items.validation_report` | passes; generated content cannot be approved without it |
| Originality / Similarity | check result and disposition | `question_bank_originality_checks` | disposition `ACCEPTED`; a `MATCH` is never accepted |
| Human SME Review | decision, checklist, PRIMARY / SUPPORTING concepts, Topic link, validated difficulty, usage and alignment | `question_bank_reviews`, `question_bank_item_concepts`, `question_bank_item_curriculum_nodes`, `question_bank_stimulus_reviews` | approving review by a qualified reviewer who is not the author |
| Rights Validation | rights record for the item version, its stimulus version and every asset; content sources with usage | `question_bank_content_rights`, `question_bank_content_sources` | reuse `STUDYUS_OWNED`, `LICENSED_FOR_USE` or `OFFICIALLY_AUTHORIZED`, in force |
| Pool Assignment | one pool for the item, or for its stimulus | `question_bank_pool_memberships` | exactly one active membership |
| PILOT_ELIGIBLE | nothing new — a verdict | computed | all twelve conditions |

Known at creation (cannot be supplied later): exam version; learning objective; language; provenance and, for generated content, the generation request; author; question type; content; for stimulus-bound items the stimulus version and position; assets and their storage facts.

Supplied during review (while the version is under review; fixed once it is active): PRIMARY and SUPPORTING concepts; the Topic link; validated difficulty; usage and exam alignment; checklist key and version; stimulus review.

Supplied after review, independent of the version: rights records (append-only, can be superseded); pool membership (on the identity; can be retired); originality checks may also be recorded before review and must exist before eligibility.

Not yet buildable as written: reviewer qualifications (QB-R1); a UI or operator tool for attribution, Topic link, rights and pool (the tables and guards exist, no writer does); the Matemáticas structure version (section 4).

`QUESTION_PRODUCTION_WORKFLOW = CERTIFIED` as a contract against the deployed schema. It has not been executed.

## 11. Pedagogical reference sources

Policy slot `PEDAGOGICAL_REFERENCE_SOURCE`: an external source used to understand how a concept is taught or assessed. Three facts stay separate and none implies another:

| Fact | Where | Says |
|---|---|---|
| Reference source | `assessment_sources` (+ `source_access`), linked with usage `REFERENCE_ONLY` | what was consulted and how it can be read |
| Content provenance | `question_bank_items.provenance` | who wrote the item: a person, or a model |
| Reuse rights | `question_bank_content_rights.reuse_rights` | whether StudyUs may deliver the content |

A pedagogical reference is always `REFERENCE_ONLY`. If content adapts or reproduces a source, that is usage `ADAPTED` / `REPRODUCED` and needs a licence or authorisation; consulting a source never gives a reuse right. No schema change is needed for the slot; it is a source category to add when the first one is registered.

`KOGNITY_ACCESS_VALIDATION = DEFERRED_TO_QUESTION_PRODUCTION`. Kognity was not accessed and no third-party content was copied.
