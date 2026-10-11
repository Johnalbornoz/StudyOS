# B2 — Blueprint & Question Selection Core — Certification

Date: 2026-10-10 · Worktree: `studyos-assessment-b1` · Branch: `feat/assessment-b2-blueprint-core`

## 0. Executive Result

```text
BLUEPRINT_CORE_PASS
```

One deterministic solver, three policy families, depth presets that are not counts, a read-only evidence-need
projection over the canonical policy, and a Q1 feasibility projection that runs the same solver. Nothing is
wired into a delivered runtime, no flag was read or changed, no migration was added, and B1's evidence /
mastery authorities are untouched.

Certification gate (18 / 18):

| # | Gate item | Result | Where it is proven |
|---|---|---|---|
| 1 | Three families share one architecture | PASS | `pipeline.ts` (3 pipelines, 1 `solveBlueprint`); `b2-readiness-architecture` |
| 2 | Policy is separate from the solver | PASS | solver imports no policy; no policy calls the solver (source guards) |
| 3 | Deterministic | PASS | shuffled-input tests, 25 seeds x 3 depths; slot mode 20 seeds; pipeline order tests |
| 4 | selected ⊆ eligible | PASS | invariant tests; ineligible questions never reach the solver |
| 5 | Multi-concept works | PASS | `B2 multi-concept coverage` |
| 6 | SUPPORTING / DERIVED not over-credited | PASS | supporting never satisfies DIRECT; derived never counts for a concept |
| 7 | Evidence sufficiency reuses canonical policy | PASS | `mastery_policies` row + `concept_knowledge_state`; no threshold constant in B2 |
| 8 | Depths are not fixed counts | PASS | presets contain no count; same depth → 1 or 3 questions on different banks |
| 9 | Count emerges | PASS | core scenario: QUICK 2, BALANCED 4, DEEP 4 + named deficits |
| 10 | Exam prep adapts without becoming official | PASS | gap objective 3 of 5 questions vs 2 of 22 official positions; no slots, no `official` |
| 11 | Official invariant to learner weakness | PASS | policy input has no learner state; two Students → identical plan and form |
| 12 | Generated learning questions never fill official slots | PASS | eligibility rejects the store; the solver's slot rule rejects it again |
| 13 | Honest non-ready results | PASS | PARTIAL / INSUFFICIENT_COVERAGE with a cause on every deficit |
| 14 | UNKNOWN not fabricated | PASS | unknown duration / difficulty / importance tests |
| 15 | Q1 feasibility uses the same core | PASS | feasibility numbers equal a direct `solveBlueprint` run |
| 16 | B1 evidence / mastery untouched | PASS | no write SQL, no `updateMastery`, B1 suites unchanged and green |
| 17 | No runtime cutover | PASS | nothing outside the module imports it |
| 18 | Tests / typecheck / build pass | PASS | 497 files / 8,843 tests; `tsc` clean; `next build` exit 0 |

## A. Baseline

| Item | Value |
|---|---|
| Start SHA | `cbb6b39f4b3fdbff1ce89ae1b06d62deb0ad831a` (`foundation/assessment-b1`, B1-E = `FOUNDATION_PASS` / `B2_GO`) |
| B2 branch | `feat/assessment-b2-blueprint-core`, cut from `cbb6b39` |
| End SHA | UNCOMMITTED (working tree; no commit was requested) |
| B1 ancestry | HEAD is `cbb6b39`; both B1 migrations (`20261108_1000`, `20261109_1000`) present, chain = 71 files |
| B1 suites before B2 | 211 tests green |
| T1 | `remediation/t1-micro-delta` advanced to `41e9676` (labels / presentation / docs only, no frozen-contract file). Not merged into B2, as instructed; it is a downstream integration item |
| Protected branches | `remediation/t1-account-profile`, `t1-final-delta`, `t1-micro-delta` not modified |

## B. Architecture

```
intent + learner state / exam facts / official positions
        │
   POLICY (per family)            policy/learning.ts · policy/exam-preparation.ts · policy/official-exam.ts
        │   BlueprintRequirement (B1 contract)  +  solver plan (constraints, never a count)
        ▼
   ELIGIBILITY (B1, hard)         evaluateQuestionEligibility, audience fixed to STUDENT
        │   only eligible QuestionCoverage → SolverCandidate
        ▼
   SOLVER (shared, pure)          solver/solve.ts  — TARGETS mode / SLOTS mode
        ▼
   RESULT                         BlueprintResult (B1 contract) + snapshot + diagnostics
```

Module `src/lib/assessment-blueprint/`:

| File | Role | IO |
|---|---|---|
| `solver/candidate.ts`, `solver/plan.ts`, `solver/solve.ts` | Candidate model, plan / outcome types, the solver | none |
| `policy/evidence-requirement.ts` | Evidence need per concept (projection of canonical state) | none |
| `policy/practice-depth.ts` | QUICK / BALANCED / DEEP presets | none |
| `policy/learning.ts`, `policy/exam-preparation.ts`, `policy/official-exam.ts` | The three policies | none |
| `pipeline.ts`, `result.ts` | Eligibility → solver → result; snapshot; shadow comparison | none |
| `readiness/feasibility.ts` | Q1 feasibility projection | none |
| `assessment-blueprint.service.ts` | Read-only loaders + orchestration | SELECT only |

The solver knows no family rule, depth or evidence concept; a policy never selects. Both directions are
enforced by source-guard tests.

## C. Shared Solver

**TARGETS mode (LEARNING, EXAM_PREPARATION)** — greedy multi-cover. Each round takes the candidate with the
best gain, compared lexicographically (never a weighted sum):

1. targets it covers that have no opportunity yet
2. the priority of those targets
3. required opportunities / DIRECT opportunities it adds
4. independent demonstrations it makes possible
5. new question types / difficulty levels
6. not recently seen, then never seen
7. closeness to the preferred difficulty band
8. shorter known duration
9. canonical key (`<store>:<id>`)

A candidate with no gain on 1–4 is never taken. A final pass removes any question whose removal leaves every
requirement as satisfied. Independent demonstrations are assigned by maximum bipartite matching, so one
question is the demonstration of at most one target.

