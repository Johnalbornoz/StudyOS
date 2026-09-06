# STUDYUS — LX-3 — CONCEPT MISSION

Branch `tmp/lx1` · commit `e7f3816` (on `c0d06cf` LX-2P).
`tsc` clean · `vitest` 170 files / 2459 passed · `next build` green.

---

## 1. LX-3A — current concept experience audit

### A1 — current concept page map (pre-LX-3, `.../concepts/[conceptId]/page.tsx`)

| Section | Data source | Canonical? | Learner value | LX-3 disposition |
|---|---|---|---|---|
| Breadcrumb + `<h1>` concept label | `concepts` / `concept_localizations.label` | yes | identity | **keep** (in `ConceptMission`) |
| "What next / Why" card (`nextDecision`) | `getBestLearningDecisionForConcept` → `activityLabel` + `WhyThisV3` + `StartSessionButton` | yes (Phase 4) | the one next action | **keep, relocated** into the Mission NOW |
| "Tu situación actual" banner | `conceptSituation(masteryState, validationReadiness, memoryStatus)` | yes (mapping) | "where am I" one-liner | **demote** into `<details>` (Journey now answers this) |
| `primaryCTA` heuristic (`state.masteryScore < 50 ? … : …`) + `ctaConfig` + "Other ways" link row (practice / soloCheck / review / tutor quiz URLs) | page-local thresholds over `getConceptView` scores | **NO** — page-local pedagogy | **remove entirely** (LX-3 mandate) |
| "Tu aprendizaje" KPI grid: mastery %, freshness, independent %, confidence, calibration, evidence strength, transfer phrase | `getConceptView` (Twin) + `getConceptTransferDepth` | yes | detailed measures | **demote** into `<details>` |
| last demonstrated / next review dates | `getConceptView.memory` | yes | scheduling detail | **demote** into `<details>` |
| Knowledge State card (5 dimension KPIs + MasteryState badge) | `getConceptKnowledgeState` + `knowledgeKpis` | yes | detailed measures | **demote** into `<details>` |
| "Why StudyUS thinks…" evidence facts | `getConceptEvidenceSummary` | yes | evidence transparency | **demote** into `<details>` |
| Learning-debt criteria checklist | `getLearningDebtCriteriaProgress` | yes | debt exit detail | **demote** into `<details>` |
| Evidence history log | `getConceptEvidenceHistory` | yes | audit log | **keep** below the disclosure |
| `!state` early-return branch → bare label + a `/dashboard/quiz` practice link | page-local | **NO** — page-local activity pick | **removed** — every concept now gets a real Mission (NOT_STARTED → LEARN-first) |

### A2 — current decision flow (pre-LX-3)

```
Canonical state
  getConceptKnowledgeState ── MasteryState / ValidationReadiness / dimensions
  getConceptView (Twin)  ──── mastery / independence / memory / metacognition scores
  getBestLearningDecisionForConcept ── Phase 4 LearningDecision (activityType, facts, learningState)
        ↓
Current page logic
  ├─ "What next / Why" card  →  renders LearningDecision verbatim         ← canonical ends here (OK)
  └─ primaryCTA = state.masteryScore < 50 ? 'practice'
                 : independentMastery < masteryScore-15 ? 'soloCheck'
                 : retention < 50 ? 'review' : 'tutor'                    ← PAGE-LOCAL PEDAGOGY (the LX-0 finding)
        ↓
CTA
  ├─ StartSessionButton(actionConceptId)  → /api/learning/session/start   ← canonical launch (OK)
  └─ "Other ways" row: 4 hard-coded quiz-mode URLs, ordered by primaryCTA ← second, page-local action surface
```

**LX-0 finding, verified against the current tree:** the `primaryCTA`
chain still existed. Since 6L-C1-R1 it no longer rendered as "what to do
now" (that had moved to the canonical card), but it still **interpreted
scores locally** (`< 50`, `< masteryScore - 15`) to *select and order*
four alternative learning activities the learner could take instead of
the canonical one — a second, score-driven pedagogical surface. LX-3
**removes it**: no `primaryCTA`, no `ctaConfig`, no `orderedManualToolKeys`,
no quiz-mode link row. Canonical authority now ends at exactly one place
(the Mission NOW), and nothing on the screen lets the learner pick an
activity that bypasses Phase 3C/4.

