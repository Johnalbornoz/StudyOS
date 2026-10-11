# QB-R2E — Frozen validators and pre-registered criteria (phases 1 and 2)

**No provider call has been made for QB-R2E.** This document is written before the run. It fixes what the run will be judged by. Phase 3 (the run) starts only after the Orchestrator creates the freeze commit and hands back its SHA.

Everything QB-R2E will produce is EPHEMERAL · NOT INGESTED · DEV_TEST_CONTENT · AUTOMATED VALIDATION ONLY. No database, no migration, no ingestion.

## 1. What changed, and why

QB-R2D (accepted as experimental evidence, commit 6ebab9a) found five defects in the generator and the specification, and four weaknesses in what the provider wrote. Each is fixed at the layer it belongs to.

### The five fixes

| # | Defect found by QB-R2D | Fix | Where |
|---|---|---|---|
| 1 | The constructed-response template showed the provider a fixed instruction ("Show your working.") and then refused any item that used it. 4 of 5 harness refusals | A constructed response has **no** fixed instruction in generator version 2. What a part asks is said by its command term; that working is shown is the specification's reasoning depth. There is nothing left to forbid | `generator/specification-generation-v2.ts` |
| 2 | JSON-object mode with the schema in prose: 1 first answer in 5 malformed | **Strict schema mode**, requested as the repository's own adapter requests it (`response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } }`). The response is defined ONCE, as a tree of nodes; the harness's parser and the provider's JSON Schema are both derived from that tree, so they agree by construction, and a test checks 16 valid and invalid cases against both | `generator/specification-generation-v2.ts`, `scripts/operations/qb-r2e/live-provider.ts` |
| 3 | The school STANDARD specification paired a selected response with marked parts | Fixed in the **adaptation engine**: a format that cannot carry the profile's mark structure is never chosen, and asking for one is refused by name (`MARK_STRUCTURE_NOT_REALISABLE_BY_RESPONSE_FORMAT`). No special case in the generator | `assessment-adaptation/adapt.ts` |
| 4 | One command term per specification, bent onto every part | The specification carries `variable.commandTerms`: the profile's whole vocabulary, the lead term, and for each action of the evidence target the terms that suit it. Each part uses one. **No term is invented**: every one is recorded by the profile, with its rule and authority | `adaptation-specification.ts`, `adapt.ts` |
| 5 | A specification fixed a mark structure and no total | The specification carries `variable.marks`: how the item is scored, the range of the total, the range of the number of parts, the kinds of mark point, whether it carries credit levels — with provenance. The structure is the profile's rule; the **ranges are StudyUs policy** (discipline policy 0.2.0), because no assessment system in the repository records a total for one question. Nothing official is claimed | `discipline-policy.ts`, `adaptation-specification.ts`, `adapt.ts` |

The provider-side schema is **flat** (arrays instead of maps, null instead of absence, no unions), because that is what a strict provider schema can express. The harness normalises it into the same candidate contract as before; a combination the flat shape allows and the contract does not is refused by name.

**Consequence of fix 3 for the approach proof.** The school STANDARD specification is now SHORT_RESPONSE and STEM_PLUS is EXTENDED_RESPONSE, both with a justified argument. The approach still moves the response format, but the contrast is smaller than the (unrealisable) selected-against-constructed contrast of QB-R2D.

### Hardening

| Weakness found by reading QB-R2D | Template / specification layer | Deterministic refusal or check |
|---|---|---|
| Specification vocabulary in learner text (`vi`, `SOLVE`, "free measure", a stem that printed its own roots) | Item-writing rule LEARNER TEXT in every prompt | Harness refusal `RESPONSE_LEAKS_SPECIFICATION_VOCABULARY`; validator gate `LEARNER_TEXT_SPECIFICATION_LEAKAGE` |
| Unrealistic magnitudes, contexts that are relabelled abstractions | Rule PLAUSIBLE SITUATION; the specification now carries `variable.context.situation`, the family's own description of the context | Parameter ranges (already checked). **Plausibility itself is not machine-checkable** and no check claims it |
| A key that is obvious because it alone shows the working; stems that ask "which option formulates correctly" | The selected-response template asks for a RESULT or a DECISION with PARALLEL options, none showing working | Heuristic gate `ITEM_WRITING` (named a heuristic; a flag, never a failure) |
| Construct-destroying hand-overs (a factorised equation, both linear factors, a root) | Rule NOTHING HANDED OVER, with a per-construct list (`CONSTRUCT_INTEGRITY`) in the prompt | Validator: `handedOverIssues` → CONSTRUCT FAIL |
| Reused parameter sets | Rule NEW NUMBERS; each prompt lists the QB-R2D parameter sets of its construct | Originality: QB-R2D candidates are siblings of the fresh batch |

No official rule of any assessment system was weakened: no profile rule was edited.

## 2. QB-R2D stays reproducible

QB-R2D is historical evidence and is not touched: `pilots/qb-r2d/` is byte-identical and its replay test is unchanged and passes.

Because the engine changed, **every specification id is different today**. So the R2D replay no longer rebuilds its specifications: it reads the ones stored with the run (`scripts/operations/qb-r2d/stored-selection.ts`), each of which still verifies (id and invariant hash recomputed from its content — the new specification members are optional and absent there). It runs against version-1 templates and response schema and revision-2 validators, none of which was edited. QB-R2E's versions stand beside them: generator version 2, validators revision 3.

QB-R2D is **not rescored**. Its stored report is revision 2's.

## 3. Validators: revision 3 = revision 2 + additions

`specification-validators.ts` (revision 2) is not edited. `specification-validators-r3.ts` calls it and adds; a gate of revision 3 is revision 2's outcome made worse, never better, by the additions. **No existing check is relaxed.**

