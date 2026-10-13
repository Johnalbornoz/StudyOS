# QB-R2D — Live multi-profile generation (ephemeral certification, no ingestion)

**Status of everything in this document: EPHEMERAL · NOT INGESTED · DEV_TEST_CONTENT · AUTOMATED VALIDATION ONLY.**
No item was reviewed by a person. No item was written to a database, a Question Bank, a pool or a review queue. Rights are not established. Nothing here is pilot content.

Date of the run: 2026-10-11 (18:05–18:18 UTC). Branch `feat/qb-r2d-live-generation`. Artifacts: `docs/exams/question-bank/pilots/qb-r2d/`.

## 1. What was asked, in one paragraph

Take the adaptation specifications the EA-1 / EA-1A architecture produces, hand them to the **real, configured generation provider**, and find out whether a specification — not an exam name plus a topic — is enough to get an item that keeps the family's construct and is asked the way the target asks. Then validate every item independently of the generator, read every item, and report honestly where the two disagree.

**The short answer.** The pipeline works end to end and is replayable. The provider keeps the mathematics right (no wrong key in 30 well-formed responses, by my reading and by recomputation) and follows the *assessment* dimensions of a specification (format, marks, calculator, language, stimulus, context declaration). It is unreliable on the *response contract* (one in five first answers malformed; a fixed instruction it was told not to repeat is repeated in a third of the constructed responses; specification vocabulary leaks into what a learner would read), and its items are recognisably machine-written and often not native to the system they are for. The generator is **not** ready for scale.

## 2. Pre-flight

| Fact | Value |
|---|---|
| How the repository configures generation | `src/lib/ai/model-routing.ts`, `CAPABILITY_ROUTING.QUESTION_GENERATION`; used for the Question Bank by `src/lib/exam-core/question-bank/ai-runner.ts` |
| Provider | OpenAI (Chat Completions) |
| Model | `gpt-5.6-luna` (routed primary; routed fallback `gpt-5.6-terra`, **not used**) |
| Model served | `gpt-5.6-luna` on all 35 calls. No substitution was needed |
| Call parameters | JSON-object mode, `reasoning_effort: low` (the repository's practice-generation budget), `max_completion_tokens: 6000` (the Question Bank runner's own cap) |
| Credential | `OPENAI_API_KEY` present in `/Users/jalbornoz/PROYECTOS/studyos-q1-bank-readiness/.env.local`. Only that one variable was passed into the process; the file was never loaded. The key is in no artifact, log or error message |
| Gateway | **BYPASSED, stated plainly.** The repository's AI gateway writes governance rows to a database and this lane may touch no database. The live call is a direct HTTPS call from `scripts/operations/qb-r2d/live-provider.ts`. No governance row, audit row or gateway budget was written for these 35 calls. The lane's own complete ledger is `spend-ledger.json` |
| Database | None. A unit test walks every transitive import of the run script: no database module, no gateway module, no service; of `src/lib/ai` only the routing table and the price table (and the type file the routing table names) |

### Price basis and spend

I could not verify current vendor prices (no browsing). Two bases are applied to the **provider's own usage figures**, per call, in the ledger:

| Basis | Input / 1M | Output / 1M | What it is |
|---|---|---|---|
| **GUARD — ASSUMED** | USD 5.00 | USD 30.00 | A deliberately high assumption, 25 times the repository's configured price of this model and above its configured price of the stronger one. The USD 20 cap is enforced on this basis |
| REPO — configured | USD 0.20 | USD 1.20 | `src/lib/ai/pricing.ts`, which labels itself "configured, NOT vendor billing truth" |

Neither is an invoice. The provider's billing is the only truth about money and this lane cannot read it.

| | Pre-flight estimate | Actual |
|---|---|---|
| Calls | 20 (one per unit) | **35** (20 first calls, 4 retries, 11 regenerations) |
| Tokens | ~2,550 in and ~2,500 out per call | 82,925 in · 37,865 out (of which 14,188 reasoning) |
| USD, guard basis | 1.75 expected · 4.05 worst case · 8.09 if every unit were retried | **1.550575** |
| USD, repo-configured basis | 0.07 | **0.062023** |

