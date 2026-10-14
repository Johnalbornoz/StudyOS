# IB constructed response: capability gap

Track B · 2026-10-14 · Discovery only. No IB content was produced.

**Verdict: IB_CONSTRUCTED_RESPONSE_GAP = DEFINED.**

The 30 certified IB instances (`IB.MATH_AA_HL.P1`, quadratic core, `SHORT_RESPONSE`, M1/A1/A1 mark scheme, `RUBRIC` policy) are blocked at **one** place: the Exam Bank projection.

The Exam Core runtime already contains most of the scorers this content needs. The gap is a **governed mapping, a scoring contract and certification of method marks**. It is not a missing grading engine.

## 1. What exists

| Capability | Where | Notes |
|---|---|---|
| Certified IB instances | `docs/exams/question-factory/v52/QF52_CERTIFIED_SUPPLY.json` (30/326) | `markedOnWorking: true`, partial credit `[M1 (answer null), A1 "1", A1 "2"]`, `math: null` |
| Renderer for constructed formats | `strategy-quadratic-factorising.ts:100-155` | Builds the M1/M1/A1/A1 rubric. `parts: []` is always empty. **No renderer emits multi-part items.** |
| QF response evaluation | `assessment-instance/response-evaluation.ts:168-177` | `RUBRIC` scores only the answer points. Method marks return `NEEDS_A_MARKER`. |
| Exam Core item model | `exam-core/items.ts:31-192` | `SCORING_STRATEGIES` include PARTIAL_CREDIT, METHOD_MARK, MARKSCHEME, MULTI_PART, rubrics. `MathKeySchema` covers EXPRESSION, NUMBER, EQUATION, INEQUALITY and INTERVAL with forms and tolerance. `MethodKeySchema` has `intermediates`. `ExamItemPartSchema` has a per-part math key and method. |
| Exam Core grader | `exam-core/item-grading.ts:325-467` | Multi-part mark scheme. Math with method marks, awarded from working or implied by a correct answer. Double-assessor rubric (AI A/B + adjudicator). AI free text. |
| Math equivalence | `exam-core/math/math-engine.ts` (`gradeMath`, `expressionsEquivalent`), `grading/math-equivalence.ts` | mathjs whitelist |
| Scoring provenance | `exam_attempt_item_responses.scoring_strategy / review_status / grading_detail / normalized_response`, `exam_response_assessments` (DETERMINISTIC / ASSESSOR_A / ASSESSOR_B / ADJUDICATOR, `criterion_scores`) | Already persisted |
| UI | `ItemRunner.tsx` | math input with a working box (method marks), parts, text |
| Calibration suite | `exam-core/calibration/calibration.ts` | IB benchmark cases (method-only, equivalent forms, significant figures, units). `equivalenceClaimAllowed` is false without ≥ 30 official cases. |
| Legacy IB fixtures with method marks | `exam-core/verticals/v2/ib-math-aa-hl.ts` | `LEGACY` / `DEV_CERT_FIXTURE`. **Not certified supply.** |

## 2. Where delivery is blocked

1. `supply-authority.ts:93`: `isMarkedOnWorking` is true for RUBRIC, parts, working shown, or any non-ANSWER rubric point.
2. `exam-bank/bank-projection.ts:39-45`: `projectionRefusal` returns `RESPONSE_IS_MARKED_ON_WORKING` first. If that check were removed, it would still refuse:
   - any policy other than NUMERIC or format other than NUMERIC_ENTRY;
   - any stimulus, parts or options.
3. `publication.service.ts:310`: the refused instance stays a certified instance with **no bank row**. That is the CERTIFIED_NOT_DELIVERABLE state.
4. `bank-projection.ts:59-76` hard-codes `numeric_problem` / `MATHEMATICAL_EQUIVALENCE` / a NUMBER key. `MaterializedItem.content.math` is NUMBER-only (`supply-authority.ts:252`).

## 3. What is missing

| Area | Missing |
|---|---|
| **Mapping** | (a) A QF `RubricPoint` M1 holds only criterion text; it has no `intermediates`, which `MethodKeySchema` requires. (b) Two A1 roots do not fit `math.answers`, because any single answer would match. They need `parts` (one per root), an unordered **set key**, or an EQUATION key with a solution-set check. (c) There is no projection version for constructed formats: `BANK_PROJECTION_VERSION` is still `exam-bank-projection-2`. |
| **Multi-part** | No renderer emits `parts`. The certification checks (`instance-certification.ts:85-90`) do not cover per-part marks or the dependencies between parts (follow-through). |
| **Method marks** | Method is "evidenced" by matching working against `intermediates`. That needs intermediates authored and **certified** per core. Method-neutral M1 (`renderQuadraticSolve`) is PROVISIONAL. |
| **Answer marks** | Deterministic, through `gradeMath`. IB accuracy conventions (3 s.f., units, exact vs approximate) exist as math-key options but are not set by the renderer. |
| **Partial credit / follow-through** | Exam Core awards per criterion. IB "FT" (follow-through on an earlier wrong value) is **not modelled**. |
| **Math equivalence** | Available. The single-variable whitelist limits multi-variable IB items. Equivalence across solution sets is not implemented. |
| **Rubric (non-deterministic)** | The double assessor exists, but its use for certified bank content is **not governed**: no policy says when AI marking may count, and `REVIEW_REQUIRED` responses are already excluded from evidence. |
| **Scoring provenance** | Persisted per response. Missing: the scoring-contract version and the mark-scheme digest on the response, so that a later grader change can be detected. |
| **Certification** | The certification policy must certify the **mark scheme**, not only the key: intermediates, accuracy rules, part structure and FT rules. The current RUBRIC check only verifies that each keyed value has an accuracy point. |
| **Readiness** | Exam Core advertises no scoring capability. The Readiness Engine needs `scorableFormats` to say exactly which formats are scored deterministically under a certified contract. |