| # | Change | Kind | Justification |
|---|---|---|---|
| 1 | `marksIssues`: total, number of parts, scoring, kinds of mark point and credit levels against `variable.marks` → PROFILE_COMPLIANCE | new check | New specification field (fix 5) |
| 2 | `commandTermIssues`: each part has one command term, allowed by the specification, at the head of its prompt → PROFILE_COMPLIANCE | new check | New specification field (fix 4). Revision 2's check that the lead term appears somewhere still runs; the template asks that one part use it |
| 3 | `LEARNER_TEXT_SPECIFICATION_LEAKAGE` as a gate of its own, counted | new gate | Orchestrator's instruction. Wider than revision 2's structural check: it also reads the stimulus's text, titles and labels, the construct's own variable symbols (r1, xv) and a list of internal phrases |
| 4 | `handedOverIssues`: a declared root given as the value of the unknown; both linear factors of an optimum model written out; the model to be formulated written out → CONSTRUCT FAIL | new check | Hardening item; QB-R2D items 10 a2 and 11 |
| 5 | `ITEM_WRITING`: key uniquely obvious, options not parallel, stem asks which option is correctly formed | new heuristic gate, PASS / FLAGGED | Hardening item. Named a heuristic; never FAIL |

**Bug fixes to revision 2: none.** I made no change to it, so there is nothing to demonstrate.

Regression tests pin every addition on synthetic fixtures (positives and negatives) and on the stored QB-R2D batch, where the additions find exactly the defects the QB-R2D reading found: leakage in 10 a2, 11 a2, 15 a1, 15 a2 and 17 a1; a root handed over in 10 a2; item-writing flags on 01, 05, 06, 08, 16, 18, 19 and 20 a2.

**A caution.** These additions were written with the QB-R2D items in view. That is why they are frozen now, before the fresh items exist.

## 4. The freeze

