# LX-9R1 — CANONICAL PROGRESS PERCENTAGE

## STATUS

**PASS.** The learner-facing percentage on the Subjects detail page now reflects canonical journey progression (LX-1B `LearnerJourneyStage`), not raw `mastery_score`. RETAIN and TRANSFER can no longer render near-zero (fixed anchors: 70% and 85% respectively). CONSOLIDATED is exactly 100%, NOT_STARTED is exactly 0%. Topic/subject aggregates now average the same canonical per-concept projection. No second mastery engine was created; no canonical evidence was mutated; this is a presentation-only fix. Full regression suite green (3504/3504 across 215 files), `tsc`/`build` clean.

## LIVE ROOT CAUSE

The Subjects detail page's concept row (`ConceptList.tsx`, rendered inside `HierarchicalConceptList.tsx`, both used by `src/app/dashboard/subjects/[id]/page.tsx`) computed its percentage and bar fill directly from `mastery_score` — a raw, multidimensional evidence-confidence number (Phase 2's `mastery.service.ts::calculateMasteryDelta`), converted to a percent via `masteryToPercent(tryMasteryScore(...))`. The row's ONLY qualifier text came from `MasteryState` (`knowledge-state.service.ts`), a DIFFERENT axis again. Neither of these is the canonical LX-1B learner journey (`LEARN → PRACTICE → PROVE → RETAIN → TRANSFER → CONSOLIDATED`), which is instead derived from `LearningState` + `MasteryState` + `ValidationReadiness` + memory/transfer overlays via `deriveLearnerJourneyStage`. A concept can legitimately have already cleared PROVE and reached RETAIN (an open retention obligation) while its raw mastery-confidence number is still low — exactly the "2% / Aprendiendo" case Live QA found for Potenciación.

## OLD PERCENTAGE AUTHORITY

Audited every percentage on the Subjects detail page (R1) before changing anything:

| Location | Source | Calculation |
|---|---|---|
| Concept row bar/% (`ConceptList.tsx`) | raw `mastery_score` | `masteryToPercent(tryMasteryScore(c.mastery_score))`, computed in `topic-hierarchy.service.ts::getSubjectHierarchy` |
| Concept row secondary qualifier | `MasteryState` enum | `knowledge-state.service.ts` batch read, rendered via `masteryStateLabel` |
| Topic/subtopic/unassigned header bar/% (`HierarchicalConceptList.tsx`) | mean of raw `mastery_score` | `averageMastery()` — a plain arithmetic mean of each concept's raw percent |
| Header secondary line (freshness/independent mastery/confidence/coverage) | `retention`/`independentMastery`/`confidenceCalibration`/`hasEvidence` — genuinely different canonical signals (memory retrievability, learner-model intel) | unchanged, correctly distinct from the primary bar even before this fix |
| Subject header "avg mastery" line | `learnerModel.avgMasteryPercent` (Digital Learning Twin cognitive summary) | unchanged — a distinct, already-labeled secondary metric, out of scope |
| `AssessmentPanel.tsx`'s per-concept exam-topic-selection checklist | raw `mastery_score` | unchanged — a narrow, already-labeled readiness hint in an exam-scope picker, not the "journey progress" this repair targets; see NO MASTERY MUTATION |
| Concept Mission detail page (`concepts/[conceptId]/page.tsx`) | raw mastery %, retention, independent mastery, confidence — each explicitly labeled as its own dimension, alongside its OWN pre-existing journey rail (`conceptMission.journeyTitle`) | unchanged — this page already separates journey stage from raw dimensions correctly (LX-3/LX-7); not part of this bug |

Only the FIRST TWO rows (concept row bar/%, topic/subtopic/unassigned aggregate) conflated raw mastery with journey progress. Nothing was changed until this was confirmed by direct code read.

## NEW CANONICAL PROJECTION

`src/lib/lx/journey-progress.ts` (new): `deriveJourneyProgress(stage: LearnerJourneyStage)` — a pure presentation function, input is a canonical stage ONLY (never a score/count/percentage), output is `{ progressPercent, progressLabelKey, currentStage, isConsolidated }`. `averageJourneyProgress(stages: LearnerJourneyStage[])` aggregates a group the same way (R7).

The canonical stage itself is resolved by a NEW export, `resolveConceptJourneyStage`, extracted (not reimplemented) from `path-view.ts`'s pre-existing, module-private `resolveConceptJourney` — the exact function My Path's `buildSubjectPathView` already calls per concept. `resolveConceptJourney` itself is untouched; the new export shares its logic and returns the raw `LearnerJourneyStage` (all 8 values) rather than the 5-rung collapsed `ConceptJourney` shape My Path renders, since the percent mapping needs to distinguish `NOT_STARTED` from `LEARN` and `READY_TO_PROVE` from `PROVE`, both of which My Path's rung line intentionally collapses for its own different purpose.

`subjects/[id]/page.tsx` now computes one `Record<conceptId, LearnerJourneyStage>` for the whole subject, using the SAME `knowledgeStates` batch read and the SAME snapshot-derived per-concept decision map `buildSubjectPathView` uses — never a second query path.

## STAGE → PERCENT MAPPING

Fixed, deterministic stage anchors (R4/R5) — no intra-stage progress is manufactured from quiz count, attempts, or time spent, since no canonical intra-stage signal exists:

| Stage | Percent |
|---|---|
| NOT_STARTED | 0% |
| LEARN | 15% |
| PRACTICE | 35% |
| READY_TO_PROVE | 50% |
| PROVE | 55% |
| RETAIN | 70% |
| TRANSFER | 85% |
| CONSOLIDATED | 100% |

