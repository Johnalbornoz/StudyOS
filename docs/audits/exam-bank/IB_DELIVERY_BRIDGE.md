# IB delivery bridge: scoring authority, projection 3, form-aware method marks, CF-IB-AAHL-01

Track B · 2026-10-14 · PAA baseline FROZEN at `610d3c6`. No deploy, no database writes, no migrations.

Content package: `CF-IB-AAHL-01`, pinned in `docs/exams/content-factory/CF-IB-AAHL-01/`. Its sha256 values are in `SHA256SUMS`; the package itself is `678741c9…`.

| Gate | Result |
|---|---|
| SCORER_PARITY | **PASS** |
| IB_BANK_PROJECTION_V3 | **PASS** (guarded: IB only, governed formats, fail closed) |
| PAA_PUBLICATION_PATH_UNCHANGED | **YES** |
| FORM_AWARE_METHOD_MARK | **PASS** |
| IB_EXISTING_30_COMPATIBLE | **0/30** |
| IB_CONCEPT_GOVERNANCE | **PARTIAL** (1/10) |
| IB_PACKAGE_DRY_RUN | **PASS** (executed in full; 0/300 accepted, with reasons) |
| IB_PACKAGE_IDEMPOTENCY | **PASS** (identical report digest; 0 identities and 0 rows written) |
| CF_IB_AAHL_01_PACKAGE_ACCEPTED | **NO** |
| IB_FIRST_DEV_FORM | **NOT_READY** |

## 1. One scoring authority

The one contract is `src/lib/assessment-scoring/canonical-response.ts` (`canonical-response-1`). It has one parser and one evaluator, and it reads no locale.

**The defect it removes:** the Question Factory read `2.625` as `AMBIGUOUS_SEPARATOR`, while Exam Core read it as a decimal, and inferred the decimal convention from the Student's language.

| Semantics | Rule (stated by the POLICY, never guessed) |
|---|---|
| Decimal separator | `decimalSeparators`. With '.' allowed, `2.625` is 2.625. |
| Grouping / thousands | `groupingSeparators`, **default none**. Allowed only in the integer part, in groups of exactly three. A character cannot be both a decimal and a grouping separator (`POLICY_INVALID`). |
| Fractions | integer/integer, when FRACTION is accepted. |
| Equivalent numeric forms | INTEGER / DECIMAL / FRACTION. A form that is not accepted gives `NOT_IN_AN_ACCEPTED_FORM`. |
| Significant figures / d.p. | They constrain a DECIMAL response: exact precision is required, then the value is compared within half a unit. |
| Tolerance | Absolute or relative. |
| Units | Accepted list (case-insensitive, exact); `required`. |
| Ordered multi-part | `evaluateOrderedParts`: part *k* against key *k*, never as alternatives. |

**Who uses it**

| Stage | How |
|---|---|
| Question Factory candidate validation | `evaluateResponse` delegates NUMERIC to the contract. |
| Certification | `instance-certification.ts` calls that same `evaluateResponse`. |
| Bank | Projection 3 embeds `math.responseContract`, with its digest in `certified.scoring`. |
| Exam Core | `gradeMathTarget` uses the contract for any NUMBER target that carries one (`gradeContractTarget`). |

**Content without a contract (all frozen PAA content) keeps its exact current path.**

**Proof:** `tests/unit/scorer-parity.test.ts` runs 11 policy families, 50 responses and ordered parts. Each response gets the same verdict at validation, certification, Bank and Exam Core, and the Exam Core verdict is the same in `es` and `en`.

**One deliberate semantics change, in the Question Factory only (offline):** `1.250` against a key of 1250, under a policy with no grouping, is now `INCORRECT` (it reads as 1.25) instead of `AMBIGUOUS_SEPARATOR`. The pinned test `qf51-instance-validators` now states the governed rule and the explicit grouping cases. No certified decision is re-run.

**Out of scope:** the Learning-side normaliser `exam-core/question-bank/production/answer-normalization.ts` (qb-r2c) keeps its "grade both readings" rule. It is not on the standardized-exam path.

## 2. Projection 3, guarded

`bankProjectionFor(i)`:

| Case | Projection |
|---|---|
| `systemId = IB` and format in {NUMERIC_ENTRY, SHORT_RESPONSE, MULTI_PART_MATH} | `exam-bank-projection-3` |
| IB in any other format | refused: `FORMAT_NOT_GOVERNED_FOR_PROJECTION_3` |
| Every other system | `exam-bank-projection-2`, with exactly `projectionRefusal(i)` |

