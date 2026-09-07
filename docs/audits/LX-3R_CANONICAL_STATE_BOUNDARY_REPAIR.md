# STUDYUS — LX-3R — CONCEPT MISSION CANONICAL STATE BOUNDARY REPAIR

Branch `tmp/lx1` · commit `dc3f2ab` (on `af93f60` LX-3).
`tsc` clean · `vitest` 171 files / 2475 passed · `next build` green.

Narrow architectural repair. Concept Mission's information hierarchy,
Goal→Journey→NOW composition, progressive disclosure, single primary
CTA, `StartSessionButton`, canonical `LearningDecision` pass-through,
removal of the page-local `primaryCTA` / manual quiz-link row, the
Concept Explanation disclosure, the demonstrated-rung evidence rules,
and the responsive layout are all **unchanged**.

---

## 1. Root cause — why Concept Mission could lack a `LearningState`

Traced through `adaptive-learning-orchestrator.service.ts` →
`adaptive-learning-policy.ts`:

```
getBestLearningDecisionForConcept(studentId, conceptId)
  -> getLearningDecisions(studentId)
       -> loadLearningSignals()        // per-concept loop over EVERY concept_knowledge_state row,
                                       //   pushes a LearningSignal ONLY when a condition fires
                                       //   (critical misconception / low understanding /
                                       //    WAITING_FOR_RETENTION / TRANSFER_REQUIRED /
                                       //    independence gap / memory review-due / forgetting risk /
                                       //    pending verification / insufficient independent evidence / …)
       -> consolidateSignals(signals, ksByConceptId)
            //  for (const signal of signals) { ... }   <-- iterates SIGNALS, never ksByConceptId
            //  => a ConceptDecisionContext is created ONLY for a concept that emitted >= 1 signal
       -> buildLearningDecisions(contexts)   // one decision (carrying computeLearningState(ctx)) per context
       -> rankLearningDecisions(...)
  -> decisions.find(d => d.actionConceptId === conceptId) ?? null
```

So a concept that has a canonical Knowledge State (`MasteryState`,
`ValidationReadiness`, dimensions) but emits **zero signals** — the
healthy, nothing-due case, most obviously `VALIDATED_MASTERY` with no
retention/transfer/misconception flags — never gets a
`ConceptDecisionContext`, so `computeLearningState` is never run for it,
so **no `LearningState` exists anywhere in the pipeline**. Additionally,
a thrown read (`.catch(() => null)` in the old boundary) also produced
`null`, indistinguishable from the genuine empty case.

The LX-3 code then did:

```ts
// src/lib/lx/concept-mission.ts  (REMOVED)
function effectiveLearningState(decision, ks) {
  if (decision) return { learningState: decision.learningState, source: 'LEARNING_DECISION' };
  if (ks == null || ks.masteryState === 'UNKNOWN')
    return { learningState: 'NOT_STARTED', source: 'NO_KNOWLEDGE_STATE' };
  if (ks.masteryState === 'VALIDATED_MASTERY')
    return { learningState: 'VALIDATED', source: 'KNOWLEDGE_STATE_VALIDATED' };
  return { learningState: 'DEVELOPING', source: 'KNOWLEDGE_STATE_RESIDUAL' };
}
```

i.e. the presentation layer manufactured a `LearningState`. That is the
violation.

### Which case applies

- **Case A (a canonical LearningState already exists):** yes, whenever
  Phase 4 returned a decision — `decision.learningState`. Already used;
  unchanged.
