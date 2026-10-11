# QB-R2B — Production Planning Resolution & Pilot Generation

Branch `feat/qb-r2b-planning-pilot`, on the integration line after QB-R2A. One authoring contract, the PAA backlog resolved into requirement cells, and a 24-item pilot batch stored as a planning artifact. Nothing was ingested: no Question Bank table was written, no review, qualification, rights record or pool membership was created, PAA Mathematics V2.1 was not published, and Kognity was not accessed.

## 1. One authoring contract

```
RequirementCell -> GenerationRequest -> QuestionCandidate -> ValidatedQuestionCandidate -> HumanReviewPackage
```

| Before | Now |
|---|---|
| `draft-package.ts` with `ProductionDraftPackage` (QB-R1B) beside the QB-R2A cell and candidate | removed. Its Reference Intelligence Pack is `reference-pack.ts`; nothing else of it remains |
| `GeneratedCandidate` | `QuestionCandidate` |
| structural result and originality result passed around separately | `ValidatedQuestionCandidate` (`validated-candidate.ts`): candidate + both automated gates + one automated status |
| review package built from loose parts | built from the validated candidate; carries a review status |

A test fails if a second draft-package model reappears. `AUTHORING_CONTRACTS_UNIFIED = PASS`.

The requirement cell (version 2) now states everything before generation: exam family and configuration, Section, Domain, one Topic, one PRIMARY concept (certified stable id plus canonical subject and name), count, pool, response format with its authority, difficulty band with basis `EDITORIAL_ESTIMATE`, stimulus plan, blueprint variant for mock cells, curriculum currentness, and a `binding` that holds one environment's row ids. A cell can be planned unbound; a generation request refuses an unbound cell.

## 2. The 353 rows resolved

`resolvePaaRequirementCells()` turns the 353 backlog rows into **789 cells for 865 items**, with no violation. `scripts/operations/qb-paa-requirement-cells.ts` prints them; with `--bind` it attaches DEV's row ids through a session that refuses writes.

| Pool | Items | | Section | Items |
|---|---|---|---|---|
| Practice | 183 | | Lectura | 197 |
| Diagnostic | 122 | | Redacción | 97 |
| Verification | 122 | | Matemáticas | 383 |
| Reduced Mock | 88 | | Inglés | 188 |
| Full Mock 1 | 175 | | | |
| Full Mock 2 | 175 | | | |

Each Full Mock keeps 45 / 25 / 55 / 50 and the Reduced Mock 23 / 12 / 28 / 25. All 61 concepts are used; 82 of the 84 Topics take items (two English Topics have no certified concept, so no cell can have a PRIMARY concept there).

Artifact: `docs/exams/question-bank/audits/q1-paa/QB_R2B_paa_requirement_cells.dev.json` — the 789 cells bound to DEV (`2a29b99ee14a22b4`): 789 bound, 0 unresolved, 82 Topic node ids, 61 canonical concept ids. Row ids are DEV's; another environment needs its own binding.

### Topic and concept policy (`q1-paa-cell-resolution` v1)

1. A per-concept row already names its concept. Its items are spread over that concept's certified Topics in code order, one per Topic in turn; the starting Topic shifts by pool, so the three pools of a concept do not all begin on the same Topic.
2. A mock row names a Domain. Its items are spread over the Domain's certified (Topic, concept) pairs in Topic order, one in turn, and the turn carries over between rows of that Domain within a form. Each form starts at a different Topic. Result: within a form, the Topics of a Domain differ by at most one item.
3. A cell's Domain is the Domain of its Topic. Three concepts are certified under Topics of two Domains and yield cells in both.
4. The pool is part of the cell key: no cell is shared between pools.

The PRIMARY concept is fixed in the cell. A candidate is written for it; SUPPORTING concepts are the author's proposal and stay non-authoritative until review.

### Planning values and their authority

