# CF-IB-AAHL-01-R1: targeted revision

**Thread:** Exam Content Factory · **Date:** 2026-10-14 · **Status:** offline package plus manifest. Nothing is runtime-ready.

| Guard | Value |
|---|---|
| Provider spend | USD 0 · provider calls 0 |
| Database reads / writes | 0 / 0 |
| Deployments | 0 |
| Runtime changes | 0 (nothing under `src/` was edited, in any worktree) |
| PAA | untouched (frozen `610d3c6`) |
| The 300 candidates of CF-IB-AAHL-01 | not regenerated (package `678741c9…` unchanged) |
| New constructs | none |
| The 30 existing IB instances | not modified; still `CERTIFIED_NOT_DELIVERABLE` |

**Validated against Track B `a2055a0`** (canonical-response-1, guarded projection 3, form-aware method rules, package dry run), using a detached read-only checkout at `/Users/jalbornoz/PROYECTOS/studyos-cf-validate-a2055a0`. That checkout has 0 changes. Track B's own worktree was only read.

## Files

| File | What |
|---|---|
| [`CF-IB-AAHL-01-R1_CANDIDATE_PACKAGE.json`](CF-IB-AAHL-01-R1_CANDIDATE_PACKAGE.json) | 30 SHORT_RESPONSE candidates. sha256 `9f0ecffebdf9d5bc0db1dc3731709903df6f6850dd30159b3557d6a764fc6c8b` (byte-reproducible) |
| [`CF-IB-AAHL-01-R1_VALIDATION.json`](CF-IB-AAHL-01-R1_VALIDATION.json) | Per-candidate validation, parity table, Bank v3 digests, Track B dry-run report |
| [`IB_CONCEPT_CORRESPONDENCE_MANIFEST.json`](IB_CONCEPT_CORRESPONDENCE_MANIFEST.json) | Deliverable B, 10 constructs |
| [`scripts/content-factory/ib-aahl-01-r1/produce-short-response.ts`](../../../scripts/content-factory/ib-aahl-01-r1/produce-short-response.ts) | Deliverable A producer (pure) |
| [`scripts/content-factory/ib-aahl-01-r1/concept-correspondence.ts`](../../../scripts/content-factory/ib-aahl-01-r1/concept-correspondence.ts) | Deliverable B generator (pure, quotes governed records at run time) |

Re-run, from the `a2055a0` checkout (no environment needed):

```bash
npx tsx --tsconfig ./tsconfig.json <content-factory>/scripts/content-factory/ib-aahl-01-r1/produce-short-response.ts <CF-IB-AAHL-01 package> <R1 package out> <R1 validation out>
```

## Deliverable A: QUADRATIC_MINIMUM_VALUE as SHORT_RESPONSE (PASS)

**What changed:** `learner.itemType` NUMERIC_ENTRY → **SHORT_RESPONSE**, and the identities that follow from it:
- batch-scoped seed `CF-IB-AAHL-01-R1/…`;
- `candidateId`;
- `contentDigest`, which now includes the format.

Each candidate records `derivedFrom`: source batch, package sha, source candidateId, digest and seed.

**Envelope:** the proposal is Track B's evaluated envelope (`ENVELOPE_QUADRATIC_MINIMUM`) with **only** `responseFormats` changed to `['SHORT_RESPONSE']`. The envelope hash is `2d2c398d…`; the delta is computed, not asserted. The IB adapter is not altered: `IB.MATH_AA_HL.P1` already offers SHORT_RESPONSE.

**Preserved, each re-derived from the same parameter set and asserted identical** (30/30):

| Preserved | Value |
|---|---|
| Construct, parameter envelope, bands | `cf.ib.quadratic-minimum-value@0.1.0`, unchanged code |
| Prompt and answer key | identical |
| Recognition id, difficulty, band, marks | identical (marks 2 / 3 / 4) |
| Calculator | NONE |
| Rubric | `KEY` / `ANSWER` point |
| Response policy | `EXACT_NUMERIC_POLICY`, byte-identical at `610d3c6` and `a2055a0` |
| Misconceptions | identical |
| Blueprint relationship | `v2.ib.math-aa-hl/p1/aahl.p1.functions#0`, certified classification `step4b-pilot-1` |
| Concept | `math.alg.quadratics` |
| Lineage, rights, provenance | identical; `STUDYUS_ORIGINAL_DETERMINISTIC`, 0 provider calls |

`workingShown: false` and an ANSWER-only rubric, so Track B's `isMarkedOnWorking` = **false**: the item is answer-marked.

### Validation (30/30 candidates pass every gate)

