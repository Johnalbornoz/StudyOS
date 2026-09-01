# StudyUs Phase 1D-R — Response Timing Quality Semantics Closure

**Date**: 2026-09-01
**Scope**: Narrow semantic-contract remediation only — correct how the Digital Learning Twin's `readResponseTimingSignal` counts `OUTLIER` samples, so a future Phase 1E minimum-sample gate can never be satisfied by outliers alone. No capture, storage, normalization, mastery, Knowledge State, or Verification change.
**Deployment status**: **NOT DEPLOYED.** Nothing in this remediation has been committed, pushed, or deployed. Local `HEAD` remains `b0529f264a1cc64f95021179907c06fe80b6d5ed` (Phase 1C-P). Phase 1E has not started.

---

## 1. Executive Summary

**`RESPONSE_TIMING_QUALITY_CONTRACT = CLOSED`**

The Digital Learning Twin's `readResponseTimingSignal` previously counted `VALID` and `OUTLIER` observations together into one `validSampleCount` — a real ambiguity, since an `OUTLIER` is a preserved observation (a submitted duration beyond the accepted ceiling) but not necessarily a usable analytical sample. `ResponseTimingSignal` now exposes three mutually exclusive counts: `validSampleCount` (`VALID` only), a new `outlierSampleCount` (`OUTLIER` only, still visible in `recentObservations` for transparency), and `invalidSampleCount` (`INVALID`/`CLOCK_SKEW`, unchanged). `quality.sampleSize` now always equals the corrected `validSampleCount`. A dedicated regression test proves the exact scenario external review flagged — 9 VALID + 20 OUTLIER produces `validSampleCount = 9`, never `29` — plus a full A–E quality-matrix suite. Capture, storage, and the normalizer are untouched; the release-blocking mastery-invariant test was re-run and remains green, confirming no behavioral change reached mastery or Knowledge State.

---

## 2. External Review Finding

The Phase 1D contract defines `OUTLIER` as "preserved for transparency" and "NOT usable by default for future behavioral metrics" — distinct from `VALID`, which is the only class meant to be analytically usable. The Phase 1D implementation's `readResponseTimingSignal`, however, counted both `VALID` and `OUTLIER` into the same `validSampleCount` (and by extension into `quality.sampleSize`). This is dangerous specifically because Phase 1E may later gate a derived behavioral metric on a minimum sample count — if that gate reads `validSampleCount`, a concept with many unusable outliers and few (or zero) real valid samples could incorrectly appear to have enough data. A preserved observation is not necessarily a valid analytical sample, and the contract must make that distinction unambiguous before Phase 1D can be certified.

---

## 3. Previous Counting Behavior

