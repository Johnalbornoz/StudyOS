# Post-Canary remediation (offline)

Status: ENTIRELY OFFLINE. **NEW_PROVIDER_CALLS = 0. NEW_PROVIDER_SPEND_REQUESTED = NO.** No transport is
constructed and no key is read anywhere in this work; no database, migration, ingestion, deploy or stage promotion.

Orchestrator rulings recorded: CANARY_EXECUTION = PASS; PRODUCTION_CONTENT_READINESS = FAIL. Every existing
candidate remains DEV_TEST / RIGHTS_NOT_ESTABLISHED / NOT_RELEASE_CONTENT. The AI reviewer's decisions are frozen:
they are not rescored and the reviewer is not re-run.

Everything here is NEW files. The Canary's frozen closure (freeze `f445e7a`), its artifacts (commit `caed21c`),
and the QB-R2D / R2E / R2F evidence are byte-identical and their replays pass.

**In-sample warning.** Validators revision 5 was written with the Canary's 221 candidates in view. Its numbers on
those candidates are diagnostics, not certification.

## 1. Where things are

| What | Where |
|---|---|
| Validators revision 5 | `scripts/operations/qb-post-canary/validators-r5.ts` |
| Generator version 4 (future runs) | `src/lib/exam-core/question-bank/production/generator/specification-generation-v4.ts` |
| Demand and paper-fidelity profile v2 | `scripts/operations/qb-post-canary/demand-profile-v2.ts` |
| Parameter policy and typed guidance v2 | `scripts/operations/qb-post-canary/parameter-policy-v2.ts` |
| Spend accounting v2 | `scripts/operations/qb-post-canary/spend-accounting-v2.ts` |
| Human review form v2 | `scripts/operations/qb-post-canary/human-review.ts` |
| Calibration analytics | `scripts/operations/qb-post-canary/calibration-analytics.ts` |
| Next-run gate | `scripts/operations/qb-post-canary/next-run-gate.ts` |
| Offline replay, family analysis | `scripts/operations/qb-post-canary/replay.ts`, `family-analysis.ts` |
| Artifacts | `docs/exams/question-bank/pilots/qb-canary-250/{v5-offline-replay/, human-review/, spend-reconciliation.json}` |
| Fixtures (copies of Canary items) | `tests/fixtures/qb-v5/canary-items.json` |
| Tests | `tests/unit/qb-post-canary.test.ts` (43 tests) |

Revision 5 and the policy layers live in the lane's script directory, not under `src/`. That kept every frozen
closure and every guard list untouched except for the one new generator file. Moving revision 5 into `src/` is a
mechanical step for the next freeze.

## 2. Human calibration (sample of 37, not enlarged)

**Audit of the frozen packet** (`human-review/packet-audit.json`, with a test that reads the frozen file
independently): the 10 blind items expose no AI verdict, no validator verdict and nothing of the key file. Blind
items: 016, 032, 037, 093, 128, 138, 147, 187, 226, 233.

