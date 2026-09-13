# LX-9R1-R1 — CANONICAL PROGRESS ROLLUP

## STATUS

**PASS.** Concept, topic, subject, and learner-overall primary progress now all derive from the same canonical `LearnerJourneyStage` projection introduced in LX-9R1. The Subjects detail page's header and `/dashboard`'s overall/subject-card percentages no longer show raw `mastery_score` averages as the primary number — both routes now show the identical, canonical, concept-weighted journey progress for a given subject. Legacy mastery values remain fully intact as secondary analytics. No evidence/mastery data was mutated.

## LIVE ROOT CAUSE

LX-9R1 fixed the concept-row, topic, and subtopic percentages on the Subjects detail page. Two aggregates one level up were never touched, because they came from a **completely separate data pipeline**:

- The Subjects detail page's header ("dominio promedio 1%") reads `learnerModel.avgMasteryPercent` — the Digital Learning Twin cognitive summary (`getSubjectView`), itself a raw `mastery_score` average.
- `/dashboard`'s "Dominio general" and every subject card's percentage read `overview.overallMasteryPercent` / `overview.subjects[].avgMasteryPercent` from `progress-overview.service.ts::getStudentProgressOverview` — also a raw `mastery_score` average, computed independently of LX-9R1's `journey-progress.ts` work entirely.

Both are legitimate, unmodified, pre-existing aggregates — they were simply never the *canonical journey* number, and nothing had connected them to it.

## SUBJECT OLD AUTHORITY

`src/lib/learner-twin` → `getSubjectView(studentId, subjectId).cognitiveSummary.avgMasteryPercent` — a raw average of `mastery_records.mastery_score` for the subject's concepts, surfaced directly in the Subjects detail page header, labeled "dominio promedio."

## STUDENT OVERALL OLD AUTHORITY

`progress-overview.service.ts::getStudentProgressOverview`:
- `overallMasteryPercent = masteryToPercent(averageMasteryScore(allRawMasteryScores))` — raw mastery average across every concept in every active subject.
- `SubjectProgress.avgMasteryPercent = masteryToPercent(averageMasteryScore(rawMasteryScores))` — the same computation scoped to one subject.

Both audited and left **completely unchanged in their own computation** — they remain valid secondary metrics, just no longer rendered as the primary number.

## SHARED CANONICAL AGGREGATOR

No new aggregation function was needed. LX-9R1's `averageJourneyProgress(stages: LearnerJourneyStage[])` (`src/lib/lx/journey-progress.ts`) already computes exactly "mean of a set of canonical concept journey stages" — which is what BOTH subject-level and learner-overall progress are, differing only in which concepts are passed in:

- **Subject progress** = `averageJourneyProgress(stagesOfThisSubjectsOwnConcepts)`.
- **Overall progress** = `averageJourneyProgress(stagesOfEveryConceptInEveryActiveSubject)` — a single flat array spanning all subjects, which is naturally concept-weighted (each concept contributes exactly one entry regardless of which subject it belongs to, so a 1-concept subject cannot outweigh or be outweighed disproportionately by a 20-concept one — R4).

No `deriveSubjectJourneyProgress`/`deriveOverallJourneyProgress` wrapper functions were added, since they would have been trivial pass-throughs to `averageJourneyProgress` with no added logic — reusing the ONE existing function directly is the more literal reading of "one shared source" (R6) and eliminates any chance of the two levels' logic drifting apart.

Each concept's stage is resolved via `resolveConceptJourneyStage` (LX-9R1, `path-view.ts`) — the exact same function the Subjects detail page and My Path already call. `progress-overview.service.ts` now also calls it, using the concept universe from `getSubjectHierarchy` (every concept, including ones with no `mastery_records` row yet) rather than the narrower `getStudentMastery`-joined set the file's existing per-concept detail list uses — see WEIGHTING/DENOMINATOR below for why this distinction matters.

## SUBJECT PROGRESS

`subjects/[id]/page.tsx` already computed a `journeyStages: Record<conceptId, LearnerJourneyStage>` map for every concept in the subject's hierarchy (LX-9R1). This phase adds one line: `subjectJourneyProgressPercent = averageJourneyProgress(Object.values(journeyStages))`, and replaces the header's primary display (`learnerModel.avgMasteryPercent`, "dominio promedio") with it, relabeled `subjectDetail.journeyProgressShort` ("Avance del recorrido" / "Journey progress" / etc., all 5 locales). The old raw mastery percentage moves into the page's existing secondary analytics line (alongside freshness/independent mastery/confidence/evidence coverage), explicitly still labeled `subjectDetail.avgMastery` — no information lost, just correctly re-categorized (R3).

`progress-overview.service.ts` computes the identical value independently for `/dashboard`'s subject cards: `SubjectProgress.journeyProgressPercent`, added as a new field alongside the unchanged `avgMasteryPercent`.

## OVERALL STUDENT PROGRESS

