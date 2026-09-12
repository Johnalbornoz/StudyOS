# STUDYUS -- LX-7 -- MY PATH

Branch: `tmp/lx1` (worktree only -- not merged to `main`, not deployed).

## STATUS

**PASS**

My Path is a faithful learner-facing visualization of canonical learning state and progression. It infers nothing from scores/mastery heuristics -- every concept's position comes from `deriveLearnerJourneyStage` (LX-1B), the same certified contract Concept Mission already renders from. It cannot conflict with Today: both read the identical `getLearningOSSnapshot().nextExecutableItem`. It shows no internal engine metric as the primary meaning of progress (severity, mastery %, understanding %, priority score, and confidence threshold all stay off every My Path surface).

## CURRENT MY PATH AUDIT

The "My Path" nav item had no LX-7 implementation yet: `learner-navigation.ts` documented it as a temporary stand-in mapped to `/dashboard/subjects` (the Subjects experience). Audited that experience end to end:

| Element | Where | Classification |
|---|---|---|
| Subjects grid (`SubjectCard`, archive toggle) | `subjects/page.tsx` | KEEP -- subject administration, out of My Path's scope |
| Subject detail header (avg mastery/retention/independence/calibration %, evidence coverage, debt/at-risk counts) | `subjects/[id]/page.tsx` | REPOSITION -- these raw averages are analytics, not the primary journey; My Path shows stage counts instead (R16) |
| "Practice weakest" CTA (`[...concepts].sort((a,b) => a.mastery_score - b.mastery_score)[0]`) | `subjects/[id]/page.tsx:60` | **REMOVE from My Path's scope** -- a genuine client-side ranking heuristic (a second, informal decision engine); left untouched on the existing Subjects/admin page since fixing it is a different, unrelated repair, but My Path never reuses this pattern |
| `HierarchicalConceptList` / `ConceptList` (Topic → Subtopic → flat concept cards, mastery bar + `%`, `masteryFillClass` 75/50 color thresholds, group-average aggregation computed client-side) | `subjects/[id]/HierarchicalConceptList.tsx`, `ConceptList.tsx` | REPLACE, for the learner-navigation purpose -- My Path's `/dashboard/path/[subjectId]` supersedes this as the primary journey view. The old page and its components are left in place (still reachable, still used for content upload / settings / assessment-mode launch), but the **nav item no longer points here** |
| `MasteryState` badge (`masteryStateLabel`/`masteryStateColor`) | `ConceptList.tsx` | REPLACE -- My Path shows the fixed LEARN→...→CONSOLIDATED position instead of the raw 7-value `MasteryState` enum |
| Concept detail page (stat tiles, debt-criteria checklist, situation/decision cards) | `subjects/[id]/concepts/[conceptId]/page.tsx` | KEEP unchanged -- Concept Mission (LX-3) remains the canonical destination when a learner clicks a concept from My Path (R18) |
| Upload / Settings / Assessment-mode panels | `UploadPanel.tsx`, `SubjectSettingsPanel.tsx`, `AssessmentPanel.tsx` | KEEP unchanged -- subject administration, not part of the learner-facing path |

No client-side sorting/derivation from My Path's own code exists (see EVIDENCE INTEGRITY below); the one pre-existing client heuristic found (`weakest`) lives on the untouched Subjects admin page, not on any surface LX-7 built or that the My Path nav item now reaches.

## CANONICAL PATH AUTHORITY

A "journey stage" spanning LEARN→PRACTICE→PROVE→RETAIN→TRANSFER→CONSOLIDATED does **not** exist as a raw DB field or a single service function -- it is itself a presentation contract, already built and certified in an earlier phase:

- **`deriveLearnerJourneyStage`** (`src/lib/lx/learner-journey-contract.ts`, LX-1B) -- the sole stage authority. Pure, deterministic, mirrors `computeLearningState`'s own precedence, never re-orders it. Inputs are exclusively already-canonical values: Phase 4B `LearningState`, Phase 2.2 `MasteryState`/`ValidationReadiness`.
- **`computeLearningState`** (`src/lib/adaptive-learning-policy.ts`) -- Phase 4B's own derivation from `ConceptDecisionContext` (signals + Knowledge State). For a concept with an active `LearningDecision`, its `learningState` field is used verbatim. For a concept with **no** active decision (the majority -- `LearningDecision`s exist only for concepts with at least one active signal), `computeLearningState` is called directly with the exact zero-signal context Concept Mission's own read boundary (`concept-mission-view.service.ts`) already uses -- now exported (`zeroSignalContext`) so both surfaces share one implementation instead of two.
- **`getSubjectKnowledgeState`** (`src/services/knowledge-state.service.ts`) -- one batched read of `MasteryState`/`ValidationReadiness` per subject.
- **`getLearningOSSnapshot`** (`src/services/learning-os-snapshot.service.ts`) -- the same snapshot Today reads, supplying the ranked `LearningDecision[]` and `nextExecutableItem` used for the current-position hero.

REINFORCE, retention-due, and transfer-required are never independently re-derived: they arrive as `LearnerJourneyResult.intervention` and as whichever `LearnerJourneyStage` the contract already returns (`RETAIN` for `RETENTION_RISK`, `TRANSFER` for `TRANSFER_GAP`). No field was UNRESOLVED -- every input My Path needs already has a canonical source.

**Cross-concept selection authority** (the "current position" hero) already exists too: `getLearningOSSnapshot().nextExecutableItem`, identical to Today's own read. My Path never invents its own selection.

## KNOWLEDGE ARCHITECTURE

Unchanged. `getSubjectHierarchy` (`topic-hierarchy.service.ts`) still returns the existing Subject → Topic → Subtopic → Concept structure; `topics`/`subtopics` remain first-class in both the TypeScript types and the DB schema (confirmed by direct audit, not assumption). My Path's per-subject page flattens Subtopic into its parent Topic for display only (a `TopicPathView.concepts` list) -- no restructuring, no Competency/Skill hierarchy introduced. Competency/skill data does not exist as a navigation dimension anywhere in this codebase; nothing needed omitting.

## PATH VIEW CONTRACT

`src/lib/lx/path-view.ts` (new):

```ts
interface ConceptPathView { conceptId; title; journey: ConceptJourney; isCurrent; hasEvidence }
interface TopicPathView { topicId; title; concepts: ConceptPathView[] }
interface SubjectPathView { subjectId; title; topics; unassigned; summary; currentConceptId }
interface CurrentPosition { subjectId; subjectTitle; conceptId; conceptTitle; activityType; estimatedMinutes; reasonCode; decision; journey }
interface MyPathOverview { state; current; subjects: SubjectSummaryCard[]; currentSubjectView }
```

`buildSubjectPathView` and `buildMyPathOverview` are the two builders; `loadMyPathContext` is the one shared read boundary (snapshot + active-subjects list), loaded once per render and passed to both the overview page and the subject page -- no adaptive decision is recomputed inside either builder, only assembled from the reads above.

## CURRENT POSITION

The overview hero shows exactly one concept: `snapshot.nextExecutableItem`, the same object Today's hero renders. Its journey strip, narrative (`activityNarrative`), and "why" (`WhyThisV3`, capped to one fact per LX-6R1) are all reused verbatim from Today/LX-6 -- no new copy-generation path.

## JOURNEY VISUALIZATION

`JourneyStrip.tsx`: a semantic `<ol>` of stage pips (✓ completed / ● current / ○ pending), shared unmodified between the hero and every concept row. `RUNG_ORDER` (now exported from `concept-mission.ts`) is the one ordering both Concept Mission's rail and My Path's strip use.

## LEARN / FIRST TOUCH

`NOT_STARTED` (no Knowledge State row, or `masteryState: 'UNKNOWN'`) → stage `LEARN`, current; everything else pending. Verified by test.

## PRACTICE

Residual `DEVELOPING` learningState (learning/developing mastery, nothing blocking, not yet independence-ready) → stage `PRACTICE`. Verified by test.

## PROVE

`PENDING_VERIFICATION` and `INSUFFICIENT_INDEPENDENT_EVIDENCE` both → stage `PROVE`, Learn+Practice already completed. Verified by test.

## RETENTION

`RETENTION_RISK` → stage `RETAIN`. Presented as "Keep it fresh" / "Time to make sure this still sticks." -- never implies failure.