**What the other 27 items show.** The frozen packet shows them WITH the AI review (classification, ten verdicts
with reasons, the AI's own worked solution, its question) and the validator gates. A person reviewing those 27 is
not independent of the AI reviewer on them. The frozen packet was not changed.

**Two renderings, both generated deterministically:**

- `reviewer-packet.html`: the frozen packet as it is (default, as the orchestrator named it).
- `reviewer-packet-fully-blind.html` and `.json`: the same 37 items in the same order with no automated result for
  any item. **Recommended for the first review**, so that all 37 first judgements are independent; the automated
  results can be shown afterwards.

Both are print-friendly, self-contained HTML: item, stimulus (tables, and the one rendered chart), key and mark
scheme, assessment system and component, stated band, and the ten questions. Items are in their own language with
English labels.

**The form** (`response-template.json`, 37 empty slots). Ten independent judgements, each with a controlled
vocabulary: academic_correctness, answer_key_correctness, construct_fit, assessment_system_fidelity,
paper_level_fidelity, difficulty_achieved, originality_material_duplicate, wording_clarity, final_human_decision,
reviewer_notes. Plus reviewer id, `reviewer_kind: HUMAN`, qualification, date, minutes spent, reviewed_blind and
`consulted_ai` (must be false).

**SECOND_HUMAN_REVIEW_REQUIRED** is computed only after a first review is recorded, from that review and the
frozen AI decision, and is never shown to the first reviewer. YES when any of:

1. the final decision disagrees with the AI (AI approved and the person did not; AI rejected and the person
   approved);
2. correctness or key is AMBIGUOUS or NOT_ASSESSABLE;
3. the person found an error the AI passed;
4. the AI found an error the person passed.

An item the AI sent to a person has no AI decision to disagree with, so rule 1 does not apply to it.

**No AI in either slot.** A reviewer whose identity names an AI system, who is not declared human, or whose
review is AI-assisted is refused; a second review by the same person is refused.

**Which label counts.** Settled by the first review when no second is required; by two reviews whose final
decisions agree; otherwise UNSETTLED, for a third person. Never settled by an AI.

**Mapping to `STUDYUS_HUMAN_CALIBRATION_SET` v1** (schema untouched): NEEDS_REVISION is recorded as REJECTED
("not usable as it stands"); DEFECT_CLASS and SEVERITY are derived from the ten judgements by a fixed order.

`REVIEWER_INSTRUCTIONS.md` says what each field means, forbids AI, and gives time guidance (about five to six
hours for the packet).

No human response exists in any artifact. Templates are empty.

## 3. Validators revision 5

### Change log, revision 4 to revision 5

| Id | Area | Kind | Change | Canary evidence |
|---|---|---|---|---|
| A1 | key | tightens | verified only by recomputation from learner-visible text | 070: wrong key MACHINE_VERIFIED from declarations |
| A2 | key | relaxes | a disagreement with the DECLARED target or arithmetic is a flag, not a failure | 004, 079, 090, 048 |
| A3 | key | reclassifies | sign, percent unit and rounding are REPRESENTATION_DIFFERENCE with a subtype | 146, 153, 194 |
| A4 | key | reclassifies | STEM_CONSISTENT and UNVERIFIED are not verifications | revision 4 verified 139 keys, all via declarations |
| B1 | options | relaxes | equations compared as equations | 019 |
| B2 | options | tightens | equivalent equations are the same option | synthetic only |
| C1 | originality | relaxes | scenario similarity not applied to ABSTRACT items | 66 items, framing sentences scoring 1.0 |
| C2 | originality | reclassifies | only MATERIAL_DUPLICATE fails; two signals reported | orchestrator instruction; 57 items failed on originality alone |
| D1 | profile | reclassifies | declaration and working-outline issues to a non-blocking channel | 31 and 26 items |
| T1 | construct | tightens | keyed value is a cell of the table row the question names | 122 |
| T2 | stimulus | tightens | text count disagrees with the table total | 211 |

No change is justified by a score. Each has a named item or an explicit instruction.

### A. Answer key

Classes: INDEPENDENTLY_VERIFIED, REPRESENTATION_DIFFERENCE (SIGN / UNIT_PERCENT / ROUNDING), KEY_CONTRADICTED,
STEM_CONSISTENT, UNVERIFIED. The generator's declarations are a cross-check that can only add a flag; a test
changes the declared parameters and shows the class does not move.

Readers, and what each cannot read:

| Construct | Reads | Limit |
|---|---|---|
| line through two points | two points; y at a stated x, slope, intercept, equation | |
| quadratic by factorising | the equation in the stem; greater / lesser root, sum, product | factorised-form answers are text |
| quadratic optimum | two linear factors as expressions or in words; maximising x, maximum value | wording outside the patterns |
| compare two probabilities | four counts; which option is higher (verdict) | a keyed NUMBER is consistency only |
| unit-rate comparison | four amounts | rate direction not read: consistency only |
| single-draw probability | two counts | which event not read: consistency only |
| direct proportion | three numbers | which correspond not read: consistency only |
| linear model | a table of a line, or start and rate; the equation | a keyed NUMBER is consistency only |
| relative change | two table rows named in the question; percentage change | |
| claim against a display | nothing | every key UNVERIFIED |

Rounding to a whole number counts as a representation only when the text asks for rounding; a sign counts only
for a difference or a change.

### B. Options and equations

`y = x - 4` and `y = -x + 4` are different options. `2x + 4 = 0` and `x = -2`, `y = x/2 + 1` and `2y - x = 2`,
`0,5x` and `1/2x`, reordered terms: the same equation.

### C. Originality

- MATERIAL_DUPLICATE (fails): textual similarity at the reject threshold (0.8); or the whole parameter set equal;
  or, for an item with a situation, a near-duplicate scenario AND a shared parameter pair with the same item.
- MATHEMATICAL_TEMPLATE_SIMILARITY (signal): a shared parameter pair alone.
- STRUCTURAL_SIMILARITY (signal): textual similarity in the review band (0.5 to 0.8), or a near-duplicate scenario
  alone on a situational item.
- Scenario similarity is not applied to ABSTRACT items.

The QB-R2E pair 06 a2 / 07 is still a material duplicate under this rule.

### D. Profile channels

| Code | Channel |
|---|---|
| PARAMETER_NOT_OF_THE_CONSTRUCT | DECLARATION_QUALITY |
| WORKING_OUTLINE_SHORTER_THAN_THE_METHOD_POINTS | DECLARATION_QUALITY |
| ITEM_DOES_NOT_SAY_WHICH_STIMULUS_VALUES_IT_USES | DECLARATION_QUALITY |
| COMMAND_TERM_ABSENT, DISPLAY_VALUE_OUT_OF_RANGE, NO_CALCULATOR_RULE_*, PARAMETER_CONSTRAINT, PARAMETER_OUT_OF_RANGE, RUBRIC_HAS_NO_ACCURACY_POINT, WORKING_SHOWN_BUT_NO_METHOD_POINT, MARK_POINT_*, every other code | HARD |

A code not seen in the Canary defaults to HARD.

### E. Harness leak rule (generator version 4, future runs)

Version 3 refused any multi-letter construct symbol found in learner text; three constructs have symbols that are
ordinary words. In version 4 a symbol that is a plain word of five letters or more is a leak only where it is used
as an identifier (`verdict = SUPPORTED`, `categories: 6`). Symbols with a digit or under five letters (`r1`, `vi`)
and code words are refused as before.

Diagnostic on the Canary's 8 leak refusals, from the recorded responses: **6 were false** ("result" three times,
"verdict" twice, "categories" once), **2 were real** (`r1`, `r2` written into the stem). The eight slots stay "no
candidate" in the Canary. Appendix only (`harness-leak-diagnostic.json`, "wouldHaveBeen"): of the six, version 4
would accept five; the sixth (083) has a malformed stimulus table and would still be refused. None of the five is
a revision-5 strict pass.