**SLOTS mode (OFFICIAL_EXAM)** — maximum bipartite matching of blueprint positions to eligible reviewed
items (one item per template), free item first in preference order. An incomplete form selects nothing.

**Status.** READY = no unmet requirement. PARTIAL = something selected, deficits named. INSUFFICIENT_COVERAGE
= nothing selected, or the content cannot reach a target. A target left out only by the Student's own time
limit is PARTIAL, not a content shortfall.

**Determinism.** Candidates are put in canonical key order first; every comparison ends on the key; no clock,
randomness, environment or LLM is read (source guard). `asOf` is an explicit input of the evidence projection.

**Complexity.** N candidates, T targets, S selected: greedy O(S·N·T), matching O(S²·T), pruning O(S²·T).
Slots: O(P·E). Measured: 3,000 candidates × 40 concepts at DEEP solves READY in well under the 5 s test
bound, under 400 greedy rounds.

**Limit, stated plainly.** The greedy is a heuristic: it guarantees every reported requirement is met or
named, and no selected question is redundant, but it does not prove the set is the smallest possible.

## D. Coverage Semantics

| Source fact (B1 `QuestionCoverage`) | Solver strength | Counts as opportunity | Counts as DIRECT | Can be an independent demonstration |
|---|---|---|---|---|
| Concept role PRIMARY | DIRECT | yes | yes | yes (one target per question) |
| Concept role SUPPORTING | SUPPORTING | only where the policy accepts it | no | no |
| Concept role UNSPECIFIED (objective mapping) | DERIVED | no | no | no |
| Item's own learning objective | DIRECT on `OBJECTIVE:<id>` | yes | yes | yes |
| No canonical identity (UNRESOLVED / TRANSITIONAL) | none — not a candidate for a canonical target | — | — | — |

A selection states opportunities. It never states an amount of evidence: whether a response counts, and for
how much, remains the Learner State Authority's decision after the attempt.

## E. Evidence Sufficiency Projection

Reused, never restated:

| Canonical source | Fields read | Used for |
|---|---|---|
| `mastery_policies` (latest version) | `minimum_evidence_count`, `minimum_independent_evidence_count` | deficits |
| `concept_knowledge_state` | `mastery_state`, `validation_readiness`, `evidence_count`, `independent_evidence_count`, `next_review_at` | need level, retention due, transfer required |
| `CANONICAL_POLICY` (`pedagogical-engine/policy.ts`) | practice / prove / retention: independence, difficulty band, pass bar, novelty | activity semantics |

B2 adds one selection-only table: `NEED_PRIORITY` (NO_EVIDENCE 4, WEAK 4, DEVELOPING 3, STRONG 1; +1 for
retention due / transfer required / critical misconception, max 5). Priority orders the solver; it removes
no target. A concept the Student chose stays in scope even when mastered.

## F. Practice Depth

| Requirement | QUICK | BALANCED | DEEP | Source |
|---|---|---|---|---|
| Evidence deficit per concept | read | read | read | EXISTING_CANONICAL_POLICY |
| Independent deficit per concept | read | read | read | EXISTING_CANONICAL_POLICY |
| Activity independence; difficulty band | read | read | read | EXISTING_CANONICAL_POLICY |
| Opportunities per concept = clamp(deficit, floor, ceiling) | floor 1, ceiling 1 | floor 1, ceiling 2 | floor 2, ceiling 3 | B2_SELECTION_POLICY |
| DIRECT opportunities required | 0 | 1 | 2 | B2_SELECTION_POLICY |
| SUPPORTING counts as an opportunity | yes | yes | yes | B2_SELECTION_POLICY |
| Independent demonstrations (non-independent activity) | 0 | 0 | 1 | B2_SELECTION_POLICY |
| Independent demonstrations ceiling (independent activity) | 1 | 2 | 3 | B2_SELECTION_POLICY |
| Variety sought: types / difficulty levels (soft) | 1 / 1 | 2 / 2 | 3 / 3 | B2_SELECTION_POLICY |
| DERIVED coverage counts for a concept | no | no | no | B2_SELECTION_POLICY |
| Number of questions | not a policy value | not a policy value | not a policy value | — |

The table is also exported as data (`depthPolicyTable()`), so the report cannot drift from the code.

## G. Learning Blueprint

| Intent | Maps onto | Behaviour |
|---|---|---|
| CONCEPT_PRACTICE, TOPIC_PRACTICE, CUSTOM_CONCEPT_PRACTICE, MIXED_CUMULATIVE | PRACTICE | depth preset × evidence need |
| MASTERY_CHECK | PROVE | independence required → a dedicated demonstration per concept |
| RETENTION_CHECK | RETENTION_CHECK | canonical novelty → recently seen questions excluded outright |
| DIAGNOSTIC | DIAGNOSTIC_CHECK | one DIRECT look per concept, whatever the depth |

Limits: no new persisted activity type; `evidence.itemCount` is always null; targets are canonical concepts
only (a TRANSITIONAL or unlinked learner concept is reported as an unresolved target); with no resolvable
target there is no requirement and the result is INSUFFICIENT_COVERAGE. `topicTargets` resolves a node's
concepts within a structure version; a target outside a given scope is reported `NOT_IN_SCOPE`.

## H. Exam Preparation Blueprint

`priority(objective) = exam importance × learner gap × urgency`

| Factor | Values | Source |
|---|---|---|
| Importance | 3 / 2 / 1 by the objective's share of blueprint positions; unknown → 2, flagged | official blueprint; never the bank's own counts |
| Gap | HIGH 3 (3 opportunities), MEDIUM 2 (2), LOW 1 (1); no gap 1 (1) | published `ExamGapCandidate` severity |
| Urgency | ≤ 14 days 3, ≤ 45 days 2, else / unknown 1 | explicit days to exam |

Hard constraints: targets are objectives of this exam version only; a gap outside the exam is reported
`NOT_EXAM_RELEVANT` and never practised; exam version, section, licence, review and content class are
applied by eligibility before the solver; the Student's unreviewed cache is excluded unless the caller
explicitly allows it. `CLOSE_GAPS` targets gap objectives only. The requirement declares
`mayDeviateFromOfficialDistribution: true`, has no `official` block and no slots.