- **Case B (the canonical pure policy can compute it from canonical
  inputs, reused not duplicated):** yes, for the *genuine* no-decision
  case. `computeLearningState(context)` reads **only** `context.signals`
  (as a `Set` of types) and `context.knowledgeState` (its own doc:
  *"takes only the same `ConceptDecisionContext` … no new IO, no new
  data source"*). Every signal-only precedence branch
  (`PREREQUISITE_BLOCKED`, `PENDING_VERIFICATION`,
  `INSUFFICIENT_INDEPENDENT_EVIDENCE`, and the signal half of
  `MISCONCEPTION_BLOCKED` / `NEEDS_REPAIR`) corresponds to a state that
  **would have emitted a signal and therefore produced a decision** — so
  if `getBestLearningDecisionForConcept` returned `null` *without
  throwing*, those branches cannot apply, and the remaining branches
  read only `knowledgeState` (`criticalMisconceptionCount`,
  `masteryState` ∈ {INTERVENTION_REQUIRED, AT_RISK, VALIDATED_MASTERY,
  UNKNOWN}, `validationReadiness` ∈ {WAITING_FOR_RETENTION,
  TRANSFER_REQUIRED}), which the boundary has. So calling
  `computeLearningState({ knowledgeState: ks, signals: [] })` is a
  faithful reuse of the canonical policy over an **accurate** context
  (the concept really did produce zero signals).
- **Case C (no canonical LearningState available):** the decision read
  **failed** (threw). Then `signals: []` would be a lie, so the state is
  genuinely unavailable → represent that, do not compute.

The repair applies **B for a successful-empty read, C for a failed
read**.

---

## 2. Canonical resolution — what supplies the state now

`src/services/concept-mission-view.service.ts` resolves exactly one of
three ways and hands the pure builder a discriminated `journeyInput`
(`ConceptMissionJourneyInput`):

| decision read | `journeyInput` | `journey.source` |
|---|---|---|
| **succeeded, returned a `LearningDecision`** | `{ kind: 'RESOLVED', learningState: decision.learningState }` | `LEARNING_DECISION` |
| **succeeded, returned `null`** (zero signals for this concept) | `{ kind: 'RESOLVED', learningState: computeLearningState({ knowledgeState: ks, signals: [] }) }` | `CANONICAL_POLICY_NO_SIGNALS` |
| **threw** | `{ kind: 'UNAVAILABLE' }` | — (journey `status: 'UNAVAILABLE'`) |

The decision read is now:

```ts
getBestLearningDecisionForConcept(studentId, conceptId).then(
  (decision): DecisionRead => ({ status: 'OK', decision }),
  (): DecisionRead => ({ status: 'READ_FAILED' }),
)
```

— success and failure are distinct; a thrown read is **never** silently
converted into "no signals". The other reads (`getConceptView`,
`getConceptKnowledgeState`, `getConceptTransferDepth`, the explanation
existence check) keep their soft `.catch` degradation.

`computeLearningState` is **imported** from
`@/lib/adaptive-learning-policy` and called once with a minimal, honest
`ConceptDecisionContext` (`signals: []`, canonical `knowledgeState`, all
provenance arrays empty). No precedence rule is re-implemented, no new
policy is defined.

- `ks == null` → `computeLearningState` returns `NOT_STARTED` (its own
  documented `!ks` behaviour). This is genuine canonical absence
  (Repair 4), not a fabrication.
- `masteryState === 'UNKNOWN'` (evidenceCount 0) → `NOT_STARTED`, same.
- `masteryState === 'VALIDATED_MASTERY'` + zero signals → `VALIDATED` →
  journey `CONSOLIDATED`. Not a Mission special-case (Repair 3) — the
  canonical policy makes that mapping; the Mission delegates to it.
- The pure builder (`src/lib/lx/concept-mission.ts`) never computes any
  of this. It routes a `RESOLVED` `learningState` through LX-1's
  `deriveLearnerJourneyStage` (unchanged) and renders `UNAVAILABLE`
  honestly.

---

## 3. Files changed

| File | Purpose |
|---|---|
| `src/lib/lx/concept-mission.ts` | **Removed** `effectiveLearningState` (the fabrication). `ConceptMissionInputs.learningDecision` split: `journeyInput` (discriminated `RESOLVED`/`UNAVAILABLE`) drives the journey; `learningDecision` (nullable) drives only the NOW card. `ConceptMissionJourney` is now a discriminated union (`{status:'RESOLVED', stage, intervention, reasonCode, milestones, source}` \| `{status:'UNAVAILABLE', reason:'LEARNING_STATE_READ_FAILED', milestones}`). `ConceptMissionMilestone.position` gains `'INDETERMINATE'`. `buildMilestones(null, …)` → all rungs `INDETERMINATE`, `demonstrated` still purely canonical. `CONCEPT_MISSION_VIEW_VERSION` 1 → 2. |
| `src/services/concept-mission-view.service.ts` | Decision read now `{status:'OK'\|'READ_FAILED'}` (was `.catch(() => null)`). Builds `journeyInput` per the table in §2; imports and calls the canonical `computeLearningState` for the successful-empty case via a small `zeroSignalContext()` helper. |
| `src/app/dashboard/subjects/[id]/concepts/[conceptId]/ConceptMission.tsx` | `JourneyRail` handles `journey.status === 'UNAVAILABLE'`: shows `conceptMission.journeyUnavailable` instead of "You are here: {stage}", omits the reason line and the REINFORCE card, renders the rail with no "current" marker. `milestoneStatusText` / `markerGlyph` handle `INDETERMINATE` (`·`). NowCard / secondary actions unchanged (a decision-less journey is already `NO_CANONICAL_ACTION` + `LEARN_FIRST`). |
| `src/app/dashboard/LearnerShell.tsx` | Repair 5: `NavList` takes a required `label: string`; `<nav aria-label={label}>` (was hard-coded `aria-label="Primary"`). |
| `src/app/dashboard/layout.tsx` | passes `navLabel={t['nav.primary']}` to `LearnerShell`. |
| `src/app/globals.css` | `.cm-rung-indeterminate` (neutral, dashed border) — one rule. |
| `src/lib/i18n/messages.ts` | +3 keys ×5 locales: `conceptMission.journeyUnavailable`, `conceptMission.milestone.indeterminate`, `nav.primary`. |
| `tests/unit/lx3r-canonical-state-boundary.test.ts` | **new** — source-level Repairs 1/2/3/5/7/8. |
| `tests/unit/lx3-concept-mission.test.ts` | reworked for the discriminated `journeyInput` / `journey` union; new LX-3R behavioural cases (read-failure → UNAVAILABLE, validated-mastery-alone → not CONSOLIDATED, UNAVAILABLE still preserves identity/goal/learn/NO_CANONICAL_ACTION and canonical demonstrated rungs). |
| `tests/unit/lx3-concept-mission-i18n.test.ts` | +`indeterminate` placeholder check; +`nav.primary` localized-and-distinct check. |
| `tests/unit/6l-c1-concept-next-action.test.ts` | 3 assertions retargeted from `.catch(() => null)` / `view.journey.reasonCode` / `fallback: stage === …` to the OK/READ_FAILED read and the discriminated `journey`. |
| `tests/unit/6l-c2-b1-progress-semantics.test.ts` | 1 assertion retargeted to `.then(` + `status: 'READ_FAILED'`. |

---

## 4. Removed fallback (exact deleted logic)

```ts
// DELETED from src/lib/lx/concept-mission.ts
function effectiveLearningState(
  decision: ConceptMissionLearningDecision | null,
  ks: ConceptMissionKnowledgeState | null,
): { learningState: LearningState; source: ConceptMissionJourneySource } {
  if (decision) return { learningState: decision.learningState, source: 'LEARNING_DECISION' };
  if (ks == null || ks.masteryState === 'UNKNOWN') {
    return { learningState: 'NOT_STARTED', source: 'NO_KNOWLEDGE_STATE' };
  }
  if (ks.masteryState === 'VALIDATED_MASTERY') {
    return { learningState: 'VALIDATED', source: 'KNOWLEDGE_STATE_VALIDATED' };
  }
  return { learningState: 'DEVELOPING', source: 'KNOWLEDGE_STATE_RESIDUAL' };
}
```

Also deleted: the `KNOWLEDGE_STATE_VALIDATED` / `KNOWLEDGE_STATE_RESIDUAL`
/ `NO_KNOWLEDGE_STATE` members of `ConceptMissionJourneySource`, and the
`.catch(() => null)` on the decision read in the service.

---

## 5. No-state UX

When `journey.status === 'UNAVAILABLE'` (decision read failed):

- **Journey section header:** *"Learning status not available right now."*
  (localized, `conceptMission.journeyUnavailable`) — no "You are here",
  no stage name.
- **Rail:** all five rungs render with `position: 'INDETERMINATE'`
  (dashed border, neutral `·` glyph, no brand "current" highlight). A
  rung still shows `✓` iff a **canonical record** proves it
  (`evidenceCount > 0`, `independentEvidenceCount > 0`,
  `lastSuccessfulRetentionAt`, demonstrated `transferDepth`) — those
  facts are true independent of `LearningState`, so keeping them is
  honest, not invented.
- **No** reason line, **no** REINFORCE card.
- **NOW:** `NO_CANONICAL_ACTION`, `fallback: 'LEARN_FIRST'` — "Start by
  understanding it" with the inline explanation disclosure. No invented
  next action.
- **Preserved:** concept identity, goal, the Learn surface, "Ask the
  tutor", the "More about my progress" disclosure (its canonical
  measures render exactly as before — they never needed `LearningState`).