| Value | Rule | Tag |
|---|---|---|
| Count | per-concept 3 / 2 / 2; mock split by Domain from the published practice test's pattern | `STUDYUS_POLICY` (a mock's section total is official; its split is not) |
| Response format | per-concept cells: multiple choice. Mock cells: the row's format — 840 multiple choice, 25 student-produced, all in Matemáticas | `STUDYUS_POLICY` on every cell. No official per-Domain format distribution exists, and none is claimed |
| Difficulty | mock cells: the row's band. Per-concept: Practice F / S / C, Diagnostic S / F, Verification S / F | `EDITORIAL_ESTIMATE` on every cell: 311 foundational, 408 standard, 146 challenge. Never the exam's own classification |
| Stimulus | from the catalogue's note on the concept | below |
| Currentness | Matemáticas cells: `CURRICULUM_CURRENTNESS_BLOCKED_UNTIL_PAA_CUTOVER` (383 items); the rest `CURRENT` (482) | shown as BLOCKED on condition 5 by the projection at every stage |

Stimulus plan, in items: standalone 297; stimulus required 487 (passage 198, numbered text 97, figure 86, draft paragraph 25, poem 19, graph 15, paired passage 12, composite 12, table 12, data set 11); stimulus optional 81 (graph 71, data set 10).

`PAA_REQUIREMENT_CELLS = RESOLVED`, `PAA_TOTAL_PLANNED_ITEMS = 865`.

### Found while resolving

Three certified mathematics concepts — quadratics, exponential models, trigonometry — live in the canonical subject *Mathematics*, not *Matemáticas*. 28 planned items target them. Because the reviewer rule reads the PRIMARY concept's subject, those items need a *Mathematics* × PAA reviewer, which the locked `PAA_MATH_CANONICAL_SUBJECT = Matemáticas` does not cover. Nothing was changed; it needs a decision (grant both, or move the three concepts in the Curriculum).

## 3. Pilot batch

24 candidates in `docs/exams/question-bank/pilots/qb-r2b/pilot-batch.json`, six per Section, with four original stimuli (an informative passage, a poem, a numbered draft text, an English passage). 14 stimulus-based, 10 standalone; 8 foundational, 12 standard, 4 challenge; Practice 13, Diagnostic 5, Verification 4, Full Mock 1 two; 23 multiple choice, 1 student-produced.

**How they were generated.** The model wrote them in this session from the certified catalogue: each for a resolved cell's PRIMARY concept, with a rationale and a reason for every wrong option. All text is original; no external source, no official question and no Kognity material was used. They are `STUDYUS_GENERATED` with a model lineage. There was no prompt template and no repeatable pipeline run.

`scripts/operations/qb-r2b/pilot-evaluate.ts` runs the batch through the contracts and writes two files beside it: `pilot-automated-report.json` and `pilot-review-packages.json`. `PILOT_GENERATION_INGESTED = NO`.

### Automated results

| Gate | Result |
|---|---|
| Schema (batch, candidates, stimuli) | 24 of 24 valid |
| Structural validation (11 checks, draft stage) | 24 pass |
| Originality vs the 23 batch siblings | 24 `PASS_LOW_SIMILARITY`; 0 review; 0 reject. Highest sibling similarity 0.214, between two English items that share the instruction sentence |
| Originality vs the internal bank (496 current DEV items, read-only) | 24 low similarity; highest 0.227 |
| Stimuli against each other | 0 |
| Rights gate | 24 `NOT_ESTABLISHABLE` — no reference to the terms under which model output is owned is on file |
| Review packages | 24 built; `REVIEW_STATUS = BLOCKED_NO_QUALIFIED_REVIEWER`; no approval simulated |
| Projection | Matemáticas items show condition 5 BLOCKED (cutover); all show condition 6 BLOCKED |

The originality gate is lexical and template-based. It does not detect paraphrase and makes no claim about semantic similarity.

### Quality review

Done by the same model that wrote the items. It is not an independent review and not a human one.

| Check | Finding |
|---|---|
| Concept fidelity | 22 clearly require their PRIMARY concept. 2 are uncertain: the Redacción items for *Adición* and *Particularización*. No definition of those PAA operations is in the reference pack, so the items follow the model's reading of the names |
| Answer correctness | 24 keys re-worked and correct (the six mathematics answers recomputed) |
| Distractors | each wrong option has a stated misconception; none duplicates the key. Not tested on students |
| Ambiguity | one defensible answer in each, on the model's reading |
| Difficulty | 23 plausible for their band; 1 doubtful — the reading inference item is labelled challenge and reads as standard. Bands are estimates and unvalidated |
| Independence | standalone items are independent. Within the numbered text, two questions work on the same sentence; neither gives the other's answer |
| Stimulus integrity | every stimulus question is answerable from its text |
| Wording | natural Spanish and English on the model's reading; no native-speaker check |

