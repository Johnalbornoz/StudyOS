# Question Factory -- Canary 250 (Stage A: offline preparation)

Status: PREPARED, NOT RUN. **No provider call was made in this stage.** No database, no migration, no ingestion,
no deploy. Every candidate the canary will produce is DEV_TEST_CONTENT with RIGHTS_NOT_ESTABLISHED and stays in
`docs/exams/question-bank/pilots/qb-canary-250/`.

Orchestrator rulings recorded here:

- CR-L8-01 accepted.
- `R2F_20_ITEM_RUN = SUPERSEDED_BY_QUESTION_FACTORY_CANARY_250`. The 20-item QB-R2F certification run is not
  executed. Its run script, selection and freeze stay in the repository, unexecuted and unchanged.
- The offline remediation of QB-R2F (validators revision 4, generator version 3, the defect fixtures) is kept and
  is what the canary runs on. No frozen file of QB-R2D, QB-R2E or QB-R2F was changed; the canary is new files only.

## 1. What the canary is

250 new first-attempt candidates over a stratified manifest; an independent AI review of every candidate; a human
calibration sample chosen after the reviews; one cumulative spend cap.

| | |
|---|---|
| Generator | harness version 3 (unchanged) + canary slot guidance version 1; OpenAI `gpt-5.6-luna`, the model the repository routes for question generation |
| Validators | revision 4, as frozen in QB-R2F |
| Reviewer | `studyus-ai-item-reviewer` version 1 (prompt 1, schema 1, redaction 1, decision policy 1); Anthropic `claude-sonnet-5-5` |
| Regenerations | `MAX_AUTOMATIC_REGENERATIONS = 0`. One generation call per slot; one review call per candidate; no retry |
| Spend cap | USD 30.00 cumulative, assumed price basis, earlier runs included (3.005135 already spent) |

## 2. The manifest

`scripts/operations/qb-canary-250/manifest.ts`; stored as `pilots/qb-canary-250/manifest.json`.

How the 250 are chosen, with no hand-picked list and no randomness:

1. The space is every combination of the ten families x seven targets x {no approach, STEM_PLUS} x three bands x
   five context kinds x the four response formats generator version 3 has a template for, **that `adapt()`
   accepts**. That is 1,317 distinct specifications. Nothing is forced.
2. Quotas per target are stated (below). Slots are dealt to targets in a fixed interleaved order, so any stretch of
   the manifest is spread over the systems (each block of 25 slots contains all seven targets).
3. For each slot the least-used value wins, in this order: task family (whole manifest, then within the target),
   response format, learning approach (two baseline to one STEM_PLUS), band, context kind.

**All 250 slots are distinct adaptation specifications; no two slots share one.** There are ten invariant hashes
(ten families, one construct each): the diversity is in system, component, approach, format, band and context, not
in constructs. No specification of QB-R2D, QB-R2E or the QB-R2F selection is used.

### Balance

| System | Slots | | Response type | Slots | | Band | Slots |
|---|---|---|---|---|---|---|---|
| PAA | 45 | | Selected response | 84 | | FOUNDATIONAL | 83 |
| IB (P1 25, P2 25) | 50 | | Numeric entry | 46 | | STANDARD | 83 |
| Cambridge 9709 P1 | 45 | | Constructed (short 69, extended 51) | 120 | | CHALLENGE | 84 |
| PISA | 45 | | | | | | |
| Icfes Saber 11 | 40 | | **Approach** | | | **Calculator** | |
| School STEM performance | 25 | | Standard (by absence) | 166 | | NONE | 110 |
| | | | STEM_PLUS | 84 | | ALLOWED | 70 |
| | | | | | | SCIENTIFIC_REQUIRED | 45 |
| | | | | | | GDC_REQUIRED | 25 |

| Task family | Slots | Evidence actions | Class |
|---|---|---|---|
| proportion.missing-value | 24 | SOLVE | procedural |
| proportion.rate-comparison-model | 26 | FORMULATE + SOLVE + INTERPRET | modelling |
| linear.line-through-two-points | 25 | COMPUTE + REPRESENT | procedural |
| linear.constant-rate-model | 25 | FORMULATE + INTERPRET | modelling |
| quadratic.solve-by-factorising | 24 | SOLVE | procedural |
| quadratic.optimum-of-a-model | 25 | FORMULATE + SOLVE + INTERPRET | modelling |
| probability.single-event-equally-likely | 25 | COMPUTE | procedural |
| probability.compare-chances-to-decide | 25 | FORMULATE + COMPUTE + EVALUATE | reasoning |
| data.rate-of-change-from-realistic-dataset | 25 | INTERPRET + COMPUTE | data interpretation |
| data.judge-claim-against-display | 26 | INTERPRET + EVALUATE | reasoning |

Evidence class (by rule on the evidence actions): procedural 98, modelling 76, reasoning 51, data interpretation
25. Concepts: 49 / 50 / 50 / 50 / 51 over the five. Stimulus: none 188, table + graph 37, table + graph + data set
25. Context kind: abstract 72, personal 60, occupational 42, scientific 40, societal 36. Transfer expectation of the
specification: not required 140, expected 65, required 45. Reasoning depth: answer only 130, method shown 95,
justified argument 25. System x response type: Icfes 40 selected; PAA 21 selected + 24 numeric; PISA 23 selected +
22 numeric; IB 50, Cambridge 45 and school 25 constructed.