`ProgressOverview.overallJourneyProgressPercent` (new field) = `averageJourneyProgress(allJourneyStages)`, where `allJourneyStages` is the flat concatenation of every subject's own `journeyStages` array (computed once, in the same per-subject `Promise.all` pass that already builds `SubjectProgress`). `/dashboard`'s header now shows this as the primary number, labeled `progress.overallJourneyLabel` ("Avance general del recorrido"), with the old `overallMasteryPercent` demoted to a small secondary line directly beneath it (still labeled with its own existing key, `progress.overallMasteryLabel` — "Dominio general" — so the number's meaning stays honest per R3: it is no longer claiming to be the primary journey number).

## WEIGHTING / DENOMINATOR

**Concept-weighted, not subject-weighted** (R4): the overall figure sums every individual concept's stage-anchor percentage and divides by the total concept count across all subjects — never a mean of per-subject percentages. Verified by test with a 1-concept subject at TRANSFER (85%) and a 4-concept subject entirely at RETAIN (70%): the concept-weighted result is `(85 + 70×4) / 5 = 73%`, deliberately different from the naive subject-mean `(85+70)/2 = 78%` (test asserts both, confirming the code is NOT doing the naive thing).

**Denominator = every concept in the subject's hierarchy** (`getSubjectHierarchy`), not every concept with a `mastery_records` row (`getStudentMastery`). This distinction is load-bearing: `getStudentMastery`'s query is `FROM mastery_records mr JOIN concepts c ON mr.concept_id = c.id`, which silently excludes a concept that has NEVER been attempted (no `mastery_records` row exists for it at all) — exactly the "do not silently exclude low-progress concepts to inflate the number" failure mode R2/R11 warn against. `getSubjectHierarchy` returns the subject's full concept list regardless of attempt history, and a concept absent from both the knowledge-state map and the active-decision map correctly resolves to `NOT_STARTED` (0%) via `resolveConceptJourneyStage`'s own existing fallback — never fabricated, never excluded.

A subject with zero concepts (`hierarchy.topics`/`hierarchy.unassigned` both empty) resolves to `journeyProgressPercent: null` (R11: "not NaN, not 100%") — verified by test. A learner with zero active subjects resolves to `overallJourneyProgressPercent: null` the same way.

## SUBJECT DETAIL ↔ PROGRESS DASHBOARD CONSISTENCY

Both routes now call the identical `averageJourneyProgress` function (verified by source-contract test) over stage sets derived from the identical `resolveConceptJourneyStage` authority. The Subjects detail page's header and `/dashboard`'s subject card for the same subject can no longer diverge, because there is exactly one aggregation function and one stage-resolution function feeding both — no parallel percentage engine exists (R10).

## SECONDARY ANALYTICS

Untouched, exactly as instructed:
- The five capability dimensions ("Lo entiendo" / "Lo hago solo" / "Lo aplico" / "Lo recuerdo" / "Lo adapto", `progress-overview.service.ts::capabilities`) — a different question (multidimensional evidence confidence) than journey position, left completely alone (R7).
- Freshness / independent mastery / confidence calibration / evidence coverage (Subjects detail page's Digital Learning Twin secondary line) — unchanged computation, still secondary.
- Achievements ("Qué he logrado", `AchievementCounts`) — untouched; still evidence-crossing counts, never derived from the new percentage (R8). The LX-9 milestone system (`progression-milestones.ts`) was not touched by this repair at all (verified by test).
- Needs-attention ("Qué necesita atención", `learning_debt`-derived `NeedsAttentionItem[]`) — untouched; still severity-ordered from `learning_debt`, never re-sorted by the new journey percentage (R9, verified by test).

## EMPTY STATES

- All-`NOT_STARTED` subject (concepts exist, none touched) → `0%`, verified by test.
- Zero-concept subject → `null` (explicit no-content state), never `NaN`/`100%`, verified by test.
- Zero active subjects for the learner → `overallJourneyProgressPercent: null`, `subjects: []`, verified by test.

## NO DATA MUTATION

`progress-overview.service.ts` performs no `INSERT`/`UPDATE`/`DELETE` anywhere (verified by test) — this remains a pure read/aggregation service, exactly as its own header comment already stated before this phase. `mastery_score`, the Knowledge State projection, and the learner model are read identically to before; only which value is presented as the PRIMARY percentage changed. `avgMasteryPercent` (subject and overall) keep their exact prior computation and remain fully available in the returned data and on-screen as secondary analytics.

## TESTS

- `tests/unit/lx9r1r1-canonical-progress-rollup.test.ts` (**new**, 18 tests, fully mocking the service's module boundaries while letting `resolveConceptJourneyStage`/`deriveLearnerJourneyStage`/`averageJourneyProgress` run for real) — covers all 21 required items: subject-level aggregation with NOT_STARTED-counts-as-zero and differing concept counts (1-3), shared-aggregator source contract across both routes (4-5), concept-weighted overall progress proven against the naive subject-mean alternative, and legacy-source isolation (6-8), primary/secondary independence with the exact live-QA "1%" reproduced as the now-correctly-secondary value (9-10), unchanged RETAIN/TRANSFER/CONSOLIDATED stage anchors (11-13), empty/all-untouched subject and zero-subject learner states (14-15), no evidence/mastery writes (16), and Today/My Path/milestones/attention-logic non-interference (17-20).
- Full suite: 3546/3546 passing across 217 files (up from 3528/216 — one new test file). `npx tsc --noEmit` and `npm run build` both clean.

## COMMIT

Implementation (`src/`) and report committed separately, both with the required `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer. LX-10 was NOT started.
