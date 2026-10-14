# CF-IB-AAHL-01: IB Math AA HL deterministic constructs and reprojection spec for the 30

**Thread:** Exam Content Factory · **Date:** 2026-10-14 · **Baseline:** `610d3c6` (frozen, untouched)

**Status:** offline content package plus specification. **No candidate is runtime-ready.** Track B must confirm Bank projection and scoring compatibility first.

| Guard | Value |
|---|---|
| Provider spend | USD 0 · provider calls 0 |
| Database reads / writes | 0 / 0 |
| Deployments | 0 |
| Runtime changes | 0 (nothing under `src/` was edited) |
| PAA mutations | 0 |

## Files

| File | What |
|---|---|
| [`scripts/content-factory/ib-aahl-01/constructs.ts`](../../../scripts/content-factory/ib-aahl-01/constructs.ts) | The 10 constructs, written against the repository's own `ParametricConstruct` contract so Track B can adopt or refuse them unchanged |
| [`scripts/content-factory/ib-aahl-01/produce.ts`](../../../scripts/content-factory/ib-aahl-01/produce.ts) | Deterministic production and validation (pure) |
| [`CF-IB-AAHL-01_CANDIDATE_PACKAGE.json`](CF-IB-AAHL-01_CANDIDATE_PACKAGE.json) | 300 candidates with lineage, rights, provenance, validation, digests |
| [`CF-IB-AAHL-01_DEPTH_SIMULATION.json`](CF-IB-AAHL-01_DEPTH_SIMULATION.json) | Repeatability through the runtime assembler |
| [`scripts/content-factory/ib-aahl-01/reprojection-spec.ts`](../../../scripts/content-factory/ib-aahl-01/reprojection-spec.ts), [`IB_30_REPROJECTION_SPEC.json`](IB_30_REPROJECTION_SPEC.json) | Per-instance transformation spec for the 30, checked |
| [`scripts/content-factory/ib-aahl-01/probe-method-marks.ts`](../../../scripts/content-factory/ib-aahl-01/probe-method-marks.ts), [`../evidence/CF-IB-AAHL-01_METHOD_MARK_PROBE.json`](../evidence/CF-IB-AAHL-01_METHOD_MARK_PROBE.json) | Probe of the current method-mark rule |

Re-run (all pure, no env needed):

```bash
npx tsx scripts/content-factory/ib-aahl-01/produce.ts docs/content-factory/CF-IB-AAHL-01/CF-IB-AAHL-01_CANDIDATE_PACKAGE.json
```

## 1. The 10 constructs

Every construct keys **one exact value** (integer, fraction or terminating decimal) under `EXACT_NUMERIC_POLICY`, as a single-part `NUMERIC_ENTRY` with answer marks only. That is delivery class **D0**: the existing core-derived projection.