`publication.service.ts` selects the projection only through this function. For PAA (296 instances), the projection version, verdict and content are identical to projection 2, which is asserted.

Projection 3 preserves:
- ordered parts (certified learner parts only);
- intermediate working;
- method marks (from intermediates, or a form-aware rule);
- answer marks;
- s.f. / tolerance / units, through the contract;
- provenance: contract version and digest, mark-scheme digest, rubric digest, policy digest, and the point→target map;
- rubric identity (`criterionDigest` per method rule).

Idempotency: `scoringBankContentIssues` recomputes the content on every publication.

### Real-database proof

**Command:** `bash scripts/exam-bank-publication-proof.sh`. It runs on a throwaway local Postgres, never on DEV or Preview, with the projection selector wired in. Result: **`EXAM_BANK_PUBLICATION_PROOF = PASS`**.

- **Ledger:** 95, the same as DEV.
- **First publication:** 326 instances and 296 PAA CORE_DERIVED bank rows, the same as before.
- **Second publication:** writes **0** rows.
- **The 30 IB instances:** still have no bank row; they are now blocked by projection 3 (`WORKING_MARKED_WITHOUT_MACHINE_MARK_SCHEME`).
- **Attribution:** 0 automated decisions attributed to a person.

The script itself was stale: it pre-dated the pilot migrations `20261124_*`, and its ledger assertion assumed exactly 3 pending migrations. It now applies every migration from the first pending one through the real runner, in order, and expects ledger = files + 1.

Unsupported semantics fail closed. Examples: an unordered solution set, method points without intermediates or rule, a rule that is not exactly the certified point, an incoherent policy.

**Gap still present in projection 2, recorded and frozen:** it would accept two key values as alternative full-credit answers. No PAA instance has that shape.

## 3. Form-aware method marks

**Module:** `src/lib/assessment-scoring/method-rules.ts` (`method-rules-1`). It works on the structure of the expression (mathjs syntax tree + exact numeric checks), not on strings. It reads LaTeX from MathLive.

| | QUADRATIC_SOLUTION_METHOD | REARRANGE_TO_STANDARD_FORM |
|---|---|---|
| Required form | the quadratic formula with THIS equation's values substituted · a product of linear factors = 0 · a completed square | an expanded degree-2 polynomial in x = 0, proportional to THIS equation |
| Accepted equivalences | P, Q, R written as expressions or as their values (`(3 ± 1)/2` and `(-(-3) ± √((-3)²-4·1·2))/(2·1)`); factors in any order, with a constant factor; a repeated root | any non-zero multiple, either sign |
| Rejected trivial forms | RESTATES_THE_GIVEN_EQUATION · EQUIVALENT_BUT_NOT_A_METHOD_FORM · GENERIC_FORMULA_NOT_SUBSTITUTED · FINAL_ANSWER_ONLY · WRONG_SUBSTITUTION / FACTORS / SQUARE | RESTATES_THE_GIVEN_EQUATION · NOT_EXPANDED · NOT_EQUAL_TO_ZERO · NOT_THIS_EQUATION |
| Mark | the certified point's marks | same |
| Provenance | `rubricIndex`, `rubricCode`, `criterionDigest` (sha256 of the certified criterion text), `ruleDigest` | same |

**Never implied:** with a rule, a correct final answer without working earns only its answer marks. This holds in Exam Core and in projection 3 (`impliedByCorrectAnswer` must be false).

**Tests** (`method-rules.test.ts`, `exam-bank-scoring-projection.test.ts`):

| Working | Result |
|---|---|
| Copied equation (plain, Unicode, LaTeX) | M1 = 0 |
| Quadratic-formula line (5 writings) | M1 = 1 |
| Factored / completed square | M1 = 1 |
| Algebraically equivalent restatement (`x² = 3x − 2`) | 0 |
| Nonsense | 0 |
| Answers only | answer marks only |

**The rejected shortcut** ("M1 only when both roots are correct") was not implemented.

## 4. The 30 existing IB instances: 0/30 compatible

**Assessment:** `src/lib/exam-bank/ib-reprojection-compatibility.ts`, run against the CF reprojection spec (`IB_30_REPROJECTION_SPEC.json`). Test: `tests/unit/ib-reprojection-compatibility.test.ts`.