Visually verified at 375px via the LX-3 markup harness (scenario F).

---

## 6. Accessibility repair — duplicate nav landmark

`LearnerShell`'s `NavList` rendered `<nav aria-label="Primary">` and is
used twice (persistent sidebar + slide-in drawer), so the accessibility
tree could carry two identically-named `navigation` landmarks, and the
name was a hard-coded English string.

Fix: `NavList` now takes a **required** `label: string`.

- Sidebar: `label={navLabel}` → `t['nav.primary']` — *"Main navigation"*
  / *"Navegación principal"* / *"Hauptnavigation"* /
  *"Navigation principale"* / *"Navegação principal"*.
- Drawer: `label={menuLabel}` → `t['nav.menu']` (*"Menu"* / *"Menú"* …),
  matching the drawer dialog's own `aria-label`.

Two navigation landmarks, each with a **distinct, localized**
accessible name. No LX-2 navigation redesign. Test:
`lx3-concept-mission-i18n.test.ts` asserts `nav.primary` is present,
non-empty, and `!== nav.menu` in every locale;
`lx3r-canonical-state-boundary.test.ts` asserts the hard-coded `"Primary"`
is gone and the two call sites pass distinct labels.

---

## 7. Tests

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| LX-3 / LX-3R unit (`lx3-concept-mission*.test.ts`, `lx3r-canonical-state-boundary.test.ts`) | 44 passed |
| full `npx vitest run` | **171 files / 2475 passed** (was 2459 at LX-3) |
| `npm run build` | green — compiled OK, 91/91 static pages, no warnings |
| visual review | markup harness scenarios PRACTICE·canonical, NOT_STARTED, CONSOLIDATED, REINFORCE, **UNAVAILABLE (LX-3R, scenario F)** at 375px — no overflow, honest no-state presentation confirmed |

