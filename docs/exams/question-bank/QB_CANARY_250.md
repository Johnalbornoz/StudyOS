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