| Metric | Result |
|---|---|
| generated | 24 |
| structurally valid | 24 |
| answer-key valid | 24 |
| concept-fidelity pass | 22 (2 uncertain) |
| originality low-similarity | 24 |
| needs regeneration | 3 as content (2 fidelity, 1 difficulty band); 14 need re-planning (below) |
| rejected | 0 |
| review-ready | 21 as content; 24 packages built; 0 can be reviewed |

| Section | Generated | Structurally valid | Key valid | Fidelity pass | Low similarity | Content issues |
|---|---|---|---|---|---|---|
| Lectura | 6 | 6 | 6 | 6 | 6 | 1 difficulty band |
| Redacción | 6 | 6 | 6 | 4 | 6 | 2 uncertain fidelity |
| Matemáticas | 6 | 6 | 6 | 6 | 6 | none |
| Inglés | 6 | 6 | 6 | 6 | 6 | none |

### Defect the pilot exposed

All four stimuli have questions planned into more than one pool (the numbered text into four). A stimulus group belongs to one pool as a whole — pool membership is on the stimulus — so these 14 questions could not be assigned as planned. The cause is in the plan, not in the questions: a cell is one (pool, Topic, concept), and a stimulus set spans several cells. Nothing in the plan says which cells share a stimulus. A test keeps this visible.

## 4. Generator decision

`GENERATOR_READY_FOR_SCALE = NO`

The 24 items passing every automated gate does not show a generator works at scale, because there is no generator yet.

| # | Defect | What is needed before scaling |
|---|---|---|
| 1 | No generator. The items were written in-session; there is no prompt, no pipeline and no repeatable run, so no pass rate can be claimed | a generation pipeline that takes a `GenerationRequest` and returns a batch, with a versioned prompt, run on a sample large enough to measure |
| 2 | Stimulus sets are not planned. 487 items need a stimulus and the plan has no unit for one | a stimulus-set plan: which cells share a stimulus, in one pool, with how many questions; and the number of sets per kind |
| 3 | Reference packs hold no concept definitions. Fidelity was uncertain exactly where a definition was missing (two Redacción operations) | a pack per concept with at least its definition, prerequisites and typical task form, from the official guide, restated |
| 4 | No figure, graph, table or data-set stimulus was produced. 124 items require one and 81 may | an asset path: specification, production, alt text, rights — then a pilot that includes them |
| 5 | The quality review was made by the generator itself | an independent check (a second model pass at least; a human SME for the pilot) |
| 6 | Rights cannot be established | the authorship-terms reference for model output, accepted operationally |
| 7 | One student-produced item only; accepted-answer normalisation is unspecified | an answer-normalisation rule and a larger sample |
| 8 | Difficulty bands are unvalidated estimates | acceptable for drafting; needs calibration data later |
| 9 | Shared instruction sentences raise sibling similarity (0.214) | exclude boilerplate from the compared text, or it will produce false reviews at scale |

## 5. Verification

| Check | Result |
|---|---|
| TypeScript | clean |
| Unit suite | 508 files / 9,062 tests, 0 failures. `qb-production-os.test.ts` (59 tests) replaces the QB-R2A file and the draft-package cases of QB-R1B |
| Deterministic 865 assertions | totals, section totals, pool totals, mock form totals, zero overlap, one PRIMARY / Topic / Domain per cell |
| Existing certifications | governance, CURR-PAA, B2-B1, B2-B2, platform chain — see the phase report |
| Production build | exit 0 |
| DEV | read only (binding and bank comparison through sessions that refuse writes); ledger 83, no row changed |

## 6. Status

`REAL_HUMAN_REVIEW = BLOCKED` (no qualified reviewer), `KOGNITY_ACCESS_VALIDATION = DEFERRED`, `READY_FOR_BANK_INGESTION = NO`, `QUESTION_BANK_READY = FAIL`, `PILOT_READY = FAIL`.