---

## 2. Concept Mission architecture (LX-3B)

Two additive modules, mirroring `learning-os-snapshot.service` /
`remediation-session-view.ts`:

| File | Kind | Responsibility |
|---|---|---|
| `src/lib/lx/concept-mission.ts` | **pure** | `buildConceptMissionView(inputs) → ConceptMissionView`. Types + all presentation derivation. No I/O. Unit-tested in isolation. |
| `src/services/concept-mission-view.service.ts` | **read boundary** | `getConceptMissionView(studentId, subjectId, conceptId, locale, goalFallbackText)`. One concept/subject/description row + one `Promise.all` of canonical reads (`getConceptView`, `getConceptKnowledgeState`, `getBestLearningDecisionForConcept`, `getConceptTransferDepth`, a cheap `concept_explanations` existence check), each `.catch`-degraded. Calls the pure builder. Returns `{status:'OK', view}` \| `{status:'NOT_FOUND'}`. |
| `src/app/…/[conceptId]/ConceptMission.tsx` | presentation | Renders the view. Chooses nothing. |
| `src/app/…/[conceptId]/ConceptExplanationDisclosure.tsx` | presentation (`'use client'`) | The LEARN surface. Lazily `GET /api/concepts/[id]/explanation`, renders the existing `ConceptExplanationPanel`. |
| `src/app/…/[conceptId]/page.tsx` | page | Mission on top; canonical measures inside `<details>`; history below. |

`ConceptMissionView` shape: `identity` · `goal {text, source}` ·
`journey {stage, intervention, reasonCode, milestones[], source}` ·
`now {kind, activityType, actionConceptId, facts, fallback}` ·
`learn {available, state, prominence}` · `contractVersion`.

**Boundary:** the Mission consumes canonical values only. The single
derivation it performs beyond pass-through is the decision-less
`LearningState` fallback (§4). It never calls `computeLearningState`,
never reads a raw score/threshold, never grades, never writes.

---

## 3. Concept goal (LX-3C)

**Audit result.** The only canonical per-concept prose is
`concept_localizations.description` (localized, nullable) and
`concept_explanations.content` (localized AI teaching body, generated on
demand). There is no `learning_objective` / competency-statement table,
no curriculum-hierarchy objective field.

**Decision.**
- **Primary source:** `concept_localizations.description` for the
  interface locale, when non-blank → `goal.source = 'CONCEPT_DESCRIPTION'`.
- **Fallback:** a presentation-only interface-language template,
  `conceptMission.goalFallbackTemplate` = *"Understand {concept} and
  apply it correctly and on your own."* (5 locales) →
  `goal.source = 'FALLBACK_FROM_NAME'`. Interpolated by the read
  boundary, passed into the pure builder.
- **No** new `learningObjective` system, **no** AI generation, **no**
  persistence. `getConceptExplanation` is *not* called by the Mission
  (it generates + writes on a miss).

**Honest limitation (condition):** goal quality depends on authoring —
many concepts will have no `description` and fall back to the template.
Establishing real per-concept objectives is a content/curriculum job,
explicitly out of LX-3 scope.

---

## 4. Journey presentation (LX-3D)

Stage comes **only** from LX-1 `deriveLearnerJourneyStage`. The rail is
five learner-visible rungs — **Learn → Practice → Prove → Retain →
Transfer** — rendered as an `<ol>` of `.cm-rung` cells.
`READY_TO_PROVE` is a `readyToProve` flag on the Prove rung, not a sixth
rung. `CONSOLIDATED` = every rung `PASSED`. `NOT_STARTED` = Learn is
`CURRENT`.