| # | Construct | Paper · bucket (`v2.ib.math-aa-hl/…#0`) | Governed concept link (`OBJECTIVE_LEARNING_LINKS`) | Concept stable id | Independent key check | Raw / recognition classes F · S · C |
|---|---|---|---|---|---|---|
| 1 | GEOMETRIC_SUM_TO_INFINITY | P1 · aahl.p1.algebra | Sequences and series | `math.ib.sequences-and-series` **PROPOSED** | S = u₁²/(u₁ − u₂) from the shown terms | 301 · 294 · 301 |
| 2 | LOG_EQUATION_ONE_ADMISSIBLE_ROOT | P1 · aahl.p1.algebra | Logarithms | `math.ib.logarithms` **PROPOSED** | integer (BigInt) exponentiation back | 79 · 342 · 16 |
| 3 | INVERSE_FUNCTION_VALUE | P1 · aahl.p1.functions | Rational functions and inverses | `math.ib.rational-functions-and-inverses` **PROPOSED** | forward evaluation f(key) | 2273/192 · 1025/456 · 2206/399 |
| 4 | QUADRATIC_MINIMUM_VALUE | P1 · aahl.p1.functions | Quadratic functions and inequalities | `math.alg.quadratics` **existing**, same link as the certified IB pilot bucket | f evaluated at the derivative's zero | 293 · 442 · 2137 |
| 5 | DEFINITE_INTEGRAL_POLYNOMIAL | P1 · aahl.p1.calculus | Integration | `math.ib.integration` **PROPOSED** | Simpson's rule (exact for degree ≤ 3) | 106 · 381 · 1468 |
| 6 | AREA_BETWEEN_CURVE_AND_AXIS | P1 · aahl.p1.calculus | Integration | `math.ib.integration` **PROPOSED** | roots from the shown coefficients, then Simpson | 12 · 108 · 240 |
| 7 | TANGENT_GRADIENT_AT_A_POINT | P1 · aahl.p1.calculus | Differentiation | `math.ib.differentiation` **PROPOSED** | Richardson extrapolation (exact for cubics) | 721 · 372 · 258 |
| 8 | CUBIC_LOCAL_MAXIMUM | P1 · aahl.p1.calculus | Differentiation | `math.ib.differentiation` **PROPOSED** | integer scan: f′ = 0 and second difference < 0 | 120 · 197 · 325 |
| 9 | BINOMIAL_EXACT_PROBABILITY | P2 · aahl.p2.statistics | Binomial distribution | `math.ib.binomial-distribution` **PROPOSED** | brute force over all 2ⁿ sequences | 84 · 110 · 110 |
| 10 | NORMAL_SYMMETRY | P2 · aahl.p2.statistics | Normal distribution | `math.ib.normal-distribution` **PROPOSED** | symmetry checked from the other side | 504 · 576 · 576 |

### Bands and calculator

| Band | Difficulty band | Item difficulty | Marks |
|---|---|---|---|
| Foundational | LOW | 2 | 2 |
| Standard | MEDIUM | 3 | 3 |
| Challenge | HIGH | 4 | 4 |

Marks are **answer marks only**; no IB method mark is claimed. Calculator follows the governed paper rule: P1 `NONE`, P2 `GDC_REQUIRED`. The P2 items are exact by design, so a GDC is permitted but not needed.

### Lineage carried by every candidate

| Field | Value |
|---|---|
| System | `IB` / `0-2-0-illustrative` |
| Config | `v2.ib.math-aa-hl`; framework `ib-dp-math-aa`, guide 2021 |
| Programme / subject / level | IB Diploma Programme / Mathematics: analysis and approaches / HL |
| Paper | `p1` or `p2` |
| Adapter | `IB.MATH_AA_HL.P1` / `IB.MATH_AA_HL.P2`, resolved from `GENERATION_PROFILE_COMPONENT` |
| Blueprint / bucket | blueprint, bucket and objective with its governed description |
| Syllabus area | `contentCategory` |
| Command terms | target and item command term |
| Concept | subject, name, link, catalogue row, stable id and its status |
| Core | core id, version, construct, renderer version, core digest |
| Item | seed, band, recognition id, parameter set, learner block, key, rubric, response policy |
| Other | misconception values, rights, provenance, certification proposal, validation, content digest |

### Design decisions taken during production

| Issue | Decision |
|---|---|
| P2 statistics concept link | The governed link for `aahl.p2.statistics` names only **Normal** and **Binomial distribution**. My earlier "mean / expected value" idea would have broken concept lineage, so both P2 constructs are distributions. |
| Normal-distribution items | **σ is never stated.** With σ given, a central probability is fixed (about 0.683 within 1σ), and an arbitrary stated probability would make the item self-contradictory. Without σ, every stated value in (0.5, 1) is consistent. |
| Definite integral, foundational | A lower limit of 0 makes "evaluates only the upper limit" equal to the key, so the collision filter removed every set. Foundational lower limits are now 1–2. |
| Ambiguous decimals | Keys whose exact decimal has exactly 3 decimals and a non-zero integer part (21/8 = 2.625) are excluded. See finding F2. |
| Vertical fixtures | Never re-issued (18 + 12 + 8 + …, ∫₀²(3x² − 2x), (2x + 1)/(x − 3), log₂x + log₂(x − 2) = 3). Checked again by semantic fingerprint. |
| P2 contexts | Spinner, seed germination and free throws (binomial); masses and completion times (normal). The context is chosen **by the numbers**, so the same numbers are never sold as a different question. |
| Wording padding | I did not pad wording to reach the 6-form target. Algebra and functions stay at 5 template forms. |