### What the architecture cannot supply (not padded over)

- Mathematics only. No science, language or social-science family, component or construct.
- Five canonical concepts; ten task families, all DRAFT; one machine-checkable construct per family.
- The only school profile is SCHOOL_STEM_PERFORMANCE, and only the three EA-1A families support it.
- One component per system, except IB with two papers. No IB paper 3, no other Cambridge paper.
- MULTI_SELECT and MATH_EXPRESSION are accepted by `adapt()` on PISA, but generator version 3 has no template for
  them. Icfes is selected response only; IB, Cambridge and school are constructed only; numeric entry exists on PAA
  and PISA only.
- Learning approach: STANDARD and STEM_PLUS only.
- There is no transfer family; the specification's own transfer expectation is what is reported.
- Stimuli are the item's own table, graph or data set. No shared stimulus, image or passage.
- Difficulty is three editorial bands, not a calibrated difficulty.
- Calculator policy follows the component; it is not a free dimension.

### Slot guidance (diversity at 250)

The do-not-reuse lists of QB-R2F grow with the batch, which is prompt size and therefore cost. In the canary each
slot's prompt is independent of every other answer of the run:

- do-not-reuse lists come from QB-R2D and QB-R2E only (fixed; scenarios cut to 120 characters);
- each slot carries deterministic guidance: a scenario **domain** (14 per context kind; never the same one twice in
  a family and context kind) and one **pinned parameter value** that no other slot of the construct has and no
  earlier run used. For claim evaluation, the verdict (the three in turn) and the number of categories instead.

Guidance steers; it does not measure. The batch-diversity validator still measures duplicates
(`MATERIAL_DUPLICATES`), and `GUIDANCE_FOLLOWED` reports how often the pinned value was used.

**A deviation to know about.** Version 3 has no place for slot guidance and is frozen, so the canary adds one
member, `slotGuidance`, to the instruction that is sent. The request is therefore the version-3 prompt plus that
member. Both are identified per slot: `promptHash` (version 3's, carried in the lineage) and `requestHash` (what
was actually sent). A recorded call whose `requestHash` is not the planned one is refused on replay.

## 3. The AI reviewer

`scripts/operations/qb-canary-250/reviewer.ts`.

**This is an AI review.** It is not a human review, grants no approval in the Question Bank sense and changes no
lifecycle. Every artifact that carries it is labelled `AI_REVIEW`, `isHumanReview: false`, and the review status of
every candidate stays `BLOCKED_NO_QUALIFIED_REVIEWER`.

**Independence.** Another provider and another model family than the generator: Anthropic `claude-sonnet-5-5`
against OpenAI `gpt-5.6-luna`. The repository's routing has no review capability on another provider (GRADING and
the evaluation capabilities route to OpenAI `gpt-5.6-terra`, the generator's family), and its price table does not
price current Claude models. Parameters: thinking off (`between_tools`), effort `medium`, strict JSON schema
(`output_config.format`), 1,600 output tokens, no fallback model, no retry. Called directly from the lane: the
repository's AI gateway is bypassed and writes no governance row, as for the generator.

**Redaction.** The reviewer receives the item as a learner and a marker would: stem, stimulus (text and structured
data), options and key, numeric key, parts with prompts, command terms, marks, mark scheme and final answers, coded
credit levels. It does not receive the generator's own account of the item:

`rationale`, `declaredModel`, `context.description`, `usesStimulusValues`, `proposedSupportingConceptStableIds`,
`selected.distractors` (rationales and misconception labels), every `target`, every `answerCheck`,
`constructed.workingOutline`, `stimulus.renderedAssets`.

A test puts a sentinel in every one of these and asserts none reaches the request. Validator results are given as
outcomes and issue codes.

**Inputs.** Canonical concept; evidence target; assessment profile and component; task family; learning approach;
adaptation specification (provenance records left out, evidence target given once); the redacted item; stimulus;
lineage; deterministic validator results; the ten dimension questions.

**Output.** The reviewer must first solve the item itself from the learner-facing text, then compare with the key
(`AGREES` / `DISAGREES` / `CANNOT_DETERMINE`). Then a verdict (PASS / CONCERN / FAIL / NOT_APPLICABLE) with a short
reason on each of: ACADEMIC_CORRECTNESS, CONSTRUCT_VALIDITY, PROFILE_FIDELITY, RESPONSE_CONTRACT, DIFFICULTY,
LEARNER_QUALITY, STIMULUS_INTEGRITY, ORIGINALITY, FAIRNESS_AMBIGUITY, LINEAGE_CONSISTENCY. Then a proposed
classification and, for NEEDS_HUMAN_REVIEW only, exactly one question.

**No repair.** A response is refused whole (`REVIEW_CONTAINS_A_REPLACEMENT_ITEM`) when any key names a replacement
or any text introduces replacement wording. A refused, malformed, truncated or provider-refused response is a
`REVIEWER_FAILURE`: no classification, never an approval, not retried. The no-repair check is a named heuristic; it
catches the forms it names, not every paraphrase.

### Decision policy (version 1; code, not the model's word)

The model proposes; `decide` classifies. The proposal can only make the outcome stricter.