Version 4 also takes an optional `demand` block and typed `slotGuidance` in the prompt; absent, the prompt has
neither. It has generated nothing.

### F. Spend accounting

`spend-reconciliation.json` (new file; no frozen artifact edited):

| Source | Cumulative USD | Difference |
|---|---|---|
| run log, every call of every phase (AUTHORITATIVE) | 29.973085 | 0 |
| ledger entries, last running total | 29.973085 | 0 |
| ledger entries, summed | 29.973085 | 0 |
| ledger header | 29.913190 | -0.059895 |
| metrics.json | 29.913190 | -0.059895 |

The difference is exactly the reviewer pre-flight call, which the frozen report left out. The budget guard read
the run log, so the cap was enforced on the authoritative figure. Version 2 states one total everywhere and
`assertReconciled` refuses a report that does not reconcile. A test recomputes 29.973085 from the frozen run log.

## 4. Offline replay (in-sample; the Canary is not rescored)

Criteria were written in code before the replay was computed.

| | Criterion | Result |
|---|---|---|
| C1 | none of the 8 known false failures contradicted or structurally failed | met |
| C2 | none of the 6 confirmed wrong keys independently verified; caught where the stem permits | met: 5 caught, 070 not catchable |
| C3 | 122 and 211 fail | met |
| C4 | no validator rejection lost except the 8 known | **not met as written**: 241 |
| C5 | every revision-5 contradiction confirmed by the frozen AI reviewer | met |
| C6 | byte-reproducible | met (test) |

