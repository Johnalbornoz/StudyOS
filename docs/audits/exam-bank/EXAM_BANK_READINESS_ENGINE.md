# Exam Bank Readiness Engine: one governed readiness authority

Track B · 2026-10-14 · PAA pilot baseline FROZEN at `610d3c6`. Nothing on this page changes PAA behaviour.

**Status**

| Item | Status | Where |
|---|---|---|
| EXAM_BANK_READINESS_ENGINE | **IMPLEMENTED** as a pure module | `src/lib/exam-bank/readiness/bank-readiness.ts` |
| BANK_DEPTH_METRICS | **IMPLEMENTED** | same module |
| EXPOSURE_METRICS | **IMPLEMENTED** | `exposure.ts` and the Student depth inside the engine |
| Certification vs deliverability | **IMPLEMENTED** | `certification-state.ts` |
| Difficulty calibration | **IMPLEMENTED** as a pure module | `difficulty.ts` |
| Tests | 17 | `tests/unit/exam-bank-readiness-engine.test.ts`, synthetic supply only |
| READINESS_SINGLE_AUTHORITY | **NO**, not yet | The authority exists. The live consumers (§2) still decide on their own. Rewiring them would change PAA catalogue, cards, mock and readiness behaviour, which the freeze forbids. Adoption plan in §8. |

---

## 1. Pipeline

```
Assessment System / Version / Profile / Component
          |
Governed Blueprint (blueprintId, blueprintVersion) -> buckets (requiredPositions, allowedFormats)
          |
Supply rows mapped to buckets  --deliverabilityOf-->  RUNTIME_DELIVERABLE | CERTIFIED_NOT_DELIVERABLE | NOT_CERTIFIED
          |            certification (scope) . lineage . rights . render . score . stimulus . retired . blueprint
          |
Mode requirements (calibrated difficulty, minimum form depth)
          |
One position per item (water-filling across multi-bucket rows)
          |
Coverage . depth . repeatability . exhaustion . overlap . Student exposure
          |
READY | PARTIAL | NOT_READY  + reasonCodes, blockingReasons, warnings
          |
catalogue . exam-prep cards . section practice . mock . Admin health . coverage reports . automation
```

**Fail-closed rules**

- Each of the following is a reason, never a pass:
  - an empty blueprint;
  - an invalid bucket;
  - a format the runtime cannot render or score;
  - a stimulus the runtime cannot present;
  - rights that are not CLEARED;
  - incomplete lineage;
  - a pilot certification outside its scope;
  - a broken inheritance;
  - a missing calibration for a mode that needs one.
- **A raw item count is never readiness.** 50 certified items in one bucket cannot hide an empty bucket. That case is tested.

## 2. Current readiness deciders (audit)

| # | Surface | Decides from |
|---|---|---|
| A2/A3 | `delivery-scope.ts` `certifiedSupplySql` / `certifiedItemsNoLongerEligible` | lineage class + scope views |
| A5/A6 | `question-bank/lifecycle.ts` `isEligible` / `lifecycleSqlFor` | lifecycle, usage, alignment (SQL twin omits current-version / retired / provenance) |
| A7/A8 | DB `assessment_item_instance_refusal`, `exam_bank_pilot_deliverable_versions` | certification, rights, envelope, scopes, pilot environment row |
| A9 | `assessment-foundation/question-eligibility.ts` | A5 + reuse rights + stimulus/asset |
| A10 | `exam-bank/bank-projection.ts` `projectionRefusal` | NUMERIC_ENTRY only; refuses work marked on working |
| B1–B3 | `catalog/readiness.ts`, `structure.service.ts`, `readiness-view.ts` | **static vertical config** (SHADOW) |
| B4/B5 | `capability-overlay.service.ts` (`QUESTION_BANK_READINESS_MODE`) | health snapshot overlay (ENFORCE) |
| B6/B7 | `question-bank/health.service.ts`, `health.ts` | assembly proofs, no exposure, scope of the computing process |
| B8/B9 | `structure.service.ts` `offeredModes` / `resolveExamLevel` | Challenge removed unless C7 |
| B10/B11 | catalogue tree, `dashboard/exams/page.tsx` | persisted rows, no overlay |
| C2/C4 | `objectives/capabilities.ts` → `PreparationHome.tsx` | overlay; no Challenge filter |
| C6/C6b | `assessment-experience.service.ts` → `views.ts` | `officialForm: null` hard-coded |
| C7 | `examVersionHasCalibratedDifficulty` | any `difficulty_index` present |
| C8 | `simulation/eligibility.service.ts`, `full-mock-guard.service.ts` | one item per objective; mapping-only objectives treated as deliverable |
| D1–D5 | `exam-instance.service.ts`, `form-fidelity.ts` | pool without rights / `exam_version_id`; Challenge always startable |
| E | `admin.service.ts`, `paa-coverage.ts`, `mock-certification.ts` | different snapshots and counts |

