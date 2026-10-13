# QB-R2F -- Offline generator remediation

Status: OFFLINE. **No provider call was made in this phase.** No database, no migration, no ingestion, no deploy.
All content referred to here is DEV_TEST_CONTENT / RIGHTS_NOT_ESTABLISHED.

QB-R2E ended FAIL with its certification evidence INVALIDATED by two validator defects (V1, V2). This phase
corrects those two defects, removes the generator-side causes of the other failures, and turns every known defect
of QB-R2D and QB-R2E into a deterministic regression fixture. It prepares, but does not run, the next live run.

QB-R2D and QB-R2E are not rescored. They stand as scored by the revisions that scored them.

## 1. How earlier runs stay reproducible

Every change is in a NEW file. None of the 64 source files and 4 data files of the QB-R2E freeze
(commit `9fe68d01d8649548f453873acec633f4a3dead5e`) was edited.

| Run | Generator | Validators | Status in this phase |
|---|---|---|---|
| QB-R2D | `generator/specification-generation.ts` (v1) | `specification-validators.ts` (revision 2) | untouched, replay passes |
| QB-R2E | `generator/specification-generation-v2.ts` (v2) | `specification-validators-r3.ts` (revision 3) | untouched, replay passes |
| QB-R2F | `generator/specification-generation-v3.ts` (v3) | `specification-validators-r4.ts` (revision 4) | new |

Consequence for the QB-R2E test "THE STORED MANIFEST IS THE WORKING TREE": it was expected to break and it does
not, because no frozen file changed. It still passes unmodified. A stronger statement of the same fact was added
in `tests/unit/qb-r2f-offline-remediation.test.ts`: `git diff --quiet 9fe68d0 -- <68 frozen paths + manifest>`.

Edits to existing files, all in tests, all file-list guards that had to learn the three new source files:
`tests/unit/qb-production-os.test.ts` (module list, generator list, count 33 -> 35),
`tests/unit/qb-r2d-specification-generation.test.ts` (generator list),
`tests/unit/ea1-assessment-adaptation.test.ts` (adaptation directory list, importer list).

One design consequence to know: the item demand policy (section 2, fix 8) is NOT a member of the adaptation
specification. Had it been, every specification id, and with them the EA-1/EA-1A artifacts and the QB-R2D/QB-R2E
replays, would have moved. The policy is instead in every v3 prompt (so in every prompt hash) and in the QB-R2F
freeze.

## 2. The nine fixes

### Validators

**1. V1 -- `OPTIONS_STATE_THE_SAME_NUMBER` false positive.**
`optionsStatingTheSameNumber` in `specification-validators-r4.ts`.
Before (revision 2, kept in revision 3): two options were "the same number" when the numbers read from them were
equal. QB-R2E 18 a1 has four options "El juego 1 ... falsa / El juego 1 ... verdadera / El juego 2 ..." and failed
structural compliance on the label numerals.
After: two options state the same number when the numbers are equal AND the words of one option, without its
number, are contained in the other's. So `1/3` and `3/9`, `110 dólares` and `110`, `0,5` and `1/2` are still
caught; "Juego 1; falsa" / "Juego 1; verdadera" and "3 metros" / "3 segundos" are not.

**2. V2 -- equation parser false negative.**
`quadraticEquationStatedIn` and `reclassifyAnswers` in `specification-validators-r4.ts`.
Before: the parser read only `a x^2 + b x + c = 0`. On QB-R2E 13 a1 ("3x^2 - 6x = 33") it read nothing, and the
answer units fell back to agreement with the declaration: parts b and c were DETERMINISTIC_RULE_VERIFIED although
the keyed roots -2.5 and 4.5 are not roots of the stated equation.
After: (a) the equation is read with both sides brought together; (b) a keyed root that does not satisfy the
stated equation is FAILED / KEY_CONTRADICTED (`KEYED_ROOT_DOES_NOT_SATISFY_THE_STATED_EQUATION`), likewise a keyed
sum, product or coefficient; (c) when no equation can be read the class is HUMAN_REVIEW_REQUIRED
(`STATED_EQUATION_NOT_READ`), never rule-verified; (d) construct preservation FAILS with
`STATED_EQUATION_DOES_NOT_HAVE_THE_DECLARED_ROOTS`. The same principle is applied to a keyed line of the linear
model: rule-verified only when rate and start are readable in the item or the table shows the line.

