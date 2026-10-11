# QB-R2C — Production Planning Hardening & Repeatable Generator

Branch `feat/qb-r2c-planning-generator`, on the integration line after QB-R2B (`905cc39`). Planning code, a generation harness, validators and a second pilot stored as planning artifacts. Nothing was ingested, no migration was added, no database was written, no AI provider was called, no reviewer was granted, nothing was approved.

## 1. StimulusPlan

`production/stimulus-plan.ts` adds the planning primitive the R2B pilot lacked: a `StimulusPlan` has an id, exam family, Section, Domain(s), Topic(s), target concepts, stimulus kind, language, **one** intended pool, question count, integrity rule (WHOLE or SUBSET{min,max}), difficulty mix, response-format mix and its member item slots (requirement-cell key + index).

`ONE_STIMULUS_PLAN = ONE_POOL` is enforced twice: every slot restates its pool, so the schema refuses a plan whose slots disagree (`STIMULUS_PLAN_CROSSES_POOLS`), and the plan validator re-checks each slot against its cell (`SLOT_POOL_IS_NOT_THE_CELLS`), so a plan that lies consistently is still caught.

A generation unit is a STANDALONE unit (one item slot) or a STIMULUS unit (one plan). The requirement cell is unchanged (schema v2, 789 cells, byte-identical; the R2B DEV-bound artifact still matches).

