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