Strictly increasing across all 8 stages by construction (verified by test). RETAIN (70%) and TRANSFER (85%) — both reached only after real, substantial prior progress — sit comfortably in the upper range, never near-zero. `deriveJourneyProgress` takes no intervention/REINFORCE parameter, so a temporary intervention overlay cannot alter the percentage (R8/required test 8).

## LABEL SEMANTICS

Reuses Concept Mission's own existing, already-translated stage vocabulary (`conceptMission.stage.NOT_STARTED` … `conceptMission.stage.CONSOLIDATED`, all 5 locales, e.g. `RETAIN` → "Retener"/"Retain"/"Behalten"/"Mémoriser"/"Reter") — no new label set was created, and the label key is a pure function of the SAME stage the percentage was computed from (`` `conceptMission.stage.${stage}` ``), so a percentage from one stage can never pair with a label from a different one. The old `MasteryState`-derived secondary qualifier ("Aprendiendo") is no longer rendered on this row at all — it was itself a symptom patch (6L-C2-B1) for the exact percentage bug this phase fixes at the root, and keeping it alongside the new, correct stage label risked recreating a milder version of the same contradiction. A new accessible label (`subjectDetail.journeyProgressLabel`, "Avance en el recorrido de aprendizaje" / "Progress along the learning journey" / etc., all 5 locales) is attached to the concept row's progress bar (R9).

## TOPIC AGGREGATION

`HierarchicalConceptList.tsx`'s `averageGroupJourneyProgress(concepts, journeyStages)` replaces `averageMastery()`. Denominator: EVERY concept in the topic/subtopic (assigned via the hierarchy), no filtering — a concept with no active decision and no knowledge-state row yet resolves to `NOT_STARTED` (0%) and still counts in the mean, never silently excluded (R7's explicit "do not silently exclude low-progress concepts to inflate the number").

## SUBJECT AGGREGATION

The "unassigned" concepts group uses the identical `averageGroupJourneyProgress` function and the identical denominator rule as topics/subtopics. No separate subject-level rollup exists on this page beyond the per-group headers already shown (topic, subtopic, unassigned) — the subject-wide "avg mastery" line in the page header (`learnerModel.avgMasteryPercent`) is a distinct, already-labeled Digital Learning Twin metric and was left unchanged (it does not claim to be "journey progress").

## SECONDARY ANALYTICS

`retention` (memory freshness), `independentMastery`, `confidenceCalibration`, and evidence coverage remain exactly as before — real canonical signals, computed the same way, rendered in `buildSecondaryLine` as a visually distinct line beneath the primary progress bar/label (R8's suggested hierarchy). Nothing about this repair touches their computation or their secondary framing; only the PRIMARY percentage/label pair (previously conflated with raw mastery) was corrected.

## MY PATH CONSISTENCY

`resolveConceptJourneyStage` is the exact same underlying computation My Path's `buildSubjectPathView` already runs per concept (same `LearningState`/`MasteryState`/`ValidationReadiness` inputs, same zero-signal fallback for a concept with no active decision). The Subjects detail page and My Path can no longer disagree about a concept's stage, because they now call the same function with the same inputs — verified directly by test (given identical canonical inputs, both paths produce the same stage). Today and Concept Mission were not modified by this repair (confirmed via source-contract test that neither file references the new module) and remain the authorities they already were.

## NO MASTERY MUTATION

`journey-progress.ts` has no database import and performs no write of any kind — verified by test. `resolveConceptJourneyStage` is a read: it calls the same pure `deriveLearnerJourneyStage`/`computeLearningState` functions My Path already calls, never persists anything. No `mastery_records`/`concept_knowledge_state` row was touched, updated, or reinterpreted by this phase — the underlying evidence and its computation (`mastery.service.ts`, `knowledge-state.service.ts`) are completely untouched; only how a stage is PRESENTED as a percentage changed. `AssessmentPanel.tsx`'s exam-topic-selection checklist (a narrow, already-labeled readiness hint distinct from "journey progress") was deliberately left on raw `mastery_score` — an explicit scope decision, not an oversight, since changing it was not required by the live bug report and raw confidence is arguably a more relevant signal for pre-exam topic selection than journey-stage position.

## TESTS

- `tests/unit/lx9r1-canonical-progress-percentage.test.ts` (**new**, 29 tests) — covers all 22 required items: fixed stage anchors and strict ordering (1-7), REINFORCE/backward-state immunity (8), the exact RETAIN/TRANSFER near-zero regression (9-10), label-stage agreement (11), My Path consistency (12-13), canonical aggregation with the correct denominator rule (14-15), no legacy `mastery_score` leak (16), secondary-analytics distinctness (17), no evidence/mastery writes (18), Today/My Path/Concept Mission unchanged (19-21).
- `tests/unit/6l-c2-b1-progress-semantics.test.ts` — updated in place: the 3 tests that certified the OLD raw-`mastery_score`-plus-`MasteryState`-qualifier behavior now certify the NEW `deriveJourneyProgress(c.journeyStage)`-based behavior instead (the prior phase's own fix was a symptom patch this phase corrects at the root — matching the required test 32-style "intentionally corrected" convention used throughout this session). All other tests in that file (freshness/retention labeling, transfer, situation labels, policy-version protections) are untouched and still pass, confirming this repair did not disturb any unrelated invariant that file protects.
- Full suite: 3504/3504 passing across 215 files (up from 3475/213 before this phase — 2 new test files, one net addition after the in-place update). `npx tsc --noEmit` and `npm run build` both clean.

## COMMIT

Implementation (`src/`) and report/docs committed separately, both with the required `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer. LX-10 was NOT started.