**OFFLINE_REPLAY = FAIL as the criteria were written (5 of 6).** C4 fails on one item: slot 241 is a ninth false
key failure of the same kind as 004, 079 and 090 (y at x = 3 on the line through (0, 2) and (4, -6); key -4 is
correct; revision 4 compared it with the declared intercept). It was not AI-reviewed (closed by the budget), so it
was not on the list. It is disclosed, not added to the list after the fact. If the orchestrator accepts that
explanation, the replay meets the intent of every criterion; that is the orchestrator's ruling to make.

### Old against new (221 candidates, same definitions for both)

| | Revision 4 | Revision 5 |
|---|---|---|
| STRICT_PASS | 66 | 132 (87 if demand "below" is also excluded) |
| KEY_FAILURES | 13 | 5 |
| Key verified | 139 (all from declarations) | 55 independently |
| MATERIAL_DUPLICATES | 93 | 0 (signals: 33 template, 12 structural; 67 abstract items exempt from the scenario rule) |
| PROFILE_FAILURES | 55 | 19 (36 moved to declaration quality) |
| REJECTED_BY_VALIDATOR | 16 | 7 |
| Any hard failure | 133 | 38 |
| Construct failures | 12 | 13 |
| Stimulus failures | 2 | 3 |

"Rejected by validator": a failure of a gate stating a deterministic fact (structural, key failed / contradicted,
lineage, leakage), the R1-type failures.

Revision-5 key classes by item: 55 independently verified, 5 contradicted, 61 stem-consistent, 100 unverified.

### Named items

| Item | Revision 4 | Revision 5 |
|---|---|---|
| 016, 085, 135, 177, 226 (wrong keys) | FAILED | KEY_CONTRADICTED |
| 070 (wrong key) | part b MACHINE_VERIFIED | STEM_CONSISTENT / item UNVERIFIED: not verified, **not caught** |
| 004, 048, 079, 090 (false failures) | FAILED | INDEPENDENTLY_VERIFIED |
| 146, 194 (false failures) | FAILED | UNVERIFIED (numeric parts stem-consistent) |
| 153 (false failure) | FAILED | STEM_CONSISTENT |
| 019 (false structural failure) | structural FAIL | PASS, key verified as an equation |
| 241 (found by the replay) | FAILED | INDEPENDENTLY_VERIFIED |
| 122 | construct WEAK, key verified | construct FAIL |
| 211 | strict pass | stimulus FAIL |
| 032 (duplicated options) | structural FAIL | structural FAIL |

### Changed outcomes

Almost every item changes its key class name, because the classes are new. Changes of substance: originality 93
items fail to pass; profile 36 items fail to pass; structural 1 (019); construct 1 (122, to FAIL); stimulus 1
(211, to FAIL). Strict pass gained by 67 items and lost by 1 (211). The full list with a reason per item is in
`changed-outcomes.json`.

### Counterfactual (in-sample, not evidence, not the Canary's result)

The frozen decision policy fed revision-5 gates and the same frozen AI reviews, over the 210 reviewed items:
APPROVED 25 to 40, NEEDS_HUMAN_REVIEW 157 to 150, REJECTED 28 to 20. Fifteen items move from needs-review to
approved and the eight false R1 rejections move to needs-review. The Canary's recorded classifications are
unchanged.

## 5. Difficulty and paper fidelity, version 2

`DEMAND_PROFILE_V2` (`studyus.demand-profile.mathematics@2.0.0-provisional`):

- per band: target cognitive demand, reasoning steps (FOUNDATIONAL 1 to 2, STANDARD 2 to 4, CHALLENGE 4 to 8),
  whether a non-routine element is required (CHALLENGE), representation transitions, number types, algebraic
  complexity;