| Rule | Outcome | When |
|---|---|---|
| R1 | REJECTED | a deterministic validator gate failed: structural, answer key FAILED, machine recomputation, lineage, learner-text leakage |
| R3 | NEEDS_HUMAN_REVIEW | the reviewer disputes a key the validators MACHINE_VERIFIED: two checks contradict each other |
| R2 | REJECTED | reviewer FAIL on ACADEMIC_CORRECTNESS, CONSTRUCT_VALIDITY, RESPONSE_CONTRACT, STIMULUS_INTEGRITY or FAIRNESS_AMBIGUITY |
| R4 | REJECTED | the reviewer's own solution disagrees with a key that was not machine verified |
| R5 | NEEDS_HUMAN_REVIEW | a disputable validator gate failed (profile, construct, stimulus, originality) and the reviewer rejected nothing |
| R6 | NEEDS_HUMAN_REVIEW | any other FAIL, any CONCERN, or agreement with the key not determined |
| R7 | NEEDS_HUMAN_REVIEW | the validators did not strictly pass (construct WEAK or item writing FLAGGED) though the reviewer passed everything |
| R8 | APPROVED | validators strictly passed, every dimension PASS or NOT_APPLICABLE, solution AGREES, reviewer proposed APPROVED |
| R9 | stricter of the two | the reviewer's own proposal, when stricter than the policy's |
| R10 | one question | the reviewer's, or one the policy states from the rule that fired |

Rules are applied in the order listed. A validator failure is never silently overridden: when the reviewer saw
nothing wrong the disagreement is recorded (`VALIDATOR_FAIL_REVIEWER_PASS`, `VALIDATOR_DOUBT_REVIEWER_PASS`,
`REVIEWER_REJECTS_A_MACHINE_VERIFIED_KEY`, `REVIEWER_FAIL_VALIDATOR_STRICT_PASS`).

## 4. Metrics (defined in frozen code, `report.ts`)

| Metric | Source | Definition |
|---|---|---|
| GENERATED | run log + harness | slots whose one call returned an answer the harness accepted, over 250 |
| PROVIDER_FAILURES | run log + harness | transport failure, rejected request, call never recorded, or an answer that is not the strict shape (not JSON, schema-invalid, empty, truncated, provider refusal) |
| HARNESS_REFUSALS | harness | well-formed answers refused by a named harness rule; reported separately, not provider failures |
| VALIDATOR_STRICT_PASS | validator | no gate failure, construct PASS, item writing PASS |
| APPROVED / NEEDS_HUMAN_REVIEW / REJECTED | AI reviewer + policy | the decision policy's classification |
| REVIEWER_FAILURES | run log + parser | candidates with no usable review |
| ACADEMIC_FAILURES | either | validator: key FAILED or recomputation FAIL; reviewer: ACADEMIC_CORRECTNESS FAIL or solution disagrees |
| ANSWER_KEY_FAILURES | either | validator: key FAILED; reviewer: solution disagrees |
| CONSTRUCT_FAILURES | either | validator: construct FAIL; reviewer: CONSTRUCT_VALIDITY FAIL |
| PROFILE_FAILURES | either | validator: profile FAIL (incl. demand policy); reviewer: PROFILE_FIDELITY FAIL |
| STRUCTURAL_FAILURES | either | validator: structural FAIL; reviewer: RESPONSE_CONTRACT FAIL |
| MATERIAL_DUPLICATES | validator | originality not PASS_LOW_SIMILARITY, against the fresh batch and QB-R2D / QB-R2E |
| ASSUMED_CUMULATIVE_SPEND_USD | run log + earlier ledgers | earlier runs + canary, assumed prices |
| HUMAN_CALIBRATION_SAMPLE_PROPOSED | sample procedure | the number selected, with the sample manifest |

"Either" metrics report validator, reviewer, either and both. Reviewer counts are over reviewed items; the number
reviewed is reported. Also produced: breakdowns by system, response type, family, approach and band; the
validator-vs-AI agreement matrix; the reviewer's own proposal against the validators; decision rules fired;
disagreement counts; `GUIDANCE_FOLLOWED`.

## 5. Human calibration sample (`sample.ts`)

Run after every candidate has a review outcome. No fixed percentage, no fixed size: each step has its own bound.

| Step | What | Bound |
|---|---|---|
| S1 DISAGREEMENT | validators and reviewer contradict each other | all, up to 20, spread over systems |
| S2 UNCERTAIN | NEEDS_HUMAN_REVIEW with doubt about answer, construct or profile, by uncertainty score | up to 15 |
| S3 REVIEWER_FAILURE | candidates the reviewer could not review | up to 5 |
| S4 BLIND_AUDIT_APPROVED | approved items | ceil(sqrt(approved)), 6 to 15 |
| S5 OVER_REJECTION_CHECK | rejected items | ceil(sqrt(rejected)), 4 to 12 |
| S6 REPRESENTATION | top-ups: 4 per system, 6 for IB and Cambridge, 5 per response type | as needed |

Every item carries its exact reasons. On two synthetic batches of 220 the procedure selected 45 and 49 items.

An approved or rejected item selected only as an audit or a top-up is BLIND. Three files: the **packet** (what a
person receives: items in a hash order that says nothing, blind items without AI decision and validator outcome),
the **key** (reasons, AI decision and validator outcome for every item; not for reviewers), and the **calibration
set** with one undecided row per item.