## 4. Implications

### Schema (proposals, no migration created)

- `approved_items.content` gains a **constructed-response projection** (`exam-bank-projection-3`). It carries `parts[]`, each with a math key (or set key), `method {marks, criterion, intermediates[]}`, an accuracy rule and an FT policy.
- New: `exam_bank_mark_schemes(mark_scheme_id, version, digest, item_content_hash, policy_hash)`, so that the certified mark scheme has an identity.
- `exam_attempt_item_responses` gains `scoring_contract_version` and `mark_scheme_digest`.

### Runtime

- `projectionRefusal` allows `SHORT_RESPONSE` / `MATH_EXPRESSION` **only** when every mark is deterministically scorable: no `NEEDS_A_MARKER` point, every method point has certified intermediates, and every part has a key.
- Anything else stays CERTIFIED_NOT_DELIVERABLE, with an explicit reason.

### Scoring

1. Deterministic first: `gradeMath` plus method from working.
2. Rubric or AI marking only under a governed policy, as `REVIEW_REQUIRED` until confirmed.
3. A calibration suite run is required before any claim of IB-equivalent marking.

### UI

- `ItemRunner` already renders math, working and parts.
- Still needed: part-by-part review showing the M/A marks awarded and why (from `grading_detail`), and a clear notice that marking is a StudyUs estimate.

### Certification

- A policy (human, or automated-pilot with blind solvers, as for PAA) that certifies the mark scheme.
- Rules: KEY_SUPPORTED, METHOD_INTERMEDIATES_VALID (each intermediate equivalent along the solution path), ACCURACY_RULE_STATED, PART_INDEPENDENCE / FT_DECLARED, SCORING_COMPATIBILITY.

## 5. Recommended first slice

1. A single-part `MATH_EXPRESSION` item.
2. An A-mark only, with an optional M-mark carrying certified intermediates.
3. Deterministic scoring.
4. No AI marking.

The Readiness Engine would then report `scorableFormats` = SELECTED_RESPONSE, NUMERIC_ENTRY and MATH_EXPRESSION (deterministic). IB P1 short items would become deliverable. Multi-part, follow-through and rubric marking stay CERTIFIED_NOT_DELIVERABLE until their own contracts exist.

## 6. Implementation, 2026-10-14: scoring-preserving projection (isolated)

**IB_SCORING_PROJECTION = PARTIAL.** The delivery and scoring capability exists and is proven. No IB item is materialised: the existing certified schema is not compatible, and the new content does not exist yet.

**Module:** `src/lib/exam-bank/scoring-projection.ts` (`exam-bank-projection-3`). It is pure and wired into nothing. The publication service still uses projection 2, so the frozen PAA bank content is untouched.

**Tests:** `tests/unit/exam-bank-scoring-projection.test.ts` (15). They run against the real QF V5.2 supply (296 PAA + 30 IB instances) and a synthetic IB re-render.

### What projection 3 carries, end to end through `examItemFromApproved` + `gradeExamItem`

| Semantics | How | Proof |
|---|---|---|
| Multi-part structure | `ORDERED_PARTS`: one Exam Core math part per **certified learner part**, in the certified order. Prompts must already be certified content; they are never invented. | parts a/b, marks equal to the rubric |
| Method marks from intermediate steps | Every METHOD rubric point maps to a method key whose `intermediates` come from the certified scheme. Each equation intermediate is **checked by substitution** against the key. A false intermediate is refused, and so is one in another variable. | working `(x-2)(x-3)=0` → M1; a false intermediate → `INTERMEDIATE_NOT_SATISFIED_BY_THE_KEY` |
| Answer marks | Every ACCURACY / ANSWER point maps to exactly one target. Its value must equal the policy's certified answer for that point. | `TARGET_VALUE_NOT_THE_CERTIFIED_KEY` |
| Ordered or multiple roots | The roots are two targets, never alternatives. | swapped answers → 0/3; the same root twice → 2/3 (1 A1 + implied M1); correct → 3/3 |
| Implied method | `impliedByCorrectAnswer` comes from the certified scheme. | "not implied" → 2/3 without working |
| Significant figures, tolerance, units, accepted forms | Carried into the math key, with **no invented partial credit** (all 0). The certified policy awards nothing for a value that misses a requirement. | The QF evaluator and Exam Core agree on every probe response (s.f. 3, absolute tolerance, a required unit) |
| Rules Exam Core cannot express exactly | Refused, never dropped: a single decimal separator, unit aliases, a fraction-only representation. | `SEPARATOR_` / `UNIT_` / `REPRESENTATION_RULE_NOT_PROJECTABLE` |
| Scoring provenance | `certified.scoring`: contract version, mark-scheme digest, rubric digest, response-policy digest, and the point → target map. The lineage digest is unchanged. The grade's provenance is `exam-core:mark-scheme`. | asserted |
| No regression for PAA | All 296 PAA instances project under both 2 and 3 with **the same math key**, and grade identically on a sample. Every PAA key has exactly one value. | asserted |
| Certification not weakened | Only `AUTOMATED_CERTIFIED_PILOT` / `HUMAN_CERTIFIED` instances project. The machine scheme must live **inside** the certified response policy, which is covered by the lineage hash and certification digest, so a scheme added later is new content and needs a new certification. | `NOT_CERTIFIED` |