`docs/exams/question-bank/pilots/qb-r2e/validator-freeze.json` holds the sha256 of **64 source files** and 4 data files, the pre-registered criteria and definitions, the run parameters, and one hash over all of it (`dc7549e579d8d971df9193ef4fd2bf9bb8b3c133e6c8fb2970a56826fe3b18c5` at the time of writing; the Orchestrator's freeze commit fixes it).

The file list is **computed, not typed**: it is the transitive closure of the repository imports of the entry files — the revision-3 validators, the gate evaluator, the pipeline, the selection, the budget, the evidence loader, the live transport, the freeze module and the run script. A file that is imported cannot be left out; a test checks that the list is the closure. It includes revision 2, the expression evaluator, answer normalisation, the originality gate, the construct vocabulary, the candidate contract, the stimulus specification, the rights gate, the version-2 generator, the adaptation engine, the profiles, the discipline policy, the learning approaches and the task families. The data files are the QB-R2D batch and ledger and the two pilot batches the fresh items are compared with.

**Enforcement.** `run.ts` calls `verifyFreeze` before it reads the key or creates the transport, and refuses, naming every reason, unless:

1. every listed file hashes to what the manifest says, and no file was added to or dropped from the closure;
2. the manifest's own hash is right, and the pre-registration and run parameters in code are the manifest's;
3. the freeze commit SHA it was given (`--freeze-sha`, required) exists and `git diff --quiet <sha> -- <files and manifest>` is clean;
4. every one of those files is tracked.

A refused run never builds a transport (`transportBehindTheFreeze`), so it cannot call. A test proves the refusal on a hash mismatch without a network. The freeze SHA and the manifest hash are written into the recording and, from there, into every artifact.

Note for later: one unit test asserts that the stored manifest is the working tree. It will fail when any frozen file changes — which is the point until the run is done, and a reason to retire that assertion afterwards.

<details><summary>The 64 frozen source files</summary>

- `scripts/operations/qb-r2d/budget.ts`
- `scripts/operations/qb-r2d/live-provider.ts`
- `scripts/operations/qb-r2d/prior-corpus.ts`
- `scripts/operations/qb-r2e/budget.ts`
- `scripts/operations/qb-r2e/evidence.ts`
- `scripts/operations/qb-r2e/freeze.ts`
- `scripts/operations/qb-r2e/gates.ts`
- `scripts/operations/qb-r2e/live-provider.ts`
- `scripts/operations/qb-r2e/pipeline.ts`
- `scripts/operations/qb-r2e/run.ts`
- `scripts/operations/qb-r2e/selection.ts`
- `src/lib/ai/model-routing.ts`
- `src/lib/ai/pricing.ts`
- `src/lib/ai/types.ts`
- `src/lib/assessment-adaptation/adapt.ts`
- `src/lib/assessment-adaptation/adaptation-specification.ts`
- `src/lib/assessment-adaptation/assessment-applicability.ts`
- `src/lib/assessment-adaptation/assessment-system-profile.ts`
- `src/lib/assessment-adaptation/canonical-hash.ts`
- `src/lib/assessment-adaptation/discipline-policy.ts`
- `src/lib/assessment-adaptation/instance-lineage.ts`
- `src/lib/assessment-adaptation/math-poc-applicability.ts`
- `src/lib/assessment-adaptation/math-poc-matrix.ts`
- `src/lib/assessment-adaptation/school-stem-performance.ts`
- `src/lib/assessment-adaptation/system-profiles.ts`
- `src/lib/assessment-foundation/known.ts`
- `src/lib/assessment-foundation/question-coverage.ts`
- `src/lib/catalog/concept-identity.ts`
- `src/lib/curriculum/curriculum-scope.ts`
- `src/lib/exam-core/audience.ts`
- `src/lib/exam-core/content-origin.ts`
- `src/lib/exam-core/question-bank/lifecycle.ts`
- `src/lib/exam-core/question-bank/pilots/human-review.ts`
- `src/lib/exam-core/question-bank/pilots/saber11-math.ts`
- `src/lib/exam-core/question-bank/policy.ts`
- `src/lib/exam-core/question-bank/production/answer-normalization.ts`
- `src/lib/exam-core/question-bank/production/expression-evaluator.ts`
- `src/lib/exam-core/question-bank/production/generation-contract.ts`
- `src/lib/exam-core/question-bank/production/generator/provider.ts`
- `src/lib/exam-core/question-bank/production/generator/response-schema.ts`
- `src/lib/exam-core/question-bank/production/generator/specification-generation-v2.ts`
- `src/lib/exam-core/question-bank/production/generator/specification-generation.ts`
- `src/lib/exam-core/question-bank/production/math-construct-registry.ts`
- `src/lib/exam-core/question-bank/production/originality-gate.ts`
- `src/lib/exam-core/question-bank/production/reference-pack.ts`
- `src/lib/exam-core/question-bank/production/requirement-cell.ts`
- `src/lib/exam-core/question-bank/production/rights-gate.ts`
- `src/lib/exam-core/question-bank/production/specification-candidate.ts`
- `src/lib/exam-core/question-bank/production/specification-validators-r3.ts`
- `src/lib/exam-core/question-bank/production/specification-validators.ts`
- `src/lib/exam-core/question-bank/production/stimulus-spec.ts`
- `src/lib/exam-core/question-bank/production/structural-validation.ts`
- `src/lib/exam-core/question-bank/production/validated-candidate.ts`
- `src/lib/exam-core/question-bank/quality.ts`
- `src/lib/exam-core/question-bank/task-families/family-demand.ts`
- `src/lib/exam-core/question-bank/task-families/index.ts`
- `src/lib/exam-core/question-bank/task-families/math-poc-families-ea1a.ts`
- `src/lib/exam-core/question-bank/task-families/math-poc-families.ts`
- `src/lib/exam-core/question-bank/task-families/math-problem.ts`
- `src/lib/exam-core/question-bank/task-families/task-family.ts`
- `src/lib/exam-core/slot-constraints.ts`
- `src/lib/exam-core/taxonomy.ts`
- `src/lib/learning-approach/institution-configuration.ts`
- `src/lib/learning-approach/learning-approach-profile.ts`

</details>

## 5. PRE-REGISTRATION

Written before any call. The evaluator is `scripts/operations/qb-r2e/gates.ts`, frozen. The text below is generated from that file.

### Criteria

| Criterion | Required | Measured on |
|---|---|---|
| `FIRST_ATTEMPT_STRICT_PASS` | >= 16 / 20 | ATTEMPT_1 |
| `STRUCTURAL_COMPLIANCE` | = 20 / 20 | FINAL_ATTEMPT |
| `PROFILE_COMPLIANCE` | = 20 / 20 | FINAL_ATTEMPT |
| `ANSWER_VALIDATION_FAILURES` | = 0 | ALL_ATTEMPTS_AND_FINAL |
| `CONSTRUCT_PRESERVATION_FAIL` | = 0 / 20 | FINAL_ATTEMPT |
| `CONSTRUCT_PRESERVATION_WEAK` | <= 2 / 20 | FINAL_ATTEMPT |
| `LINEAGE_COMPLETENESS` | = 20 / 20 | FINAL_ATTEMPT |
| `STIMULUS_INTEGRITY` | = ALL_APPLICABLE | FINAL_ATTEMPT |
| `ORIGINALITY_MATERIAL_FAILURES` | = 0 / 20 | FINAL_ATTEMPT |
| `MULTI_PROFILE_SAME_FAMILY_PROOF` | = PASS | FINAL_ATTEMPT |
| `STANDARD_VS_STEM_PLUS_PROOF` | = PASS | FINAL_ATTEMPT |
| `LEARNER_TEXT_SPECIFICATION_LEAKAGE` | = 0 | ALL_ATTEMPTS |
| `MAX_REGENERATIONS_PER_ADAPTATION` | <= 1 | RUN |
| `NO_MANUAL_CONTENT_REPAIR` | = TRUE | RUN |

GENERATOR_READY_FOR_DEV_SCALE is YES only when EVERY criterion above passes. If any fails it is NO. GENERATOR_READY_FOR_PILOT_CONTENT, READY_FOR_BANK_INGESTION and QUESTION_BANK_READY are NO / NO / FAIL whatever the result: nothing here is reviewed, and rights are not established.

### Definitions

| Term | Definition |
|---|---|
| `ADAPTATION` | One of the 20 selected adaptation specifications (scripts/operations/qb-r2e/selection.ts, frozen). |
| `ATTEMPT_1` | The first call for an adaptation: its prompt with attempt = 1. Exactly one call. There is NO automatic retry of any kind. |
| `ATTEMPT_2` | The ONE regeneration: the same prompt with attempt = 2 and nothing else (no hint of what failed). Exactly one call. Made if and only if ATTEMPT_1 is REGENERABLE. There is no attempt 3. |
| `NO_CANDIDATE` | An attempt that produced no candidate: no content received (transport failure, timeout, HTTP error), an answer that is not well-formed under the strict schema, or an answer the harness refused by name. A NO_CANDIDATE first attempt is a FAILED first attempt. |
| `GATE_FAIL` | For a candidate, any of: structural FAIL; profileCompliance FAIL; constructPreservation FAIL; answerKey FAILED; machineRecomputation FAIL; stimulusIntegrity FAIL; originality other than PASS_LOW_SIMILARITY; lineage FAIL; learnerTextLeakage FAIL. |
| `REGENERABLE` | ATTEMPT_1 is NO_CANDIDATE or has a GATE_FAIL. An attempt that is only WEAK, FLAGGED or HUMAN_REVIEW_REQUIRED is a result and is NOT regenerated. |
| `STRICT_PASS` | A candidate exists and: structural PASS; profileCompliance PASS; constructPreservation PASS (WEAK is not a strict pass); answerKey MACHINE_VERIFIED, DETERMINISTIC_RULE_VERIFIED or HUMAN_REVIEW_REQUIRED (not FAILED); machineRecomputation PASS or NOT_APPLICABLE; stimulusIntegrity PASS or NOT_APPLICABLE; originality PASS_LOW_SIMILARITY; lineage PASS; learnerTextLeakage PASS; itemWriting PASS (a heuristic FLAG is not a strict pass). |
| `FINAL_ATTEMPT` | ATTEMPT_2 when it was due, otherwise ATTEMPT_1. A regeneration REPLACES the first attempt even when it is worse; there is no best-of-two. An ATTEMPT_2 that was due and not run is NO_CANDIDATE. |
| `PER_ITEM_CRITERIA` | Criteria with denominator 20 other than FIRST_ATTEMPT_STRICT_PASS are measured on the FINAL_ATTEMPT of each adaptation. A FINAL_ATTEMPT that is NO_CANDIDATE fails every one of them. The same counts are ALSO reported for first attempts, for information. |
| `SIBLINGS_FOR_ORIGINALITY` | A first attempt is compared with the first attempts of the other adaptations; a final attempt with the final attempts of the other adaptations. Both are also compared with every QB-R2D candidate and with the QB-R2B and QB-R2C pilot drafts. |
| `MATERIAL_ORIGINALITY_FAILURE` | An originality outcome other than PASS_LOW_SIMILARITY under the existing gate thresholds (textual similarity >= 0.5 is REVIEW, >= 0.8 is REJECT), or the same construct with identical parameter values as another candidate of the fresh batch or of QB-R2D. |
| `CLEAN_ITEM_FOR_A_PROOF` | A FINAL_ATTEMPT candidate with structural PASS (the response contract), profileCompliance PASS, constructPreservation not FAIL, answerKey not FAILED and learnerTextLeakage PASS. |
| `SAME_FAMILY_PROOF` | Adaptations 01-05 (one task family, one invariant hash, five assessment systems). PASS when the five specifications share ONE invariant hash and ONE primary concept, every pair of different systems differs in its specification, and the items of AT LEAST THREE different assessment systems are CLEAN, declare the family's construct and carry the invariant hash in their lineage. The number of clean systems (of five) is reported. |
| `APPROACH_PROOF` | The three pairs (06,07) (01,08) (04,09). PASS when in EVERY pair: both items are CLEAN; concept id, invariant hash and declared construct are identical; the two items do NOT share a parameter set; STANDARD is recorded by absence and STEM_PLUS explicitly; every unmet preference carries its overriding rule, and a rule authority exactly when it carries a certification status. AND the school pair differs in response format in specification and items; AND the PAA pair has at least one preference overridden by an OFFICIAL rule while both items keep the same response format. |
| `LEAKAGE_COUNT` | Over ALL attempts: candidates with learnerTextLeakage FAIL, plus attempts the harness refused with RESPONSE_LEAKS_SPECIFICATION_VOCABULARY. |
| `ANSWER_FAILURE_COUNT` | Candidates of ANY attempt with answerKey FAILED, plus adaptations whose FINAL_ATTEMPT is NO_CANDIDATE. |
| `REQUEST_REJECTED` | The very first call of the run is made alone. If the provider rejects the REQUEST itself (an HTTP 4xx: authentication, model, parameters or schema) the run stops, LIVE_PROVIDER is BLOCKED and the run is VOID: no criterion is evaluated and no further call is made. A rejected request is not content. A void run needs a new freeze. |
| `NO_MANUAL_REPAIR` | Every artifact except the recording and the ledger is produced by replaying the recording. No item, key, mark or number is edited by hand. A unit test compares the stored artifacts with a replay, byte for byte. |

### Where this lane chose, and how

1. STRICT_PASS allows answerKey HUMAN_REVIEW_REQUIRED. This is NOT the strictest reading. Reason: a part whose answer is an interpretation or a justification in words cannot be decided by any rule, so excluding it would make the criterion unattainable by construction for every constructed response with such a part. Such answers are reported separately and are never counted as verified.
2. STRICT_PASS excludes a heuristic itemWriting FLAG and a constructPreservation WEAK (stricter than "no validator fails").
3. CONSTRUCT_PRESERVATION "WEAK/HUMAN_REVIEW <= 2/20" is read as: at most 2 FINAL attempts whose constructPreservation gate is WEAK. It is not the count of answers needing human review.
4. ANSWER_VALIDATION_FAILURES and LEARNER_TEXT_SPECIFICATION_LEAKAGE are counted over ALL attempts, not only final ones (stricter).
5. A FINAL_ATTEMPT is the regeneration when one was due, even if it is worse than the first attempt (stricter than best-of-two).
6. No transport retry at all: a call that returns no content is a failed attempt (stricter than the Orchestrator's reading, which would allow a transport retry; also what the cumulative budget allows).
7. A malformed answer is a failed first attempt and its second call is the one regeneration (the Orchestrator's stricter reading, adopted).
8. SAME_FAMILY_PROOF follows the Orchestrator's text (at least three systems). All five are attempted and the count is reported; requiring five would be stricter than the text.
9. A regeneration is made only for a REGENERABLE first attempt, mechanically; an attempt that is merely WEAK or FLAGGED stands.
10. REQUEST_REJECTED voids the run instead of counting twenty failures: a rejected request shape says nothing about generation.

Items 1 and 8 are the two places where the reading is **not** the strictest available; the reasons are given there. Everything else follows the Orchestrator's text or is stricter.

## 6. The run plan (phase 3, not started)

| | |
|---|---|
| Provider, model | The repository's routed generation model, `gpt-5.6-luna`, as in QB-R2D. Gateway bypassed, as in QB-R2D, for the same reason |
| Mode | Strict JSON schema; `reasoning_effort: low`; `max_completion_tokens: 2150` |
| Calls | 20 first attempts + at most 20 regenerations = at most 40. **No retry of any kind** |
| First call | Adaptation 01, alone. A rejected request (HTTP 4xx) voids the run |
| Regenerations | Exactly those the pre-registered rule says are due, computed from the recording by the frozen pipeline |
| Budget | QB-R2D + QB-R2E ≤ USD 5.00 on the assumed guard basis (USD 5 / 30 per million tokens in / out). QB-R2D used 1.550575, read from its ledger. Remaining 3.449425 |
| Worst case | Per call at most 0.0883 (input bounded at one token per 2.5 characters, output at the cap). 40 calls: 3.3915. Cumulative 4.9421 ≤ 5.00. The guard refuses any call that would pass the cap |

Why no transport retry: with one, the worst case of 80 calls does not fit the cap. Dropping it is also the stricter reading. The output cap was lowered from 6,000 to 2,150 tokens for the same reason; the largest QB-R2D answer was 1,484 tokens, but an answer cut off at the cap is a malformed answer and a failed attempt. That risk is accepted and stated.

**Not verified, because it needs a call:** that the provider accepts this JSON Schema in strict mode. It uses only the keywords the repository's own strict schema uses (type, enum, properties, required, additionalProperties, items). If the first call is rejected, the run is void and a corrected schema needs a new freeze.

## 7. The twenty new adaptations

Engine 3 specifications; none of these ids existed in QB-R2D. 01–05 are one family (the rate-comparison model) on all five systems; 06–09 with 01 and 04 are the three approach pairs.

| # | Target | Approach | Format | Calculator | Command terms allowed | Marks | Stimulus | Context | What it tests |
|---|---|---|---|---|---|---|---|---|---|
| 01.rate-comparison.paa | PAA.MATEMATICAS | – | SELECTED_RESPONSE | NONE | – | 1 | – | PERSONAL | Modelling as a selected response without a calculator; baseline of the PAA approach pair. |
| 02.rate-comparison.ib-p1 | IB.MATH_AA_HL.P1 | – | SHORT_RESPONSE | NONE | find, solve, show that, hence, write down, calculate | 2–8 | – | OCCUPATIONAL | The same family as a constructed response with marked parts and one command term per part, no calculator. |
| 03.rate-comparison.cambridge-p1 | CAMBRIDGE.9709.P1 | – | SHORT_RESPONSE | SCIENTIFIC_REQUIRED | work out, calculate, show that, write down | 2–8 | – | OCCUPATIONAL | Constructed response under another vocabulary and a scientific calculator; syllabus-version binding. |
| 04.rate-comparison.pisa | PISA.MATHEMATICS | – | SELECTED_RESPONSE | ALLOWED | – | 1, credit levels | – | PERSONAL | Authentic context required, coded credit, calculator allowed; baseline of the PISA approach pair. |
| 05.rate-comparison.icfes | ICFES.SABER11_MATEMATICAS | – | SELECTED_RESPONSE | NONE | – | 1 | – | PERSONAL | Selected response without a calculator under the Icfes competency model. |
| 06.approach.school.standard | SCHOOL_STEM_PERFORMANCE | STANDARD | SHORT_RESPONSE | ALLOWED | – | 2–8, credit levels | – | SOCIETAL | The repaired school specification: marked parts now come with a constructed response (SHORT), not with options. |
| 07.approach.school.stem-plus | SCHOOL_STEM_PERFORMANCE | STEM_PLUS | EXTENDED_RESPONSE | ALLOWED | – | 2–8, credit levels | – | SOCIETAL | STEM_PLUS where no official rule constrains it: the approach moves the response format (EXTENDED). |
| 08.approach.paa.stem-plus | PAA.MATEMATICAS | STEM_PLUS | SELECTED_RESPONSE | NONE | – | 1 | – | SOCIETAL | STEM_PLUS where OFFICIAL constraints win: preferences recorded as unmet; only the context moves. Paired with 01. |
| 09.approach.pisa.stem-plus | PISA.MATHEMATICS | STEM_PLUS | SELECTED_RESPONSE | ALLOWED | – | 1, credit levels | – | SOCIETAL | STEM_PLUS on PISA: tools honoured, format overridden by an official rule. Paired with 04. |
| 10.line-two-points.paa | PAA.MATEMATICAS | – | SELECTED_RESPONSE | NONE | – | 1 | – | ABSTRACT | Procedural and ABSTRACT (COMPUTE + REPRESENT), selected response with numeric options. |
| 11.linear-model.ib-p2 | IB.MATH_AA_HL.P2 | – | SHORT_RESPONSE | GDC_REQUIRED | find, solve, show that, hence, write down, calculate | 2–8 | – | SCIENTIFIC | FORMULATE + INTERPRET on the calculator paper: parts that need different command terms. |
| 12.linear-model.pisa | PISA.MATHEMATICS | – | SELECTED_RESPONSE | ALLOWED | – | 1, credit levels | TABLE/GRAPH | PERSONAL | A stimulus of its own (table / graph) the rate has to be read from; coded credit. |
| 13.quadratic-factorising.cambridge-p1 | CAMBRIDGE.9709.P1 | – | SHORT_RESPONSE | SCIENTIFIC_REQUIRED | work out, calculate, show that, write down | 2–8 | – | ABSTRACT | A SOLVE family as a constructed response: nothing may be handed over (no factorised form, no root). |
| 14.quadratic-factorising.paa | PAA.MATEMATICAS | – | NUMERIC_ENTRY | NONE | – | 1 | – | ABSTRACT | NUMERIC ENTRY without a calculator: a keyed root recomputed from the stem's own equation. |
| 15.quadratic-optimum.ib-p1 | IB.MATH_AA_HL.P1 | – | SHORT_RESPONSE | NONE | find, solve, show that, hence, write down, calculate | 2–8 | – | SCIENTIFIC | Modelling with an optimum WITHOUT a calculator: the factors must come from the situation, in words. |
| 16.quadratic-optimum.pisa | PISA.MATHEMATICS | – | NUMERIC_ENTRY | ALLOWED | – | 1, credit levels | – | PERSONAL | The same modelling family as a numeric entry in an authentic context. |
| 17.probability-single-event.ib-p1 | IB.MATH_AA_HL.P1 | – | SHORT_RESPONSE | NONE | find, solve, show that, hence, write down, calculate | 2–8 | – | ABSTRACT | A COMPUTE family as a short constructed response with an exact (fraction) answer. |
| 18.probability-compare.icfes | ICFES.SABER11_MATEMATICAS | – | SELECTED_RESPONSE | NONE | – | 1 | – | PERSONAL | Reasoning to a decision (FORMULATE + COMPUTE + EVALUATE) as a selected response with parallel options. |
| 19.data-judge-claim.icfes | ICFES.SABER11_MATEMATICAS | – | SELECTED_RESPONSE | NONE | – | 1 | TABLE/GRAPH | PERSONAL | A stimulus the family requires; a judgement about a claim, whole numbers, no calculator. |
| 20.data-relative-change.cambridge-p1 | CAMBRIDGE.9709.P1 | – | SHORT_RESPONSE | SCIENTIFIC_REQUIRED | work out, calculate, show that, write down | 2–8 | TABLE/GRAPH/DATA_SET | SCIENTIFIC | A realistic data set as stimulus and a calculator-dependent result with stated rounding. |

## 8. EA-1 and EA-1A artifacts

Regenerated, because the engine that produces them changed.

| Artifact | Specification ids | Outcomes, counts, summary |
|---|---|---|
| `EA1_math_adaptation_matrix.json` | all 87 changed (51 component-level, 36 system-level) | identical: 110 attempts, same specifications and refusals per target, same applicability, same minimum differences |
| `EA1A_learning_approach_poc.json` | all 24 changed | 24 specifications, summary identical. The four school STANDARD cells are now SHORT_RESPONSE; on the school profile the approach changes `responseFormat` only (it was `responseFormat`, `reasoningDepth`, `distractors`) |

Why every id changed: engine version 3, discipline policy 0.2.0, and the two new members (`marks` always, `commandTerms` where the profile has a vocabulary, `context.situation`). Invariant hashes did not change: no family and no invariant was touched.

## 9. What I could not do

1. Verify that the provider accepts the strict schema (no call in this phase).
2. Check plausibility of magnitudes or authenticity of a context by rule. The template asks for them; no validator claims them.
3. Make the item-writing gate more than a heuristic.

---

# PHASE 3 — RESULTS OF THE PRE-REGISTERED RUN

Everything above this line was written before the run and is unchanged. Everything below was written after it.

Run `qb-r2e-20261011190328`, started 2026-10-11T19:03:28.445Z. Freeze commit `9fe68d01d8649548f453873acec633f4a3dead5e`, manifest hash `dc7549e579d8d971df9193ef4fd2bf9bb8b3c133e6c8fb2970a56826fe3b18c5`, stamped into every artifact. No frozen file was changed during or after the run. No item was repaired; no score was changed. All candidates are DEV_TEST_CONTENT, RIGHTS_NOT_ESTABLISHED, unreviewed.

## R1. Verdict of the frozen evaluator

**GENERATOR_READY_FOR_DEV_SCALE = NO.** Nine of fourteen criteria fail.

| Criterion | Required | Observed | |
|---|---|---|---|
| FIRST_ATTEMPT_STRICT_PASS | ≥ 16/20 | **11/20** | FAIL |
| STRUCTURAL_COMPLIANCE | 20/20 | 18/20 | FAIL |
| PROFILE_COMPLIANCE | 20/20 | 17/20 | FAIL |
| ANSWER_VALIDATION_FAILURES | 0 | 2 | FAIL |
| CONSTRUCT_PRESERVATION_FAIL | 0 | 2 | FAIL |
| CONSTRUCT_PRESERVATION_WEAK | ≤ 2/20 | 5/20 | FAIL |
| LINEAGE_COMPLETENESS | 20/20 | 18/20 | FAIL |
| STIMULUS_INTEGRITY | all applicable | 3/3 | PASS |
| ORIGINALITY_MATERIAL_FAILURES | 0 | 2 | FAIL |
| MULTI_PROFILE_SAME_FAMILY_PROOF | PASS | PASS (3 clean systems of 5: Cambridge, Icfes, PISA) | PASS |
| STANDARD_VS_STEM_PLUS_PROOF | PASS | FAIL | FAIL |
| LEARNER_TEXT_SPECIFICATION_LEAKAGE | 0 | 0 | PASS |
| MAX_REGENERATIONS_PER_ADAPTATION | ≤ 1 | 1 | PASS |
| NO_MANUAL_CONTENT_REPAIR | TRUE | TRUE | PASS |

How to read the "2"s. Two adaptations (02 and 16) produced **no candidate on either attempt**. By the pre-registered definition a final attempt with no candidate fails every per-item criterion, so those two account for the whole shortfall in structural (18), lineage (18), the 2 answer failures, the 2 construct failures and the 2 originality failures. Among the 18 final candidates there is no structural failure, no contradicted key found by the validators, no construct contradiction, no originality failure and no lineage gap. The failures that are about content are: profile compliance (one final item), construct WEAK (five), first-attempt strict pass (11) and the approach proof.

## R2. The run

| | |
|---|---|
| LIVE_PROVIDER | PASS. `gpt-5.6-luna`, strict JSON schema **accepted on the first call**; served as requested on all calls |
| Calls | 26: 20 first attempts + 6 regenerations (exactly those the rule made due). No retry, no transport error, no rejected request |
| Malformed answers | **0 of 26** (QB-R2D: 5 of 35). Strict schema mode did what it was for |
| Fresh items | 22 candidates (18 first attempts + 4 regenerations); 4 harness refusals |
| Tokens | 86,894 in · 34,003 out |
| Spend, assumed guard basis | QB-R2E **1.454560** · QB-R2D 1.550575 · **cumulative 3.005135** of 5.00 |
| Spend, repo-configured basis | QB-R2E 0.058182 |

## R3. Per adaptation

| # | Attempt 1 | Regenerated? | Final | Failing or weak gates of the final attempt |
|---|---|---|---|---|
| 01 rate, PAA | candidate; originality: same parameter set as 06 | yes | candidate (a2) | **profile FAIL** (a distractor states 0.444 and 0.044 on a no-calculator item); construct WEAK; answer human review |
| 02 rate, IB P1 | **refused**: quantity target without a numeric value | yes | **no candidate** (refused again, same code) | every per-item criterion |
| 03 rate, Cambridge | strict pass | – | candidate | answer human review (one part) |
| 04 rate, PISA | strict pass | – | candidate | – |
| 05 rate, Icfes | candidate | – (WEAK is not regenerable) | candidate | construct WEAK; answer human review |
| 06 school STANDARD | candidate; originality: same parameter set as 01 | yes | candidate (a2) | construct WEAK; answer human review |
| 07 school STEM_PLUS | strict pass | – | candidate | answer human review (one part) |
| 08 PAA STEM_PLUS | strict pass | – | candidate | – |
| 09 PISA STEM_PLUS | strict pass | – | candidate | – |
| 10 line, PAA | candidate | – | candidate | construct WEAK; answer human review |
| 11 linear, IB P2 | strict pass | – | candidate | answer human review (two parts) |
| 12 linear, PISA | strict pass | – | candidate | answer human review |
| 13 factorising, Cambridge | candidate; **profile FAIL** (coefficients not integers) | yes | candidate (a2) | – |
| 14 factorising, PAA | strict pass | – | candidate | – |
| 15 optimum, IB P1 | strict pass | – | candidate | answer human review (two parts) |
| 16 optimum, PISA | **refused**: repeats the fixed instruction | yes | **no candidate** (refused again, same code) | every per-item criterion |
| 17 single event, IB P1 | strict pass | – | candidate | – |
| 18 compare, Icfes | candidate; **structural FAIL** (options "state the same number") | yes | candidate (a2) | item-writing FLAGGED (options not parallel) |
| 19 claim, Icfes | strict pass | – | candidate | answer human review |
| 20 relative change, Cambridge | candidate | – | candidate | construct WEAK; answer human review |

Strict pass: 11/20 on first attempts; 12/20 on final attempts (reported; not a criterion).

Final attempts by gate (18 candidates + 2 with none): construct PASS 13 · WEAK 5 · none 2. Answer class by item: MACHINE_VERIFIED 2 · DETERMINISTIC_RULE_VERIFIED 5 · **HUMAN_REVIEW_REQUIRED 11** · FAILED 0 · none 2. By keyed answer (34): 12 / 9 / 13 / 0. Machine recomputation 10/10 applicable. Originality: all 18 pass; maximum textual similarity over all candidates 0.204.

### The proofs

**Same family — PASS** on the pre-registered criterion (at least three clean systems): Cambridge, Icfes and PISA are clean; PAA's final item fails profile compliance; IB has no candidate. One invariant hash, one concept, every cross-system pair of specifications differs. Three of five is the letter of the criterion and not more.

**STANDARD against STEM_PLUS — FAIL.** The school pair (06, 07) and the PISA pair (04, 09) pass every pair check. The PAA pair (01, 08) fails `bothClean`: the regenerated baseline 01 fails profile compliance. Official constraints did win on PAA and are recorded; the school pair differs in response format; no pair shares a parameter set.

## R4. What the two fixes that worked did, and the one that was incomplete

- **Strict schema (fix 2):** 0 malformed answers in 26 calls.
- **No forbidden sentence for constructed responses (fix 1):** no constructed response was refused for it.
- **Fix 1 was not applied to numeric entry, and that cost an adaptation.** The numeric-entry template still shows the provider the fixed instruction ("Escribe tu respuesta como un número.") and the harness still refuses an item that contains it. Adaptation 16 ended its stem with exactly that sentence on both attempts and was refused twice. This is the same trap as in QB-R2D, left in place by me in one of the three templates. It is in a frozen file and was not touched.
- **Per-part command terms (fix 4):** every constructed item used allowed terms at the head of each part; none was refused or failed for it.
- **Marks (fix 5):** every item was inside the specification's ranges.
- **Leakage hardening:** 0 by the gate, and I found none in learner text by reading.
- **Parallel options / result-asking stems:** partly. Options are now parallel in form in every selected item. But five stems still ask "which option presents / indicates / describes correctly" (01 a1, 01 a2, 05, 08, 12): the heuristic did not flag them (see R6).

## R5. Generator-side reading (not a review)

I read all 26 responses. Nothing was edited.

**Wrong key: one.** 13 a1 states `3x² − 6x = 33` and keys the roots −2.5 and 4.5. Those are not the roots of that equation (with a = 3 they would need a constant of −33.75). The item was regenerated — but because of a parameter constraint, not because the validators saw the wrong key (R6, defect V2).

Every other key is mathematically right.

| Unit | Validators | My reading |
|---|---|---|
| 01 a1 | regenerable: same parameters as 06 | Key right. Stem asks "which option presents the comparison correctly". Two options conclude "package 1" |
| 01 a2 | profile FAIL, WEAK | Key right. Same meta stem. The failing numbers are in a distractor |
| 02 a1, a2 | refused | Mathematics right. The provider wrote two answers labelled `a` to carry two rates in one part; a2 also pasted the parts into the stem. A real contract failure, twice |
| 03 | strict | Right. Almost the same item as 02: suppliers, rates 3 and 2.8, difference 0.2 |
| 04 | strict | Right. A plan of 13.125 GB for 75 euros is not a realistic offer |
| 05 | WEAK | Right. Meta stem. A distractor says "75 points per dollar" |
| 06 a1, a2 | regenerable / WEAK | Right. a2 reuses 24, 84, 35, 105 again (now only against the superseded 01 a1) |
| 07 | strict | Right. **Nearly the same item as 06 a2**: municipal transport passes, 24 euros for 84 trips. The STANDARD and STEM_PLUS items differ in little but the word "justifica" |
| 08 | strict | Right. Meta stem ("which option correctly indicates"). Decimal points in Spanish |
| 09 | strict | Right. "Delivers 18 books for every 40 euros contributed" to a lending programme is odd |
| 10 | WEAK, human review | Right, and a good item. The validators cannot read an equation option for this construct, so they neither verify it nor credit the computation |
| 11 | strict | Right and clean. Far below the level of the paper |
| 12 | strict | Right. **The stimulus text states the start and the rate in words** ("ya tenía 75 euros y añade 6 euros cada semana"), so the table has nothing left to be read for. Meta stem; only one option is coherent |
| 13 a1 | profile FAIL | **Wrong key** (above) |
| 13 a2 | strict | Right and clean |
| 14 | strict | Right and clean |
| 15 | strict | Right (21.5; 12183.75). "The product of two linear effects" measured in "response units" is the abstraction relabelled, not a laboratory situation |
| 16 a1, a2 | refused | Mathematics right both times. a1 writes both factors out (it would have failed the hand-over check had it not been refused). a2's situation — 140 notebooks per buyer — is not plausible |
| 17 | strict | Right. Part (b) only converts the answer of part (a) |
| 18 a1 | structural FAIL | Right, and I see no structural defect: a validator false positive (R6, defect V1) |
| 18 a2 | flagged | Right and clean. The flag is fair: one option is five times the length of the key |
| 19 | strict | Right. Very easy: the claim compares two bars |
| 20 | WEAK | Right (50.0 %). "Percentage increase from site A to site C": a change between two places again. A round answer on a calculator paper |

Patterns: (1) the provider reuses numbers and scenarios across adaptations of one family — 24 and 84 appear in five items; (2) meta stems persist in five of nine selected items; (3) the items for IB and Cambridge are still elementary; (4) contexts are plausible more often than in QB-R2D, with exceptions (04, 09, 15, 16 a2).

## R6. Where my reading disagrees with the frozen validators — two validator defects

No score was changed and no frozen file was touched. Both defects are reported so that the batch can be judged with them in view.

**V1 — false positive (revision 2, structural, `OPTIONS_STATE_THE_SAME_NUMBER`).** The check reads "the one number an option states". In 18 a1 the options are "El juego 1 … la afirmación es falsa" and "El juego 1 … la afirmación es verdadera": the only numeral is the label of the game, so two options that say opposite things were read as stating the same number. That failed a first attempt I judge sound and forced a regeneration. Effect on the gates: without it, first-attempt strict pass would be 12/20 instead of 11/20. Nothing else changes; its regeneration is a candidate and passes every FAIL gate.

**V2 — false negative (revision 2, answer class).** In 13 a1 the stem's equation is not in the form `… = 0`, so it was not read; the keyed roots were then compared only with the *declared* roots and classed DETERMINISTIC_RULE_VERIFIED. They are not roots of the stated equation. A key that is wrong was given a "rule-verified" class. The item still failed (profile compliance) and was regenerated, so no final item carries the error; but the answer gate did not count it, so ANSWER_VALIDATION_FAILURES is understated by one first-attempt failure.

**Heuristic misses (not bugs, limits):** `STEM_ASKS_WHICH_OPTION_IS_CORRECTLY_FORMED` did not match "presenta / indica / describe correctamente" (01 a1, 01 a2, 05, 08, 12). Counted as flags they would lower first-attempt strict pass further. Nothing checks that a stimulus text hands over the model (12), that two items of a pair are near-duplicates in scenario (06 / 07), or plausibility.

**Does either defect change the verdict?** No. Correcting V1 alone gives at best 12/20 first-attempt strict passes; V2 and the heuristic misses only add failures. Every other failed criterion fails without them: two adaptations produced no candidate in two attempts, five final items are construct-WEAK, one final item fails profile compliance, and the approach proof fails on that item.

**Under the Orchestrator's rule** a genuine validator bug found after the batch started means the batch is reported as INVALIDATED, without rescoring, and the Orchestrator decides. V1 and V2 are genuine. I report them under that rule. My own view, for what it is worth: as a *certification* the batch cannot stand as scored; as *evidence* its conclusion (NO) is robust to both defects.

## R7. What would have required touching a frozen file (none was touched)

1. Removing the fixed-instruction trap from the numeric-entry template (`specification-generation-v2.ts`) — adaptation 16.
2. V1: making `OPTIONS_STATE_THE_SAME_NUMBER` ignore a numeral that is a label (`specification-validators.ts`).
3. V2: not classing a keyed answer as rule-verified when the declared parameters are not readable in the item (`specification-validators.ts`).
4. Widening the meta-stem pattern (`specification-validators-r3.ts`).

## R8. Artifacts

`docs/exams/question-bank/pilots/qb-r2e/`: `validator-freeze.json`, `recorded-live-responses.json`, `spend-ledger.json` (with the cumulative total), and — by replay only — `selection.json`, `specifications.json`, `generated-batch.json`, `automated-validation-report.json` (first-attempt and final-attempt views per adaptation), `gate-evaluation.json`, `multi-system-same-family-proof.json`, `standard-vs-stem-plus-proof.json`, `rights-record.json`. `tests/unit/qb-r2e-live-replay.test.ts` replays the recording offline and compares every replay-produced file byte for byte.

## R9. Rights

Unchanged from QB-R2D: no provider terms or licence evidence is on file in the repository; every candidate is `RIGHTS_NOT_ESTABLISHED`; nothing is claimed as StudyUs-owned.