### Disagreements found (input for the adoption plan; none fixed during the freeze)

1. **The "Simulacro reducido" card contradicts itself on one page.**
   - `PreparationHome` offers the mock.
   - `CanonicalExamAvailability` always says unavailable, because of `officialForm: null`.
   - This is PAA-FOLLOWUP-01.
2. **SHADOW readiness comes from static config, while the runtime pool comes from the database.**
3. **The ENFORCE overlay is applied unevenly.** The catalogue tree and deep link do not use it; the instance API and capabilities do.
4. **Health snapshots do not record the delivery scope.** A PILOT_PREVIEW snapshot can be read by a PRODUCTION server.
5. **Challenge has five different gates, and "calibrated" has three meanings.**
   - The meanings: an index is present (C7); `calibration_confidence ≥ MODERATE`; EMPIRICAL with n ≥ policy (this engine).
6. **A missing `difficultyIndex` is read as 1.0** (`form-assembly.ts`). An uncalibrated MOCK form therefore "meets" the official difficulty band.
7. **Rights are enforced by Blueprint Core (A9) but not by the Exam Core pool for LEGACY items.**
8. **The item universes differ.** One side counts by `exam_version_id` bank rows, the other by `learning_objective_id`.
9. **The legacy full-mock guard counts objectives that have only mappings as deliverable**, through runtime AI.
10. **`contentCertified` and the result label count PILOT_CERTIFIED without checking scope.**
11. **Mock Certification `mockReady` is computed but read by no offer or launch path.**
12. **`paa-coverage.ts` counts eligible items against positions, but mock assembly applies more constraints.** The two can disagree.
13. **Empty PRACTICE slots fall back to the runtime generator** (`item-sourcing.service.ts`).
14. **The certification vocabulary drifts** between SQL, `v52/certification-policy.ts`, `speed-strategy.ts` and this module. §5 normalises it.
15. **Pilot scope is declared twice**: by the env var and by the database row.
16. **Exposure identity differs.** Exam Core counts the version; Blueprint Core counts the bank item and its siblings; health ignores exposure.

## 3. Output contract (`ExamBankReadiness`)

| Field | Meaning |
|---|---|
| `status` | `READY`: every position is covered and the form depth meets the mode minimum. `PARTIAL`: some positions are covered and at least one bucket is short. `NOT_READY`: nothing is covered, or the blueprint is empty or invalid, or the mode needs a calibration that is missing. |
| `reasonCodes` | Every reason observed, including reasons that excluded rows without blocking. |
| `blockingReasons` | The reasons that explain why the status is not READY. A per-row exclusion blocks only when it is why a bucket is short. |
| `warnings` | `LOW_REPEATABILITY`, `REPEATS_EXPECTED_NEXT_FORM`, `STUDENT_SUPPLY_EXHAUSTED`, `CERTIFIED_NOT_DELIVERABLE_PRESENT`. |
| `requiredPositions`, `coveredPositions`, `missingBuckets` | Blueprint coverage. |
| `certifiedItemCount` | Rows in the blueprint whose certification is valid or out of scope. |
| `runtimeEligibleItemCount` = `effectiveItemCount` | Runtime-deliverable rows for this blueprint and mode. Each counts once. |
| `uniqueFormDepth` = `repeatabilityDepth` = `minimumBucketDepth` | The number of disjoint complete forms: min over buckets of ⌊eligible / required⌋. |
| `bucketExhaustion` | Buckets ordered by the form after which they run out. |
| `expectedOverlapNextForm` | Share of positions the next form must repeat: after one prior form in general, or after this Student's exposure when one is given. |
| `studentEffectiveDepth` | Disjoint forms left using only never-exposed supply. |
| `scoringCapability`, `stimulusCapability`, `difficultyCapability`, `rightsStatus`, `certificationStatus` | `FULL`, `PARTIAL`, `NONE` or `NOT_REQUIRED`, across the blueprint's rows. |
| `certifiedNotDeliverableCount` | Certified rows the runtime may not deliver here. |
| `buckets[]` | Per bucket: certified count, eligible count, depth, covered positions, distinct stimuli, Student unexposed count and depth, and exclusions by reason. |
| `engineVersion` | `exam-bank-readiness-1`. Snapshots must store it **together with the delivery scope** (fixes disagreement 4). |