| Gate | Result |
|---|---|
| Full envelope sweep, every parameter set of every band | **CLEAN** (293 / 442 / 2137 raw = recognition classes) |
| Independent answer calculation (f at the derivative's zero, not the completed-square formula) | 30/30 |
| Correct and equivalent responses accepted by **both** evaluators (Question Factory `evaluateResponse` and canonical contract `evaluateCanonicalNumeric`) | 30/30. Key, `n.0`, exact decimal, decimal comma, unreduced fraction (`249/12`), surrounding spaces. |
| Wrong answers rejected by both | 30/30. Every modelled misconception, a near miss, the negative, empty, non-numeric. |
| Policy coherence (`policyIssues`, canonical-response-1) | none |
| **Scorer parity**: Question Factory = canonical contract = Exam Core (`gradeExamItem` on the Bank v3 content), in `en` **and** `es` | **333/333 responses agree** |
| **Bank v3**: `bankProjectionFor` → `exam-bank-projection-3`, refusal none; `scoringBankContentOf` → structure SINGLE, `responseContract: canonical-response-1` carried in `math`, digests in `certified.scoring`; `scoringBankContentIssues` = []; `ApprovedItemContentSchema` parses; `examItemFromApproved` loads | 30/30 |
| **Track B's own ingestion dry run** (`dryRunCfPackage`, pinned to this package's bytes) | **accepted 30/30, certification-eligible 30/30, 0 failures** (incl. FORMAT_OFFERED, CONCEPT_GOVERNED, BUCKET_CERTIFIED, ADAPTER_GOVERNED, PROJECTION); two runs, identical report digest `636b62b8…` |

**What the Bank v3 / Exam Core step ran on:** the instance each candidate would become once certified. It carries `AUTOMATED_CERTIFIED_PILOT`, `INHERITED_DETERMINISTIC_CERTIFICATION`, `HUMAN50_POLICY_V1`, `PILOT_PREVIEW`, and is marked `lineage.simulated = true`. **No certification exists or is claimed.** This shows that, once certified, the content would be projected and scored exactly as its certified policy says.

### The chain `candidate → certification → Bank v3 → Exam Core → DEV response → score`

| Link | Status after R1 | Who |
|---|---|---|
| candidate | delivered, validated 30/30, accepted by Track B's dry run | Content Factory (done) |
| render | **Track B capability**: `parametricStrategy` renders NUMERIC_ENTRY only, so a parametric SHORT_RESPONSE strategy is needed. The package states exactly what it must render: same prompt, key, rubric, policy; `itemType` SHORT_RESPONSE. | Track B |
| certification | envelope re-certification (format delta only); instances INHERITED_DETERMINISTIC | Track B |
| Bank v3 | proven offline (projection 3, SINGLE, canonical contract) | Track B (real DB) |
| Exam Core score | proven offline (parity 333/333, en/es) | Track B (DEV) |
| DEV response | not done here (no database) | Track B |

## Deliverable B: concept correspondence manifest (1/10 source-backed)

**What the repository governs for IB AA HL**, every IB-side field quoted from it at run time:

| Record | What it holds |
|---|---|
| Source registry (`exam-core/catalog/sources.ts`) | `ibo-math-aa-guide-2021`: title, publisher IBO, official ibo.org URL, first assessment 2021, effective May 2021 – Nov 2028, licence PUBLIC |
| Structural record (`ib-dp-groups-4-6.json`, `math-aa`) | components, marks, timings and assessment objectives only |
| Objective descriptions (`v2.ib.math-aa-hl`) | StudyUs blueprint text that cites the guide |
| Reviewed links (`OBJECTIVE_LEARNING_LINKS`) | catalogue rows labelled `DEV_FIXTURE / NON_OFFICIAL` |
| Certified classification `v2.ib.math-aa-hl/p1@step4b-pilot-1` | places `math.alg.quadratics` in `aahl.p1.functions` |

**No section, number or sentence of the guide's syllabus is stored**, so none is quoted, and none was recalled from memory.