- per response type: expected response depth, distractor sophistication by band;
- per evidence class: the non-routine elements a CHALLENGE item may use;
- per component, a paper fidelity profile: a floor of reasoning steps, minimum total marks for a constructed item,
  marks-per-part range, a syllabus-level note.

**Honesty.** Every number is STUDYUS_POLICY, PROVISIONAL, and requires subject-matter-expert confirmation. None
is the standard of any board. What the repository records as official about a component is read from the
specification with its provenance and is not restated.

**No existing artifact moves.** The adaptation engine, its schema and every specification id are untouched; the
demand block is composed beside a specification and passed to generator version 4. A test shows specifications
are unchanged and the accepted EA-1 / EA-1A artifacts are identical to `caed21c`.

**Checkable part.** Only a constructed response shows its steps: a step is evidenced when the mark scheme rewards
it (METHOD or REASONING point). CHALLENGE needs four evidenced steps and a REASONING point. For a closed item the
outcome is UNVERIFIED. `paper_level_fidelity` is UNVERIFIED unless the item is constructed and the component has a
floor.

**Diagnostic on the Canary:**

- 76 CHALLENGE candidates: 36 constructed, of which 28 are below demand and 8 meet it; 40 closed, unverified.
- 82 IB and Cambridge candidates: 55 below the provisional paper floor, 27 meet it.
- The 7 approved IB and Cambridge items: 6 below the provisional floor (026, 045, 138, 170, 173, 216), 1 meets
  it (233).

## 6. The four families with no approved item

One primary cause per slot, by the first rule that applies (`family-analysis.json`).

| Family | Slots | Primary cause | Counts | Revision 5 alone: strict pass |
|---|---|---|---|---|
| rate comparison | 26 | GENERATOR_PROMPT | generator 21, difficulty 2, other 3 | 2 to 10 |
| line through two points | 25 | VALIDATOR | validator 9, difficulty 8, family spec 4, generator 2, other 2 | 0 to 7 |
| factorising | 24 | GENERATOR_PROMPT | generator 10, difficulty 6, validator 6, other 2 | 1 to 17 |
| optimum | 25 | GENERATOR_PROMPT | generator 20, parameter policy 2, other 3 | 1 to 2 |

- **Rate comparison.** The AI reviewer doubted response contract, fairness or construct on 21 of 25: stems that
  do not say which rate is meant, scaffolding parts that name the division (examples 007, 014, 025, 054, 103).
  Revision 5 cannot verify any key here: the rate's direction is not read.
- **Line through two points.** Mostly held back by revision 4 (examples 030, 051, 056) and by the band not being
  realised (038, 101, 120). Four items ask for y at a stated x (004, 079, 090): the family's evidence target
  allows it, the construct's vocabulary has no such quantity. One real wrong key (135).
- **Factorising.** Equation given already factorised (102, 141), roots written into the stem (028, 202), band
  not realised (018, 049, 058). Revision 5 verifies 14 keys from the stated equation.
- **Optimum.** The worst family and revision 5 does not rescue it: both factors written out (027, 060, 099),
  four wrong maxima (016, 085, 177, 226), unclear wording (009, 033, 048). Only 2 of the 4 wrong keys are on a
  non-clean pinned case; the other 2 are plain arithmetic errors, so my earlier attribution to the parameter
  policy was too strong.

**Remediation for future runs** (`parameter-policy-v2.ts`):

- pinned values are derived from the construct's solvability constraint. For the optimum, p = q·a and
  r = s·(2t + a) give an integer vertex t with both factors positive; a test checks 250 values of n. Lines get
  slopes that are integers or halves; proportions a whole missing value; factorising distinct non-zero integer
  roots.
- guidance is typed: each pinned value carries its role; the display description is separate, and states that
  the number of categories is the number of rows, not a quantity of the situation.