**SPEND_USD = 1.55 on the assumed guard basis (0.06 on the repository's configured basis). Cap: 20.** The guard refused no call. It is enforced in code before every call (`spent + worst case of this call at max_tokens ≤ cap`), and a unit test proves it refuses.

The first call was a single minimal one (the smallest prompt) to verify the key, the response format and the usage accounting before the batch.

## 3. What was built

All additive. The cell-driven QB-R2C harness is untouched; pilot v2 replays byte-identical; the cells are unchanged.

| File | What |
|---|---|
| `production/specification-candidate.ts` | The contract of a specification-driven candidate: declared model, answer targets, selected / numeric / **constructed** response (parts, marks, typed mark points, final answers, working outline), coded credit, and a lineage in which every member is required |
| `production/math-construct-registry.ts` | The closed vocabulary of the ten constructs: parameter symbols, quantity codes, verdict codes. Declarative only — it computes nothing |
| `production/generator/specification-generation.ts` | The specification-driven entry point (unit = one specification). Three templates by elicitation format, a strict response schema, a named refusal for every misfit, complete lineage. Pure: no network, clock, randomness or vendor name |
| `production/specification-validators.ts` | The eight independent validators. Imports nothing of the generator |
| `scripts/operations/qb-r2d/` | `selection.ts` (the twenty adaptations), `budget.ts` (price bases, ledger, guard, one-retry rule), `live-provider.ts` (the only network file), `pipeline.ts` (recording → every derived artifact, pure), `prior-corpus.ts`, `run.ts` |

**Why a specification-driven entry point.** A requirement cell is a planned slot of one exam and holds a multiple-choice or student-produced format. IB and Cambridge specifications ask for a constructed response and have no planned cell. Fabricating cells would have been inventing blueprint data; the generator takes the specification as it is.

**Marks.** A specification fixes a mark *structure*, not a total. The constructed-response schema therefore enforces what can be enforced: parts in order, each part's mark points summing to its marks, parts summing to the total, and at least two marks under `MULTI_MARK_PARTS`. Mark points are typed METHOD / ACCURACY / REASONING — StudyUs's neutral names. The template tells the provider not to imitate any board's notation.

## 4. The selection: twenty adaptations

Five concepts, the ten draft EA-1 families (two EA-1A versions for the approach group), six targets.

| # | Family → target | Approach | Format | Calculator | Command term | Marks | Stimulus | Context | The constraint it tests |
|---|---|---|---|---|---|---|---|---|---|
| 01 | linear model → PAA | – | selected | none | – | 1 | – | personal | closed, no calculator, exact numbers |
| 02 | linear model → IB P1 | – | short | none | find | parts | – | scientific | constructed, method shown, **no** calculator |
| 03 | linear model → IB P2 | – | short | GDC | find | parts | – | scientific | same system, calculator paper |
| 04 | linear model → Cambridge P1 | – | short | scientific | work out | parts | – | scientific | another command term; syllabus-version binding |
| 05 | linear model → PISA | – | selected | allowed | – | coded | own table | personal | stimulus, authentic context, coded credit |
| 06 | linear model → Icfes | – | selected | none | – | 1 | – | personal | Icfes competency model |
| 07 | missing value → PAA | – | selected | none | – | 1 | – | **abstract** | procedural, no situation |
| 08 | rate comparison → PISA | – | selected | allowed | – | coded | – | personal | modelling as a closed item |
| 09 | factorising → PAA | – | **numeric** | none | – | 1 | – | abstract | student-produced number |
| 10 | factorising → IB P1 | – | short | none | solve | parts | – | abstract | the same procedure, constructed |
| 11 | optimum → IB P2 | – | short | GDC | find | parts | – | scientific | modelling with an optimum |
| 12 | single event → Icfes | – | selected | none | – | 1 | – | personal | fraction answers |
| 13 | compare chances → Cambridge P1 | – | short | scientific | work out | parts | – | scientific | a verdict a mark scheme must reward |
| 14 | judge a claim → PAA | – | selected | none | – | 1 | own table/graph | personal | stimulus required by the family |
| 15 | relative change → IB P2 | – | short | GDC | write down | parts | own data | scientific | realistic data, stated rounding |
| 16 | rate comparison → school | STANDARD | selected | allowed | – | parts | – | societal | baseline, no official constraint |
| 17 | rate comparison → school | **STEM_PLUS** | extended | allowed | – | parts | – | societal | the approach acts |
| 18 | rate comparison → PAA | STANDARD | selected | none | – | 1 | – | personal | baseline, official constraints |
| 19 | rate comparison → PAA | **STEM_PLUS** | selected | none | – | 1 | – | societal | official constraints win |
| 20 | rate comparison → PISA | **STEM_PLUS** | selected | allowed | – | coded | – | societal | compared with 08 |

01–06 are one family on all five systems, with one invariant hash (`d881e9aa…`).

## 5. What happened

| | Count |
|---|---|
| Units planned on first attempt | 20 |
| First answer well-formed | **16 of 20** |
| Units that used the one permitted retry | 4 (3 recovered; one malformed twice) |
| First-attempt units that produced a candidate | **16 of 20** |
| First-attempt units refused by the harness | 4 — three `RESPONSE_REPEATS_FIXED_INSTRUCTION`, one `PROVIDER_RESPONSE_SCHEMA_INVALID` |
| Explicit regenerations (counted; one per failed unit, never a third attempt) | 11 → 10 candidates, 1 refused again |
| **GENERATED_ITEMS** | **26** candidates (16 first attempts + 10 regenerations) |
| Provider calls | 35 |

The five malformed answers: four omitted the required `rationale`; one sent an array where a boolean belongs.

The eleven regenerations use the same prompt with `attempt: 2` and nothing else — no hint of what went wrong. They therefore also measure whether a defect is systematic. Each has its reason in `recorded-live-responses.json`.

## 6. Gates

`N = 26` generated candidates. Where it differs, the count for the **latest attempt of each of the 20 adaptations** is given too.

| Gate | Proposed value | Notes |
|---|---|---|
| `LIVE_PROVIDER` | **PASS** | Configured provider and model, served as requested, usage reported on every call |
| `SPEND_USD` | **1.55** (assumed guard basis) / 0.06 (repo-configured basis) | 35 calls. Neither is an invoice |
| `GENERATED_ITEMS` | **26** | From 20 adaptations: every one has at least one candidate |
| `STRUCTURAL_VALIDATION` | **17/26** | The nine failures are response-contract defects, not broken JSON (§8) |
| `PROFILE_COMPLIANCE` | **25/26** (26/26 at item level) | The one failure is a property of the *specification* (§9, finding S1) |
| `CONSTRUCT_PRESERVATION` | **25/26** not contradicted — PASS 19, WEAK 6, FAIL 1 | WEAK is a heuristic's absence of evidence. My reading finds more (§8) |
| `ANSWER_VALIDATION` | **26/26** not failed — MACHINE_VERIFIED 6, DETERMINISTIC_RULE_VERIFIED 13, **HUMAN_REVIEW_REQUIRED 7**, FAILED 0 | By keyed answer (42): 13 / 22 / 7 / 0. HUMAN_REVIEW_REQUIRED is not a verification |
| `MACHINE_RECOMPUTATION` | **14/14** applicable | 12 items have no keyed quantity a rule recomputes |
| `STIMULUS_INTEGRITY` | **4/4** applicable | |
| `ORIGINALITY` | **24/26** | Maximum textual similarity 0.174. Two items share one parameter set |
| `LINEAGE_COMPLETENESS` | **26/26** | |
| `MULTI_PROFILE_SAME_FAMILY_PROOF` | **FAIL as defined; the substance holds** | §7.1. Five of six items are clean; the Cambridge item is correct but breaks the response contract, and its regeneration was refused |
| `STANDARD_VS_STEM_PLUS_PROOF` | **PASS**, with two caveats | §7.2 |
| `GENERATOR_READY_FOR_DEV_SCALE` | **NO** | §10 |
| `GENERATOR_READY_FOR_PILOT_CONTENT` | NO | |
| `READY_FOR_BANK_INGESTION` | NO | |
| `QUESTION_BANK_READY` | FAIL | |

Automated status of the latest attempt per adaptation: 8 passed every check, 7 passed with human review required, 5 failed.

Review status of every item: `BLOCKED_NO_QUALIFIED_REVIEWER`.

## 7. The two proofs

### 7.1 One family, five systems

Family `tf.math.linear.constant-rate-model` (FORMULATE + INTERPRET; construct `LINEAR_MODEL_FIXED_START_CONSTANT_RATE`). One concept, one invariant hash, six specifications. Pairs of different systems differ in 3 to 12 of the twelve compared dimensions; the two IB papers differ in 2 (tool policy, numeric profile).

| Target | What the specification decided | What was written |
|---|---|---|
| PAA | selected, no calculator, exact, 1 mark, Spanish | A fare of 120 plus 8 per kilometre; four options, each an equation with an interpretation of its parameters |
| IB Paper 1 | short response, **no calculator**, "find", parts, method and accuracy | A culture of 240 cells gaining 12 an hour. (a) Find the relation [2]. (b) Find what slope and intercept mean [2]. Whole numbers |
| IB Paper 2 | the same, **calculator paper**, realistic values | 240 litres decreasing by 3.5 a minute. (a) relation [2], (b) volume after 20 minutes [2], (c) meaning of rate and start [2]. Decimals appear |
| Cambridge P1 | short response, scientific calculator, "work out", parts | 120 mg decreasing by 3.5 an hour. (a) Work out a relation [2], (b) and (c) work out what −3.5 and 120 mean [1 + 1] |
| PISA | selected, **own stimulus**, authentic context, coded credit | A table of distance and price (0 → 4.5, 5 → 13.5, 8 → 18.9); the rate is not stated and has to be read from the table; full / no credit |
| Icfes | selected, no calculator, plausible context | Savings of 120 pesos plus 15 a week; four options |

What the proof shows: the invariants reach the item (the declared construct is the family's in all six; the keyed equation has the declared rate and start in all six, read by a parser, not taken from the declaration), and the specification's decisions reach the item (closed against constructed, the table on PISA, the command term, decimals only where a calculator is allowed, the language).

Why it is **FAIL as defined**. I fixed the criterion before the run: every item must also pass its item-level automated checks, the response contract included. The Cambridge item declares a QUANTITY target on two interpretive parts and carries no numeric key for them (`PART_WITH_A_QUANTITY_TARGET_HAS_NO_NUMERIC_KEY`). Its one regeneration was refused for repeating the fixed instruction. I did not run a third attempt to make the gate pass. `multi-system-same-family-proof.json` records both: `substance.holds = true`, `responseContract.everyItemClean = false`.

### 7.2 STANDARD against STEM_PLUS

Family `tf.math.proportion.rate-comparison-model`, one invariant hash (`135690f5…`) in all five specifications.

| Target | Changed by the approach (specification) | Honoured | Unmet, and who overrode it | In the items |
|---|---|---|---|---|
| School (illustrative, no official rule) | response format, reasoning depth, distractors | constructed response, situated context, tools, justified reasoning | data stimulus — the family (no stimulus) | STANDARD: one selected item. STEM_PLUS: three parts, 7 marks, two reasoning points, a justified decision |
| PAA | context only | situated context | constructed response and tools — **OFFICIAL** component rules; justified reasoning — StudyUs policy rule; all recorded with certification `PROVISIONAL_ILLUSTRATIVE` | Both are one selected item, no calculator. Only the situation moved, from a shop to a cooperative |
| PISA | context only | situated context, tools | constructed response — OFFICIAL; justified reasoning — StudyUs policy | Both selected; a personal purchase against a city programme |

Curriculum knowledge is unchanged in every pair: same concept id, same invariant hash, same declared construct in both items. STANDARD is recorded by absence in the specification and as `STANDARD_BY_ABSENCE` in the lineage; STEM_PLUS is explicit.

Caveats. (1) The school STEM_PLUS item that passes is the **regeneration**; the first attempt repeated the fixed instruction, left `SOLVE` and `INTERPRET` in the Spanish prompts and omitted a numeric key. (2) The PAA STEM_PLUS item has exactly the parameter values of the school STANDARD item (8, 20, 15, 33): the validator sends both to a person.

## 8. Validators against my own reading

This section is a generator-side reading, **not a review**. I read all 30 well-formed responses. No item was edited.

### 8.1 Wrong keys

**None.** Every keyed number and verdict is mathematically right. The validators agree: no answer is contradicted.

### 8.2 Per item

✔ = agrees with the validators. ✘FN = the validators missed it (false negative). ✘FP = the validators flagged something that is not a defect.

| Unit | Validators | My reading |
|---|---|---|
| 01 PAA linear | passed; equation structure verified | Key right. The stem asks "which option formulates the relation and interprets its parameters" — the wording of the evidence target, not of a PAA item. Distractor D is labelled `slope-as-total` and is a sign error. A fare of 120 euros to start a ride. ✘FN on style and on the distractor label |
| 02 IB P1 linear | human review (an interpretation in words) | Right. "Find what the slope and the intercept mean": the single command term the specification fixes is forced onto a part it does not fit. Far below the level of the course it is for. Cells that grow linearly. ✘FN: level and nativeness are not checked |
| 03 IB P2 linear, a1 | **FAILED structural** — quantity target, no numeric key | Right (177). One part mixes a computation with an interpretation. ✔ |
| 03 a2 | human review | Right (170). Clean. Does not need the calculator the paper allows — not a violation. ✔ |
| 04 Cambridge linear, a1 | **FAILED structural** — two quantity targets, no numeric key | Right. "Work out what the slope −3.5 means". ✔ |
| 04 a2 | refused by the harness — fixed instruction in the stem | Content right (60 grams) |
| 05 PISA linear | passed | Right; the rate must be inferred from the table, which is good. Three rows only. Decimal points in a Spanish item. ✔ |
| 06 Icfes linear | passed | Right. Distractor D speaks of "4 semanas", a number that is nowhere in the stem. ✘FN |
| 07 PAA proportion | passed, machine-verified | Right (126). A distractor is 2.57, a rounded decimal on a no-calculator item. Good item otherwise. ✔ |
| 08 PISA rate | human review (WEAK: the item keyed a comparison of its own, not the vocabulary's verdict) | Right. The key is the only option that works both rates out: it gives itself away. "Unidades del producto" is not an authentic context, and the specification requires one. ✘FN on both |
| 09 PAA quadratic, a1 | **FAILED construct** — equation given already factorised | Right key, wrong item: `2(x+3.5)(x−4)=0` leaves nothing to factorise. **Construct drift.** ✔ (after revision 2; revision 1 said only WEAK) |
| 09 a2 | passed, machine-verified from the stem's own equation | `4x² + 4x − 15 = 0`, greater root 1.5. Good. ✔ |
| 10 IB quadratic, a1 | refused — fixed instruction | Content right. A method mark for "writing the equation in standard form" when it is given in standard form |
| 10 a2 | **FAILED structural** — `r1`, `r2` in the item text | The stem says "generated with parameters a = 2, r1 = 3 and r2 = −1": **it prints the answer.** ✔ |
| 11 IB optimum, a1 | refused — fixed instruction | Right (22.5; 6050). The two factors are handed over |
| 11 a2 | human review | Right. "A quantity Q depends on a free measure x": the specification's own words, not a scientific situation; nothing is formulated from a situation. **Construct weakened, context not authentic.** ✘FN |
| 12 Icfes probability, a1 | **FAILED structural** — two options state the same number | Key right (1/4). Options 1/3 and 3/9 are one value. ✔ (after revision 2) |
| 12 a2 | passed, machine-verified | Good. ✔ |
| 13 Cambridge compare, a1 | refused — fixed instruction | Right (0.35 against 0.4; claim true). Declared SCIENTIFIC; it is a game |
| 13 a2 | **FAILED structural** — answer check is a comparison | Right (claim false). "18 of 40 tests" is a relative frequency, not a sample space of equally likely outcomes: **a drift from the classical construct** the validators cannot see. ✘FN |
| 14 PAA claim, a1 | refused — malformed twice | Options began `SUPPORTED:`, `NOT_DECIDABLE:` in a Spanish item; table numbers sent as strings |
| 14 a2 | human review (a verdict no rule decides) | Defensible key. "La categoría Norte causó que 6 personas la eligieran": categories that mean nothing; not a realistic claim. ✘FN on realism |
| 15 IB data, a1 and a2 | **FAILED structural** twice — `vi`, `vj` in the prompts | Right (27.8 %; 28.8 %). Systematic leak. "Percentage change from North Marsh to East Lagoon": a change between two places. "Write down" with three marks and method points. ✔ on the leak, ✘FN on the rest |
| 16 school STANDARD | **FAILED profile** at specification level; originality to a person | Right. The key stands out (flagged as a note). ✔ |
| 17 school STEM_PLUS, a1 | **FAILED structural** — three contract defects | Right. `SOLVE las dos tasas`, `INTERPRET el resultado`. ✔ |
| 17 a2 | passed | Right (0.075, 0.09, 0.015; programme 2). Clean. 18 tonnes collected for 240 euros is not a realistic magnitude. ✘FN on realism |
| 18 PAA STANDARD | passed | Right. Decimal commas, correctly. Option A reaches the right conclusion for a wrong reason; a careful reader could argue it. ✘FN (ambiguity) |
| 19 PAA STEM_PLUS | originality to a person — same parameters as 16 | Right. "Unidades monetarias", "unidades de beneficio": a societal context in name only. ✔ / ✘FN on context |
| 20 PISA STEM_PLUS, a1 | **FAILED structural** — answer check does not evaluate | Right. Transporting 120 litres to deliver 18 "useful" litres. ✘FN on realism |
| 20 a2 | human review | Right (0.25 against 0.24). The key is the longest option. ✔ |

### 8.3 What reading found that the validators cannot

1. **Machine style.** Eight of the eleven selected-response adaptations ask "which option formulates / compares correctly" instead of asking a question. In five of them (08, 16, 18, 19, 20) the key is the one option that works both rates out, so a learner can pick it without doing the mathematics. The heuristic I added flags two of the five.
2. **Not native to the system.** The IB and Cambridge items are far below the level of the papers they name, and the one command term a specification fixes is bent onto parts it does not fit.
3. **Context declared, not delivered.** The item declares the context kind the specification decided and the validator compares the declaration. "A scientific model with a free measure", "units of the product", "category North" pass.
4. **Subtle construct drift.** A classical probability becomes a relative frequency; a model to be formulated is handed over as two factors.
5. **Locale.** Decimal points in Spanish items for Colombia.

### 8.4 Validator false positives, and revision 2

The first replay, under revision 1, said: structural 16/16, profile 11/16, construct 11/16, answers 10/16 with **six FAILED**, recomputation 4/7. Reading showed that most of that was the validators' own error, and that they were also blind to real defects. I revised them **once**, and say so here rather than report only the second set of numbers. The first-replay figures above are what revision 1 produced on the 16 first-attempt items.

| # | Revision-1 behaviour | Shown by | Change | Direction |
|---|---|---|---|---|
| 1 | A written fraction (`1/3`, a ratio `12 / 84` in a stem) was read as its decimal expansion and failed the no-calculator rule | 07, 12, 18, 19 | Fractions are read as the integers they are written with. The rule's bounds are unchanged | false positive corrected |
| 2 | "SOLVE needs a keyed quantity" failed CONSTRUCT for an item keyed as the construct's own verdict | 08, 16, 18, 19, 20 | A vocabulary verdict evidences solving; missing evidence is WEAK. FAIL now means a contradiction | false positive corrected |
| 3 | A contract defect (no numeric key, an expression that does not evaluate) was reported as a FAILED *answer* | 03, 04, 17, 20 | Moved to STRUCTURAL, where it still fails the item. The answer is classified from what the text states; FAILED answers say `KEY_CONTRADICTED` or `DECLARATION_UNUSABLE` | re-homed, not relaxed |
| 4 | "decreases by 3.5" read as 3.5 and compared with −3.5 | 04 | A sentence carries its sign in words: magnitudes are compared, as a deterministic rule only | false positive corrected |
| 5 | A comparison had to use stimulus numbers; an item without a stimulus could not have one | 08, 16, 17 | Without a stimulus, the numbers of the item's own text | corrected; a comparison is still never machine-verified |
| 6 | A declared `x` no question used counted as "parameter not readable" | 01, 02, 04, 06 | A point of evaluation is required only when a keyed quantity uses it; a table on the declared line states rate and start | false positive corrected |
| 7 | `= 0.` (a full stop) hid the equation from the reader | 09 a2 | Parser bug fixed | bug |
| 8 | A keyed equation or pair of roots was simply "human review" | 01–06, 10 | **New:** the equation or the roots are parsed and compared with the declared model | stricter |
| 9 | Nothing saw an equation given already factorised | 09 a1 | **New:** CONSTRUCT FAIL | stricter |
| 10 | Nothing saw two options with one value | 12 a1 | **New:** STRUCTURAL FAIL | stricter |
| 11 | Nothing saw specification vocabulary in the item text | 15, 17 | **New:** STRUCTURAL FAIL. It then caught 10 a2 printing its own roots | stricter |
| 12 | The fixed instruction was matched exactly, as the harness does | 17 a1 | **New:** the validator also matches without case or punctuation | stricter |
| 13 | Nothing saw two items with one parameter set | 16, 19 | **New:** ORIGINALITY sends both to a person | stricter |
| 14 | — | 08, 16, 19 | **New heuristic, note only:** a key that stands out | informational |
| 15 | Two cue lists missed "relation" and "means" | 03 a2 | Lists extended (heuristic version 2) | heuristic tuned |

No threshold was lowered. The harness was not changed after the run: what it refused stays refused.

**What this means for the numbers.** The validators were tuned on the same 26 items they now score. Their agreement with my reading on these items is therefore not evidence that they would agree on the next 26.

## 9. Findings about the architecture, not the provider

- **S1. A specification can be unrealisable.** The school STANDARD specification is `SELECTED_RESPONSE` with `MULTI_MARK_PARTS`: the format and the mark structure are decided by different rules and nothing checks that they fit. The validator reports it as a specification-level issue and does not blame the item. This belongs to EA-1A.
- **S2. One command term per specification is too coarse** for a multi-part item ("Work out what the slope means").
- **S3. A specification fixes no mark total.** The provider chose between 3 and 9.
- **S4. The fixed instruction is the largest single cause of loss.** Five of 15 constructed responses repeat "Show your working" (or its Spanish sentence) although told not to; four are refused by the harness and the fifth is caught by the validator. Keeping boilerplate out of the stem is right; telling the provider the sentence and then refusing its use is a trap of my own template.
- **S5. The construct vocabulary forces a declaration** (`x` for a linear model) that some items do not use.

## 10. Is the generator ready for dev scale? — NO

| Evidence | Value |
|---|---|
| First answer well-formed | 16 / 20 |
| First attempt produced a candidate | 16 / 20 |
| First attempt passed every automated check (revision 2) | **8 / 20** |
| After one regeneration of each failure, latest attempt passes or needs only human review | 15 / 20 |
| Regenerations that came back without an automated failure | 7 of 11. One repeated its defect exactly (15: `vi`, `vj`); three failed in a new way (04, 10, 13) |
| Defects I found only by reading, on items that passed | on most items (§8.3) |
| Wrong keys | 0 / 30 |

The mathematics can be trusted more than I expected and the contract less. At scale, four in ten items would be discarded by the machine, and the ones that pass still carry defects no validator here sees. Before scale: give the constructed-response template no sentence it then forbids (S4); state the output schema to the provider as an enforced structure rather than as prose; add a style check on item writing; resolve S1–S3 in the specification.

## 11. Stop conditions

None was hit, and I say why rather than leave it implied.

| Condition | Assessment |
|---|---|
| Spend would exceed USD 20 | No. 1.55 on the assumed basis |
| Construct drift appears systematically | **No, but watch it.** One contradiction among 26 (09 a1) and two weakenings found by reading (11 on both attempts; 13 a2). It clusters in the optimum family. The primary concept never changed |
| The provider cannot follow adaptation specifications | **Partly.** Assessment dimensions: followed (26/26 at item level). Response contract: not reliably. I judged this a result to report, not a reason to stop |
| Answer-verification failure rate is material | No. Zero contradicted keys. Seven items rest on human review only |
| Rights assumptions are unclear | They are not unclear: nothing is established, and nothing is claimed |
| The generator needs schema or persistence | No |

## 12. Rights

| | |
|---|---|
| Provider / model | OpenAI Chat Completions / `gpt-5.6-luna` (served as requested) |
| Generated | 2026-10-11, 18:05–18:18 UTC, run `qb-r2d-20261011180507` |
| Terms or licence evidence in the repository | **None.** I searched `src/`, `docs/` and `scripts/` for a recorded reference to provider terms, an agreement, an account or a licence governing model output. The repository itself records that none is on file (QB-R2B, QB-R2C). No web page was read; no legal question was decided |
| Rights gate | `MODEL_OUTPUT_RIGHTS_EVIDENCE_INCOMPLETE`, `MODEL_OUTPUT_RIGHTS_NOT_VERIFIED_BY_A_PERSON`. Missing: terms reference, account context, terms version or date, permitted commercial use, restrictions, verifier, verification date |
| Every candidate | **`RIGHTS_NOT_ESTABLISHED`**, `supportedReuseRights: UNKNOWN`, not deliverable. Nothing is claimed as `STUDYUS_OWNED` |

## 13. Limitations

1. Twenty adaptations, one item each, mathematics only, one model at one reasoning effort. Nothing here is a rate with a confidence interval.
2. The validators were revised after seeing these items (§8.4).
3. My reading is the reading of the session that built the generator. It is not a qualified review and finds only what I know to look for. I am not a native-speaker item writer for any of the five systems.
4. Machine verification covers a keyed number of a known construct. An interpretation, a justification and a claim about a display are not verified.
5. "Calculator policy respected" is a rule about the size and form of numbers. Whether an item *needs* the calculator a paper allows is not checked.
6. Context kind, authenticity, transfer, competency codes, time budget and difficulty are not checked automatically.
7. Originality is textual similarity among the generated set and against the two earlier StudyUs pilots. It cannot detect resemblance to published material it was not given. I copied nothing and read no published question; that is a statement about my conduct, not a verified property of the provider's output.
8. Families are unreviewed drafts, profiles are provisional and illustrative, STEM_PLUS is uncertified. A good item from a draft family is still dev-test content.
9. Prices are not verified. The spend figure is tokens times a table.
10. The gateway's governance ledger has no record of these calls.

## 14. Artifacts

All in `docs/exams/question-bank/pilots/qb-r2d/`, all labelled ephemeral.

| File | Content | Produced by |
|---|---|---|
| `recorded-live-responses.json` | Every raw provider response (35), with usage, served model, timestamp, well-formed or not; the regeneration list with reasons | the live run |
| `spend-ledger.json` | Every call with tokens and both cost bases | the live run |
| `selection.json`, `specifications.json` | The twenty adaptations and their full specifications | replay |
| `generated-batch.json` | 26 candidates with lineage, 4 stimuli, 5 harness refusals | replay |
| `automated-validation-report.json` | Per item and totals | replay |
| `multi-system-same-family-proof.json` | §7.1 side by side | replay |
| `standard-vs-stem-plus-proof.json` | §7.2 side by side | replay |
| `rights-record.json` | §12 | replay |

`tests/unit/qb-r2d-live-replay.test.ts` replays the recording offline and compares every replay-produced file byte for byte.

To reproduce without a network: `npx tsx scripts/operations/qb-r2d/run.ts --write`.

## 15. My recommendation for each gate

| Gate | Recommendation |
|---|---|
| `LIVE_PROVIDER` | PASS |
| `MULTI_PROFILE_SAME_FAMILY_PROOF` | Rule on which reading you want. On the criterion I set beforehand it is FAIL (one of six items is not contract-clean). On substance — one invariant hash, six different specifications, six items that keep the construct and follow their profile, with correct keys — it holds. I would not call it PASS without that sentence attached |
| `STANDARD_VS_STEM_PLUS_PROOF` | PASS, with the two caveats of §7.2 |
| `GENERATOR_READY_FOR_DEV_SCALE` | **NO** |
| `GENERATOR_READY_FOR_PILOT_CONTENT` | NO |
| `READY_FOR_BANK_INGESTION` | NO |
| `QUESTION_BANK_READY` | FAIL |