Naming note: `requirement-cell.ts` already exports a type called `StimulusPlan` (the cell's stimulus class and kind). It was left alone to keep cells identical; a rename is a later clean-up.

## 2. The 865 items re-planned

`buildPaaGenerationPlan()` (`production/paa-generation-plan.ts`, policy `q1-paa-stimulus-plan` v1, StudyUs policy) is deterministic and independent of cell order. Artifact: `docs/exams/question-bank/audits/q1-paa/QB_R2C_paa_generation_plan.json` (codes and stable ids only), printed and written by `scripts/operations/qb-paa-generation-plan.ts [--write]`.

**576 generation units = 378 standalone + 198 stimulus plans (487 questions).** Standalone = 297 STANDALONE items + 81 STIMULUS_OPTIONAL items (policy: an optional stimulus is never shared; a single-question stimulus may be attached at generation).

Grouping rule: required-stimulus slots are grouped only within one pool, one Section and one stimulus kind, interleaving Domains in Topic order, chunked by a per-kind target (passage 5, paired passage 4, numbered text 5, draft paragraph 5, poem 3, composite 3, table 3, graph 3, data set 3, figure 1). A trailing chunk of one is rebalanced with the previous chunk when that chunk has more than two.

| Kind | Plans | Sizes (questions: plans) |
|---|---|---|
| Passage | 45 | 5: 30, 4: 9, 2: 6 |
| Numbered text | 20 | 5: 19, 2: 1 |
| Draft paragraph | 8 | 5: 2, 3: 3, 2: 3 |
| Paired passage | 6 | 3: 1, 2: 4, 1: 1 |
| Poem | 9 | 3: 2, 2: 6, 1: 1 |
| Composite | 6 | 3: 1, 2: 4, 1: 1 |
| Table | 6 | 3: 1, 2: 4, 1: 1 |
| Graph | 7 | 3: 2, 2: 4, 1: 1 |
| Data set | 5 | 3: 1, 2: 4 |
| Figure | 86 | 1: 86 |

Plans per pool: Practice 42, Diagnostic 31, Verification 31, Reduced Mock 22, Full Mock 1 36, Full Mock 2 36.

Assertions (all pass, `tests/unit/qb-r2c-stimulus-plan.test.ts`): total 865; pools 183 / 122 / 122 / 88 / 175 / 175; Full Mocks 45/25/55/50, Reduced 23/12/28/25; every slot in exactly one unit; no plan crosses pools, Sections, kinds or forms; one PRIMARY / Topic / Domain per item; zero pool overlap; artifact equals function output.

Known weaknesses of the v1 plan (not defects of the invariant; they need a plan v2 before volume):

1. Literary and informational reading concepts share passage buckets, and nothing says a planned passage must be literary. Lectura needs a text-type dimension.
2. `stimulusPlanOf` reads "literary passage or poem" as POEM, so figurative language is never planned on a prose passage.
3. Mock demand is uneven, so some plans repeat a concept (three Elisión questions on one text in Full Mock 1; two or three vocabulary questions on some mock passages).
4. The Reduced Mock has five single-question stimuli of multi-question kinds (paired passage, poem, composite, table, graph).

## 3. Pilot v1 defects

The R2B pilot stays in `pilots/qb-r2b/` as a superseded artifact. Its 14 stimulus/pool defects came from stimuli written for cells of several pools. They are resolved structurally, not by duplication: pilot v2 generates whole plans from the plan, each in one pool, and the pool-integrity validator checks it. `PILOT_STIMULUS_POOL_VIOLATIONS = 0` (10 stimuli checked).

## 4. PAA Math canonical subject (audit, DEV read-only)

Three certified PAA concepts sit in canonical subject `Mathematics` while the locked PAA subject is `Matemáticas`:

| Stable id | Canonical concept (id) | PAA Topics | Other published usages on DEV |
|---|---|---|---|
| `math.alg.quadratics` | Quadratic functions and inequalities (`adffebff…`) | 040, 047 | IB AA HL `aahl.p1.functions`, IB AA SL `aasl.p1.functions`, Cambridge 9709 AS and A Level `aice.9709.p1.quadratics` |
| `math.fun.exponential` | Exponential models (`cec52274…`) | 048 | IB AA HL/SL `p2.extended`, IB AI `ai.p1.functions` and `ai.p2.modelling` (two subjects) |
| `math.trig.ratios` | Trigonometry and triangles (`c9bcde89…`) | 052 | IB AA HL/SL `p2.trigonometry` |

Each is also mapped from `paa.mat.algebra` in the published DEV-CERT v1 structure and in the DRAFT V2.1. Dependencies on the three concept rows: 18 published objective mappings, 6 localizations, 12 institution-curriculum concepts, 25 student plan entries, 75 student plan events, 25 student concept sources, 3 learning recommendations, 1 class-plan concept, 1 institution assignment, 2 curriculum events. No mastery, evidence, memory or Question Bank row references them.

- **Moving them to Matemáticas is not safe**: it would take the concepts out of the subject IB and Cambridge Mathematics use and re-home learner plan history.
- **No true equivalent exists under Matemáticas**: none of its 32 concepts covers quadratics, exponential functions or trigonometric ratios.
- **Granting `Mathematics × PAA` was not done** and is not proposed as an automatic fix.

Consequence today: 28 planned items have a PRIMARY concept that a `Matemáticas × PAA` reviewer could not approve. Options for a decision (nothing prepared in the database):

- **A — three new Matemáticas concepts** for the PAA Topics, mapped at the new-PAA cutover, the Mathematics concepts untouched. Keeps subjects separate; whether this counts as duplication is a Curriculum Authority decision, because the same idea would then exist under two subjects.
- **B — a deliberate, human-granted `Mathematics × PAA` qualification** limited to reviewers who hold it on evidence. No data change; keeps PAA Math split across two subjects.
- **C — hold the 28 items** out of production until the cutover decides.

`PAA_MATH_SUBJECT_CONSISTENCY = REMEDIATION_REQUIRED`. No Curriculum write was made.

## 5. English Topics without a certified concept

`paa.topic.081` Sentence correction and `paa.topic.082` Error identification (Domain Redacción indirecta, official, guide p.61).

| Question | Finding |
|---|---|
| TRUE_EQUIVALENT existing concept? | No. The nine English concepts are knowledge areas; the grammar these tasks exercise is certified under Topics 071–074 (sentence structure, function words, verb forms, noun/adjective/adverb forms). Mapping one of them here would give a concept two Domains and would be a forced mapping. |
| Legitimately organizational? | Partly. Both are task formats (how the item asks), not distinct knowledge. As Topics they are official and certified; as planning targets they take no items, because a cell's Topic follows its PRIMARY concept. |
| New concept required? | Only if StudyUs wants items reported under these two Topics. That would be an editing-skill concept per Topic ("recognise the correct revision of a sentence", "locate the error in a sentence"), a Curriculum Authority decision. |

Classification: `TASK_FORMAT_TOPIC — NO_TRUE_EQUIVALENT`; recommended treatment is to carry the task format as an item attribute on grammar items rather than invent concepts, pending that decision. The plan keeps 82 of 84 Topics with items. `PAA_TOPIC_CONCEPT_COVERAGE = CERTIFIED` (82 covered, 2 classified, none forced).

## 6. Reference Intelligence Pack v2

`production/concept-profile.ts` adds a `ConceptProfile` per PRIMARY concept: canonical label, definition, observable mastery statement, prerequisites, misconceptions, acceptable reasoning patterns, inappropriate shortcuts, example context categories, response-format guidance, difficulty guidance per band, stimulus guidance, evidence and foreign markers, `authoredBy: 'STUDYUS'`, pack version, definition confidence. A pack is generation-ready only with the profile of the cell's own concept.

`production/paa-concept-profiles.ts` holds **23 of 61** profiles (the concepts pilot v2 uses), all written by StudyUs with no external text. Five are `WORKING_DEFINITION` pending confirmation against the official guide: Elisión, Adición, Generalización, Integración, Particularización. The other 38 concepts refuse generation (`CONCEPT_PROFILE_NOT_AUTHORED`).

## 7–9. Generator, templates, structured stimulus

`production/generator/`:

- `generateCandidates({ unit, cells, packs, policy, provider, templateRegistry, runId, batchKey, now })` renders a provider-neutral prompt, hashes it (sha256 of canonical JSON), calls a `GenerationProvider` interface, parses the answer strictly, refuses any misfit by name (no repair) and returns a `GenerationBatch`. Cell, concept, band, format, language and stimulus plan come from the plan, never from the response. No clock, no randomness: same inputs give the same batch.
- Lineage on every candidate and on the batch: provider, model, generation policy id and version, template id and version, prompt hash, run id, generation unit, requirement cell, pack and profile version, timestamp.
- `RecordedResponseProvider` replays recorded answers by prompt hash and errors on an unknown hash. **No live provider exists.** One would be added outside the pure directory, through the AI gateway.
- Seven templates: standalone MCQ, MCQ with its own stimulus, student-produced mathematics, text/passage set, editing/writing set, data-interpretation set, figure/geometry. A template fixes structure and the instruction sentence only.
- `production/stimulus-spec.ts`: tables, data sets, chart specifications (bar, line, scatter, number line, coordinate plot) that reference data in the same stimulus, and figure specifications (right triangle, rectangle, circle, angle). `data → specification → SVG` with deterministic renderers and alt text generated from the data. Validators: chart series exist in the data; a right triangle with three sides satisfies Pythagoras; rendered assets equal a re-render.

`GenerationRequestSchema` (pack v1, bound cells) is untouched and still refuses unbound cells. The harness takes v2 packs and needs `allowUnboundCells: true` for a planning run; a v2-aware request object does not exist yet.

## 10. Student-produced answer normalization (`STUDYUS_POLICY`)

`production/answer-normalization.ts`: integers, decimals with comma or point, fractions and equivalent forms when the key allows them, leading `+`, Unicode minus, leading and trailing zeros, whitespace, tolerance or decimal places only when declared on the key, units only when the key lists them (`%` is a unit). Mixed numbers are refused (`MIXED_NUMBER_UNSUPPORTED`); a single separator followed by three digits is `AMBIGUOUS_SEPARATOR` when the two readings disagree. Unsupported input returns a named not-gradable result, never a guess. This is StudyUs policy, not a statement about how the official test grades.

## 11. Difficulty calibration contract

`production/difficulty-calibration.ts` (`studyus-difficulty-calibration` v0, PROVISIONAL). A band moves from `EDITORIAL_ESTIMATE` to empirical only with learner-response evidence: sample size, facility, discrimination, median response time and a sample that matches the target population and excludes authors and staff. Without it the answer is `NOT_CALIBRATED`. Every pilot item keeps `EDITORIAL_ESTIMATE`.

## 12. Rights evidence for model output

`rights-gate.ts` adds `ModelOutputRightsEvidence` (provider, model, terms reference, account/licence context, terms date/version, permitted commercial use, restrictions, verifier, date). STUDYUS_GENERATED content is not establishable unless every field is present and verified by a person. Behaviour change: an authorship-terms reference alone no longer passes. No legal question was decided and nothing was browsed. `REUSE_RIGHTS = NOT_ESTABLISHED` for all pilot items.

## 13–15. Pilot Generation v2

Files in `docs/exams/question-bank/pilots/qb-r2c/`: `recorded-responses.json`, `pilot-v2-batch.json`, `pilot-v2-automated-report.json`, `pilot-v2-review-packages.json`. Run: `npx tsx scripts/operations/qb-r2c/pilot-v2-run.ts` (file IO only; reproduces the files byte for byte).

**How it was produced.** Provider `recorded:in-session-authoring`, model `claude-opus-5-5`. The responses were written in-session by the assistant against the rendered prompts and replayed through the harness. `liveProviderExercised: false`. This shows the harness, templates, parsing, lineage and validators work end to end; it is not evidence that a live provider can do the same.

**Size.** 34 items, not 32: Lectura 8, Redacción 10, Matemáticas 8, Inglés 8. Every Redacción plan is a numbered text of 5 questions (one of 2), so 8 cannot be reached with whole plans; two whole plans were generated instead of cutting one.

Composition: 15 units, 10 stimuli (9 whole stimulus plans + 1 own optional stimulus), all six pools, bands F 12 / S 15 / C 7, 31 multiple choice + 3 student-produced, all seven templates, 2 data stimuli with bar charts, 2 geometry figures.

| Metric (`AUTOMATED_VALIDATION`) | Result |
|---|---|
| Generated | 34 |
| Structurally valid | 34 |
| Answer key: machine-verified / not machine-verifiable / failed | 9 / 25 / 0 |
| Concept-fidelity heuristic: pass / weak / fail | 34 / 0 / 0 |
| Response format | 34 |
| Stimulus integrity | 29 of 29 stimulus-based |
| Pool integrity | PASS, 0 violations |
| Originality: low / review / reject | 34 / 0 / 0 (max sibling similarity 0.12; also against the 24 R2B items) |
| Normalization round-trip | 3 of 3 |
| Lineage complete | 34 |
| Regeneration required by a validator | 0 |
| Review-ready | 34 |
| Rights | 34 not establishable |
| Review status | 34 `BLOCKED_NO_QUALIFIED_REVIEWER` |

| Section | Items | Key verified / not verifiable | | Template | Items | Key verified / not verifiable |
|---|---|---|---|---|---|---|
| Lectura | 8 | 1 / 7 | | text-passage-set | 9 | 0 / 9 |
| Redacción | 10 | 0 / 10 | | editing-writing-set | 12 | 0 / 12 |
| Matemáticas | 8 | 8 / 0 | | data-interpretation-set | 5 | 3 / 2 |
| Inglés | 8 | 0 / 8 | | mcq-standalone | 3 | 1 / 2 |
| | | | | mcq-own-stimulus | 1 | 1 / 0 |
| | | | | spr-math | 2 | 2 / 0 |
| | | | | figure-geometry | 2 | 2 / 0 |

No threshold, marker or validator was changed after results.

**What the clean sheet does and does not show.**

- The nine arithmetic keys were re-worked by hand in the coordinating session and are correct; the four SVGs were rendered and looked at (two grouped bar charts, a right triangle, a rectangle) and are legible and match their data.
- "Machine-verified" means the key equals the arithmetic the candidate declared and no other option states that value. It does not prove the expression models the stem.
- The fidelity heuristic matches markers that the same author wrote into the profiles; 34/34 does not discriminate.
- 25 keys (all of Redacción and Inglés, most of Lectura) have no automated check. The author's own reading is that they are correct; that is not a review.
- One error was found only by re-reading (a key that called a character "joven" when the text does not say so), not by any validator.
- Open doubts: the Adición and Particularización items follow working definitions; one generalization key ("libros de distintos tipos") is debatable; one item labelled CHALLENGE reads as STANDARD and one FOUNDATIONAL item uses a device its profile places at STANDARD. No native-speaker check.

## 16. Scale gate

| Requirement | State |
|---|---|
| Repeatable generator | Yes, with a recorded provider only |
| No stimulus/pool violations | Yes |
| Structural validity | Yes |
| Answer-key correctness | Arithmetic only; 74% of the pilot is unverified by machine |
| Concept fidelity | Not measured independently |
| Visual/data stimulus generation | Yes for the supported shapes |
| Response normalization | Yes |
| Originality | No problem in 34; unmeasured at volume and against the real bank |
| Useful review packages | Yes, unreviewed |

`GENERATOR_READY_FOR_SCALE = NO`. Still to prove: a live provider returning schema-valid output at a measured rate (the harness has no retry loop); an independent second pass on non-arithmetic keys; the fidelity heuristic on items it did not co-author; the five Redacción definitions; 38 missing profiles; plan v2 for Lectura text types; originality at volume; rights evidence; cost and latency per template.

## 17–18. Kognity and reviewers

`KOGNITY_ACCESS_VALIDATION = DEFERRED`; not accessed. `REAL_REVIEWER_IDENTITIES_AVAILABLE = NO`; no qualification granted, no approval simulated.

## 19. Verification

See the phase report for the run results of TypeScript, the unit suite, the production build and the five database certifications.