## 6. `STUDYUS_HUMAN_CALIBRATION_SET` (`calibration.ts`)

A file with a zod schema and a validator; no database. Empty template:
`pilots/qb-canary-250/human-calibration-set.template.json`.

Fields: ITEM_ID, AI_DECISION, HUMAN_DECISION, AGREEMENT, HUMAN_REASON, DEFECT_CLASS, SEVERITY,
DETERMINISTIC_RULE_CANDIDATE, GENERATOR_RULE_CANDIDATE, REVIEWER_RULE_CANDIDATE, plus REVIEWER_ID,
REVIEWER_QUALIFICATION, REVIEWED_AT, REVIEWED_BLIND (left empty).

- AGREEMENT is computed from the two decisions (AGREE, AI_TOO_LENIENT, AI_TOO_STRICT, AI_DEFERRED,
  NOT_COMPARABLE); a row that states another value is invalid.
- DEFECT_CLASS vocabulary version 1 (PROPOSED, 18 values) and SEVERITY version 1 (NONE, MINOR, MAJOR, CRITICAL).
- A HUMAN_DECISION is a calibration label on dev-test content. It is not a Question Bank approval.

**Calibration answers must not be used to silently rescore this same canary as independent certification
evidence. They improve the next reviewer, generator and validator versions.** The set carries this statement and
is invalid without it.

## 7. Spend

One cumulative cap of USD 30.00 on the assumed basis. Before every call of either kind:

    earlier runs + canary spend + worst case of calls in flight + worst case of this call  <=  30.00

Generation may take the cumulative spend to USD 19.00 and no further, so that a generation phase costing more than
projected cannot leave the reviewer with nothing. The first call the budget refuses closes itself and every call
after it (`NOT_CALLED_BUDGET_STOP`, terminal).

**Price bases, both ASSUMED, neither an invoice.** Generator: USD 5 / 30 per million tokens in / out, as in QB-R2D
and QB-R2E; about 25 times the repository's configured price. Reviewer: USD 5 / 30 as well, the floor set by the
orchestrator; the repository's table does not price the model, so it suggests nothing higher.

**Be aware:** the reviewer's assumed basis is not many times its real price. The vendor's list price for the model
(USD 2 / 10 per million, from a cached price table, not checked live) is of the same order. So the assumed reviewer
spend is close to real money, where the assumed generator spend is mostly margin. Rough real cost of a full run on
those figures: generator about USD 0.6, reviewer about USD 3.3.

### Projection (`spend-projection.json`)

| | Expected | Worst case |
|---|---|---|
| Earlier runs | 3.01 | 3.01 |
| Generation, 250 calls | 14.58 | 23.18 |
| Review (expected 213 candidates; worst case 250) | 9.06 | 19.46 |
| **Cumulative** | **26.64** | **45.64** |
| Against the cap of 30.00 | fits, headroom 3.36 | does not fit |

- Generation prompt sizes are exact: all 250 prompts were rendered (11,552 to 18,550 characters). Tokens per
  character and output per call are measured on the QB-R2D and QB-R2E ledgers.
- Review request sizes are measured on stand-ins (the 22 stored QB-R2E candidates through the real redaction and
  request builder; 8,854 to 11,927 characters). **Reviewer output (800 tokens) and its tokens per character are
  assumed, not measured: the reviewer has never been called.** This is the least certain number.
- Sensitivity: every 100 output tokens more per review adds about USD 0.64. At 1,200 tokens the expected total is
  about 29.2; at the 1,600 cap about 31.8, and the last reviews would be closed by the budget.
- The worst case does not fit and is not meant to: the per-call guard stops the run before the cap.

### Cost reductions made, and their trade-offs

- Reviewer thinking is off, so output is the structured answer only: bounded and predictable. Trade-off: the
  reviewer's reasoning is the worked solution it writes, not hidden thinking; on harder items it may be less
  accurate than a thinking model.
- Reviewer input is compact: provenance records and the duplicate evidence target are left out. No required input
  was removed.
- Do-not-reuse lists are fixed and short. Trade-off: steering apart inside the batch relies on slot guidance.
- The generator's output cap stays at 2,150 (the largest observed answer is 1,675).

Alternative not chosen: `claude-opus-5-5`. On that model thinking cannot be turned off, so its output is unbounded
below the cap and unmeasured; at 1,300 to 1,800 output tokens the expected cumulative is about 29.9 to 33.1. It
would need a higher cap to be safe. Changing the reviewer model is one constant, before the freeze.

## 8. Run design

- **Order.** (0) one reviewer pre-flight call on a stand-in, not a slot, to check the request shape; (1) all
  generation; (2) validation of the whole batch (offline); (3) all reviews, in manifest order; (4) replay and
  artifacts, including the sample. No review is planned until every slot's generation is closed, because the
  validator results a reviewer is shown include originality against the whole batch.
- **A budget stop is coherent.** If the budget stops reviews, the reviewed items are a prefix of the manifest,
  which is itself spread over systems; the report says how many were reviewed and the sample is not selected.