### Mode requirements (`MODE_REQUIREMENTS`)

| Mode | Calibrated difficulty | Minimum depth | Target depth |
|---|---|---|---|
| SECTION_PRACTICE | no | 1 | 3 |
| DIAGNOSTIC | no | 1 | 2 |
| MOCK | no | 1 | 3 |
| CHALLENGE | **yes** | 1 | 2 |

Items existing does **not** make Challenge READY. Challenge is NOT_READY with `CALIBRATION_REQUIRED` until enough rows hold a governed EMPIRICAL calibration. This is tested.

## 4. Depth and repeatability metrics

| Metric | Definition |
|---|---|
| `certified_item_count` | certified rows (any scope) mapped to the blueprint |
| `runtime_eligible_item_count` | rows RUNTIME_DELIVERABLE for this blueprint, scope and mode; one position each |
| `effective_bucket_depth` | ⌊eligible_b / required_b⌋ |
| `minimum_bucket_depth` / `unique_form_depth` | min over buckets of effective depth: disjoint full forms |
| `expected_overlap_next_form` | Σ_b min(covered_b, max(0, required_b − fresh_b)) / Σ required, where fresh = eligible − required (general) or never-exposed (Student) |
| `bucket_exhaustion` | buckets sorted by depth (first exhausts first) |
| Student-specific depth | ⌊unexposed_b / required_b⌋, minimised over buckets |

**Limitations, stated:**

- Depth is item-level.
- Stimulus sets, where a passage carries N items across buckets, are reported as `distinctStimuli`. Set-level depth is left for later: a passage is consumed whole.
- Assembly constraints beyond bucket and format, such as template diversity and difficulty bands, are not modelled. The health engine's assembly proof (B7) remains the stricter check for MOCK until it is migrated.

## 5. Certification and publication states (normalised)

| State | Meaning | Deliverable? |
|---|---|---|
| `HUMAN_CERTIFIED` | A named human reviewer certified exactly this content under a recorded policy. | Yes, if capability, rights, lineage and blueprint all pass. |
| `AUTOMATED_CERTIFIED_PILOT` | A versioned automated policy certified exactly this content, rule by rule. Example: `PAA_PILOT_CERT_POLICY_V1`. Valid in **PILOT_PREVIEW** only, unless an explicit production release exists (`assessment_production_releases`). | In scope only. |
| `INHERITED_DETERMINISTIC` | A deterministic derivation (core → adapter → renderer) of certified content. It inherits while every digest in the chain matches. In SQL it is the **mode** `INHERITED_DETERMINISTIC_CERTIFICATION` over a certified state. | While inheritance is intact. |
| `REVIEW_REQUIRED` | Produced, not certified. | Never. |
| `REJECTED` | Failed certification. | Never. |
| `DRAFT`, `VALIDATING`, `QUARANTINED`, `RETIRED` | Not decided, or withdrawn. | Never. |
| `CERTIFIED_NOT_DELIVERABLE` | **Derived, never stored.** A certified row that fails capability, rights, lineage, blueprint or scope. | No, with its reasons. |

```
certified  !=  runtime deliverable
runtime deliverable  =  certification valid in scope
                      + lineage complete + rights CLEARED
                      + renderable + scorable + stimulus supported
                      + mapped to a blueprint bucket (format allowed) + not retired
                      + mode requirements (e.g. calibrated difficulty for Challenge)
```

The Question Bank **lifecycle** (DRAFT_AI → VALIDATING → VALIDATED → PILOT → CALIBRATED → ACTIVE) is a separate axis. It is a usage gate, not a certification. It reuses the names REVIEW_REQUIRED and REJECTED with a lifecycle meaning. Adapters must map lifecycle into `retired` and eligibility, never into `certification`.

Example, today: 30 IB instances are `AUTOMATED_CERTIFIED_PILOT` but have no bank row, because `projectionRefusal` = `RESPONSE_IS_MARKED_ON_WORKING`. Through this engine they come out as `CERTIFIED_NOT_DELIVERABLE` with the reason `FORMAT_NOT_SCORABLE`, given a capability set without rubric scoring. See `IB_CONSTRUCTED_RESPONSE_GAP.md`.