| Semantic | Result |
|---|---|
| Rubric identical, marks, answer values | preserved, 30/30 |
| Every method point expressed by a form-aware rule | **yes**: 50 points (30 solution-method, 20 rearrangement). Each rule awards the proposal's own evidence line and refuses a restatement of the question. |
| Response structure | **NOT preserved.** The certified policy (RUBRIC) matches the solutions **in any order**. The proposal requires ASCENDING ordered parts, so a correct answer given in the other order would score 0 instead of full marks. |
| Learner content | **NOT preserved.** The proposal adds two parts ("Write down the smaller/larger solution.") that no certification covers. |

**Conclusion:** the 30 stay CERTIFIED_NOT_DELIVERABLE, and the historical certified objects are untouched.

**To deliver them**, one of these is needed, each a decision outside Track B:
- a NEW certified instance (new learner content, new envelope, new certification) built from the Content Factory proposal; or
- a governed **unordered solution-set** target in the contract and in Exam Core, plus a governed way to enter several values.

## 5. IB concept governance: PARTIAL (1/10)

The governed IB sources (`docs/exams/v2/sources/ib-dp*.json`, the vertical `ib-math-aa-hl.ts`) carry components and assessment objectives, but **no syllabus topic layer and no concept identities** (`CURRICULUM_DATA_NOT_READY`, curriculum-convergence matrix).

The IB catalogue rows are `DEV_FIXTURE / NON_OFFICIAL`. They were not promoted, and no topic layer was invented.

| construct_id | canonical_concept_id | source | mapping_confidence | governance_status |
|---|---|---|---|---|
| tf.math.series.geometric-sum-to-infinity | — (proposed `math.ib.sequences-and-series` rejected) | none governed; `math.alg.patterns-sequences` (PAA) is not this concept | — | UNRESOLVED (fails closed) |
| tf.math.logarithms.equation-one-admissible-root | — (`math.ib.logarithms` rejected) | none governed | — | UNRESOLVED |
| tf.math.functions.inverse-function-value | — (`math.ib.rational-functions-and-inverses` rejected) | none governed; `math.fun.functions` (PAA) is broader and not IB-backed | — | UNRESOLVED |
| **tf.math.quadratic.minimum-value** | **`math.alg.quadratics`** | objective link `aahl.p1.functions` (DECLARED_REVIEWED); PAA REMAP_EXISTING; bucket `aahl.p1.functions#0` human-certified (D02) | MEDIUM (declared-reviewed link, by precedent) | **GOVERNED_BY_PRECEDENT** |
| tf.math.calculus.definite-integral-polynomial | — (`math.ib.integration` rejected) | none governed | — | UNRESOLVED |
| tf.math.calculus.area-between-curve-and-axis | — (`math.ib.integration` rejected) | none governed | — | UNRESOLVED |
| tf.math.calculus.tangent-gradient-at-a-point | — (`math.ib.differentiation` rejected) | none governed | — | UNRESOLVED |
| tf.math.calculus.cubic-local-maximum | — (`math.ib.differentiation` rejected) | none governed | — | UNRESOLVED |
| tf.math.probability.binomial-exact-probability | — (`math.ib.binomial-distribution` rejected) | none governed | — | UNRESOLVED |
| tf.math.probability.normal-symmetry | — (`math.ib.normal-distribution` rejected) | none governed | — | UNRESOLVED |

**To resolve the nine:** a governed IB AA syllabus source with concept identities (as PAA has in `paa-hierarchy.ts`: authority, source reference, certified concept), followed by applicability-register records.

## 6. IB blueprint and bucket governance

Automated pilot certification **is permitted** for blueprint classifications and adapters, under the `HUMAN50_POLICY_V1` object governance. That governance requires every bucket concept to be ESTABLISHED in the applicability register (`EVERY_BUCKET_LINKS_AN_ASSESSED_CONCEPT`).

| Object | Result |
|---|---|
| IB_P1_FUNCTIONS_BUCKET | **CERTIFIED**: `v2.ib.math-aa-hl/p1@step4b-pilot-1`, HUMAN_CERTIFIED, recorded decision D02 |
| IB_P1_ALGEBRA_BUCKET | **BLOCKED**: its concepts are not governed (§5). No human review is required by the rules; the governed concept + applicability evidence is. |
| IB_P1_CALCULUS_BUCKET | **BLOCKED**: same reason |
| IB_P2_STATISTICS_BUCKET | **BLOCKED**: same reason, and no P2 blueprint classification exists |
| IB_P2_ADAPTER | **AUTOMATED_CERTIFIED_PILOT by governance** (EA-1 component profile; computed, asserted in `cf-package-dry-run.test.ts`). Not published to any database, because no governed blueprint uses it. |