Verified by direct code inspection of `readResponseTimingSignal` before any change (not inferred from the prior report's prose):

```ts
const hasRealDuration =
  (entry.timingQuality === 'VALID' || entry.timingQuality === 'OUTLIER') && ...;
if (hasRealDuration) {
  validSampleCount++;                 // VALID and OUTLIER both incremented this ONE counter
  if (observations.length < observationLimit) observations.push({ ... });
} else if (entry.timingQuality === 'INVALID' || entry.timingQuality === 'CLOCK_SKEW') {
  invalidSampleCount++;
}
...
quality: behaviorObservation(lastUpdatedAt, validSampleCount),   // sampleSize inherited the same ambiguity
```

- `VALID` → counted in `validSampleCount`, pushed to `recentObservations`.
- `OUTLIER` → **also** counted in the same `validSampleCount`, **also** pushed to `recentObservations`.
- `INVALID`/`CLOCK_SKEW` → counted in `invalidSampleCount`, never pushed to `recentObservations`.
- `MISSING` → never stored at all (Step 10 data minimization in Phase 1D), so it was never a factor in this reader either before or after this remediation.
- `quality.sampleSize` was set to the combined `validSampleCount`, inheriting the same ambiguity.

This confirms the external review finding exactly, with no surprises — the prior report's own prose ("VALID/OUTLIER vs INVALID/CLOCK_SKEW counting") was an accurate description of a genuinely ambiguous implementation, not a documentation error alone.

---

## 4. Final Timing Quality Contract

| Quality | Usable by default? | Counted in | Visible in `recentObservations`? |
|---|---|---|---|
| `VALID` | **Yes** | `validSampleCount` | Yes |
| `OUTLIER` | **No** (preserved, not usable by default) | `outlierSampleCount` | Yes |
| `INVALID` | No | `invalidSampleCount` | No (no duration to show) |
| `CLOCK_SKEW` | No | `invalidSampleCount` | No (no duration to show) |
| `MISSING` | N/A | Not stored, not counted | No |

`VALID` is the only class any default analytical use — a future Phase 1E minimum-sample gate, an average, a distribution — may treat as a usable sample without an explicit, documented opt-in.

---

## 5. `ResponseTimingSignal` Changes

```ts
interface ResponseTimingSignal {
  recentObservations: ResponseTimingObservation[]; // unchanged: VALID + OUTLIER, bounded, most-recent-first
  validSampleCount: number;      // NARROWED: quality === 'VALID' only (was VALID + OUTLIER)
  outlierSampleCount: number;    // NEW: quality === 'OUTLIER' only
  invalidSampleCount: number;    // unchanged: quality === 'INVALID' | 'CLOCK_SKEW'
  quality: SignalQuality;        // quality.sampleSize now strictly === validSampleCount
}
```

**Field-naming decision (Step 3)**: kept `validSampleCount` rather than renaming to `usableSampleCount` — Step 3 explicitly allows this when renaming would create unnecessary surface-area churn, and here the name was already correct; only its *definition* was too broad. Redefining it strictly (`VALID` only) and adding a sibling `outlierSampleCount` communicates the same contract with a smaller diff than a rename would have required (`ConceptView` consumers, tests, and the architecture doc all keep the same field name).

`ResponseTimingObservation`'s shape is unchanged — it always carried `timingQuality: 'VALID' | 'OUTLIER'`, so no type change was needed there; only the reader's counting logic changed.

---

## 6. Sample Size Semantics

`SignalQuality.sampleSize` (via the `behaviorObservation(lastUpdatedAt, sampleSize)` helper) is now called with the corrected `validSampleCount`, so `quality.sampleSize` is strictly `VALID`-only — never inflated by outliers. No second, differently-named field was introduced for "all observations including outliers"; if a future phase needs that total, `validSampleCount + outlierSampleCount` is directly and unambiguously available from the two separate counts, which is preferable to a third overlapping number.

---

## 7. Outlier Preservation

`OUTLIER` observations are **not** discarded, clamped, or hidden. They remain in `recentObservations` with `timingQuality: 'OUTLIER'` clearly visible (same behavior as before this remediation — only the *counting*, not the *visibility*, changed), and are now separately, explicitly counted via `outlierSampleCount` rather than silently folded into the usable-sample count. This preserves full transparency (an engineer or a future Phase 1E algorithm can always see that outliers exist and how many) while making it structurally impossible for a naive read of `validSampleCount` to be inflated by them.

---

## 8. Tests Added / Modified

| File | Status | Tests | Covers |
|---|---|---|---|
| `tests/unit/learner-twin-response-timing.test.ts` | MODIFIED | 1 test corrected, 1 new describe block (7 tests) added | The one existing OUTLIER test now asserts the corrected semantics (`validSampleCount: 0`, `outlierSampleCount: 1`, `quality.sampleSize: 0`) instead of the old ambiguous `validSampleCount: 1`. New "timing-quality sample-count matrix" block: the exact external-review scenario (9 VALID + 20 OUTLIER → `validSampleCount = 9`, not `29`) plus the full A–E matrix (3 VALID; 3 OUTLIER; 2 INVALID + 2 CLOCK_SKEW; a 7-sample mix proving mutual exclusivity; the no-timing/`NO_TIMING_DATA` case). |

**7 net new tests this remediation** (812 total, up from 806 — 1 existing test corrected in place, not counted as new).

---

## 9. Mastery Invariant

Re-ran `tests/unit/response-timing-mastery-invariant.test.ts` unmodified — all 6 tests pass, unchanged from Phase 1D. This remediation touches only the Twin's *read-side* interpretation of already-stored `learning_evidence.metadata`; it does not touch `normalizeResponseTiming`, any evidence writer, or `mastery.service.ts::updateMastery` in any way, so there was never a mechanism by which this change could reach mastery or Knowledge State. Confirmed, not merely assumed.

---

## 10. Architecture Regression Counts

```
VALID_TIMING_ANALYTICAL_CLASSES = 1   (VALID only)
OUTLIERS_COUNTED_AS_VALID       = 0
INVALID_TIMINGS_COUNTED_AS_VALID = 0
CLOCK_SKEW_COUNTED_AS_VALID     = 0
NEW_SCHEMA_CHANGES              = 0
NEW_DERIVED_BEHAVIOR_METRICS    = 0
MASTERY_BEHAVIOR_CHANGES        = 0
```

---

## 11. Application Validation

```
npx tsc --noEmit     -> clean, 0 errors
npx vitest run       -> 73 test files passed (73), 812 tests passed (812)
npm run build        -> succeeded
npm run db:status    -> LEDGER = FOUND; 2 applied, 0 pending, 0 drifted
```

---

## 12. Git Diff

**Modified** (this remediation only): `src/lib/learner-twin/readers.ts` (counting logic), `src/lib/learner-twin/types.ts` (`ResponseTimingSignal` field/doc changes), `tests/unit/learner-twin-response-timing.test.ts` (corrected assertion + new matrix tests), `docs/architecture/digital-learning-twin.md` (semantic clarification), `docs/audits/STUDYUS_PHASE_1D_RESPONSE_TIME_TELEMETRY.md` (labeled Phase 1D-R amendment, no rewrite of the original text).

**New**: `docs/audits/STUDYUS_PHASE_1D_R_TIMING_QUALITY_CLOSURE.md` (this report).

No change to any capture path, presentation timestamp logic, answer-submission payload, `normalizeResponseTiming`, the 2-hour threshold, `mastery.ts`, `knowledge-state.service.ts`, `verification-triggers.ts`, or any UI file — confirmed via `git status`/`git diff --stat`, which shows no path under `src/app/**/route.ts`, `src/app/dashboard/**/page.tsx`, or `src/lib/algorithms/response-timing.ts` touched since Phase 1D's own commit-pending state. No schema file, no migration file.

---

## 13. Remaining Risks (max 5)

1. **`outlierSampleCount` has no consumer yet** beyond this reader and its tests — it is exposed defensively, ahead of Phase 1E, per Step 4's guidance that a meaningful observed category is worth exposing even before something reads it. Low risk, but worth noting it is currently write-only from the Twin's perspective (no UI or algorithm consumes it yet).
2. **The three-way partition (`valid`/`outlier`/`invalid`) still leaves the *choice* of what to do with outliers entirely to Phase 1E** — this remediation deliberately does not prescribe whether a future algorithm may ever opt into them; that is intentionally out of scope here and left as a live open question for that phase.
3. **No production traffic has exercised the corrected reader yet** — verification here is against unit fixtures only, per the explicit no-deploy constraint carried over from Phase 1D.
4. **The prior (ambiguous) report text was corrected via a clearly labeled amendment, not a rewrite** — a reader who only skims the original Phase 1D report body without noticing the Phase 1D-R banner could still see the old "VALID/OUTLIER vs INVALID/CLOCK_SKEW" phrasing in context; the amendment is placed prominently at the top, but this is a documentation-hygiene risk, not a code risk.
5. **`quality.sampleSize`'s new strict definition is a breaking change in *meaning*, not in *type*** — any future code that reads `quality.sampleSize` expecting "all observations with a duration" (the old, incorrect behavior) rather than "usable samples only" would now get a different, smaller number for the same underlying data. No such consumer exists today (confirmed: `ConceptView.behavior.responseTiming` has zero consumers outside this phase's own tests), so this is a documented risk for future code, not a present bug.