## I. Official Exam Blueprint

`buildOfficialBlueprint` takes the official positions and nothing about the learner. It states them as the
B1 requirement (`officialRequirementFromFormPositions`) and as one slot per position — none added, dropped,
merged or reweighted. Only REVIEWED_EXAM_BANK items that are mock-eligible for the exam version can fill a
position; slot type, difficulty range (an unknown difficulty is not assumed in range) and slot constraints
are honoured. Whether a complete form is FULL_MOCK, REDUCED_MOCK or not startable is B1's decision,
consumed through `officialAttemptDecision` → `deriveInstanceAttemptType`. The only learner-specific input is
exposure (prefer an item not yet seen among equally valid ones).

## J. Question Count

No plan, preset or requirement holds a count. The count is `selected.length`.

Core scenario — targets C1, C2, C4; Q1→C1 P; Q2→C1 P + C2 S; Q3→C2 P + C4 P; Q4→C4 P; learner with no evidence:

| Depth | Selected | Status | Why |
|---|---|---|---|
| QUICK | Q2, Q3 (2) | READY | one opportunity per concept; overlap covers three concepts with two questions |
| BALANCED | Q1–Q4 (4) | READY | two opportunities per concept, one DIRECT |
| DEEP | Q1–Q4 (4) | PARTIAL | bank exhausted; e.g. C2 lacks a second DIRECT question (`NOT_ENOUGH_CANDIDATES`) |

Same depth, different banks: QUICK needs 3 questions on three disjoint items and 1 on one item covering all
three. With a richer bank the counts are strictly QUICK < BALANCED < DEEP and DEEP is READY.

## K. Difficulty

The preferred band is the activity's canonical band (practice 2–4, prove / retention 3–4); exam preparation
imposes none; an official slot's range is hard. Difficulty is never rewritten. A candidate of unknown
difficulty is neither rewarded nor assumed in band: it can still be selected, and the outcome reports a
`DIFFICULTY_BAND` shortfall; in an official slot with a range it does not fit.

## L. Time

A time limit is hard and verified only against recorded durations. `estimatedSeconds` / minutes are the sum
of known durations, or null when any selected question has none — never an estimate. With a limit and no
recorded durations nothing is selected and every deficit carries `DURATION_UNKNOWN`. With durations, the
budget is respected, the highest-priority need is served first and the rest is reported `TIME_BUDGET`.

## M. Diversity

Soft, two dimensions: distinct question types and distinct difficulty levels, sought up to the preset's
figure. Reported as `QUESTION_TYPE_DIVERSITY` / `DIFFICULTY_DIVERSITY` shortfalls when the bank cannot give
it; never forced and never bought with the time budget. Official forms: one item per template (hard).

## N. Recent Exposure

Exposure is a per-Student fact (`usage_count`, `last_used_at`; recent = within `RECENT_EXPOSURE_DAYS` = 14
of the explicit `asOf`). Default: a strong preference — a recent question loses to an equivalent unseen one
but never outranks coverage; when it is the only way to cover a required target it is used and tagged
`RECENT_REUSE_REQUIRED`, with an `UNSEEN_QUESTIONS` shortfall. Hard exclusion only where the canonical
activity policy requires novelty (retention); then the deficit is `ONLY_RECENT_CANDIDATES`.

## O. Multi-Concept

- A question covering several targets is preferred, so overlap reduces the count (`AB` alone instead of `A` + `B`).
- SUPPORTING-only coverage cannot satisfy a DIRECT requirement (`ONLY_WEAKER_COVERAGE`).
- DERIVED coverage is not credited to a concept at all.
- One question is the independent demonstration of one concept only; a second concept needs its own question.
- DEEP asks for a dedicated demonstration per concept, so no concept rests on a shared question when a dedicated one exists.

## P. Explainability

Per selected question: `contributes[{targetKey, strength, counted[]}]`, `dedicatedTo`, `reasons[]`
(`COVERS_UNCOVERED_TARGET`, `ADDS_REQUIRED_OPPORTUNITY`, `ADDS_DIRECT_OPPORTUNITY`, `INDEPENDENT_DEMONSTRATION`,
`FILLS_OFFICIAL_SLOT`, `ADDS_DIVERSITY`, `RECENT_REUSE_REQUIRED`). Per deficit:

```json
{ "subject": "CONCEPT:C2", "requirement": "DIRECT", "missing": 1, "cause": "NOT_ENOUGH_CANDIDATES" }
{ "subject": "SLOT:1", "requirement": "SLOT", "missing": 1, "cause": "NO_ITEM_FOR_SLOT" }
{ "subject": "LEARNER_CONCEPT:lc-2", "requirement": "IDENTITY", "missing": 1, "cause": "UNRESOLVED_TARGET" }
```

Plus `eligibility{total, eligible, rejected-by-reason}`, the exam-preparation `weighting` rows, and a
snapshot (family, policy id / version, depth, curriculum, targets, candidate-set digest, learner-evidence
digest + `asOf`, selected, unmet, status). Diagnostics carry counts only — no question content, nothing
about the Student. The snapshot is built, not stored: persistence belongs to B3.

## Q. Readiness / Q1

`evaluateFeasibility` and `evaluateOfficialSlotFeasibility` (no Q1 UI was touched; nothing calls them yet):

| Metric | Meaning |
|---|---|
| `eligibleQuestions`, `rejected` | student-eligible count and reasons for the rest (fixtures / technical-demo excluded) |
| `unresolvedQuestions` | offered questions with no canonical concept |
| `coverage`, `coverageByTarget` | DIRECT / SUPPORTING_ONLY / DERIVED_ONLY / UNCOVERED per target |
| `diversity` | known difficulty levels and question types, and how many are unknown |
| `repeatSafeTargets` | targets with enough DIRECT questions for a second, non-repeating BALANCED practice |
| `depth.QUICK / BALANCED / DEEP`, `diagnostic` | solver status, questions needed, targets unmet, causes — dry run with a generic no-evidence learner |
| `durationKnown` | whether a total duration could be stated |
| `unfillablePositions` | official positions the reviewed bank cannot fill |