Coverage of the 9 required proofs:

1. no fabricated `LearningState` fallback — `effectiveLearningState`
   removed; no `learningState: 'DEVELOPING'|'VALIDATED'|'NOT_STARTED'`
   literal assignment anywhere in `concept-mission.ts`.
2. `null` decision does not become `DEVELOPING` — the pure builder
   honours the resolved `learningState` as-is; the service resolves it
   via `computeLearningState`, never a hardcoded `'DEVELOPING'`.
3. validated `MasteryState` alone does not manufacture
   `LearningState.VALIDATED` — no `masteryState === 'VALIDATED_MASTERY'`
   in `concept-mission.ts`; a read-failure with `VALIDATED_MASTERY` KS →
   `journey.status === 'UNAVAILABLE'`, not `CONSOLIDATED`.
4. canonical `LearningState` still maps normally — all 9 stages
   (`RESOLVED` path) covered.
5. `NO_CANONICAL_ACTION` remains when no canonical action — asserted for
   both the `RESOLVED`-no-decision and `UNAVAILABLE` paths.
6. no `ActivityType` invented — `now.activityType` is `null` without a
   decision, verbatim with one.
7. no score threshold introduced — `concept-mission.ts` contains no
   `masteryScore`/`understandingScore`/`forgettingRisk`/… and the only
   numeric comparisons are `> 0` presence checks.
8. no new learning policy in Concept Mission — the model defines no
   `computeLearningState`/`selectActivityType`; the service **imports**
   the canonical `computeLearningState` and reuses it.
9. duplicate nav label resolved — §6.

---

## 8. Compatibility