---

## 14. Definition of Done

- [x] VALID is the only default usable timing class
- [x] OUTLIER does not increase valid sample count
- [x] INVALID does not increase valid sample count
- [x] CLOCK_SKEW does not increase valid sample count
- [x] OUTLIER observation remains preserved
- [x] NO_TIMING_DATA remains distinct
- [x] storage contract unchanged
- [x] no schema change
- [x] no derived interpretation
- [x] mastery unchanged
- [x] tests pass
- [x] build passes

---

## 15. Final Decision

**A. Is the timing-quality contract now unambiguous?** **YES.**

**B. Does OUTLIER count as a valid analytical sample?** **NO.**

**C. Is OUTLIER still preserved as an observation?** **YES** — visible in `recentObservations`, counted in its own `outlierSampleCount`.

**D. Can future Phase 1E minimum-sample gates safely use the valid/usable sample count?** **YES** — `validSampleCount` (and `quality.sampleSize`) now strictly reflects only `VALID` observations, proven by the 9-VALID/20-OUTLIER regression test.

**E. Did this remediation change capture/storage?** **NO** — `normalizeResponseTiming`, every client-side capture point, every answer-submission payload, and the stored `learning_evidence.metadata.behavior.responseTimes` shape are all byte-identical to Phase 1D.

**F. Did it introduce any behavioral interpretation?** **NO** — no FAST/SLOW/GUESS/FLUENT/STRUGGLE label, no derived metric, no algorithm; only a read-side counting correction.

**G. Is Phase 1D now fully certifiable?** **YES.**

**H. Can Phase 1D production release proceed after external review?** Per the explicit instruction governing this remediation: **not decided here** — this report closes the timing-quality semantics finding; the decision to commit/push/deploy is reserved for the user, same as Phase 1D's own closing constraint.