- **Concurrency.** Up to 4 calls in flight. Safe because no prompt depends on another answer of the run.
- **Resumable.** One append-only run log (`run-log.jsonl`) is both recording and ledger. `CALL_STARTED` is written
  before the request leaves, `CALL_FINISHED` after. A slot with any line is never called again; re-invoking a
  command continues where the log stops. A log of another freeze is refused.
- **Crash rule, stated in advance.** A `CALL_STARTED` with no `CALL_FINISHED` is a provider failure
  (`NO_RESPONSE_RECORDED`), charged at its worst case, not retried.
- **Stop rules.** A rejected request (HTTP 4xx other than 408 / 429) halts the phase; five transport failures in a
  row halt it. Slots not yet called stay `NOT_RUN` and the operator decides whether to resume.
- **Replay.** Every derived artifact is computed from the manifest and the run log alone, in manifest order. The
  same log gives the same bytes; a log written in another order gives the same artifacts.
- **Expected duration.** QB-R2E calls took 11 to 19 seconds. At 4 in flight: generation about 16 minutes; reviews
  about 10 to 20 minutes (reviewer latency unmeasured). One at a time: about two hours. Provider rate limits are
  unknown and may lengthen this.

Commands (`scripts/operations/qb-canary-250/run.ts`): `--write-manifest`, `--write-freeze`, `--verify-freeze`,
`--preflight`, `--status`, `--reviewer-preflight`, `--generate`, `--review`, `--write`. Every command that can call
a provider needs `--freeze-sha` and verifies the freeze first. Keys come from `OPENAI_API_KEY` and
`ANTHROPIC_API_KEY` only, one variable each, never from a file.

## 9. Freeze

`pilots/qb-canary-250/freeze.json`: the computed import closure of the entry files (67 source files: generator 3,
validators 4 with revisions 3 and 2, the adaptation engine and profiles, manifest, reviewer, budget, run log,
runner, metrics, sample procedure, calibration schema, both transports, freeze and run script), 9 data files
(earlier batches, ledgers and specifications, and the canary manifest), and the run parameters. Enforcement as in
QB-R2E and QB-R2F. The orchestrator creates the freeze commit; any later change to a frozen file needs
`--write-freeze` again.

## 10. Limitations

- The reviewer has never been called. Its request shape (in particular `thinking: between_tools` together with a
  JSON schema) is unverified until the pre-flight call; its output size, latency and quality are unknown.
- The reviewer is shown no corpus, so its ORIGINALITY verdict is recognition only.
- The harness does not check that an answer's declared construct is the specification's; the validators do. A
  mismatch is a candidate that fails validation, not a harness refusal.
- Slot guidance is positive steering the earlier runs did not have. It may change first-attempt quality in either
  direction; `GUIDANCE_FOLLOWED` and the duplicate metric show what it did.
- Ten constructs. A pass here says nothing about families that do not exist yet.
- The sample bounds and the uncertainty weights are choices, stated and versioned, not derived from data.
- An AI classification is not evidence of correctness. That is what the human calibration is for.

---

# Stage B -- the run (results as produced; nothing rescored)

Freeze commit `f445e7afa89cffd69865fd3f9dbf9d98bdddb1f9`, manifest hash `51baba1b...`. One generation call per
slot, no regeneration, no repair. The run log is the only thing the run wrote; every artifact is a replay of it
(`tests/unit/qb-canary-250-replay.test.ts` proves the derivation byte for byte). All content DEV_TEST_CONTENT,
RIGHTS_NOT_ESTABLISHED. The AI review is an AI review: not a human review, no approval, no lifecycle change.

## B1. Numbers

| Metric | Value | Source |
|---|---|---|
| GENERATED | 221 / 250 | run log + harness |
| PROVIDER_FAILURES | 9 (all transport timeouts, slots 179-198) | run log |
| HARNESS_REFUSALS | 20 (9 stimulus table cell type, 8 leaked vocabulary, 2 wire inconsistent, 1 content invalid) | harness |
| VALIDATOR_STRICT_PASS | 66 / 221 | validator |
| REVIEWED | 210 / 221 | |
| APPROVED | 25 | AI reviewer + policy |
| NEEDS_HUMAN_REVIEW | 157 | AI reviewer + policy |
| REJECTED | 28 | AI reviewer + policy |
| REVIEWER_FAILURES | 0 | |
| NOT_REVIEWED (budget stop) | 11 (slots c250-240 .. c250-250 with a candidate) | run log |
| ACADEMIC_FAILURES | validator 13, AI reviewer 6, either 14, both 5 | either |
| ANSWER_KEY_FAILURES | validator 13, AI reviewer 6, either 14, both 5 | either |
| CONSTRUCT_FAILURES | validator 12, AI reviewer 6, either 14, both 4 | either |
| PROFILE_FAILURES | validator 55, AI reviewer 5, either 55, both 5 | either |
| STRUCTURAL_FAILURES | validator 3, AI reviewer 5, either 7, both 1 | either |
| MATERIAL_DUPLICATES | 93 (66 near-duplicate scenario, 33 shared parameter values; reviewer originality FAIL 0) | validator |
| GUIDANCE_FOLLOWED | 218 / 221 | check |
| HUMAN_CALIBRATION_SAMPLE_PROPOSED | 37 | sample procedure |

Agreement matrix (validators x AI classification):