- `pinnedRoleIssues` checks use in role. On slot 211 it reports
  `DISPLAY_CATEGORY_COUNT_WRITTEN_AS_A_QUANTITY_OF_THE_SITUATION:6`.

## 7. Calibration analytics (code now; runs when labels exist)

Validators revision 4, revision 5 and the AI reviewer against the settled human label, for correctness, answer
key, construct, difficulty, assessment-system fidelity and overall decision: confusion table, precision, recall,
false-positive rate, false-negative rate, agreement rate. Every rate carries its counts and a 95% Wilson
interval; every disagreement is listed by item; blind and non-blind are split; items awaiting a second review or
unsettled are listed by name and enter no rate. A judge with no opinion on a dimension (revision 4 on difficulty;
the AI when it deferred) is excluded by name.

`run.ts --analyse <form.json>` refuses a missing file, an invalid form, and a form with no settled label. No
label is invented. Tests use synthetic labels inside the test only.

## 8. Next live run gate

| Fact | Today | Required |
|---|---|---|
| HUMAN_CALIBRATION_COMPLETE | NO | YES |
| VALIDATOR_V5_OFFLINE_REPLAY | FAIL (5 of 6 as written) | PASS |
| ANSWER_KEY_INDEPENDENT_RECOMPUTATION | PASS | PASS |
| SPEND_ACCOUNTING_RECONCILED | PASS | PASS |
| DIFFICULTY_PROFILE_V2 | READY (structure) | READY |

`NEXT_LIVE_RUN_MAY_BE_REQUESTED = NO`. An open gate would permit a request; it authorises nothing.

### Proposal only, not a request: the smallest useful next experiment

Sixty slots, first attempt only, same reviewer, once the gate opens:

| Block | Slots | Measures |
|---|---|---|
| CHALLENGE band with a demand block (half on IB and Cambridge) | 24 | does generator version 4 realise a band and a paper floor it is told in numbers |
| The four families under parameter policy v2 (6 each) | 24 | wrong maxima, factorised equations, "y at x" drift, ambiguous rate stems |
| The two data families | 12 | harness refusals after the leak rule change; table cell types |

Assumed cost from the Canary's measured per-call figures (generation 0.058, review 0.062): about 3.5 for
generation and about 3.5 for review, plus a pre-flight, so about USD 7 assumed. With the cumulative spend at
29.973085 this needs a new cap from the orchestrator.

## 9. What remains unverifiable, and where a PASS is not defensible

- **070 is not caught.** Which numbers correspond in a proportion is not read. Revision 5 no longer verifies it;
  it cannot contradict it.
- **Coverage of independent recomputation is partial**: 55 of 221 items. 100 are UNVERIFIED and 61 only
  stem-consistent. The readers are patterns over Spanish and English phrasings seen in the Canary; other
  phrasings will fall to UNVERIFIED (never to verified).
- **MATERIAL_DUPLICATES = 0 under revision 5 is a reclassification, not a finding that there are none.** Twelve
  items with textual similarity in the review band no longer fail; nobody has looked at them.
- **Demand profile numbers are provisional.** `DIFFICULTY_PROFILE_V2`, `IB_PAPER_FIDELITY_PROFILE` and
  `CAMBRIDGE_PAPER_FIDELITY_PROFILE` are ready as structure. Calling them PASS as paper standards is not
  defensible without subject-matter-expert confirmation. A closed item's demand is not checkable at all.
- **128** still fails structurally on `ANSWER_CHECK_EXPRESSION_DOES_NOT_EVALUATE`, a generator-only declaration.
  The instruction covered profile declarations; this one is structural and was left as it is.
- **PARAMETER_CONSTRAINT and PARAMETER_OUT_OF_RANGE** stay hard, but are computed from declared parameters. Where
  the declaration differs from the stem they can be wrong.
- **Generator version 4 and parameter policy v2 have never generated an item.** They are rules and tests.
- **The decision policy is unchanged.** R1 still rejects on a validator failure; with revision-5 inputs it would
  fire on real contradictions only, which is the counterfactual, not a result.
- **Human calibration is ready to start, not started.** No label exists.