The projection has no Student, so per-Student cached questions never count as bank readiness.

## R. Data Gaps

From the B0-C DEV read-only pass (not re-queried in B2; B2 created no content):

| Gap | Effect on B2 outputs |
|---|---|
| 0 student-eligible reviewed exam items, 0 human reviews | exam preparation and official blueprints would return INSUFFICIENT_COVERAGE on DEV today |
| No item-level concept attribution; learning-cache questions are single-concept | on real data, exam-bank coverage of a concept is DERIVED only and multi-concept overlap does not yet occur — it is proven on fixtures |
| No estimated duration on any question | minutes are always null; any stated time limit yields `DURATION_UNKNOWN` |
| 207 / 460 objectives unmapped; 34 / 101 learner concepts unresolved | those targets are reported as unresolved, never guessed |
| Only Saber 11 Math has a DOCUMENTED blueprint distribution | elsewhere exam importance is neutral and flagged |
| No sources / licences on items | third-party provenance is rejected `LICENCE_UNKNOWN` |
| Empty prerequisite graphs; no score conversion | not used by B2 |

## S. Tests

| Suite | Tests |
|---|---|
| `tests/unit/b2-solver.test.ts` | 42 |
| `tests/unit/b2-policies-pipeline.test.ts` | 31 |
| `tests/unit/b2-readiness-architecture.test.ts` | 19 |
| **B2 total** | **92** |
| Full suite | 497 files / 8,843 tests, 0 failed (baseline 494 / 8,751) |
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx next build` | exit 0 |

One existing test was edited: `qb-student-delivery-policy.test.ts` lists the B2 service as a non-delivery
reader of `approved_items` (it lists current item ids for readiness; the one delivery rule is still applied
per item through `isEligible`). The guarded property is unchanged. During testing two solver refinements
were made: slot matching takes a free item before re-routing an earlier position, and a target cut only by
the time limit yields PARTIAL rather than INSUFFICIENT_COVERAGE.

## T. Runtime / Shadow Integration

| Item | State |
|---|---|
| Delivered runtime | unchanged — no route, action, page or service imports `assessment-blueprint` |
| Feature flags | none read, none changed (`EXAM_BLUEPRINT_V2` not enabled) |
| Migrations | none added; none applied |
| Evidence / mastery writers | untouched; B2 contains no write SQL |
| Shadow | `compareWithAssembledForm` can compare an existing assembled form with a B2 solution; it is pure and not invoked anywhere |
| Database | not queried in B2 (tests mock it) |

## U. B3 Readiness

B3 can consume: `solveLearningForStudent`, the three pure pipelines, `BlueprintSolution` (requirement,
result, snapshot, diagnostics, per-question `contributes` / `dedicatedTo` for evidence attribution),
`officialAttemptDecision`, and the feasibility projections.

```text
B3_GO_WITH_CONDITIONS
```

1. Apply migrations `20261108_1000` and `20261109_1000` (in that order) before any code that writes the new attempt types.
2. B3 owns snapshot persistence and must store the snapshot with the attempt it creates.
3. Evidence credit per concept is B3's decision; `contributes.strength` is an input to it, not a weight.
4. Commit the B2 working tree (18 files) before B3 branches from it.
5. Integrate `remediation/t1-micro-delta` (`41e9676`) downstream; it does not touch B2 files.

---

## V. B2-A — Blueprint Variants, Protected Pools & Hard Exposure

Date: 2026-10-10 · Branch: `feat/assessment-b2-blueprint-core` (on top of `896987f`, which merged the Q1/B1 integrated line). Extends the module; the solver, the three policies, the pipeline and every B1 file are unchanged.

```text
B2-A_PASS   (contracts and pure selection; nothing persisted, nothing wired to a runtime, no migration)
```

### V.1 What was added (`src/lib/assessment-blueprint/protected/`)

| File | Content |
|---|---|
| `blueprint-identity.ts` | Purpose `FULL` / `REDUCED` / `DIAGNOSTIC`; identity = exam version + purpose + form + revision (+ status); several variants and several forms per exam version; purpose vs verified fidelity vs stored attempt type may not contradict |
| `authority.ts` | Every requirement tagged `OFFICIAL` (needs a source) or `STUDYUS_POLICY` (needs a policy reference); reduced size, pool, exposure and diagnostic depth can never be tagged official |
| `pools.ts` | Six logical pools; pilot policy `ZERO_INTENTIONAL_OVERLAP` (one pool per item); sharing only for pairs a policy names; pool of each variant |
| `exposure-policy.ts` | Rule per pool: `PREFER_UNSEEN` (Practice) or `HARD_EXCLUDE_IF_EXPOSED` (the five protected pools) |
| `frozen-form.ts` | Frozen form: items, order, blueprint revision, purpose, pool, fidelity, digest; tamper check; disjointness; per-Student form eligibility |
| `protected-selection.ts` | B1 eligibility → pool rule → exposure rule → the existing official pipeline → B1 fidelity decision vs purpose → frozen form or named cause |
| `selection-unit.ts` | `ITEM` / `STIMULUS_GROUP` unit contract and validation (interface only) |
| `diagnostic.ts` | Diagnostic target plan: dedicated DIRECT questions per target, depth supplied by a StudyUs policy |

`assessment-blueprint.service.ts` gained one read-only loader, `loadReviewedBankExposure` (`exam_item_usage`; delivery of any version of a bank item exposes the item).

### V.2 Decisions

- **No schema.** Variants, pools and frozen forms are contracts in this phase. Persistence is needed only when real forms are assembled and when the Question Bank records an item's pool; both wait for content and for the Question Bank's schema. The migration chain still ends at `20261109_1000`.
- **Fixed forms are assembled for a named subject (`FIXED_FORM_SUBJECT`), never a Student**, because B1's requirement contract always names a subject.
- **A fixed form is not repaired per Student.** If any of its items was exposed to the Student, the form is ineligible for them and another form is offered.
- **Shortage causes are found by re-running the same solver** on wider candidate sets (all eligible; pool only), so the reported cause is the binding one.

### V.3 Deferred, stated as such

| Item | Status |
|---|---|
| Stimulus-group selection at runtime | `DEFERRED_TO_QB_SCHEMA` — a blueprint that needs a group gets no form (`STIMULUS_GROUP_FACTS_MISSING`) |
| Stimulus-group exposure | deferred with it (the interface rule exists: a group is exposed when any member is) |
| Answer-reveal exposure | `DEFERRED` — no source records it; delivery already counts as exposure |
| Q1 Diagnostic semantics (two independent PRIMARY observations) | `DEFERRED_TO_B3_AND_QB` |
| Topic and Exam Skill dimensions | deferred to the Curriculum Authority |
| Rights | unchanged: B2 consumes B1 eligibility. B1 still accepts a `PUBLIC` licence as deliverable; `PUBLICLY_ACCESSIBLE != REUSABLE` remains a B-track correction |

### V.4 Tests

`tests/unit/b2a-variants-pools-exposure.test.ts` (29 tests): scenarios A–H of the B2-A brief, purpose/fidelity contradictions, PAA Full (175 = 45+25+55+50) and Reduced (88 = 23+12+28+25) requirement **fixtures**, frozen-form integrity, unit contract, diagnostic hook, the exposure loader, and architecture guards.

| Run | Files | Tests | Failures |
|---|---|---|---|
| Before B2-A (`896987f`) | 497 | 8,843 | 0 |
| **After B2-A** | **498** | **8,872** | **0** |

`npx tsc --noEmit`: clean. `npx next build`: exit 0, 228 static pages.

## W. B2-B1 — Question Bank & B2 Persistence Schema

Implements migrations 1–8 of `B2B0_PERSISTENCE_AND_QUESTION_BANK_SCHEMA_DESIGN.md` under its six locked decisions, and corrects the B1 rights rule. Certified on an ephemeral database only. **Not applied to DEV.** No route, start path or existing reader uses the new schema.

### W.1 Migrations (forward-only, additive)

| # | File | Adds | Changes to existing data |
|---|---|---|---|
| 1 | `20261110_1000_qb_provenance_rights_content_sources` | provenance `STUDYUS_AUTHORED` (no generation lineage, human author, immutable); `assessment_sources.source_access`; `question_bank_content_rights`; `question_bank_content_sources` | backfill of `source_access` from `license_status` (`PUBLIC` → `PUBLICLY_ACCESSIBLE`), guarded: every row updated or the migration aborts |
| 2 | `20261110_1100_qb_asset_registry` | `question_bank_assets` (provider-agnostic), `question_bank_item_assets` | none |
| 3 | `20261110_1200_qb_stimuli` | stimuli, versions, ordered parts, item version → stimulus version | none (`content.stimulus.key` is not migrated) |
| 4 | `20261110_1300_qb_item_concept_attribution` | `question_bank_item_concepts` (PRIMARY / SUPPORTING, one PRIMARY, no weight), `question_bank_item_context_tags` | none |
| 5 | `20261110_1400_qb_pool_memberships` | `question_bank_pool_memberships` (six pools, one active per item or stimulus) | none |
| 6 | `20261110_1500_qb_review_authority_originality` | reviewer qualifications, checklist key / version, stimulus reviews, originality checks, approval safeguards | none; **behaviour**: approvals are refused without a valid qualification |
| 7 | `20261110_1600_assessment_blueprint_variants` | `purpose`, `form_number`, `revision`, `pool`; requirement and requirement-source tables | none; `UNIQUE (exam_version_id)` replaced by three narrower unique indexes |
| 8 | `20261110_1700_assessment_frozen_forms` | frozen forms, ordered positions, `exam_instances.frozen_form_id` (nullable) | none |

Not implemented, by decision: migration 9 (answer reveal) and migration 10 (curriculum-node link).

Rights layout (D2): one table keyed by `content_type` + `content_id`. The schema already uses typed polymorphic references (`target_type`, `resource_type`) and has no rule against them; a trigger checks that the referenced row exists, the referenced rows cannot be deleted, and rights records are append-only (a correction supersedes).

Two differences from the B2-B0 text: stimulus reviews live in `question_bank_stimulus_reviews` instead of a nullable column on `question_bank_reviews`; and legacy blueprints keep `form_number` and `revision` NULL (no default of 1), so nothing is implied about them.

### W.2 Rights rule (B1)

`evaluateQuestionEligibility`: for the Student audience a reviewed-bank item needs a rights record in force with `STUDYUS_OWNED`, `LICENSED_FOR_USE` or `OFFICIALLY_AUTHORIZED`, for the item version and for its stimulus version and every asset. No record, `UNKNOWN` and `PROHIBITED` fail. The licence status of a cited source is no longer read; `PUBLIC` grants nothing. The rule applies to every provenance class, StudyUs content included.

Consequence on today's data: no item has a rights record, so no reviewed-bank item is eligible through B1 for a Student. B1 eligibility is consumed only by the B2 pipeline, which no runtime path calls, so nothing delivered today changes.

Coverage now also carries item-level attribution (`ITEM_ATTRIBUTION`), the stimulus and asset facts, and rights. `loadReviewedBankPoolAssignments` reads pool membership for B2. Both loaders return "no fact" on a database without the schema.

### W.3 Ephemeral certification

`scripts/operations/b2b1-persistence-schema-cert.sh` (local temporary Postgres 18):

| Check | Result |
|---|---|
| From zero: baseline + all 79 migrations through the governed runner | 80 applied, 0 pending, 0 drift |
| DEV-equivalent: 71 migrations, seeds (410 fixtures, 80 blueprints, 167 concepts, 343 mappings, 99 sources), then the eight on populated data | applied; every legacy row identical before and after (hash comparison) |
| Schema invariants (`b2b1/schema-invariants.sql`), each phase | 153 pass |
| Loaders against the real database, schema absent / present | 4 / 15 pass |
| Seeds re-run on the new schema | unchanged |
| Second runner pass | nothing pending |
| Rollback of the eight in reverse (`b2b1/rollback.sql`), then re-apply | legacy state restored; 0 pending |

Limits of this certification: the ephemeral seed has 410 fixtures, no generated item, no review and no exam instance, where DEV has 477 fixtures, 19 generated items, 509 versions and real attempts. Read-only checks on DEV found no name collision, 122 sources all `PUBLIC`, one blueprint per version and 0 reviews. The pre-existing chain certification passes steps 1–9 on the new schema and stops at step 10 on a script that starts a `FULL_MOCK` directly, which application code has refused since B1-E; that failure does not involve this schema.

### W.4 What the rollout changes for operators

- Approving any item needs a reviewer qualification (canonical subject × exam family) for a person who is not the author. No qualification exists anywhere.
- An item can be approved only when its subject is determinable: a PRIMARY concept, or a published concept mapping on its objective. On DEV, 3 of the 11 versions under review meet this (the PAA candidates); the 8 Saber candidates do not until they are attributed or their objectives are mapped.
- `qb-v2-integration.ts`, `track-b-question-bank-migration-cert.sh` and `qb-pilot-saber11.ts` insert approving reviews and will need a qualification grant step.
- Before the first variant blueprint is inserted, the 17 existing blueprint readers must filter `purpose IS NULL`.

### W.5 Tests

`tests/unit/b2b1-persistence-schema.test.ts` (25 tests). Seven existing files updated: helpers carry a rights record; licence-based cases became rights-based; migration-chain assertions name the eight new files.

| Run | Files | Tests | Failures |
|---|---|---|---|
| Before (`5c69222`) | 498 | 8,872 | 0 |
| **After B2-B1** | **499** | **8,897** | **0** |

`npx tsc --noEmit`: clean. `npx next build`: exit 0.

### W.6 Pre-rollout hardening (B2-B1R1)

- **Review governance locked.** Migration 6 is not weakened: no bypass flag, no override, no legacy exemption, no automatic qualification. An item whose subject cannot be determined cannot be approved until its attribution or its objective mapping is repaired (`SABER_APPROVALS_WITHOUT_SUBJECT = BLOCKED_BY_DESIGN`).
- **`STUDYUS_AUTHORED` propagated** to `policy.ts` (`PROVENANCES`, origin `AUTHORED`, `needsHumanApproval`), `health.ts`, `mock-certification.ts`, `content-origin.ts` and the identity backfill in `bank.service.ts`. Authored content is certifiable and counts as real content; like generated content it needs a human approval before it counts. Generated never becomes authored. Fixtures stay ineligible. No eligibility rule changed.
- **Platform chain certification repaired.** The G6 script now asserts that a direct `FULL_MOCK` start is refused and writes nothing (B1-E), and runs its attempts as `MINI_MOCK`. Application behaviour is unchanged. Chain result: 12 of 12 steps, G6 35/35, Journey 29/29, Human Agency 26/26.
- Re-certified after these changes: tsc clean; 499 files / 8,900 tests; schema certification unchanged (153 invariants per phase, loaders 4 / 15, rollback and re-apply); build exit 0.

### W.7 DEV schema rollout (B2-B1R1, 2026-10-10)

DEV only. Stage and Production were not touched.

| Fact | Value |
|---|---|
| Implementation commit | `ae00fdc` |
| DEV fingerprint | `2a29b99ee14a22b4` |
| Migrations applied | `20261110_1000` … `20261110_1700` (8 of 8), governed runner (`npm run db:migrate`) after an exact dry-run |
| Ledger | 80 applied, 0 pending, 0 drift (was 72, latest `20261109_1000`) |
| Sources | 122 of 122 `PUBLIC` → `source_access = PUBLICLY_ACCESSIBLE` |
| Rights records created | 0 — source access is not a right to reuse |
| New content-carrier and B2 tables | all empty (rights, content sources, assets, stimuli, versions, parts, item links, item concepts, context tags, pool memberships, reviewer qualifications, stimulus reviews, originality checks, blueprint requirements, requirement sources, frozen forms, positions) |
| Review governance | active: 0 qualifications, so no approving review can be recorded until qualifications are granted (`APPROVAL_CAPABILITY = LOCKED_UNTIL_QUALIFICATIONS_GRANTED`); `SABER_APPROVALS_WITHOUT_SUBJECT = BLOCKED_BY_DESIGN` |

Legacy preservation, compared by hash before and after: 168 canonical concepts (224 labels; PAA 61 of 61 bilingual); 373 published and 5 retired objective→concept mappings; 496 items (477 fixture, 19 generated) and 509 versions; 11 versions under review unchanged (3 PAA, 8 Saber); 0 reviews; 92 blueprints, all with `purpose` NULL; 6 exam instances, 16 exam attempts, 12 simulation attempts, none with a frozen form.

Rights rule evaluated read-only over the 496 current versions: 0 eligible for a Student, 0 with a rights record, all report `REUSE_RIGHTS_NOT_ESTABLISHED`.

Open before the first variant row is inserted: the existing blueprint readers must filter `purpose IS NULL`.

## X. B2-B2 — Persistence Adapters & Runtime Preparation

Date: 2026-10-10 · Branch `feat/assessment-b2b2-persistence-adapters` (from `47ba817`). No migration, no route, no start path, no feature flag, no Student-facing flow. Every variant, form, stimulus and item used is a fixture inside a test or inside the ephemeral certification.

### X.1 What was built

| Marker | Where | Content |
|---|---|---|
| `BLUEPRINT_READERS_HARDENED` | 15 files under `src/` (X.3) | Every existing reader names the legacy blueprint (`purpose IS NULL`); a variant and its targets cannot reach an existing flow |
| `QB_CARRIER_ADAPTERS` | `assessment-foundation/question-coverage(.service).ts` | B1 `StimulusFact` gained `kind` and `selection` (`{minItems, maxItems}` or null = whole), read in the existing stimulus statement. Read-only; no second reader |
| `STIMULUS_GROUP_RUNTIME` | `protected/selection-unit.ts`, `protected/protected-selection.ts` | Units derived from coverage; groups selected whole (or a subset), adjacent and in order; `STIMULUS_GROUP_RUNTIME_SELECTION = 'UNITS_FROM_QB_COVERAGE'` |
| `PROTECTED_POOL_RUNTIME`, `HARD_EXPOSURE_RUNTIME` | `assessment-blueprint.service.ts` (`loadProtectedSelectionInputs`, `loadReviewedBankStimulusExposure`), `protected/protected-runtime.ts` (`assembleProtectedForm`) | One read-only entry point for coverage, pools and exposure; a pure function from a stored variant and those facts to a form |
| `B2_PERSISTENCE_ADAPTERS`, `FROZEN_FORM_RUNTIME` | `protected/blueprint-persistence.service.ts`, `protected/persistence-errors.ts` | Draft variant with requirements and sources, publish, load and check; draft frozen form with positions, publish with hash, load and verify; typed refusals |
| Diagnostic | `protected/protected-runtime.ts` (`protectedDiagnosticSelection`) | The Diagnostic plan and its candidates from the DIAGNOSTIC pool with hard exposure. `Q1_DIAGNOSTIC_FULL_SEMANTICS = 'DEFERRED_TO_B3'` |

`authority.ts` gained the requirement kind `STIMULUS_SET` (already in migration 7) with a strict value `{kind, sets, minItems, maxItems}`. `solver/solve.ts` exports `fitsSlot`; nothing else in the solver changed and `pipeline.ts` still calls `solveBlueprint(` three times.

### X.2 Decisions

- **Group membership.** A unit is the current item versions linked to the current version of one stimulus, in `question_bank_item_stimulus.position` order; its pool is the stimulus's. A question linked to a non-current stimulus version belongs to no unit.
- **Stimulus-bound questions are never loose items.** They are selectable only through their group and only for a `STIMULUS_SET` requirement. A variant without such a requirement takes no group.
- **WHOLE / SUBSET.** No range on the stimulus version = WHOLE: one unusable member makes the group unusable. A range = SUBSET: the unit holds the usable members in order and is usable while at least `minItems` remain; `maxItems` is capped at what remains.
- **Subset rule.** The questions taken are always the first *n* usable members in position order (a prefix), with *n* the largest value allowed by the group rule, the requirement and the positions. An unusable member in the middle is skipped; the form records the true place of each question (`unitPosition`).
- **Placement.** Deterministic and greedy, not exhaustive: requirements in key order, groups by unit id, the earliest run of adjacent free positions of one section whose slots the questions fit one by one (the solver's own slot rule). The shared solver then fills the remaining positions with standalone questions. If a requirement is not served the form is `NOT_AVAILABLE`; nothing smaller is substituted. A group that an exhaustive search could have placed may be reported as not placeable.
- **Shortage causes** are found as before, by assembling again on wider sets (all eligible; pool only). The cause `STIMULUS_GROUP_FACTS_MISSING` was replaced by `UNIT_REQUIREMENT_INVALID` (a malformed requirement); a group the bank cannot provide is `INSUFFICIENT_ELIGIBLE_ITEMS` with the shortfall listed in `units`.
- **Group exposure.** A group is exposed when any current member is, or when the delivery ledger shows the Student met the stimulus through any version of any question ever linked to any of its versions. Under a hard rule the whole group is excluded; a published fixed form holding it is not offered.
- **Frozen form digest.** `FROZEN_FORM_VERSION` is 2: the digest covers slot, item, stimulus version and place in group. A form whose group is split or out of order is refused even with a matching digest.
- **Hash mapping.** `assessment_frozen_forms.form_hash` stores the pure `formHash` verbatim (SHA-256, 64 lowercase hex). On publish the adapter recomputes the digest from the stored rows and refuses a different one; on load `frozenFormIntact` runs on the rebuilt form.
- **Writers run inside the caller's transaction**, each under a savepoint: a refusal undoes that call only. Outside a transaction they refuse before writing (`TRANSACTION_REQUIRED`). The commit-time check "an OFFICIAL requirement cites a source" is asked inside `createDraftVariant`.
- **Mapping of the pure contract.** `subject` ↔ `assessment_component_id` by `section_key` (or id); `sourceRefs` ↔ `assessment_sources.source_key`; an unknown key is refused and no source is created. Requirements load in key order (the table records no other).
- **Pool of a variant.** The adapter refuses a pool other than the one `poolForBlueprint` gives the purpose and form; a stored variant whose pool disagrees is refused at selection.
- **Rights.** No rights rule exists in B2. Candidates come only through `eligibleSolverCandidates` → B1 `evaluateQuestionEligibility`.
- **Architecture test.** Mutation SQL is allowed in exactly one B2 file, the persistence adapter, and only against the five B2-owned tables; it reads and writes no `question_bank_*` table.

### X.3 Hardened readers

| File:line | Query | Change |
|---|---|---|
| `app/api/diagnostics/preview-db/route.ts:180` | count of published blueprints | `AND purpose IS NULL` (a published variant would inflate the count) |
| `lib/assessment/blueprint.service.ts:89` | `getBlueprintForVersion` | `AND purpose IS NULL` |
| `lib/assessment/blueprint.service.ts:41` | `publishBlueprint` (by id) | `AND purpose IS NULL`: cannot publish a variant |
| `lib/assessment/blueprint.service.ts:36` | `createBlueprint` insert | unchanged: inserts a legacy row; documented |
| `lib/exam-core/catalog.service.ts:128` | areas and objectives of a version | filter in the `LEFT JOIN` |
| `lib/exam-core/exam-gaps.service.ts:56` | domain of a gap, through targets | filter in the join |
| `lib/exam-core/catalog/structure.service.ts:323` | focus objectives of a node | filter in the join |
| `lib/exam-core/question-bank/health.service.ts:59` | bank-health universe (`META_SQL`) | filter in the join |
| `lib/exam-core/objectives/preparation.service.ts:82, 292, 408, 572` | bridge mappings, requirements, shared concepts, add-concept check | filter in the join |
| `lib/learning-plan/exam-bridge.service.ts:276` | plan targets of exam versions | `AND b.purpose IS NULL` |
| `lib/assessment-blueprint/assessment-blueprint.service.ts:119` | readiness targets | `AND b.purpose IS NULL` |
| `lib/institution/intelligence-context.service.ts:88` | exams covering a subject | filter in the join |
| `lib/teacher/class-progress.service.ts:205` | versions covering a class subject | `AND b.purpose IS NULL` |
| `lib/exam-core/catalog/learning-links.service.ts:78` | objectives of published versions | `to_jsonb(b) ->> 'purpose' IS NULL` |
| `lib/exam-core/question-bank/bank.service.ts:237` | exam version of origin for bank identity | `to_jsonb(b) ->> 'purpose' IS NULL` |
| `lib/exam-core/apply-vertical-config.service.ts:281` | existing blueprint of a version | `to_jsonb(b) ->> 'purpose' IS NULL` |
| `lib/exam-core/apply-vertical-config.service.ts:142, 250` | insert, publish by id | unchanged: the legacy row it just inserted; documented |
| `lib/assessment/pilot-catalog-seed.service.ts` | via `getBlueprintForVersion` / `createBlueprint` | covered by those |

The three `to_jsonb` sites are a deviation from "reference `purpose` directly": the catalogue apply and the learning-link writer are run by `b2b1-persistence-schema-cert.sh` (Phase B) on the schema before `20261110_*`, where the column does not exist. The expression is NULL for a legacy row and where the column is absent, so that certification still passes unchanged.

Operator scripts changed (one line each): `track-b-objective-first-scenarios.ts:229`, `track-b-objective-first-manual-fixture.ts:52`, `track-b-exam-scenarios.ts:382`, `track-b-v2-scenarios.ts:292`, `track-a-learning-plan-e2e-http.ts:199, 223`.

Not changed, to be decided by their owners: `qb-v2-integration.ts:164`, `f7-lifecycle-cert-runner.ts:65`, `qb-mock-certification.ts:81`, `exam-platform-v2-integration-cert.ts:42`, `g6-exam-evidence-isolation-cert.ts:77, 131, 204` (all invoked by migration-chain certification scripts; whether they run on a partially migrated schema was not verified) and the SQL inside `track-b-question-bank-migration-cert.sh`.

Left unfiltered in `src/`, because they read `blueprint_objective_targets` without joining the blueprint: `simulation/post-exam-diagnosis.service.ts:43` (skill and command term of an objective in a component) and `question-bank/review.service.ts:53` (whether an objective is in any target). A variant with targets of its own would be visible to both. `blueprint.service.ts:95, 100` and `health.service.ts:80` read targets by a blueprint id they were given.

`tests/unit/b2b2-legacy-blueprint-readers.test.ts` fails when a statement under `src/` reads `assessment_blueprints` without the filter, unless its file is on a list with a reason (the persistence adapter; the three schema-tolerant writers), and when the set of reader files changes.

### X.4 Certification

`scripts/operations/b2b2-persistence-adapters-cert.sh` (ephemeral Postgres 18 on 127.0.0.1: baseline, all 79 migrations, seeds; one transaction, rolled back): 49 checks pass; the database is identical before and after; the seeds re-run unchanged.

It creates authored fixture items, a three-question passage, rights, reviews by a reviewer with a granted qualification and pool memberships; a variant DRAFT → PUBLISHED with five requirements; a second revision; a frozen form DRAFT → PUBLISHED, read back and verified. It calls `getBlueprintForVersion`, `listVersionAreas`, `listBankVersions` and `evaluateExamVersionReadiness` before and after the variant exists (the variant also carries a target on a foreign objective): results are identical, and a control query shows that without the filter three blueprints and one more objective would be seen. Database refusals reached and mapped: `VARIANT_IDENTITY_TAKEN`, `PUBLISHED_REVISION_EXISTS`, `ASSESSMENT_BLUEPRINT_REQUIREMENTS_FIXED`, `ASSESSMENT_FROZEN_FORM_IMMUTABLE`, `PUBLISHED_FORM_EXISTS` / `FORM_HASH_TAKEN`, `ASSESSMENT_FROZEN_FORM_STIMULUS_MISMATCH`, `ASSESSMENT_FROZEN_FORM_NEEDS_PUBLISHED_BLUEPRINT`. The item with a `PUBLICLY_ACCESSIBLE` source and reuse `UNKNOWN` is rejected by B1 and absent from every form, including when it is the only item that would complete one. One delivery of one group question excludes the three for that Student.

| Run | Files | Tests | Failures |
|---|---|---|---|
| Before (`47ba817`) | 499 | 8,900 | 0 |
| **After B2-B2** | **502** | **8,952** | **0** |

New: `b2b2-selection-units-runtime` (26), `b2b2-persistence-adapters` (19), `b2b2-legacy-blueprint-readers` (5); two tests added to existing files. Updated: `b2-readiness-architecture`, `b2a-variants-pools-exposure` (deferral assertions, form version 2), `b2b1-persistence-schema` (stimulus fixture; list of files that name the new tables).

`npx tsc --noEmit`: clean. `b2b1-persistence-schema-cert.sh`: passes unchanged (153 invariants per phase, loaders 4 / 15, rollback and re-apply). `npx next build`: exit 0.

### X.5 Still deferred

| Item | Status |
|---|---|
| Slot positions of a variant | Not persisted by the adapter and not read for a variant: `assembleProtectedForm` takes the positions from the caller. `blueprint_objective_targets` rows of a variant have no writer or reader |
| Fidelity of a variant's form | Supplied by the caller (B1 `classifyExamFormFidelity`); nothing computes it for a variant |
| Start path | No instance is created from a frozen form; `exam_instances.frozen_form_id` is not written |
| Retiring a variant or a form | No adapter function |
| Answer-reveal exposure | `DEFERRED` |
| Q1 Diagnostic semantics | `DEFERRED_TO_B3`. The Diagnostic selection leaves stimulus-bound questions out |
| Exhaustive group placement | Greedy only (X.2) |
| Stale item–stimulus links | Units read current item versions; a superseded item version still linked to the current stimulus version is not seen |
| Reviewer qualifications, real content, real variants | None exist; operator decisions |


Added at review: `simulation/post-exam-diagnosis.service.ts` and `exam-core/question-bank/review.service.ts` read `blueprint_objective_targets` without the blueprint; both now join the legacy blueprint (`purpose IS NULL`), so a variant's targets cannot reach them. Deployment order: this code reads `assessment_blueprints.purpose`, so migration `20261110_1600` must be applied to an environment before the code is deployed there.