| | APPROVED | NEEDS_HUMAN_REVIEW | REJECTED | NOT_REVIEWED |
|---|---|---|---|---|
| STRICT_PASS (66) | 25 | 38 | 1 | 2 |
| DOUBT (22) | 0 | 20 | 2 | 0 |
| FAIL (133) | 0 | 99 | 25 | 9 |

The reviewer model's own proposal, before the policy: on validator-FAIL items it proposed APPROVED 38 times,
NEEDS_HUMAN_REVIEW 69, REJECTED 17. Decision rules fired: R1 15, R2 8, R5 104 (5 of them made REJECTED by R9),
R6 57, R7 1, R8 25; R3 and R4 never. Disagreements recorded: VALIDATOR_FAIL_REVIEWER_PASS 107,
REVIEWER_FAIL_VALIDATOR_STRICT_PASS 1, VALIDATOR_DOUBT_REVIEWER_PASS 1.

Breakdowns (slots / generated / strict pass / approved / needs human review / rejected / not reviewed):

| | |
|---|---|
| PAA | 45 / 43 / 10 / 6 / 31 / 4 / 2 |
| IB | 50 / 46 / 16 / 4 / 34 / 6 / 2 |
| Cambridge | 45 / 36 / 8 / 3 / 28 / 3 / 2 |
| PISA | 45 / 40 / 13 / 5 / 28 / 5 / 2 |
| Icfes | 40 / 36 / 14 / 6 / 21 / 7 / 2 |
| School | 25 / 20 / 5 / 1 / 15 / 3 / 1 |
| Selected | 84 / 77 / 29 / 13 / 50 / 10 / 4 |
| Numeric | 46 / 42 / 8 / 4 / 30 / 6 / 2 |
| Constructed | 120 / 102 / 29 / 8 / 77 / 12 / 5 |
| Standard approach | 166 / 145 / 47 / 15 / 104 / 18 / 8 |
| STEM_PLUS | 84 / 76 / 19 / 10 / 53 / 10 / 3 |
| FOUNDATIONAL | 83 / 73 / 19 / 12 / 49 / 8 / 4 |
| STANDARD | 83 / 72 / 24 / 13 / 46 / 9 / 4 |
| CHALLENGE | 84 / 76 / 23 / 0 / 62 / 11 / 3 |
| missing-value | 24 / 22 / 12 / 7 / 14 / 1 / 0 |
| rate-comparison | 26 / 25 / 2 / 0 / 15 / 8 / 2 |
| line-two-points | 25 / 24 / 0 / 0 / 17 / 5 / 2 |
| constant-rate-model | 25 / 25 / 5 / 1 / 22 / 1 / 1 |
| solve-by-factorising | 24 / 21 / 1 / 0 / 18 / 2 / 1 |
| optimum-of-a-model | 25 / 23 / 1 / 0 / 16 / 6 / 1 |
| single-event | 25 / 24 / 14 / 8 / 15 / 0 / 1 |
| compare-chances | 25 / 24 / 10 / 3 / 17 / 3 / 1 |
| rate-of-change-dataset | 25 / 18 / 12 / 4 / 13 / 0 / 1 |
| judge-claim | 26 / 15 / 9 / 2 / 10 / 2 / 1 |

## B2. Spend (assumed basis; not an invoice)

| | Calls | Input tokens | Output tokens | USD assumed |
|---|---|---|---|---|
| Earlier runs | | | | 3.005135 |
| Reviewer pre-flight | 1 | 6,915 | 844 | 0.059895 |
| Generation | 250 (241 with usage; 9 timeouts charged at worst case) | 1,015,146 | 266,858 | 13.912345 |
| Review | 210 | 1,462,616 | 189,421 | 12.995710 |
| **Cumulative** | | | | **29.973085** |

Under the cap of 30.00. On the repository's configured price for the generator (0.2 / 1.2 per million) the 241
reported generation calls are about USD 0.52. The repository does not price the reviewer model; on the vendor list
price from a cached table (2 / 10 per million, not checked live) the reviewer calls are about USD 4.8.

**The metric `ASSUMED_CUMULATIVE_SPEND_USD` in `metrics.json` and the header of `spend-ledger.json` say 29.913190:
they leave out the pre-flight call (0.059895).** That is a defect in the frozen report code, found after the run
and not corrected. The ledger's own entries, and the budget guard during the run, counted the pre-flight; the true
cumulative is 29.973085.

Stop rules hit: the budget guard closed the last 11 reviews. No request was rejected; no halt. The 9 generation
timeouts were not consecutive enough to halt (the rule is five in a row) and were not retried.

## B3. Human calibration sample (proposed, 37 items)

Files: `human-calibration-sample.json` (reasons), `human-calibration-packet.json` (what a person receives; 10 items
blind), `human-calibration-key.json` (not for reviewers), `human-calibration-set.json` (ITEM_ID and AI_DECISION
filled, every human field empty). By reason: DISAGREEMENT 20 (the bound; 108 items qualify), UNCERTAIN 15,
BLIND_AUDIT_APPROVED 6, OVER_REJECTION_CHECK 6. By system: IB 7, PISA 7, Icfes 7, PAA 6, Cambridge 6, school 4.