### A gap in projection 2, recorded but not fixed (frozen)

`projectionRefusal` accepts a NUMERIC_ENTRY instance whose key lists **two different values**. Exam Core reads `math.answers` as alternatives, so either value alone would score full credit. No PAA instance has this shape: all 296 have one value. Projection 3 refuses it (`MULTIPLE_KEY_VALUES_WITHOUT_PART_STRUCTURE`).

### The 30 certified IB instances: why they stay CERTIFIED_NOT_DELIVERABLE

Their certified schema (prose M1, an **unordered** two-root key, no learner parts, no machine scheme) is not compatible with any deterministic scheme:

| Attempted mapping | Refusal |
|---|---|
| none (as certified) | `WORKING_MARKED_WITHOUT_MACHINE_MARK_SCHEME` |
| roots as a set | `UNORDERED_SOLUTION_SET_NOT_SCORABLE`: Exam Core has no set target |
| ordered parts | `PARTS_NOT_IN_CERTIFIED_LEARNER_CONTENT`: the certified learner instance has no parts |
| answer-only, M1 dropped | `RUBRIC_POINT_NOT_MAPPED`: a certified mark cannot be dropped |
| M1 without intermediates | `MARK_SCHEME_INVALID` |

## 7. First IB runtime target: CF-IB-AAHL-01, and the exact remaining blocker

DEV governance, read only, 2026-10-14:

| Object | Fact |
|---|---|
| IB blueprint classifications | **1**, `v2.ib.math-aa-hl/p1@step4b-pilot-1` (REDUCED), certified, with **one** bucket: `aahl.p1.functions#0` |
| IB adapters | `IB.MATH_AA_HL.P1` only, `0.2.0-illustrative+0.4.0-illustrative`, CERTIFIED. **No P2 adapter.** |
| IB system version | `0-2-0-illustrative`, ACTIVE, so PILOT_PREVIEW only |
| IB construct cores applicable | **1**: `tf.math.quadratic.solve-rational-roots` 1.0.0-rc.1 |
| IB certified instances | 30, database refusal `NULL`, **no bank row** |
| IB exam version `67350668…` | P1 5 + P2 4 + P3 1 positions; only 18 LEGACY fixture rows → engine NOT_READY |

**EXACT REMAINING BLOCKER for the first deterministic IB items to materialise:**

**1. No certified IB instance exists whose content projection 3 can score.** The only certified IB supply is the 30 quadratic instances, and their certified schema is incompatible (above). Two paths remove this:

| Path | Content (Content Factory) | Track B |
|---|---|---|
| (a) Fastest, unlocks the 30, bucket already certified | IB renderer-envelope spec that re-renders the HUMAN_CERTIFIED quadratic core with learner parts (a) smaller root, (b) larger root, and `responsePolicy.markScheme` (ORDERED_PARTS ASCENDING; intermediates standard form, factored form, roots) | certify the new envelope and re-certify the instances |
| (b) CF-IB-AAHL-01 wave 1 (D0) | 10 single exact-numeric cores | certify each core, its IB applicability and its renderer envelope |

**2. Governed buckets.** Only `aahl.p1.functions` is a certified IB bucket. Wave 1 also needs:
- P1 `aahl.p1.algebra` and `aahl.p1.calculus` in a certified classification;
- the **P2 adapter `IB.MATH_AA_HL.P2`** and a P2 blueprint classification with `aahl.p2.statistics`.

A blueprint classification is a governed object certified by a recorded decision. None exists for these, and none is fabricated: **this needs John's (or a named reviewer's) decision.**

**3. Publication.** The loader publishes with projection 2. That is enough for D0 single numeric answers, but not for path (a), accuracy-rule items (D1) or multi-part items. It must select **projection 3 for new IB content only**, leaving PAA bank versions on projection 2, which projection 3 reproduces exactly. This is a Track B change; the PAA content does not change.

Nothing in this block publishes IB content or creates IB content.