### Generator and specification

**3. Numeric-entry fixed instruction.** `SPECIFICATION_TEMPLATE_REGISTRY_V3`: no template of version 3 has a fixed
instruction (`fixedInstruction: 'NONE'`), the prompt shows none, the response rules mention none, and
`candidate.instruction` is always null. Version 2 showed the sentence and then refused it (QB-R2E 16, twice).

**4. Duplicate part labels.** `partLabelRefusal` in v3: `RESPONSE_DUPLICATE_PART_LABEL`,
`RESPONSE_PART_LABELS_NOT_IN_ORDER`, `RESPONSE_PART_WITHOUT_MARKS_OR_PROMPT`. The strict wire schema is version 2's,
unchanged: a strict JSON schema cannot express "each label once", so prevention is in the template text ("ONE
ENTRY PER PART ... two numbers are two parts") and the refusal is in the harness.

**5. Give-away stems.** Template rule "A REAL QUESTION" (v3 item-writing rule 2) and the selected-response
template ("The key must not be the only option of its form or length"). Detection: `ITEM_WRITING_HEURISTIC_R4` /
`itemWritingFlagsR4` -- a widened meta-stem pattern in Spanish and English
(`STEM_ASKS_WHICH_OPTION_IS_CORRECTLY_FORMED`) and two structural flags (`KEY_IS_THE_ONLY_OPTION_WITH_AN_EQUATION`,
`KEY_IS_ALONE_IN_ITS_LENGTH_CLASS`). It remains a named heuristic: a flag is a reason for a person to look.

**6. Model stated in the stimulus.** Template rule "A STIMULUS IS THERE TO BE READ" (v3 rule 5). Deterministic
check `constructIssuesR4`: `STIMULUS_TEXT_STATES_THE_MODEL_TO_BE_READ_FROM_THE_DATA` (linear model: start and rate,
or the line, in the stimulus TEXT) and `STIMULUS_TEXT_STATES_THE_RESULT_TO_BE_COMPUTED_FROM_THE_DATA` (relative
change / share). Both are construct FAIL.

**7. Near-duplicates.** Generator side: `avoidListsFor` in `scripts/operations/qb-r2f/pipeline.ts` gives each call
the parameter sets (same construct) and scenarios (same family) already used by QB-R2D, QB-R2E and the earlier
answers of the run. Calls are made one at a time in selection order, so the lists are a deterministic function of
the recording. Validator side: `batchDiversityIssues` (`BATCH_DIVERSITY_RULE` v1) -- `SHARES_PARAMETER_VALUES` for
a whole set or one defining pair of the construct, against the fresh batch and both earlier runs;
`NEAR_DUPLICATE_SCENARIO` for a content-word Jaccard similarity of at least 0.4 within a task family of the fresh
batch. Either makes originality REVIEW_STRUCTURAL_SIMILARITY, which is a material failure under the
pre-registration.

**8. Task fidelity.** `src/lib/assessment-adaptation/item-demand-policy.ts`: `ITEM_DEMAND_POLICY`
(`studyus.item-demand.mathematics`, `0.1.0-provisional`, authority STUDYUS_POLICY). It states nothing about any
examination and no official fact was added to any profile. Checkable rules, enforced as profile compliance:
a mark point carries one mark (so a part of k marks has at least k mark points); a multi-mark part has a METHOD or
REASONING point; the working outline has a line per method point; total marks are at least one per evidence action
plus one. The demand text for the specification's reasoning depth is in every prompt.
Not checkable, stated in the policy itself: whether a step of working is a genuine step; whether a part is at the
level of the paper it is written for; whether the reasoning rewarded is what that paper rewards.

**9. Weak construct preservation.** Cause, the same in all five QB-R2E cases: revision 2 observes an action of the
evidence target only through a declared QUANTITY target or a mark point naming it. Items that were sound but
declared a verdict or an equation gave it nothing to observe.

| QB-R2E item | WEAK note | Why | Evidence revision 4 reads |
|---|---|---|---|
| 05 a1, 01 a2 | SOLVE, INTERPRET not observable | selected decision item, verdict target | the keyed option states the compared unit rates, recomputed here |
| 10 a1 | COMPUTE not observable | keyed answer is an equation | the keyed equation is the line through the stated points (fully checked) |
| 20 a1 | INTERPRET not observable | answers computed on the table | an answer is read from, or computed on, values of the display |
| 06 a2 | FORMULATE not observable | no mark point named it | a keyed answer states a quantity that exists only once the model is formed |

Fixed at both ends: the v3 template now asks for each action explicitly (`EVIDENCE_GUIDANCE_V3`, rule "EVERY
ACTION OF THE EVIDENCE TARGET IS ASKED FOR", a QUANTITY target for numeric entry), and revision 4 reads the
evidence above. Where there is no evidence the WEAK stays, and evidence never removes a FAIL. Threshold unchanged
(WEAK <= 2/20).

## 3. Known defect -> prevention -> fixture -> test

Fixtures: `tests/fixtures/qb-r2f/known-defects.json` -- byte-identical copies of 22 QB-R2E provider responses,
12 QB-R2D candidates and 2 QB-R2D raw responses, with run ids; the first test proves the copies equal the recorded
artifacts. Tests: `tests/unit/qb-r2f-offline-remediation.test.ts` (49 tests).

| Defect | Prevented / caught by | Fixture | Test |
|---|---|---|---|
| V1 label numerals read as the same answer | validator r4, structural | R2E 18 a1; negatives R2D 12 a1 (true positive kept), 12 a2 | "QB-R2E 18 a1 (the false positive)...", "QB-R2D 12 a1 ... STILL caught", "the corrected rule, on minimal synthetic options" |
| V2 wrong key classed rule-verified | validator r4, answer FAILED + construct FAIL | R2E 13 a1; negatives 13 a2, 14, synthetic "2x^2 + 2x = 12" | "QB-R2E 13 a1 ...", "reads an equation whichever side...", "SOUND items still pass...", "an equation that cannot be read..." |
| Non-integer coefficients | validator r2 parameter constraint (kept), profile FAIL | R2E 13 a1 | "QB-R2E 13 a1 ..." |
| Fixed instruction shown then forbidden | template v3 (none exists) | R2E 16 a1, 16 a2; R2D 10 a1, 13 a1 raw | "version 3 has no fixed instruction...", "QB-R2E 16 a1 and a2 ...", "the QB-R2D refusals for Show your working..." |
| Duplicate part labels | template rule + harness refusal | R2E 02 a1, 02 a2; synthetic order / marks / prompt | "QB-R2E 02 a1 and a2 ...", "labels out of order and a part with no marks..." |
| Give-away stems and keys | template rule + item-writing heuristic r4 (FLAGGED) | R2E 01 a1, 01 a2, 05, 08, 12; R2D 19 a1; negatives R2E 04, 09, 10 | "QB-R2E 01 a1, 01 a2, 05, 08 and 12 ...", "QB-R2D 19 a1 ...", "the widened heuristic on minimal stems..." |
| Model stated in the stimulus | template rule + validator r4, construct FAIL | R2E 12; negatives: same item with neutral text, R2D 05, R2E 20 | "QB-R2E 12 (the stimulus text stated...)", "the same item with a text that only introduces the table..." |
| Near-duplicate scenario | avoid lists + validator r4, originality REVIEW | R2E 06 a2 / 07 | "QB-R2E 06 a2 and 07 (nearly the same item)..." |
| Reused numbers | avoid lists + validator r4, originality REVIEW | R2E 01 a1 / 06 a1 / 07 (24 and 84); R2D 16 / 19; negative R2E 04 vs 05, 08, 09 | "the reused 24 and 84 ...", "each unit is told what the batch ... already used" |
| One mark point worth several marks | demand policy in prompt + validator r4, profile FAIL | R2E 07, 15, 06 a2; negatives 13 a2, 17, 20, 04 | "QB-R2E 07 and 15 ...", "sound constructed items satisfy it...", "each rule, on minimal parts" |
| Weak construct preservation | evidence guidance in template + evidence read by r4 | R2E 05, 01 a2, 10, 20, 06 a2; synthetic no-evidence and wrong-key variants | "each of the five WEAK cases...", "the evidence is a verification...", "where there is no evidence the WEAK stays..." |
| Specification vocabulary in learner text | harness refusal (v2 rule kept in v3) + leakage gate | R2D 10 a2, 11 a2, 15 a1, 17 a1; synthetic | "specification vocabulary in learner text...", "the same leak in a fresh response is refused..." |
| Handed-over root / factorised equation / both factors | validator r3 (kept), construct FAIL | R2D 10 a2, 09 a1; R2E 16 a1; negatives R2D 09 a2, R2E 15 | "handed over: a root ...", "QB-R2E 16 a1 and a2 ..." |
| Decimals on a no-calculator item | validator r2 (kept), profile FAIL | R2E 01 a2; negative R2D 07 | "decimals on a no-calculator item..." |
| Quantity without its number, marks or command term outside the specification | harness refusal (kept) | synthetic on R2E 13 a2 | "a quantity declared without its number..." |
| Revision 4 weaker than revision 3 anywhere | invariant over all 32 fixtures | all | "on every fixture: each gate is revision 3's or worse, unless..." |

## 4. What is NOT deterministically catchable

- Plausibility and naturalness of a context (a tariff nobody would charge, a table nobody would publish).
- Paper-level difficulty: whether an item is at the level of the paper it adapts to.
- Nativeness and register of the language.
- Whether a step of working is a genuine step, and whether a mark scheme rewards what the target paper rewards.
  No official mark-scheme convention is recorded in the repository, so none is checked.
- Whether the WORDS of a verdict answer make the right choice. Revision 4 can confirm that a keyed option states
  the right quantities; it does not link them to "this option" or "true". Such a key stays HUMAN_REVIEW_REQUIRED.
- Give-away stems and keys in general. The heuristic catches the recorded patterns and two structural shapes; a
  new phrasing will pass it.
- Scenario near-duplication in general. The threshold 0.4 was calibrated on one positive pair (0.478; the next
  highest pair in QB-R2E is 0.357). Two items with the same idea in different words will pass it.
- A model given away in a figure or in the stem rather than in the stimulus text; and a stated model for
  constructs other than the two covered.

## 5. Diagnostic over stored QB-R2D and QB-R2E candidates

**DIAGNOSTIC ONLY -- not certification evidence, not a rescore.** `scripts/operations/qb-r2f/diagnostic.ts`
runs revision 4 over the 26 QB-R2D and 22 QB-R2E stored candidates and writes nothing. Refused responses (QB-R2E
02, 16) have no candidate and are covered by the harness fixtures instead. Outcomes changed on 17 of 48; 31 are
unchanged. The demand-policy mark check does not apply to QB-R2D specifications (they carry no mark structure).

Known defects now flagged that revision 3 missed:

| Candidate | Change | Reason |
|---|---|---|
| R2E 13 a1 | answerKey HUMAN_REVIEW_REQUIRED -> FAILED; construct WEAK -> FAIL | keyed roots -2.5, 4.5 do not satisfy 3x^2 - 6x - 33 = 0 (V2) |
| R2E 12 a1 | construct PASS -> FAIL; itemWriting FLAGGED | stimulus text states the model; meta stem |
| R2E 07 a1 | profile PASS -> FAIL; originality PASS -> REVIEW | 2-mark mark point; shares (24, 84) with 01 a1, 06 a1, 06 a2; scenario 0.478 with 06 a2 |
| R2E 06 a2 | profile PASS -> FAIL | 2-mark mark point |
| R2E 15 a1 | profile PASS -> FAIL | 2-mark mark point |
| R2E 01 a1, 01 a2, 05, 08, 19; R2D 20 a1 | itemWriting PASS -> FLAGGED | meta stem |

Outcomes that improved, every one with its reason:

| Candidate | Change | Reason |
|---|---|---|
| R2E 18 a1 | structural FAIL -> PASS (also FLAGGED: meta stem) | V1 |
| R2E 10 a1 | answerKey HUMAN_REVIEW_REQUIRED -> DETERMINISTIC_RULE_VERIFIED; construct WEAK -> PASS | keyed equation equals the line through the stated points |
| R2E 05 a1, 01 a2 | construct WEAK -> PASS | keyed option states the recomputed unit rates |
| R2E 06 a1, 06 a2 | construct WEAK -> PASS | keyed answer states a quantity of the formed model |
| R2E 20 a1; R2D 15 a1, 15 a2 | construct WEAK -> PASS | answers computed on values of the display |

No sound item regresses to a failure for a wrong reason: the six new FAILs are exactly R2E 13 a1 (two gates),
12 a1, 07 a1, 06 a2 and 15 a1, each a known defect or the new demand policy. The three demand-policy failures are
new strictness, not a rediscovered defect of those items' mathematics. The only answer class that improves
anywhere is R2E 10 a1. Both facts are pinned by tests.

## 6. Validator change log, revision 3 -> revision 4

Revision 4 runs revision 3 unchanged and carries its full result inside its own (`revision3`).

Relaxed (the two demonstrated bugs only):
- V1: before/after as in section 2, fix 1.
- V2 is a tightening, not a relaxation: before/after as in section 2, fix 2.

Evidence read that revision 2 could not read (improves an outcome; each case named with the item):
- `KEYED_EQUATION_IS_THE_LINE_THROUGH_THE_STATED_POINTS`: HUMAN_REVIEW_REQUIRED -> DETERMINISTIC_RULE_VERIFIED when
  all four coordinates are readable in the item and the keyed equation is that line; FAILED when it is another line.
- Resolution of WEAK notes by evidence (section 2, fix 9). `KEYED_ANSWER_STATES_QUANTITIES_RECOMPUTED_HERE` is
  evidence about what the item demands; it does NOT change the answer class.

Added (stricter): stated-equation checks; keyed line of the linear model downgraded when rate and start are not
readable; model or result stated in stimulus text; item demand policy; batch diversity; wider item-writing flags.

Nothing else changed. The test "revision 4 never makes an outcome better except through the two corrected bugs
and evidence it names" asserts this over all 32 fixture candidates.

A correction made during this phase, recorded for honesty: an earlier draft let
`KEYED_ANSWER_STATES_QUANTITIES_RECOMPUTED_HERE` raise the answer class to rule-verified. That would have repeated
the kind of error V2 was (a key called verified without being checked), so it was withdrawn before the freeze.

## 7. The next run: freeze, pre-registration, selection (prepared, NOT run)

**Freeze manifest.** `docs/exams/question-bank/pilots/qb-r2f/validator-freeze.json`: 69 source files (the computed
import closure of the entry files, including revisions 2, 3, 4, generators v2 and v3, the demand policy, and the
QB-R2E gate evaluator, budget and transport it reuses), 6 data files (QB-R2D and QB-R2E batches and ledgers, QB-R2B
and QB-R2C pilots), the pre-registration, the deltas, and the run parameters. Manifest hash
`fe76a301e94a91e296e990e05a276574f8983602fb240e8ac36614600c3fdffa`. Enforcement is QB-R2E's: `--freeze-sha`
required, commit must exist, frozen files tracked and identical to the commit, artifacts stamped. The coordinator
creates the freeze commit; any further change to a frozen file requires `--write-freeze` again.

**Pre-registration** (`scripts/operations/qb-r2f/gates.ts`, id `qb-r2f-pre-registration` v1). Criteria, thresholds,
verdict rule and evaluator are QB-R2E's own objects, not copies: FIRST_ATTEMPT_STRICT_PASS >= 16/20; STRUCTURAL
20/20; PROFILE 20/20; ANSWER_VALIDATION_FAILURES 0; CONSTRUCT FAIL 0, WEAK <= 2; LINEAGE 20/20; STIMULUS 100% of
applicable; ORIGINALITY 0 material failures; SAME_FAMILY PASS; APPROACH PASS; LEAKAGE 0; at most 1 regeneration;
no manual repair.

Deltas from QB-R2E (all of them):
1. Validators revision 4 instead of 3; GATE_FAIL names revision 4.
2. MATERIAL_ORIGINALITY_FAILURE is wider (shared whole set or defining pair; near-duplicate scenario) and the prior
   corpus includes QB-R2E. Stricter.
3. APPROACH_PROOF names the new pairs and also requires that the two items are not near-duplicates. Stricter.
4. ATTEMPT_1 / ATTEMPT_2 are made in selection order, because prompts carry the do-not-reuse lists.
5. PLAN_FITS_THE_CAP is new: the run refuses to start unless the worst case of the whole plan fits the cap. Stricter.
6. ADAPTATION points at the new selection; SAME_FAMILY_PROOF is word for word QB-R2E's, on adaptations 01-05.
7. No threshold changed. No definition was defective in itself; the QB-R2E defects were in validator code.

One effect of delta 1 to be aware of: PROFILE_COMPLIANCE now includes the demand policy, so a 2-mark mark point
fails an item. That is new strictness under an unchanged threshold.

**Selection** (`scripts/operations/qb-r2f/selection.ts`): 20 adaptations, none sharing a specification id with
QB-R2D or QB-R2E; 5 concepts, 6 systems, 4 response formats, 8 with a stimulus.

| Key | Target | Construct | Format | Calculator | Stimulus | Approach |
|---|---|---|---|---|---|---|
| 01.linear-model.paa | PAA.MATEMATICAS | linear model | SELECTED | NONE | - | - |
| 02.linear-model.ib-p1 | IB.MATH_AA_HL.P1 | linear model | SHORT | NONE | - | - |
| 03.linear-model.cambridge-p1 | CAMBRIDGE.9709.P1 | linear model | SHORT | SCIENTIFIC | - | - |
| 04.linear-model.pisa | PISA.MATHEMATICS | linear model | SELECTED | ALLOWED | own | - |
| 05.linear-model.icfes | ICFES.SABER11 | linear model | SELECTED | NONE | - | - |
| 06.approach.school.standard | SCHOOL_STEM_PERFORMANCE | claim against a data display | SHORT | ALLOWED | own | - |
| 07.approach.school.stem-plus | SCHOOL_STEM_PERFORMANCE | claim against a data display | EXTENDED | ALLOWED | own | STEM_PLUS |
| 08.approach.paa.baseline | PAA.MATEMATICAS | claim against a data display | SELECTED | NONE | own | - |
| 09.approach.paa.stem-plus | PAA.MATEMATICAS | claim against a data display | SELECTED | NONE | own | STEM_PLUS |
| 10.approach.pisa.baseline | PISA.MATHEMATICS | claim against a data display | SELECTED | ALLOWED | own | - |
| 11.approach.pisa.stem-plus | PISA.MATHEMATICS | claim against a data display | SELECTED | ALLOWED | own | STEM_PLUS |
| 12.proportion-missing-value.icfes | ICFES.SABER11 | direct proportion | SELECTED | NONE | - | - |
| 13.rate-comparison.ib-p2 | IB.MATH_AA_HL.P2 | unit-rate comparison | SHORT | GDC | - | - |
| 14.line-two-points.cambridge-p1 | CAMBRIDGE.9709.P1 | line through two points | SHORT | SCIENTIFIC | - | - |
| 15.quadratic-factorising.ib-p1 | IB.MATH_AA_HL.P1 | quadratic by factorising | SHORT | NONE | - | - |
| 16.quadratic-optimum.cambridge-p1 | CAMBRIDGE.9709.P1 | quadratic optimum | SHORT | SCIENTIFIC | - | - |
| 17.quadratic-optimum.paa | PAA.MATEMATICAS | quadratic optimum | NUMERIC | NONE | - | - |
| 18.probability-single-event.paa | PAA.MATEMATICAS | single-draw probability | SELECTED | NONE | - | - |
| 19.probability-compare.pisa | PISA.MATHEMATICS | compare two probabilities | SELECTED | ALLOWED | - | - |
| 20.data-relative-change.pisa | PISA.MATHEMATICS | relative change from a table | SELECTED | ALLOWED | own | - |

Same-family proof: 01-05 (one invariant hash, five systems). Approach pairs: (06,07), (08,09), (10,11).

## 8. Cost

Guard basis USD 5 / 30 per million tokens in / out, as in QB-R2D and QB-R2E. Output of `run.ts --preflight`:

| | USD (guard basis) |
|---|---|
| Spent: QB-R2D 1.550575 + QB-R2E 1.454560 | 3.005135 |
| Cap (unchanged) | 5.00 |
| Remaining | 1.994865 |
| Worst case, 20 first calls + 20 regenerations | 4.234740 |
| Cumulative worst case | 7.239875 |
| Fits under the cap | **NO** |
| MINIMUM_REQUIRED_CAP (rounded up to 0.25) | **7.25** |

Worst-case bound per call: output at the cap of 2,150 tokens; input at one token per 2.5 characters of the actual
v3 prompt (11,140 to 16,430 characters) plus the largest growth the do-not-reuse lists can have.

Realistic expectation from QB-R2E's ledger (0.055945 per call, largest answer 1,675 output tokens): 20 calls
about 1.12; 26 calls as in QB-R2E about 1.45; 40 calls about 2.24. QB-R2F prompts are longer, so somewhat more.
A typical run would probably end under 5.00 cumulative, but that is an expectation, not a bound.

Is there an honest design that fits 5.00? No. The output term alone, 40 calls at QB-R2E's largest observed answer
(1,675 tokens), is 2.01, already above the 1.994865 remaining, before any input. Fitting would need fewer
adaptations, no regenerations, or an output cap below an answer already observed, each of which weakens the
pre-registration or manufactures truncations.

The plan-level guard (`planBudget`, `transportBehindTheGates`) refuses to build a transport while the plan does
not fit; `R2F_CUMULATIVE_CAP_USD` is still 5. Raising it is the orchestrator's decision, changes a frozen file
(`scripts/operations/qb-r2f/budget.ts`, and the run parameters in the manifest), and therefore must happen before
the freeze commit, followed by `--write-freeze`.

## 9. Verification

- `npx tsc --noEmit -p tsconfig.json`: clean.
- `npx vitest run`: 522 files, 9,445 tests, all passing (baseline 521 / 9,396; +1 file, +49 tests).
- `npx next build`: succeeds.
- QB-R2D and QB-R2E replay tests pass; `pilots/qb-r2d` and `pilots/qb-r2e` have no modification; the 68 frozen
  paths of QB-R2E are identical to commit 9fe68d0.
- No key in any new file; no `.env*` file in the worktree; the env file of the other worktree was not read.

## 10. Proposed status

- GENERATOR_REMEDIATION_OFFLINE: **PASS** -- every known defect has a passing fixture test or is listed in
  section 4.
- R2F_READY_FOR_LIVE_RUN: **NO** -- PLAN_DOES_NOT_FIT_THE_CAP. Becomes ready after a cap decision
  (minimum 7.25), `--write-freeze`, and the freeze commit.