| Item | System | Type | AI decision | Reasons |
|---|---|---|---|---|
| c250-001 | PAA | SR | NHR | UNCERTAIN(CONSTR=CONCERN) |
| c250-003 | PISA | NE | NHR | UNCERTAIN(CONSTR=CONCERN+PROF=CONCERN) |
| c250-005 | IB | CR | NHR | DISAGREEMENT(V_FAIL_R_PASS); UNCERTAIN(CONSTR=CONCERN+PROF=CONCERN) |
| c250-007 | SCHOOL | CR | NHR | DISAGREEMENT(V_FAIL_R_PASS); UNCERTAIN(CONSTR=CONCERN+PROF=CONCERN) |
| c250-010 | PISA | SR | NHR | DISAGREEMENT(V_FAIL_R_PASS) |
| c250-011 | ICFES | SR | NHR | UNCERTAIN(CONSTR=CONCERN) |
| c250-013 | PAA | NE | NHR | DISAGREEMENT(V_FAIL_R_PASS); UNCERTAIN(CONSTR=CONCERN+PROF=CONCERN) |
| c250-014 | CAMBRIDGE | CR | NHR | DISAGREEMENT(V_FAIL_R_PASS); UNCERTAIN(CONSTR=CONCERN+PROF=CONCERN) |
| c250-016 | IB | CR | REJ blind | OVER_REJECTION_CHECK |
| c250-023 | IB | CR | NHR | UNCERTAIN(ACAD=CONCERN) |
| c250-032 | PISA | SR | REJ blind | OVER_REJECTION_CHECK |
| c250-033 | IB | CR | NHR | DISAGREEMENT(V_FAIL_R_PASS) |
| c250-037 | PAA | NE | APP blind | BLIND_AUDIT_APPROVED |
| c250-048 | PAA | NE | REJ | DISAGREEMENT(V_FAIL_R_PASS); OVER_REJECTION_CHECK |
| c250-076 | CAMBRIDGE | CR | NHR | DISAGREEMENT(V_FAIL_R_PASS); UNCERTAIN(CONSTR=CONCERN+PROF=CONCERN) |
| c250-077 | PISA | NE | NHR | DISAGREEMENT(V_FAIL_R_PASS) |
| c250-079 | ICFES | SR | REJ | DISAGREEMENT(V_FAIL_R_PASS) |
| c250-082 | PISA | SR | NHR | UNCERTAIN(CONSTR=CONCERN+PROF=CONCERN) |
| c250-087 | PAA | SR | NHR | DISAGREEMENT(V_FAIL_R_PASS) |
| c250-090 | ICFES | SR | REJ | DISAGREEMENT(V_FAIL_R_PASS); OVER_REJECTION_CHECK |
| c250-093 | PISA | NE | APP blind | BLIND_AUDIT_APPROVED |
| c250-099 | CAMBRIDGE | CR | NHR | DISAGREEMENT(V_FAIL_R_PASS); UNCERTAIN(CONSTR=CONCERN+PROF=CONCERN) |
| c250-107 | SCHOOL | CR | NHR | DISAGREEMENT(V_FAIL_R_PASS); UNCERTAIN(CONSTR=CONCERN+PROF=CONCERN) |
| c250-111 | ICFES | SR | NHR | UNCERTAIN(CONSTR=CONCERN) |
| c250-128 | SCHOOL | CR | REJ blind | OVER_REJECTION_CHECK |
| c250-132 | PISA | SR | NHR | DISAGREEMENT(V_FAIL_R_PASS) |
| c250-138 | CAMBRIDGE | CR | APP blind | BLIND_AUDIT_APPROVED |
| c250-147 | ICFES | SR | APP blind | BLIND_AUDIT_APPROVED |
| c250-154 | ICFES | SR | NHR | UNCERTAIN(CONSTR=CONCERN) |
| c250-186 | SCHOOL | CR | NHR | DISAGREEMENT(V_FAIL_R_PASS) |
| c250-187 | PAA | SR | APP blind | BLIND_AUDIT_APPROVED |
| c250-194 | IB | CR | REJ | DISAGREEMENT(V_FAIL_R_PASS) |
| c250-205 | IB | CR | NHR | DISAGREEMENT(V_FAIL_R_PASS); UNCERTAIN(ACAD=CONCERN+CONSTR=CONCERN) |
| c250-211 | ICFES | SR | REJ | DISAGREEMENT(R_FAIL_V_STRICT) |
| c250-214 | CAMBRIDGE | CR | NHR | DISAGREEMENT(V_FAIL_R_PASS) |
| c250-226 | CAMBRIDGE | CR | REJ blind | OVER_REJECTION_CHECK |
| c250-233 | IB | CR | APP blind | BLIND_AUDIT_APPROVED |

## B4. Findings (reported, not fixed; no score changed)

**Validators**

1. *False "answer key FAILED".* Of the 13 validator key failures, 5 are real wrong keys (016, 085, 135, 177,
   226: confirmed by the reviewer and by my own working) and 8 are not (004, 048, 079, 090, 146, 153, 194 and
   the structural case 019). Causes: the key is compared with the quantity the generator DECLARED as target
   although the item asks something else (line items asking "y at x = 3" checked against the intercept); a
   declared arithmetic expression that is wrong while the key is right (048: 141 x 94 = 13,254 is correct);
   a sign (146: -0.5 against 0.5); a unit (153: 2.5 percentage points against 0.025); a rounding form (194).