| journey stage | current rung | note |
|---|---|---|
| NOT_STARTED | Learn | — |
| LEARN | Learn | — |
| PRACTICE | Practice | — |
| READY_TO_PROVE | Prove | `readyToProve: true` → "Ready to prove it on your own." |
| PROVE | Prove | — |
| RETAIN | Retain | — |
| TRANSFER | Transfer | — |
| CONSOLIDATED | (none — all PASSED) | — |

**Position** per rung: index `< current` → `PASSED`, `=` → `CURRENT`,
`>` → `UPCOMING`. Marker glyph + a visually-hidden full sentence
(`conceptMission.milestone.{passed,current,upcoming,demonstrated}` with
`{stage}` interpolated) — never colour/icon alone.

**Completion history — audited, not invented.** A rung is `demonstrated`
(✓, `.cm-rung-done`) **only** when a specific canonical record proves it,
independent of `position`:

| rung | canonical proof | `demonstratedBy` |
|---|---|---|
| Learn / Practice | `knowledgeState.evidenceCount > 0` | `EVIDENCE_RECORDED` |
| Prove | `knowledgeState.independentEvidenceCount > 0` | `INDEPENDENT_EVIDENCE_RECORDED` |
| Retain | `memory.lastSuccessfulRetentionAt != null` | `RETENTION_DEMONSTRATED` |
| Transfer | `transferDepth != null && != 'NONE'` | `TRANSFER_DEMONSTRATED` |