| construct_id | existing StudyUs concept | proposed new StudyUs concept (prepared, not proposed) | IB paper | governed reference / locator | correspondence | applicability | confidence | status |
|---|---|---|---|---|---|---|---|---|
| tf.math.series.geometric-sum-to-infinity | — (`math.alg.patterns-sequences` is NARROWER) | `math.alg.geometric-series` | P1 | guide registered, locator NOT_HELD; objective `aahl.p1.algebra` text names "sequences and series"; link "Sequences and series" | PROPOSED → objective (StudyUs text) | NOT_ESTABLISHED | LOW (governance) | **BLOCKED** |
| tf.math.logarithms.equation-one-admissible-root | — | `math.alg.logarithms` | P1 | same; text names "logarithms" | same | NOT_ESTABLISHED | LOW | **BLOCKED** |
| tf.math.functions.inverse-function-value | — (`math.fun.functions` is BROADER) | `math.fun.inverse-functions` | P1 | same; `aahl.p1.functions` text names "rational functions, inverses" | same | NOT_ESTABLISHED | LOW | **BLOCKED** |
| **tf.math.quadratic.minimum-value** | **`math.alg.quadratics`** | — | P1 | certified placement `v2.ib.math-aa-hl/p1@step4b-pilot-1`, bucket `aahl.p1.functions#0`; text names "quadratics"; locator NOT_HELD | EXISTING → governed bucket | **ESTABLISHED** | MEDIUM (precedent) | **GOVERNED_BY_PRECEDENT** |
| tf.math.calculus.definite-integral-polynomial | — | `math.calc.definite-integrals` | P1 | same; `aahl.p1.calculus` text names "integration" | PROPOSED → objective | NOT_ESTABLISHED | LOW | **BLOCKED** |
| tf.math.calculus.area-between-curve-and-axis | — | `math.calc.definite-integrals` | P1 | same | same | NOT_ESTABLISHED | LOW | **BLOCKED** |
| tf.math.calculus.tangent-gradient-at-a-point | — | `math.calc.derivatives` | P1 | same; text names "differentiation" | same | NOT_ESTABLISHED | LOW | **BLOCKED** |
| tf.math.calculus.cubic-local-maximum | — | `math.calc.derivatives` | P1 | same | same | NOT_ESTABLISHED | LOW | **BLOCKED** |
| tf.math.probability.binomial-exact-probability | — (`math.prob.probability` is BROADER) | `math.prob.binomial-distribution` | P2 | same; `aahl.p2.statistics` text names "distributions"; link "Binomial distribution" | same | NOT_ESTABLISHED | LOW | **BLOCKED** |
| tf.math.probability.normal-symmetry | — | `math.prob.normal-distribution` | P2 | same; link "Normal distribution" | same | NOT_ESTABLISHED | LOW | **BLOCKED** |

All rows: `ib_subject` = Mathematics: analysis and approaches, `ib_level` = HL. The full field set is in the JSON.

**Why 9 are BLOCKED rather than proposed.** The rule is that a new StudyUs concept needs the governed IB source to support it clearly. The only content-level text in the repository is StudyUs's own objective description. It names the knowledge in all 9 cases, but it is not the IB source, and the IB source's own text is not held. Proposing the concepts on that basis would be a mapping backed by StudyUs text alone.

- The 7 candidate ids are **prepared** with labels and narrower/broader notes against existing concepts, ready for governance once the source exists.
- They use the StudyUs `math.<domain>.<slug>` convention, never an IB label.
- No IB Topic layer was created: the syllabus areas appear only as the vertical's existing `contentCategory` labels.

**Unblock:**
1. A governed, section-level extract of the official guide (`ibo-math-aa-guide-2021`, licence PUBLIC, URL already registered), as PAA has in `paa-hierarchy.ts`.
2. The StudyUs concept.
3. An applicability record for the component.

Reading the guide means downloading the PDF from the registered ibo.org URL. I have not done that without your go.

## Return

```
BATCH_ID = CF-IB-AAHL-01-R1
PROVIDER_SPEND_USD = 0
QUADRATIC_MINIMUM_SHORT_RESPONSE = PASS
SHORT_RESPONSE_CANDIDATES_CREATED = 30
DETERMINISTIC_VALIDATION = PASS (30/30; envelope sweep clean; key re-derived 30/30; preservation 30/30)
SCORER_PARITY = PASS (333/333 responses: Question Factory = canonical contract = Exam Core, en and es)
BANK_V3_COMPATIBILITY = PASS (projection 3, SINGLE, canonical-response-1, 0 content issues; Track B dry run 30/30 accepted, idempotent)
CONCEPT_CORRESPONDENCES_SOURCE_BACKED = 1/10
EXISTING_CANONICAL_CONCEPTS_REUSED = 1 (math.alg.quadratics)
NEW_STUDYUS_CANONICAL_CONCEPTS_PROPOSED = 0 (7 candidate ids prepared, all BLOCKED pending a governed guide extract)
BLOCKED_CONCEPTS = 9
IB_TOPICS_INVENTED = 0
DATABASE_WRITES = 0
DEPLOYMENTS = 0
PAA_FROZEN_BASELINE_MUTATED = NO
READY_FOR_TRACK_B_FIRST_IB_ITEM = YES
  (content side: package accepted 30/30 by Track B's own dry run; Track B still owns the parametric SHORT_RESPONSE
   render capability, envelope re-certification, publication to DEV and the DEV response)
```