No canonical engine or service changed:
`adaptive-learning-orchestrator`, `adaptive-learning-policy`
(`computeLearningState` **consumed, unmodified**;
`ADAPTIVE_LEARNING_POLICY_VERSION` still 3), `getLearningDecisions`,
`getBestLearningDecisionForConcept`, `knowledge-state.service`,
`learner-twin`, Phase 6 memory read, Phase 7 transfer read,
`remediation.service` / session engine, all certified label/CTA/why
mappers, `ConceptExplanationPanel` + its service/API, the LX-1
`learner-journey-contract`. No schema / route / API change. LX-2
navigation architecture unchanged (one prop added to `LearnerShell`;
the shell layout, breakpoints, drawer, and focus trap are untouched).

---

# LX-3R — CANONICAL STATE BOUNDARY REPAIR CERTIFICATION

## STATUS
**PASS**

## REMOVED NON-CANONICAL LOGIC
`effectiveLearningState()` in `src/lib/lx/concept-mission.ts` — the
function that manufactured a `LearningState` from `MasteryState` when
Phase 4 returned no decision (`VALIDATED_MASTERY → 'VALIDATED'`,
`UNKNOWN/null → 'NOT_STARTED'`, `otherwise → 'DEVELOPING'`), plus its
`KNOWLEDGE_STATE_VALIDATED` / `KNOWLEDGE_STATE_RESIDUAL` /
`NO_KNOWLEDGE_STATE` journey sources, and the `.catch(() => null)` on
the decision read that erased the success/failure distinction.

## CANONICAL STATE SOURCE
Resolved entirely in the read boundary
(`concept-mission-view.service.ts`), never in the presentation layer:
1. **Phase 4 `LearningDecision` present** → `decision.learningState`
   (source `LEARNING_DECISION`).
2. **Phase 4 read succeeded, no decision** → the concept authoritatively
   emitted zero signals, so the boundary calls the **canonical pure
   policy** `computeLearningState({ knowledgeState, signals: [] })` —
   imported from `@/lib/adaptive-learning-policy`, reused verbatim, no
   rule re-implemented (source `CANONICAL_POLICY_NO_SIGNALS`). Correct
   because every signal-only branch of `computeLearningState` maps to a
   state that would itself have produced a decision.
3. **Phase 4 read failed (threw)** → no canonical state → journey
   `status: 'UNAVAILABLE'`.
The pure builder only routes a `RESOLVED` `learningState` through LX-1's
`deriveLearnerJourneyStage`.

## NO-STATE BEHAVIOR
`journey.status === 'UNAVAILABLE'`: the Journey section shows
*"Learning status not available right now."* with no stage marker; the
five rungs render as `INDETERMINATE` (dashed, neutral glyph, no
"current"), keeping a `✓` only where a concrete canonical record proves
the rung. No reason line, no REINFORCE card, no invented next action
(`now` = `NO_CANONICAL_ACTION` / `LEARN_FIRST`). Concept identity, goal,
the Learn surface, and the "More about my progress" disclosure are all
preserved and fully usable.

## CONCEPT MISSION FINAL STATUS
**PASS**

## REMAINING CONDITIONS
- **C1 — full per-state visual verification pending.** LEARN /
  READY_TO_PROVE / PROVE / RETAIN / TRANSFER and the demonstrated /
  position matrix are unit + read-model verified; PRACTICE·canonical,
  NOT_STARTED, CONSOLIDATED, REINFORCE, and UNAVAILABLE are also
  verified visually via a faithful markup harness at 375 / 768 / 1440.
  An end-to-end pass with a seeded authenticated learner (deployed
  preview, or Playwright + Clerk testing tokens) is still owed — the
  environment has no authenticated learner session. (Carried from LX-3.)
- **C2 — concept goal quality.** Depends on
  `concept_localizations.description` authoring; concepts without one
  fall back to a name-based template. Real per-concept objectives are a
  content/curriculum effort outside LX-3. (Carried from LX-3.)

The LX-3 conditions C3 (duplicate nav label) and C4 (fabricated
`LearningState` fallback) are **closed** by this repair.

## NEXT PHASE
`LX-4 — Teaching & Active Learning Experience` — authorized only once
this certification is accepted. **Do NOT implement LX-4.**

STOP.