## TRANSFER

`TRANSFER_GAP` → stage `TRANSFER`, presented as "Apply it" / "Apply it somewhere new" -- never "another quiz." Visible in the strip as the next pip once Retain is current, satisfying R12 without a second sentence.

## REINFORCE

`MISCONCEPTION_BLOCKED` / `PREREQUISITE_BLOCKED` / `NEEDS_REPAIR` all produce `intervention: 'REINFORCE'` attached to stage `PRACTICE` (LX-1B's own choice, reused verbatim) -- rendered as a calm "Strengthen" badge next to the strip, with copy "StudyUS wants you to reinforce one part before continuing." No red, no "failure"/"weak"/"bad" language anywhere in the new copy.

## CONSOLIDATED

Only `VALIDATED` learningState (itself gated on `masteryState === 'VALIDATED_MASTERY'` with nothing above it blocking) → `consolidated: true`, entire line marked complete, never a sixth clickable task. Never inferred from a raw score, 100% correctness, or all-questions-correct shortcut -- confirmed by source-contract test that neither `concept-journey.ts` nor `path-view.ts` reads `masteryScore`/`understandingScore`/`independentMastery`/`scorePercent` or any numeric comparison.

## FUTURE / LOCKED

No canonical prerequisite-locking mechanism exists anywhere in the codebase (confirmed: `topic-hierarchy.service.ts`'s own header comment calls the hierarchy "purely organizational"). Per R14, My Path does **not** invent one -- every non-current concept is shown as neutral, clickable, pending-or-completed based only on its own canonical state. A source-contract test asserts no `LOCKED`/`isLocked` string exists anywhere in the new modules.

## SUBJECT / TOPIC NAVIGATION

`/dashboard/path` lists active subjects as compact cards (title + `consolidated/total` count); `/dashboard/path/[subjectId]` shows Topic sections as native `<details>` disclosures, open by default only for the topic containing the current concept (or the sole topic, if there's only one) -- progressive disclosure per R15, no client JS required, no simultaneous full expansion of every subject.

## TODAY CONSISTENCY

Both pages call `getLearningOSSnapshot` (via the shared `loadMyPathContext`) and use `nextExecutableItem` exactly as Today does; `current.activityType` is `best.decision.activityType` verbatim, never re-selected. For a concept with an active decision inside a subject page, `decision.learningState` is used directly rather than re-derived. Regression tests assert both facts as source contracts. Today's own "View My Path" button, previously pointing at the unrelated rolling-plan page (`/dashboard/study-plan` -- a pre-existing mislabel, since the nav's own "My Path" stand-in pointed at `/dashboard/subjects`, a third, different page), now points at the real `/dashboard/path`.

## CONCEPT MISSION INTEGRATION

Clicking any concept -- from the hero, the "coming up" list, or a subject-page row -- opens `/dashboard/subjects/[id]/concepts/[conceptId]` (LX-3's canonical Concept Mission), never a direct activity launch. The one CTA that does launch (the current concept's "Continue"/activity-verb button) uses `StartSessionButton` unmodified, posting only `{studentId, actionConceptId}` to `/api/learning/session/start` -- the same canonical entry point Today and LX-5 continuation use, verbatim.

## LANGUAGE

Both pages resolve locale via `getInterfaceLanguage(studentId)` (GLOBAL_INTERFACE_LANGUAGE), identically to Today. Neither page imports or references activity-language logic; launching an activity still hands off to LX-4P-R3's existing rules unchanged.

## VISUAL TRANSFORMATION

Before: a flat grid of subject cards → an accordion of equal-weight concept cards with raw mastery bars and percentages. After: one dominant "you are here" hero (brand border, 24px heading, journey strip, one CTA), a short "coming up" list, a quiet subject-count summary line, and subject cards sized for exploration rather than density -- no kanban grid, no 30 equal cards, no XP/gamification added.

## MOBILE

`JourneyStrip` uses `flexWrap: 'wrap'` with no `overflow-x`; five stage pips wrap onto additional lines on narrow viewports instead of forcing horizontal scroll. Subject cards use `repeat(auto-fill, minmax(...))` grids that collapse to a single column at mobile widths.

## ACCESSIBILITY

Each stage pip is a `<li>` in a semantic `<ol>`, with `aria-current="step"` on the current stage, a visible text label (`journeyStageLabel`) plus an `.sr-only` status suffix (`journeyStageStateLabel`) -- never color alone. `<details>`/`<summary>` topic sections are native, keyboard-operable disclosure widgets requiring no custom ARIA.

## OBSERVABILITY / PROVENANCE

`[my-path]` console lines: `MY_PATH_REQUEST_STARTED`, `MY_PATH_READY` (with `latencyMs`/`state`), `MY_PATH_CURRENT_POSITION_RENDERED` (`subjectId`/`conceptId`/`currentStage`/`activityType`), `MY_PATH_UNRESOLVED`, `MY_PATH_FAILED` -- mirroring Today's `[today]` pattern exactly, never learner content. `ConceptJourney.reasonCode` (LX-1B's own reason string, e.g. `RETENTION_DUE`, `VALIDATED_MASTERY`) is retained on every concept's view object for future Decision Trace/admin QA -- never rendered to the learner.

## EVIDENCE INTEGRITY

`path-view.ts` and both pages are read-only: a source-contract test confirms no `INSERT INTO`/`UPDATE ... SET` anywhere in the new modules. Opening a concept from My Path only navigates to Concept Mission (itself unchanged, LX-3 semantics); no evidence, mastery, or Knowledge State write happens on page load or concept open.

## PERFORMANCE / QUERY AUDIT

Zero AI calls on any My Path render. Per active subject, exactly two batched reads (`getSubjectHierarchy`, `getSubjectKnowledgeState`) plus the one shared, already-existing `getLearningOSSnapshot` call for the whole render -- never one query per concept. `buildMyPathOverview` calls `buildSubjectPathView` once per **active subject** (typically single digits), run in parallel via `Promise.all`. Flagged for future attention (not fixed here, per "do not optimize prematurely, but report it"): a student with a very large number of active subjects would fan out that many pairs of subject-level reads on the overview page; if that becomes a real load pattern, a lighter subject-summary-only read (skipping full concept enumeration) would be the next step.

## TESTS

`tests/unit/lx7-my-path.test.ts`, 35 cases: every `LearningState` → stage/intervention mapping (tests 1-7), no invented LOCKED state (8/9), COLD/UNRESOLVED/NO_ACTIVE_SUBJECTS branching (10/11), Today/My Path agreement on concept + activityType (12/13), hero visual dominance (14), completed/pending line reconstruction and no premature Retain/Transfer advancement (15-19), Concept Mission routing + canonical-launch-only CTA (20/21), no evidence writes + untouched `StartSessionButton` (22/23/31), no client thresholds + no metric leakage across all 5 locales (24/25), GLOBAL_INTERFACE_LANGUAGE governance (26/27), mobile wrap + accessible stage status (28/29), Today/nav regression guards (30/32-34 folded into the full-suite run), plus i18n completeness and distinct-sentence checks for `journeyReason`.

Also updated `tests/unit/lx2-learner-navigation.test.ts` (LX-2E) to reflect the nav item's real destination and the removed temporary-mapping note -- this IS the LX-7 deliverable that note was written to anticipate.

Full suite: **199 test files / 3053 tests passing** (up from 198 files / 3018 tests before this phase -- the delta is the new LX-7 file plus the LX-6R1 file added in the immediately prior phase). `npx tsc --noEmit`: clean. `npm run build`: compiles successfully, including `/dashboard/path` and `/dashboard/path/[subjectId]`.

## COMMIT

Implementation commit `4a00ffd` on `tmp/lx1`: `feat(lx): LX-7 -- My Path / canonical learning journey` (14 files: 8 new, 6 modified -- see commit body for the full breakdown). This report is committed separately, matching the established impl-commit + docs-commit pattern.

## SCREENSHOTS / VISUAL NOTES

Not captured -- this worktree has no configured Postgres/Clerk credentials to run a live dev-server render (consistent with every prior phase in this session, none of which included live screenshots either). Verification here is `tsc`/`vitest`/`build`, plus extensive source-contract tests asserting the exact JSX/logic patterns described above.

---

Do NOT start LX-8. STOP.