No reviewer was named or fabricated.

## 7. CF-IB-AAHL-01 dry run

**Run:** `npx tsx scripts/operations/exam-bank/cf-package-dry-run.ts --out docs/audits/exam-bank/evidence/CF_IB_AAHL_01_DRY_RUN.json`. No database is read or written.

**Passes for all 300 candidates:**
- package hash;
- identities (candidateId, contentDigest, recognitionId, seed unique);
- scoring policy (the Question Factory evaluator and the canonical contract agree on every key form and every modelled wrong answer);
- lineage;
- rights/provenance (STUDYUS_ORIGINAL_DETERMINISTIC, 0 provider calls);
- duplicates (against itself and the certified QF V5.2 supply);
- projection 3.

**Fails, governance only:**

| Check | Candidates | Reason |
|---|---|---|
| FORMAT_OFFERED | 300 | NUMERIC_ENTRY is not offered by the governed IB AA HL adapters (MATH_EXPRESSION / SHORT_RESPONSE / EXTENDED_RESPONSE) |
| CONCEPT_GOVERNED | 270 | §5 |
| BUCKET_CERTIFIED | 270 | §6 |

**Accepted: 0. Certification-eligible: 0.** Two identical runs give the identical report digest. Nothing is ingested, so 0 identities and 0 rows are created.

### The construct that clears concept and bucket governance

QUADRATIC_MINIMUM_VALUE was evaluated in full, through the real object governance and certification (`tests/unit/cf-ib-aahl-01-adoption.test.ts`):
- The construct reproduces all 30 delivered candidates exactly (prompt and key, from each parameter set).
- Its core governance: AUTOMATED_CERTIFIED_PILOT.
- Its envelope: REVIEW_REQUIRED (`SEED_DETERMINISM`), because rendering is refused at composition: `ADAPTATION_REFUSED / RESPONSE_FORMAT_NOT_ALLOWED`.

It is kept as an **evaluated** entry (`CF_QUADRATIC_MINIMUM_ENTRY`), registered nowhere, so the PAA publication plan is unchanged.

**Capability added, proven on an already governed PAA entry copied in memory:** `@rk=` seeds render a package candidate from its own parameter set, and `packageSeeds` makes the batch render exactly a package's candidates.

## 8. First IB DEV form: NOT_READY

**Requested chain:** governed blueprint → certified IB Bank supply → frozen form → response → canonical scorer → marks → EXAM_ASSESSMENT / Exam Readiness.

The chain stops at link 2: **there is no certified IB Bank supply**, and none can be created without a governance decision.

**IB pilot readiness**, through the engine over the 9 pilot positions (`CF_IB_AAHL_01_DRY_RUN.json`, `ibPilotReadiness`): NOT_READY, 0/9.

| State | Count |
|---|---|
| CERTIFIED_CANDIDATE | 0 |
| CANDIDATE_REFUSED | 300 |
| CERTIFIED_NOT_DELIVERABLE | 30 |
| BANK_DELIVERABLE | 0 |
| RUNTIME_READY | 0 |

DEV was not written: no IB content was published to make a form appear. The scoring links of the chain are proven without a database: projection 3 → Exam Core → canonical contract → marks. Runtime question-generation calls: 0.

## 9. NEXT_IB_BLOCKER (exact)

**The CF-IB-AAHL-01 candidates are NUMERIC_ENTRY, and the governed IB AA HL adapters do not offer NUMERIC_ENTRY.** Every candidate is refused at composition, including the one construct (QUADRATIC_MINIMUM_VALUE, P1 functions) whose concept and bucket are governed.

One decision unblocks the first deliverable IB form:
- **(a)** the Content Factory re-delivers QUADRATIC_MINIMUM_VALUE as `SHORT_RESPONSE` with an answer-mark rubric. Track B then needs a parametric SHORT_RESPONSE strategy, which is a capability rather than content. **Or**
- **(b)** John decides that the IB AA HL P1 adapter offers NUMERIC_ENTRY for answer-only items. That makes a new adapter version and a new certification.

After that, the next blocker is a governed IB concept source for the other nine constructs (§5), which unblocks the P1 algebra / calculus and P2 statistics buckets.