These are presence checks on canonical counts/timestamps, never score
thresholds. A `PASSED` rung with no backing record renders as "earlier
step" (`–`), not as done. Unit test `demonstrated is backed by a named
canonical record, never by position` locks this.

**Decision-less `LearningState` fallback** (the one derivation).
`deriveLearnerJourneyStage` needs a Phase 4B `LearningState`, which only
exists while Phase 4 has an actionable decision. When
`getBestLearningDecisionForConcept` returns `null` (brand-new or already
validated concept), the builder maps the two remaining canonical
knowledge-state facts:

```
no decision + masteryState null|'UNKNOWN'   → LearningState 'NOT_STARTED'  (journey.source NO_KNOWLEDGE_STATE)
no decision + masteryState 'VALIDATED_MASTERY' → LearningState 'VALIDATED'  (journey.source KNOWLEDGE_STATE_VALIDATED)
no decision + otherwise                     → LearningState 'DEVELOPING'   (journey.source KNOWLEDGE_STATE_RESIDUAL)
```

This is a state-enum → state-enum translation, not a score computation
and not a re-ordering of `computeLearningState`'s precedence (there are
no competing signals to order — by definition the orchestrator produced
no decision). Rule 7 of the contract then splits `DEVELOPING` using the
canonical `masteryState` / `validationReadiness` it already consumes.
`journey.source` records the path for auditability. Documented in the
module header; carried as a condition.

---

## 5. REINFORCE presentation (LX-3D)

`deriveLearnerJourneyStage` returns `intervention: 'REINFORCE'` with a
best-effort underlying `stage` (`PRACTICE`). The Mission renders it as
**temporary support on the same mission**, inside the Journey section:
a small `.card` under the rail — `conceptMission.reinforceBadge`
("Temporary support", warning colour) + `conceptMission.reinforceBody`
("You're getting extra support on the same goal. Once it's cleared,
you're back on your path."). It is **not** a separate rung, **not** a
different section. The NOW card still carries the canonical action
(typically `activityType 'REMEDIATION'` → `activityLabel` /
`activityCta` / `StartSessionButton`), so launching remediation goes
through the certified 6L-B1 session-engine chain unchanged. LX-3 does
**not** implement the return-to-mission mechanism — that is LX-5.

---

## 6. NOW — the one primary action (LX-3E)

`now.kind`:
- **`CANONICAL_ACTION`** — `getBestLearningDecisionForConcept` returned a
  decision. `now.activityType` / `now.actionConceptId` / `now.facts` are
  **verbatim** from it. Rendered: `activityLabel(now.activityType, t)`
  heading + `<WhyThisV3 facts={now.facts}>` + `<StartSessionButton
  actionConceptId={now.actionConceptId} label={activityCta(...)}>`
  (brand 2px card). The Mission never selects or substitutes the
  `ActivityType` — unit test `passes the canonical decision through
  verbatim` + `never emits an activity when Phase 4 has no decision`.
- **`NO_CANONICAL_ACTION`** — no decision. `activityType` / `actionConceptId`
  are `null`, `facts` empty. `now.fallback`:
  - `CONSOLIDATED_NO_ACTION` (stage CONSOLIDATED) → calm card:
    "Consolidated / Nothing is needed right now. StudyUS will bring this
    back for a retention check when it's due." No CTA.
  - `LEARN_FIRST` (any other decision-less stage) → "Start by
    understanding it" + the explanation disclosure rendered inline &
    primary. This routes to the LEARN surface, not to a taxonomy
    `ActivityType`.

**Time estimate:** deliberately **omitted**. No `timeEstimate` /
`estimatedMinutes` field exists on the view; unit test asserts the
serialized view contains no `min` token. There is no canonical
estimated-duration authority to show.

**Secondary actions:** "Read/Review the explanation" (disclosure) +
"Ask the tutor" (link). Both `btn-secondary`. **No** alternative
learning activities — nothing lets the learner bypass Phase 3C/4.

---

## 7. Progressive disclosure (LX-3G)

Primary flow, in order: **1. concept + goal · 2. journey · 3. now**
(+ inline LEARN when understanding is the job).

Everything measured moved into a native `<details class="cm-more">`
("More about my progress" + "Detailed measures — you don't need these to
keep going"): the situation one-liner, the 7-card KPI grid, last-demonstrated
/ next-review dates, the Knowledge State dimension card, the evidence
"why" facts, the learning-debt criteria. The underlying services are
**unchanged** — only their placement. Evidence history stays below the
disclosure.

Test applied to every demoted card — *"does this help the learner
understand what they're learning, where they are, or what to do next?"* —
all answered **no** for the primary flow (they're measures, not
direction), so all demoted; none deleted.

---

## 8. Learn / explanation integration (LX-3F)

`ConceptExplanationDisclosure.tsx` (`'use client'`): a
keyboard-accessible disclosure (`<button aria-expanded aria-controls>` +
`[hidden]` panel) that on first open lazily calls the **existing**
`GET /api/concepts/[id]/explanation` (→ `getConceptExplanation`) and
renders the **existing** `ConceptExplanationPanel`. No new tutoring
surface. Nothing fetches on mission render — that endpoint generates +
persists AI content on a cache miss, so the read boundary only does a
cheap `SELECT 1 FROM concept_explanations` existence check to pick
"Read" vs "Review" copy (`learn.state`).

`learn.prominence`:
- `PRIMARY_INLINE` when understanding is the current job — stage `LEARN`,
  `NOT_STARTED`, or `intervention === 'REINFORCE'`. Rendered inline right
  after (or as) the NOW card.
- `SECONDARY` otherwise — a `btn-secondary` in the secondary row.

---

## 9. Responsive (LX-3H)

Verified with a faithful markup harness (the real `.cm-*` CSS + real
localized copy, five canonical scenarios) served through the worktree
dev server, at 375 / 768 / 1440; plus the live route SSRs without error.
A real authenticated learner session is not obtainable in this
environment (same Clerk limitation recorded in LX-2P), so per-state
*data* wiring is unit / read-model verified (§13).

| width | journey rail | overflow | above-the-fold on mobile |
|---|---|---|---|
| 375 | 5 rungs **stacked** (`@media max-width:480px`), each full-width | none (`scrollW == 375`) | concept + goal + "You are here: {stage}" + full rail visible; NOW title visible, Continue ~1 short scroll |
| 768 | 5 rungs, **single row** | none | concept + goal + rail + NOW card + secondary all above the fold |
| 1440 | single row | none | — |

`<details>` toggles (native; `openH > closedH` confirmed). Consolidated
rail renders all-`done`; REINFORCE rail renders Learn `passed` +
"Temporary support" card.

---

## 10. Accessibility (material findings)

- **Journey not conveyed by colour/glyph alone:** each `<li>` carries a
  visually-hidden full sentence ("Practice — you are here", "Learn —
  done, you've shown this", …); glyph and label are `aria-hidden`.
- **Heading hierarchy:** page `<h1>` (concept) → `<h2>` section titles
  (goal / journey / now / learn) inside `ConceptMission`; the disclosure
  uses `<h3>` for its sub-cards (one level below the `<summary>`). Flat,
  no skipped levels.
- **Disclosures keyboard-operable:** the explanation uses a real
  `<button aria-expanded aria-controls>` toggling a `[hidden]` panel;
  "More about my progress" is a native `<details>`/`<summary>` with a
  visible `:focus-visible` ring (`.cm-more > summary`).
- **Primary CTA understandable out of context:** `StartSessionButton`
  gets `accessibleLabel = "{cta}: {activityLabel}"` (e.g. "Start:
  Reinforcement session").
- **Touch targets:** `.btn` ≥ 38px; stacked rungs are full-width rows.
- **Known nit (condition):** the page still renders two `<nav
  aria-label="Primary">` landmarks via the LX-2 shell (one
  `display:none` on mobile) — carried from LX-2P, not re-touched here.

---

## 11. i18n (LX-3I)

43 new `conceptMission.*` keys, one entry per key in **every** locale
(es/en/de/fr/pt), inserted into the `MessageKey` union + all five
`Messages` records via `scratchpad/i18n_lx3.py`:

- `stage.{NOT_STARTED,LEARN,PRACTICE,READY_TO_PROVE,PROVE,RETAIN,TRANSFER,CONSOLIDATED}`
- `milestone.{passed,current,upcoming,demonstrated}` (`{stage}` placeholder)
- `reason.{12 codes}` — one per string `deriveLearnerJourneyStage` can return
- `goalTitle`, `goalFallbackTemplate` (`{concept}`), `journeyTitle`,
  `journeyYouAreHere` (`{stage}`), `nowTitle`,
  `noAction{ConsolidatedTitle,ConsolidatedBody,LearnFirstTitle,LearnFirstBody}`,
  `reinforce{Badge,Body}`, `learn{Title,ExpandRead,ExpandReview,Collapse}`,
  `more{Title,Hint}`, `secondaryTutor`, `readyToProveNote`

All copy is **interface** language. Concept content (label / description /
explanation) keeps its own content language — not collapsed. No
target-learning-language assumption (that is LX-8).
`tests/unit/lx3-concept-mission-i18n.test.ts` asserts every key resolves
×5, placeholders survive translation, and every contract reason code is
covered.

---

## 12. Files changed

| File | New/Mod | Responsibility |
|---|---|---|
| `src/lib/lx/concept-mission.ts` | **new** | pure read model + `buildConceptMissionView` |
| `src/services/concept-mission-view.service.ts` | **new** | canonical read boundary |
| `src/app/dashboard/subjects/[id]/concepts/[conceptId]/ConceptMission.tsx` | **new** | Mission presentation (identity/goal/journey/now/learn) |
| `src/app/dashboard/subjects/[id]/concepts/[conceptId]/ConceptExplanationDisclosure.tsx` | **new** | lazy LEARN disclosure over the existing explanation API/panel |
| `src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx` | **mod** | Mission on top; measures → `<details>`; removed `primaryCTA`/`ctaConfig`/manual-tool row; no longer fetches a decision |
| `src/app/globals.css` | **mod** | `.cm-rail` / `.cm-rung*` journey rail + `.cm-more > summary` focus ring (+50 lines) |
| `src/lib/i18n/messages.ts` | **mod** | 43 `conceptMission.*` keys ×5 locales |
| `tests/unit/lx3-concept-mission.test.ts` | **new** | pure model — 9 stages + action/goal/milestone/learn invariants |
| `tests/unit/lx3-concept-mission-i18n.test.ts` | **new** | i18n coverage |
| `tests/unit/6l-c1-concept-next-action.test.ts` | **mod** | retargeted to the relocated Mission files (same invariant) |
| `tests/unit/6l-c1-r1-next-action-reconciliation.test.ts` | **mod** | reconciliation superseded — asserts the LX-3 end-state (heuristic gone) |
| `tests/unit/6l-a-learning-experience.test.ts` | **mod** | one regex loosened for `conceptView?.` (situation call unchanged in intent) |
| `tests/unit/6l-c2-b1-progress-semantics.test.ts` | **mod** | 2 assertions updated to the LX-3 architecture |

---

## 13. Tests

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| LX-3 unit (`lx3-concept-mission*.test.ts`) | 28 passed |
| full `npx vitest run` | **170 files / 2459 passed** (was 2437 at LX-2P) |
| `npm run build` | green — compiled OK, 91/91 static pages, no warnings |
| visual review | harness at 375 / 768 / 1440 for scenarios **PRACTICE + canonical action**, **NOT_STARTED / LEARN-first**, **CONSOLIDATED**, **REINFORCE**; live route SSR (unauthenticated) 200, no error |

**States visually verified (layout/a11y, via harness):** PRACTICE·canonical
action, NOT_STARTED, CONSOLIDATED, REINFORCE. **States verified by
unit/read-model only:** LEARN, READY_TO_PROVE, PROVE, RETAIN, TRANSFER,
and every `demonstrated`/`position` combination — no authenticated
learner session with seedable per-concept canonical state is available
in this environment (documented, not claimed as screenshots).

---

## 14. Compatibility

Canonical engines/services **untouched**:
`adaptive-learning-orchestrator`, `adaptive-learning-policy`
(`ADAPTIVE_LEARNING_POLICY_VERSION` still 3), `getLearningDecisions`,
`getBestLearningDecisionForConcept`, `knowledge-state.service`,
`learner-twin`, `learning-os-snapshot.service`, Phase 6 memory read,
Phase 7 transfer read, `remediation.service` / session-engine,
`activityLabel` / `activityCta` / `WhyThisV3` / `StartSessionButton` /
`concept-situation-labels` / `knowledge-state-labels` /
`transfer-progression-labels` / `ConceptExplanationPanel` /
`concept-explanation.service`. No schema, route, or API change. LX-1
contracts unchanged (`learner-journey-contract` consumed, not modified).
LX-3 adds two read-only modules + presentation; it removes only
page-local presentation logic (`primaryCTA` and its link row).

---

## 15. Deferred findings (strictly LX-4 → LX-10)

| Observed | Owner |
|---|---|
| Quiz setup still asks `maxQuestions`; question UI doesn't say "Show Work"; static difficulty dots; sidebar visible during a quiz | **LX-4** |
| Response Contract / Evidence Sufficiency / target-difficulty authority remain unwired | **LX-4** |
| After a Mission activity the learner lands back on the subject page (no continuation); REINFORCE has no return-to-mission | **LX-5** |
| Today still needs the recommendation redesign | **LX-6** |
| "My Path" still maps to the Subjects list | **LX-7** |
| Smart-math toolbar, speech-to-text, text-to-speech, listening/speaking, curated external (YouTube) content | **LX-8** |
| Motivational framing of CONSOLIDATED / streaks / rewards | **LX-9** |
| Journey / mission measurement & analytics | **LX-10** |

None solved here.

---

# LX-3 — CONCEPT MISSION CERTIFICATION

## STATUS
**PASS_WITH_CONDITIONS**

## CONCEPT MISSION
Final information hierarchy (top → bottom):

1. **Identity** — subject breadcrumb + concept `<h1>`
2. **Goal** — one learner-facing sentence ("What success looks like")
3. **Journey** — "You are here: {stage}"; 5-rung rail
   (Learn→Practice→Prove→Retain→Transfer) with per-rung position +
   evidence-backed ✓; one canonical reason line; REINFORCE shown here as
   "temporary support" when active
4. **Now** — exactly one action: the canonical `LearningDecision`
   (`activityLabel` + `WhyThisV3` + `StartSessionButton`), or a calm
   no-action state (CONSOLIDATED) / "understand it first" (LEARN-first)
5. **Learn** — the existing explanation, inline & primary when
   understanding is the job, else a secondary disclosure
6. **Secondary** — review explanation · ask the tutor (no alternative activities)
— then —
7. **`<details>` "More about my progress"** — situation line, KPI grid,
   Knowledge State dimensions, evidence facts, debt criteria (all
   canonical, unchanged services)
8. Evidence history log

## CANONICAL INPUTS
- `getConceptView` (Learner Twin) — memory `lastSuccessfulRetentionAt` /
  `retentionDue` / `memoryStatus`; (disclosure) mastery / independence /
  metacognition scores
- `getConceptKnowledgeState` — `masteryState`, `validationReadiness`,
  `evidenceCount`, `independentEvidenceCount`; (disclosure) 5 dimensions
- `getBestLearningDecisionForConcept` → Phase 4 `LearningDecision` —
  `activityType`, `actionConceptId`, `facts`, `learningState`
- `getConceptTransferDepth` (Phase 7) — `TransferDepth`
- `deriveLearnerJourneyStage` (LX-1 contract) — the learner-visible stage + intervention + reason
- `concept_localizations` (label + description) · `concepts` · `subjects`
- `concept_explanations` (existence check only) + `GET /api/concepts/[id]/explanation` (lazy) + `ConceptExplanationPanel`
- presentation: `activityLabel`, `activityCta`, `WhyThisV3`,
  `StartSessionButton`, `conceptSituation(Label)`, `knowledgeKpis`,
  `masteryStateLabel`, `transferDepthLabel`
- (disclosure) `getConceptEvidenceSummary`, `getConceptEvidenceHistory`,
  `getLearningDebtCriteriaProgress`

## JOURNEY
| StudyUS canonical state | learner-visible stage |
|---|---|
| `LearningState NOT_STARTED` / no `MasteryState` / `UNKNOWN` | **Not started** (Learn rung current) |
| `MISCONCEPTION_BLOCKED` / `PREREQUISITE_BLOCKED` / `NEEDS_REPAIR` | stage **Practice** + **REINFORCE** overlay |
| `PENDING_VERIFICATION` / `INSUFFICIENT_INDEPENDENT_EVIDENCE` | **Prove** |
| `RETENTION_RISK` | **Retain** |
| `TRANSFER_GAP` | **Transfer** |
| `VALIDATED` (or no decision + `VALIDATED_MASTERY`) | **Consolidated** |
| `MasteryState LEARNING` (nothing blocking) | **Learn** |
| `ValidationReadiness READY`, not yet validated | **Ready to prove** (Prove rung, readiness flag) |
| residual `DEVELOPING` band | **Practice** |

## PRIMARY ACTION
`now.activityType` is **exactly** `LearningDecision.activityType` from
`getBestLearningDecisionForConcept`, rendered through `activityLabel` /
`activityCta` and launched by `StartSessionButton` →
`POST /api/learning/session/start`. The Mission never selects,
substitutes, re-orders, or reconciles an `ActivityType`. When Phase 4
returns `null`: `now.kind = 'NO_CANONICAL_ACTION'`, `activityType = null`,
and the screen offers the LEARN surface or a calm consolidated state —
never a fabricated activity. Locked by
`tests/unit/lx3-concept-mission.test.ts`.

## WHAT WAS REMOVED OR DEMOTED
**Removed (presentation logic only):**
- the page-local `primaryCTA` heuristic (`state.masteryScore < 50 ? … `) — the LX-0 finding
- `ctaConfig` + `orderedManualToolKeys` + the "Other ways" row of four
  hard-coded `/dashboard/quiz?mode=…` links
- the `!state` early-return branch's page-local practice link

**Demoted (moved into `<details>`, unchanged):** situation banner, KPI
grid, last-demonstrated/next-review dates, Knowledge State dimension
card, evidence "why" facts, learning-debt criteria.

## WHAT WAS PRESERVED
Every canonical engine and service in §14 — orchestrator, policies,
knowledge-state, twin, memory/transfer reads, session engine,
remediation, all certified label/CTA/why mappers,
`ConceptExplanationPanel` + its service/API. No schema/route/API change.
LX-1 contracts consumed unmodified.

## RESPONSIVE CERTIFICATION
- **375px** — no horizontal overflow; rail stacks to 5 full-width rows;
  concept + goal + "You are here" + rail above the fold; NOW just below.
- **768px** — no overflow; rail single row; whole Mission above the fold.
- **1440px** — no overflow; rail single row; `<details>` collapsed by default.
Verified via a faithful `.cm-*` markup harness (real CSS + real copy)
for 4 canonical scenarios; live route SSRs clean. Full per-state visual
verification with seeded canonical data is blocked by the absence of an
authenticated learner session in this environment (condition C1).

## ACCESSIBILITY
Journey status is text, not colour/glyph (sr-only sentence per rung);
flat `h1 → h2 → h3` hierarchy; explanation disclosure is a real
`aria-expanded`/`aria-controls` button over a `[hidden]` panel; "More
about my progress" is native `<details>` with a visible focus ring;
primary CTA has an out-of-context `accessibleLabel`; touch targets
≥ 38px. Residual: the LX-2 shell's duplicate `<nav aria-label="Primary">`
(one `display:none`) — condition C3.

## CONDITIONS
- **C1 — full per-state visual verification pending.** LEARN /
  READY_TO_PROVE / PROVE / RETAIN / TRANSFER and the
  demonstrated/position matrix are unit/read-model verified only; a
  deployed preview with a seeded test learner (or Playwright + Clerk
  testing tokens) is needed to screenshot them against real canonical
  state.
- **C2 — concept goal quality.** Depends on `concept_localizations.description`
  authoring; concepts without one show a name-based template. Real
  per-concept objectives are a content/curriculum effort outside LX-3.
- **C3 — carried a11y nit from LX-2.** Duplicate hard-coded
  `<nav aria-label="Primary">` landmark from `LearnerShell`; localise /
  differentiate in the LX-8 shell pass.
- **C4 — decision-less `LearningState` fallback.** When Phase 4 has no
  decision, the Mission maps `VALIDATED_MASTERY → 'VALIDATED'`, else
  `'DEVELOPING'`, else `'NOT_STARTED'` to feed the LX-1 contract. It is
  a state→state translation, documented and `journey.source`-tagged; if
  a canonical decision-independent per-concept `LearningState` reader is
  added later, the fallback should defer to it.

## DEFERRED
Per §15 — strictly LX-4 (active learning / quiz setup / response
contract / adaptive count / difficulty authority / focus mode),
LX-5 (continuation, results dead-ends, REINFORCE return), LX-6 (Today),
LX-7 (My Path), LX-8 (Smart Math, STT/TTS, multilingual speaking,
curated external content), LX-9 (motivation/rewards), LX-10
(measurement). None addressed here.

## ARCHITECTURAL INVARIANTS (future phases must preserve)
1. The Concept Mission **presents** canonical truth; it never computes
   mastery, evidence sufficiency, difficulty, or a question count, and
   never grades.
2. `now.activityType` is a **verbatim** pass-through of the canonical
   `LearningDecision`. No LX phase may let the Mission select, reorder,
   reconcile, or substitute an `ActivityType`, or add a second
   next-action surface / heuristic on this screen.
3. The learner-visible stage comes **only** from
   `deriveLearnerJourneyStage` (LX-1). No score threshold, no new
   mastery calculation, no persistence of `LearnerJourneyStage`.
4. A journey rung is `demonstrated` **only** with a named canonical
   record; completion is never inferred from stage position.
5. The Mission stays **activity-agnostic** — no assumption that a
   concept contains only text activities; no speculative audio/video fields.
6. The primary flow is **concept + goal · journey · now**; measures live
   behind progressive disclosure, never with equal visual weight.
7. The LEARN surface reuses the existing explanation authority; nothing
   generates/persists explanation content on mission render.

## NEXT PHASE
`LX-4 — Active Learning Experience` — **authorized only after this
certification is accepted. Do NOT implement LX-4.**

STOP.