## 2. Candidates and validation

**300 candidates** (10 per band × 3 bands × 10 constructs): P1 algebra 60, functions 60, calculus 120; P2 statistics 60. All 300 prompts are distinct, with 57 distinct templates (wording with digits masked).

| Gate (Track B's own pure function) | Pass |
|---|---|
| Exhaustive envelope sweep, every parameter set of every band (`sweepEnvelope` / `sweepIsClean`) | **10/10 constructs CLEAN** (0 key failures, 0 band failures, 0 misconception collisions, 0 non-positive keys, 0 same-wording-different-key) |
| KEY_HOLDS: independent second route | 300/300 |
| RESPONSE_POLICY: `evaluateResponse(EXACT_NUMERIC_POLICY)` accepts the key and its equivalent forms; rejects every modelled misconception value and a near miss | 300/300 |
| EXAM_CORE_GRADING: the bank version `bankContentOf` would write parses (`ApprovedItemContentSchema`), loads (`examItemFromApproved`) and grades (`gradeExamItem`): key fraction 1 (strict 1, no review), misconceptions 0 | 300/300 |
| PROJECTION: `projectionRefusal` = null (single-part numeric, answer-marked) | 300/300 |
| LINEAGE: objective in the vertical, concept linked to the objective, concept row in the catalogue, adapter registered | 300/300 |
| NOT_A_FIXTURE / NO_OFFICIAL_CLAIM | 300/300 |

`DETERMINISTIC_VALIDATION_PASS = 300/300`. This is offline evidence that the existing projection *would* accept and score them. It is **not** a claim that they are runtime-ready.

### Repeatability (runtime `assembleForm`, MOCK, one Student, 200 simulated Students)

| Paper | Positions targeted | Forms with no repeated item and no repeated wording | Note |
|---|---|---|---|
| P1 | 4 (algebra 1, functions 1, calculus 2) | **5** | wording repeats in 2 positions from form 6 (algebra, functions) |
| P2 | 2 (statistics 2) | **6** | wording repeats from form 7 |

No item repeats within 8 forms on either paper.

| Bucket | Template-disjoint forms |
|---|---|
| algebra | 5 |
| functions | 5 |
| calculus | 17 |
| statistics | 6 |

The target was 6. Algebra and functions are one short; the next construct for each closes it.

## 3. Reprojection spec for the 30 existing instances: PARTIAL

Every one of the 30 is specified in `IB_30_REPROJECTION_SPEC.json`. Sources are unchanged: same `instanceId`, same `HUMAN_CERTIFIED` core, same `AUTOMATED_CERTIFIED_PILOT` / `INHERITED_DETERMINISTIC_CERTIFICATION` under `HUMAN50_POLICY_V1`.

| Must preserve | Specified as | Checked with the Exam Core grader | Status |
|---|---|---|---|
| Ordered roots | 2 parts: (a) smaller root A1, (b) larger root A1, ascending; never one NUMBER key with the roots as alternatives | each part key CORRECT, the other root INCORRECT, 30/30 | READY |
| Significant figures | not applicable: exact rational roots | — | READY |
| Tolerance | 0 (exact); decimal equivalents accepted where unambiguous (13/2 → 6.5) | 6.5 CORRECT | READY |
| Units | none | — | READY |
| Rubric / scoring provenance | source instance id, seed, recognition id, rubric verbatim + digest, each rubric code mapped to its target (working, part a, part b); marks unchanged (3 or 4) | accuracy criteria = derived roots, 30/30 | READY |
| Intermediate steps | rearrangement M1 → expanded standard form `= 0`; valid-method M1 → factored form, plus the accepted method families (factorising, formula, completing the square) | factored ≡ standard, 30/30 | READY as data |
| **Method marks** | needs evidence that is **form-aware** | **The current rule awards M1 for restating the given equation in 30/30, and does not award it for a valid quadratic-formula line** (probe) | **BLOCKED on Track B rule** |

Why PARTIAL: `methodEvidenced` tests mathematical equivalence only. A restatement of the question is equivalent to its rearranged or factored form, so declared intermediates cannot faithfully preserve an IB M mark. The construct is deliberately method-neutral, which makes this unavoidable with equivalence alone.

Track B options, in order of fidelity:
- **A.** A form-aware evidence rule. The line must be equivalent to an intermediate, be in its declared form (EXPANDED_STANDARD_FORM_EQUALS_ZERO / FACTORED / FORMULA_SUBSTITUTION / COMPLETED_SQUARE), and differ in form from the given equation.
- **B.** Follow-through only (`impliedByCorrectAnswer`). M is awarded only when both roots are right. This is not faithful to IB: method-only partial credit is lost.
- **C.** Keep the 30 CERTIFIED_NOT_DELIVERABLE.

**Identity:** the target changes learner-facing content, so its content hash changes. Track B would issue **new** instances (`reprojectionOf = sourceInstanceId`) under a re-certified IB renderer envelope. The source 30 remain as they are.

## 4. Return

```
BATCH_ID = CF-IB-AAHL-01
PROVIDER_SPEND_USD = 0
CONSTRUCTS_CREATED = 10
  (P1 algebra 2, P1 functions 2, P1 calculus 4, P2 statistics 2; all D0 exact-numeric, envelope sweeps 10/10 clean)
CANDIDATES_CREATED = 300 (30 per construct; 300 distinct prompts, 57 distinct templates)
DETERMINISTIC_VALIDATION_PASS = 300/300 (7 gates each, all through Track B's own pure functions)
P1_BUCKETS_COVERED = 3/4 (aahl.p1.algebra, aahl.p1.functions, aahl.p1.calculus; aahl.p1.extended not targeted: multi-part, D2)
P2_BUCKETS_COVERED = 1/3 (aahl.p2.statistics; trigonometry needs s.f./units (D1), extended is multi-part (D2))
EXISTING_30_REPROJECTION_SPEC = PARTIAL
  (ordered roots, s.f., tolerance, units, rubric/scoring provenance, intermediates: specified and checked 30/30;
   method marks: the current rule awards M1 for restating the question in 30/30, so a form-aware evidence rule is needed)
PROJECTED_IB_POSITIONS_AFTER_TRACK_B = 6/9
  (P1 algebra 1 + functions 1 + calculus 2, P2 statistics 2; correction: the earlier manifest said 5/9, but P2 statistics holds 2 positions)
CERTIFIED_NOT_DELIVERABLE_REMAINING = 30 (unchanged until Track B adopts the spec and the method-evidence rule)
DATABASE_WRITES = 0
DEPLOYMENTS = 0
PAA_FROZEN_BASELINE_MUTATED = NO
```

## 5. What Track B must confirm before any of this is delivered

1. Certified IB bucket classifications for `aahl.p1.algebra`, `aahl.p1.calculus` (P1) and a certified P2 blueprint with `aahl.p2.statistics`. Today only `aahl.p1.functions` is certified.
2. Adoption and certification of the 10 cores and their IB applicability. All are proposed `AUTOMATED_CERTIFIED_PILOT`; no human decision exists or is claimed.
3. **Concept stable ids.** 9 of 10 cores need ids that do not exist; the IB concepts are catalogue rows labelled `DEV_FIXTURE / NON_OFFICIAL`. Spec composition refuses a core whose concept is not in its bucket, so this is a hard prerequisite.
4. Bank projection and scoring compatibility on Track B itself. The offline gates reuse its functions but are not its confirmation.

## 6. Findings for Track B (observed, not acted on)

- **F1. Method-mark equivalence.** `methodEvidenced` awards M marks to restated equations and misses formula-substitution lines (probe evidence).
- **F2. Scorers disagree on decimals.** `EXACT_NUMERIC_POLICY` (separators "." and ",") reads `2.625` as AMBIGUOUS_SEPARATOR; the Exam Core grader accepts it; `2,625` the reverse. A certified instance and its bank version can score the same correct answer differently. The content-side exclusion is in place; the scorer alignment is Track B's.
- **F3. Illustrative system version.** `0-2-0-illustrative` still makes all IB supply PRODUCTION-ineligible.