2. *False negative.* 070 has a wrong key (the stem pairs 9 with x and 24 with 45, so x = 16.875; key 120) and
   its numeric part was MACHINE_VERIFIED, because the validator recomputes from the generator's declared
   parameters, not from the stem. The reviewer caught it.
3. *V1 again.* 019: options `y = x - 4` and `y = -x + 4` were failed as "the same number". The revision-4
   correction does not cover equations. The item's key is correct.
4. *MATERIAL_DUPLICATES is inflated.* 66 of the 93 are near-duplicate-scenario findings, concentrated in ABSTRACT
   items ("In the coordinate plane, two points are A(..) and B(..)" scores 1.0 against its siblings). The 0.4
   threshold was calibrated on one situational pair and does not fit items with no situation. 57 items fail on
   originality alone.
5. *Profile failures are mostly about declarations.* 31 PARAMETER_NOT_OF_THE_CONSTRUCT (the generator declared
   extra parameters such as m and b) and 26 WORKING_OUTLINE_SHORTER_THAN_THE_METHOD_POINTS (a field no learner
   sees). Neither says the learner-facing item is wrong.
6. *Misses the reviewer caught:* 122 (the asked value is already in the table), 211 (text says 6 guests, table
   sums to 13; a strict validator pass).

**Decision policy**

7. R1 treats a validator key failure as a deterministic fact. Given finding 1 it over-rejects: 8 of 15 R1
   rejections are of items whose key is correct. Rule R3's logic (a contradiction goes to a person) is what these
   cases needed.
8. R5 sends 104 items to a person mainly for findings 4 and 5. NEEDS_HUMAN_REVIEW = 157 says more about the
   validators than about the items.

**Generator**

9. CHALLENGE band: 0 approved of 76 candidates. The reviewer's most frequent doubt is DIFFICULTY (69 concerns,
   3 fails): items written for CHALLENGE are routine. The generator does not realise the band.
10. The optimum family: 6 rejected of 23, 0 approved; four confirmed wrong maxima or expansions. Pinning the
    parameter p pushed the vertex off a clean value (226: vertex 49/3, keyed as 16).
11. Line-through-two-points and factorising: 0 approved. Line items drift to "find y at x", which is not in the
    construct; factorising items give the equation already factorised (102, 141) or leak r1 / r2.
12. Data families: 16 of the 20 harness refusals (table cell types, the words "result", "verdict",
    "categories" in learner text). "result" as leaked vocabulary deserves a look: it is an ordinary word.
13. Guidance side effect: "categories: 6" was read as "6 guests" in 211.
14. 9 timeouts at 180 seconds in one stretch; provider slowness or machine load, not distinguishable here.

**Reviewer**

15. No reviewer failure in 210 calls; no repair attempted; output 844 to 1,173 tokens.
16. Input was about 7,000 tokens per review, not the 3,700 assumed (0.67 tokens per character, not 0.36). The
    projection was wrong by that factor, which is why 11 reviews were closed by the budget. The guard's
    "worst case" understated input as well; no call exceeded its bound only because output stayed well under
    its cap. The bound should be 0.75 tokens per character.

## B5. Reading (mine; 45 items read, no score changed)

Read: 24 of the 25 APPROVED (every approved IB and Cambridge item), 21 of the 28 REJECTED, including every item
where validators and reviewer contradict each other on the key.

- **Approved items: no wrong key found.** I reworked all 24. They are correct, clean, and easy: single-step
  proportion, single-draw probability, one percentage change. That is where the generator is reliable.
- **Over-approval, of a kind the reviewer was told not to judge.** The approved IB HL and Cambridge 9709 items
  (026, 045, 138, 170, 173, 216, 233) are correct but nowhere near the level of those papers: "8 of 29 guests", "7 weeks,
  105 dollars", two marks. The reviewer passed PROFILE_FIDELITY because it judges against the specification only,
  and the specification records no paper-level demand. An approval here means "correct and consistent with the
  specification", not "fit for that paper".
- **Over-rejection by the reviewer: none found.** Every reviewer FAIL I read is right: wrong maxima (016, 085,
  177, 226), wrong slope (135), wrong proportion (070), duplicated options (032), ambiguous stems (054, 103),
  answer in the table (122), inconsistent stimulus (211), equation given factorised (102, 141).
- **Over-rejection by the policy: 8 items** (finding 7). In each the reviewer solved the item, agreed with the
  key, said the validator's failure looked like an artefact, and was right.
- **Where the reviewer is cautious rather than wrong:** 38 strict-pass items went to NEEDS_HUMAN_REVIEW, mostly
  on a single DIFFICULTY or CONSTRUCT concern (238: "is a routine ratio acceptable for CHALLENGE?"). These are
  fair questions, but they are the same question many times; a person answering it once would settle dozens.
- **Minor things the reviewer let pass:** near-identical distractors (210: 39.5% and 39.3%); a non-parallel
  option (232 D); unlikely magnitudes that follow from the pinned values (148: 8 euros a bag of popcorn; 233: rowing at 29 metres per minute).

Honest summary: on this evidence the AI reviewer is a better judge of the item than the validators are, and the
validators are a better judge of the generator's declarations than of the item. 25 approved of 250 slots (10%)
is not a production yield; and the 25 are the easy end of the range.