## 6. Exposure boundary

**Current behaviour, frozen and not changed:**

- Exam Core penalises seen items but never excludes them. The penalty is +2 if seen, +1 more if seen recently, plus template, global and peer terms (`form-assembly.ts:171-182`).
- Usage is keyed by `approved_item_id`, the version, and written when the form is frozen.
- Blueprint Core counts every sibling version of a seen item as seen.
- Health ignores exposure.

**Generic contract** (`exposure.ts`, `assembleForm`):

```
eligible certified supply (RUNTIME_DELIVERABLE only)
  -> never-exposed first (seeded, stable order)
  -> then least-recently exposed
  -> one position per item, per form
  -> every repeat reported (repeatedItemIds), every shortfall reported (unfilled)
  -> freeze
```

**Decision for adoption:** exposure identity must be the **bank item** (stable across versions), as in Blueprint Core. A new version of an item the Student has seen is still a seen item.

## 7. Difficulty calibration model (design + pure module)

`DifficultyProfile`:

- `difficultyIndex`: the existing exam-relative scale, 0.3–2, where 1.0 is official difficulty. `null` when unknown.
- `difficultyBand`: VERY_LOW, LOW, MEDIUM (0.9–1.1), HIGH, VERY_HIGH.
- `confidence`.
- `calibrationSource`: CONSTRUCT_DESIGN < AUTOMATED_PRIOR < EXPERT_REVIEW < EMPIRICAL.
- `sampleSize`: independent, unassisted responses only.
- `lastCalibratedAt`.

**CALIBRATED** means EMPIRICAL, with `sampleSize ≥ minEmpiricalSample`, an index present, and the estimate fresher than `maxAgeDays`. The defaults are 200 and 730. These are policy values, not a psychometric claim. Nothing else is calibrated:

- an authored 1–5 level is a CONSTRUCT_DESIGN prior;
- a model estimate is AUTOMATED_PRIOR;
- an expert judgement is EXPERT_REVIEW.

### Proposed migration (not created)

Add to `approved_items`:

- `difficulty_source` (CHECK over the four sources);
- `difficulty_confidence` numeric;
- `difficulty_sample_size` int;
- `difficulty_calibrated_at` timestamptz.

Keep the existing `difficulty_index`, `calibrated_difficulty`, `calibration_confidence` and `calibration_sample_size`, mapped as follows:

| Existing | Maps to |
|---|---|
| `calibration_confidence` (INSUFFICIENT_DATA / EARLY_SIGNAL / MODERATE / HIGH) | `confidence` |
| `calibration_sample_size` | `sampleSize` |
| a `difficulty_index` authored in content | AUTOMATED_PRIOR or CONSTRUCT_DESIGN, never EMPIRICAL |

**Empirical writer:** `calibration.service.ts` recomputes from independent, unassisted, non-review `exam_attempt_item_responses`, per bank item, per exam version.

### Required fixes, deferred because PAA is frozen

- C7 must use `isCalibrated`, not "an index is present".
- `form-assembly.ts` must stop defaulting a missing index to 1.0. An unknown index leaves the band unmet.
- `deriveInstanceAttemptType` must refuse CHALLENGE when the engine says NOT_READY.

## 8. Adoption plan (why READINESS_SINGLE_AUTHORITY = NO today)

| Phase | Work | Changes PAA? |
|---|---|---|
| R1 | DB adapter: build `ReadinessInput` from the bank (`question_bank_items` + `approved_items` + instance certification + rights + blueprint buckets). Read-only. Snapshot keyed by `(engineVersion, scope, blueprint)`. | No (read-only) |
| R2 | Shadow: Admin health and `paa-coverage.ts`-style report print engine vs current surfaces side by side; disagreements become tickets | No |
| R3 | Consumers switch, one at a time behind a flag: catalogue tree → `resolveExamLevel` → capabilities / PreparationHome → `examAvailabilityForVersion` (closes PAA-FOLLOWUP-01) → instance API gate → Challenge start gate | **Yes**: needs the freeze lifted |
| R4 | Delete the duplicated deciders (C8 legacy guard, B1 config readiness for bank-backed families, unused `mockReady`) | Yes |

Single authority = YES only after R3 is complete for every consumer.
