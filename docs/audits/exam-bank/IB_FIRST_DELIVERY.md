# IB first delivery: one real IB item end to end in DEV, and the canonical concept model

Track B · 2026-10-14. The PAA baseline is frozen at `610d3c6`; Preview, Stage and Production are not touched.

## Gates

| Gate | Result |
|---|---|
| IB_PARAMETRIC_SHORT_RESPONSE | **PASS** |
| QUADRATIC_MINIMUM_SHORT_RESPONSE_PACKAGE | **PENDING**: the Content Factory's formal revision has not been delivered yet |
| FIRST_IB_CERTIFIED_BANK_ITEM | **PASS** (DEV) |
| FIRST_IB_DEV_ATTEMPT | **PASS** |
| FIRST_IB_DEV_SCORING | **PASS** |
| IB_RUNTIME_PROVIDER_CALLS | **0** |
| IB_CANONICAL_CONCEPT_MODEL | **PASS** |

## 1. Decision applied

The governed IB adapter keeps exactly `MATH_EXPRESSION / SHORT_RESPONSE / EXTENDED_RESPONSE`, and `NUMERIC_ENTRY` was **not** added. The construct is delivered as IB `SHORT_RESPONSE` with answer marks.

`parametricStrategy(c, { format: 'SHORT_RESPONSE', marksByBand })` in `library/parametric.ts` renders it:
- one exact value, judged by the canonical numeric contract;
- answer marks only (rubric `A<n>`, kind ANSWER), with working not assessed, so the item is not marked on working;
- the marks are the construct's own per band (2 / 3 / 4), validated against the specification's governed range (2..8);
- the command term is the one the wording uses (`find`, requested from the adapter's vocabulary).

`NUMERIC_ENTRY` stays the default, so every existing entry renders exactly as before. Nothing depends on PAA.

## 2. The governed chain, proven

### Content Factory candidate → governed construct → certification

QUADRATIC_MINIMUM_VALUE is the Content Factory's construct code, adopted unchanged in `library/cf-ib-aahl-01.ts`. Every package candidate is re-rendered from its own parameter set (seed `@rk=`).

| Check | Result |
|---|---|
| Core governance | AUTOMATED_CERTIFIED_PILOT |
| Envelope governance | AUTOMATED_CERTIFIED_PILOT |
| All 30 candidates | certified (`AUTOMATED_CERTIFIED_PILOT`, `INHERITED_DETERMINISTIC_CERTIFICATION`, `STUDYUS_ORIGINAL_DETERMINISTIC`) with prompt, key, policy, marks and bucket **identical to the package** |
| Difference from the delivered NUMERIC_ENTRY candidate | **only** the format (`revisionAcceptance` → `['format']`) |

`tests/unit/cf-ib-aahl-01-adoption.test.ts` covers this.

### The formal revision is pending

**QUADRATIC_MINIMUM_SHORT_RESPONSE_PACKAGE = PENDING.** When the Content Factory's SHORT_RESPONSE revision arrives:
- each revised candidate must pass `revisionAcceptance` (equal to the governed render), which `cf-package-dry-run.ts` runs;
- a candidate with any difference is refused, and the DEV row is retired if it does not match.

### Bank Projection v3 → Exam Bank row (DEV)

- The archived V5.2 library (`LIBRARY`) is **unchanged**.
- Adopted entries live in `LIBRARY_EXTENSIONS`, and the loader publishes them as an **extension plan** with their own batch `CF-IB-AAHL-01`.
- The V5.2 plan keeps its hash `a9906fa3…` and its counts; the frozen PAA speed-strategy record still matches it.

| Step | Result |
|---|---|
| Throwaway Postgres proof | PASS: 296 PAA rows (projection 2) + 1 IB row (projection 3, canonical contract, SHORT_RESPONSE); second apply 0 rows |
| DEV publication (`publish-certified-supply.ts --apply`, fp-gated) | 17 rows: core, envelope, renderer, applicability, object certifications, batch + 3 cells, 1 instance, 1 bank row, right, concept, lifecycle event, coverage snapshot. **Every PAA row skipped as identical; 0 conflicts.** |
| DEV re-run | 0 identities, 0 conflicts (the only new row is the per-run coverage snapshot) |

Evidence: `evidence/IB_FIRST_DELIVERY_DEV_PUBLICATION.json`.

**The item:** `Let f(x) = 4x² − 10x + 27, x ∈ ℝ. Find the minimum value of f(x).` Key `83/4`, 4 marks, bucket `v2.ib.math-aa-hl/p1/aahl.p1.functions#0` (HUMAN_CERTIFIED, D02), concept `math.alg.quadratics`.

### Frozen DEV attempt → Student SHORT_RESPONSE → canonical scorer → marks

`scripts/operations/exam-bank/ib-first-delivery-scenario.ts` runs on DEV through the Exam Core services the Student routes call. Result: **12/12 PASS** (`evidence/IB_FIRST_DELIVERY_DEV.json`).

| # | Check | Result |
|---|---|---|
| B1/B2 | Bank row CORE_DERIVED, projection 3, contract `canonical-response-1`, SHORT_RESPONSE; the instance is certified, eligible in the pilot scope, in the human-certified bucket | PASS |
| A1/A2 | A PRACTICE instance focused on `aahl.p1.functions` (one position), frozen at start (assessment snapshot holds the item); it serves exactly that item, with no answer key on the wire | PASS |
| S1 | "20,75" scores **4/4**, through the canonical contract (verdict CORRECT, review NONE) | PASS |
| S2 | "20.8" scores **0/4** (exact value; no invented partial credit) | PASS |
| S3 | "83/4" scores **4/4** | PASS |
| X1 / X2 | 0 question-provider calls; no Learning Plan entry created | PASS |
| E1 | Current writer: 0 evidence rows (the Student owns no concept and exam prep enrols none). This is the known PAA-FOLLOWUP-02 gap; it was not mutated. | PASS |
| E2 | TARGET model (`evidence-boundary.ts`) on the same three responses: ONE Exam Readiness cell (IB / P1 / functions bucket / `math.alg.quadratics`), 3 attempts, 2 independent correct; no plan entry; no Knowledge State change | PASS |
| Z1 | Fixture Student removed | PASS |

**Not part of this milestone:** the catalogue does not offer IB yet. P1 practice needs 5 positions and has 1, so the ENFORCE overlay keeps the node not selectable. The attempt goes through the same Exam Core services the instance route calls after its readiness gate.

**IB readiness on DEV** (shadow, read only, `evidence/PAA_READINESS_SHADOW_DEV.json`):
- P1: PARTIAL, 1/5 covered (1 certified, 1 runtime-eligible, `SHORT_RESPONSE_KEYED`);
- P2: NOT_READY, 0/4;
- the remaining rows are LEGACY fixtures.

The four states are distinguished as follows:

| State | Count |
|---|---|
| Certified candidates | 30 (envelope) |
| Certified-not-deliverable | 30 historical |
| Bank-deliverable | 1 |
| Runtime-ready | 1 |

**PAA regression on DEV:** `exam-runtime-scenarios.ts` **43/43 PASS** on the same code.

## 3. Canonical concept model: PASS

Code in `src/lib/curriculum/ib/ib-aa-hl-concept-correspondence.ts`, tested in `tests/unit/ib-concept-correspondence.test.ts`.

```
StudyUs canonical concept (STUDYUS_CANONICAL_KNOWLEDGE, never "an official IB concept")
  -> explicit governed correspondence (SYLLABUS_AREA_CORRESPONDENCE)
    -> IB governed source: the objective of v2.ib.math-aa-hl whose description the vertical records
       from the IBO guide (source key ibo-math-aa-guide-2021)
      -> assessment applicability: the objective's catalogue link (objective-learning-links.ts, DECLARED_REVIEWED)
```

**No Topic node is created (IB_TOPICS_INVENTED = 0).** Every construct maps to a concept that **already exists** in the StudyUs catalogue, so no new concept row is created.

| construct_id | studyus_canonical_concept_id | concept_existing_or_new | ib_source_reference | ib_correspondence_type | assessment_applicability | governance_status |
|---|---|---|---|---|---|---|
| tf.math.series.geometric-sum-to-infinity | math.alg.sequences-series | existing catalogue concept "Sequences and series"; identity PROPOSED | ibo-math-aa-guide-2021 · aahl.p1.algebra · "sequences and series" | SYLLABUS_AREA | IB P1 · link aahl.p1.algebra (DECLARED_REVIEWED) | SOURCE_BACKED · IDENTITY PENDING DECISION |
| tf.math.logarithms.equation-one-admissible-root | math.alg.logarithms | existing "Logarithms"; identity PROPOSED | · aahl.p1.algebra · "logarithms" | SYLLABUS_AREA | IB P1 · aahl.p1.algebra | SOURCE_BACKED · PENDING |
| tf.math.functions.inverse-function-value | math.fun.rational-functions-inverses | existing "Rational functions and inverses"; identity PROPOSED | · aahl.p1.functions · "inverses" | SYLLABUS_AREA | IB P1 · aahl.p1.functions | SOURCE_BACKED · PENDING |
| **tf.math.quadratic.minimum-value** | **math.alg.quadratics** | **existing, GOVERNED** (PAA REMAP_EXISTING; bucket D02) | · aahl.p1.functions · "quadratics" | SYLLABUS_AREA | IB P1 · aahl.p1.functions | **GOVERNED** |
| tf.math.calculus.definite-integral-polynomial | math.calc.integration | existing "Integration"; identity PROPOSED | · aahl.p1.calculus · "integration" | SYLLABUS_AREA | IB P1 · aahl.p1.calculus | SOURCE_BACKED · PENDING |
| tf.math.calculus.area-between-curve-and-axis | math.calc.integration | (same) | · aahl.p1.calculus · "integration" | SYLLABUS_AREA | IB P1 · aahl.p1.calculus | SOURCE_BACKED · PENDING |
| tf.math.calculus.tangent-gradient-at-a-point | math.calc.differentiation | existing "Differentiation"; identity PROPOSED | · aahl.p1.calculus · "differentiation" | SYLLABUS_AREA | IB P1 · aahl.p1.calculus | SOURCE_BACKED · PENDING |
| tf.math.calculus.cubic-local-maximum | math.calc.differentiation | (same) | · aahl.p1.calculus · "differentiation" | SYLLABUS_AREA | IB P1 · aahl.p1.calculus | SOURCE_BACKED · PENDING |
| tf.math.probability.binomial-exact-probability | math.prob.binomial-distribution | existing "Binomial distribution"; identity PROPOSED | · aahl.p2.statistics · "distributions" | SYLLABUS_AREA | IB P2 · aahl.p2.statistics | SOURCE_BACKED · PENDING |
| tf.math.probability.normal-symmetry | math.prob.normal-distribution | existing "Normal distribution"; identity PROPOSED | · aahl.p2.statistics · "distributions" | SYLLABUS_AREA | IB P2 · aahl.p2.statistics | SOURCE_BACKED · PENDING |

**Counts:**
- Source-backed: **10/10**.
- Concepts reused: **10 of 10**, all on existing catalogue concepts. **1** has a governed identity; **7 stable identities are proposed**.
- New StudyUs canonical concepts created: **0**.

**Why reuse instead of PAA ids:** `math.alg.patterns-sequences` (PAA "Patrones y sucesiones") covers no series. `math.fun.functions` and `math.prob.probability` are broader, and the IB objectives link the Mathematics rows, not those. No PAA identity is reused for a different concept.

**The decision that governs the seven:** `docs/audits/exam-bank/IB_CONCEPT_IDENTITY_DECISIONS.csv`. The DECISION and REVIEWER columns are blank; no approval is fabricated.

## 4. Buckets and adapter

| Object | Result |
|---|---|
| IB_P1_FUNCTIONS_BUCKET | **CERTIFIED**: HUMAN_CERTIFIED, D02; now delivers 1 item |
| IB_P1_ALGEBRA_BUCKET | **BLOCKED_PENDING_CONCEPT_IDENTITY_DECISION** |
| IB_P1_CALCULUS_BUCKET | **BLOCKED_PENDING_CONCEPT_IDENTITY_DECISION** |
| IB_P2_STATISTICS_BUCKET | **BLOCKED_PENDING_CONCEPT_IDENTITY_DECISION** (classification `v2.ib.math-aa-hl/p2` defined in the test; not published) |
| IB_P2_ADAPTER | **AUTOMATED_CERTIFIED_PILOT by governance**; published with the first P2 classification |

**Proven** (`ib-concept-correspondence.test.ts`, real `governBlueprint`):
- **Today**, a P1 classification with algebra / functions / calculus and a P2 classification with statistics fail **only** `EVERY_BUCKET_LINKS_AN_ASSESSED_CONCEPT`.
- **With the seven identities governed** (the register then holds the existing DECLARED_REVIEWED objective links for them), **both pass AUTOMATED_CERTIFIED_PILOT with no other change**: 1 + 1 + 2 + 2 = **6/9 positions**.

## 5. CF-IB-AAHL-01

- **Status:** `CONTENT_VALID / GOVERNANCE_PENDING / FORMAT_REPROJECTION_REQUIRED` (dry run, `evidence/CF_IB_AAHL_01_DRY_RUN.json`). Not discarded.
- **CF_IB_AAHL_01_BULK_READY = NO.** It needs three things:
  1. the SHORT_RESPONSE revision;
  2. the seven identity decisions;
  3. the P1 / P2 classifications published.
- **PROJECTED_COVERAGE_AFTER_BULK = 6/9.**

## 6. The 30 historical IB items

**CERTIFIED_NOT_DELIVERABLE**, unchanged. Their certification is not rewritten, and no ordered or multi-part semantics are imposed. The form-aware method-mark rules remain available for new certified content.
