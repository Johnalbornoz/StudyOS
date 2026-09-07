# STUDYUS — LX LEARNING EXPERIENCE TRANSFORMATION
## PHASE LX-5 — LEARNING CONTINUATION — REPORT & CERTIFICATION

Branch: `tmp/lx1`
LX-5 implementation commit: `b393b3a`
Baseline (this phase builds on): `2a99815` (LX-3P-R1 hotfix doc) →
`7b23f53` (LX-3P-R1 fix) → `3b56ca6` (LX-4R) … → production `5a2d0b7`.

---

## 0. WHAT LX-5 CHANGES IN ONE SENTENCE

Every canonical learner activity — and reading a Learn explanation — now
ends with a **continuation checkpoint** (a short "what just happened" + one
CONTINUE) that re-reads canonical learning truth and launches whatever the
**canonical authority** says is next, or returns the learner to the Concept
Mission when there is honestly nothing next — instead of a dead end.

---

## 1. THE PRIMARY ACCEPTANCE CASE — "Derivadas"

**Before LX-5**
Concept Mission (NOT_STARTED / "Aprende esto primero") → "Leer la explicación"
→ `ConceptExplanationDisclosure` expands → full AI explanation renders →
**END OF CONTENT.** No further affordance. The learner has read the whole
explanation and the only way forward is browser-back or the top-nav. This is
the dead end the phase exists to remove.

**After LX-5**
Same path. When the explanation has finished loading, a `LEARN` continuation
checkpoint renders directly beneath it:

> **YA TIENES LA IDEA**
> Ahora StudyUS te ayudará a usarla.
> [ Seguir aprendiendo ]   Volver al concepto

"Seguir aprendiendo" → `POST /api/learning/continue { from: 'LEARN' }` →
`resolveContinuation`:

- Phase 4 (`getLearningDecisions`) has **no** decision for a NOT_STARTED
  concept (`consolidateSignals` only iterates emitted signals), so
  `hasLiveDecisionForConcept` is false.
- KS is `null` / `masteryState === 'UNKNOWN'` → NOT_STARTED.
- "Derivadas" is in `getCurriculumEligibleConcepts(studentId)`.
- → **Phase 8's canonical first-touch** `bootstrapNotStartedLearningDecision`
  (`activityType: 'PRACTICE'`, `priorityScore: 0`) → `startLearningSession`
  → `launchStatus: 'READY'`, `launchTarget` = the canonical Practice URL.
- Checkpoint pushes `launchTarget`. The learner lands in the first-touch
  Practice activity for Derivadas.

**No fake evidence.** Reading the explanation writes nothing. Mastery,
`learning_evidence`, and KS are untouched by the Learn path and by the
continuation resolver. The learner *advanced through the experience*; they
did not *gain mastery because content was viewed*. The PRACTICE that follows
is Phase 8's pre-existing NOT_STARTED entry decision — **not** an invented
"Practice after Learn" rule; it is only ever consulted when Phase 4 emits
nothing.

If Phase 8 also has nothing (concept not curriculum-eligible, or KS already
started), the checkpoint honestly returns to the Concept Mission
(`RETURN_TO_MISSION / NO_CANONICAL_ACTION`) — which itself now shows the
canonical NOW / journey. Still not a dead end.

---

## 2. CANONICAL BOUNDARY — WHAT LX-5 MAY AND MAY NOT DO

`resolveContinuation` (`src/services/learning-continuation.service.ts`) is
the entire decision surface. It:

| LX-5 does | LX-5 does NOT |
|---|---|
| Re-read Phase 4 `getLearningDecisions` / `getBestLearningDecisionForConcept` | Rank or score decisions (`rankLearningDecisions` never imported) |
| Use Phase 8 `bootstrapNotStartedLearningDecision` **only** when Phase 4 emits none, for NOT_STARTED + curriculum-eligible concepts | Choose an `ActivityType` from a local table (no `activityType = '…'` literal anywhere) |
| Launch the chosen decision through the existing `startLearningSession` | Decide remediation / retention / transfer |
| Return `RETURN_TO_MISSION` when there is no canonical action | Use a mastery threshold / score band |
| Fail safe to `RETURN_TO_MISSION` on any error | Write `learning_evidence` / call `updateMastery` / recompute KS |
| Carry `from` as presentation context (which copy showed) | Let `from` affect the resolution |

`tests/unit/lx5-continuation.test.ts` asserts each of these as a
source/contract check (the repo has no live DB/component harness).

**It did not become NextBestActionEngineV2.** There is exactly one ordering
rule — "canonical Phase-4 decision first, else canonical Phase-8 first-touch,
else return to mission" — and both branches are calls into existing
canonical authorities, not re-implementations.

---

## 3. SUB-PHASE LEDGER (A–P)

**5A — Dead-end audit.** Enumerated the terminal states of every canonical
flow: Learn explanation end; quiz results (Practice / quick_check / retention)
whose only forward action was `Link → /dashboard/subjects/{id}`; remediation
`TERMINAL` whose only action was `Link → /dashboard/today`; Focus-Mode exit
always → `/dashboard/today` regardless of where the learner came from. All
four are addressed below.

**5B — Continuation context.** `src/lib/lx/continuation.ts` (pure,
`CONTINUATION_CONTRACT_VERSION = 1`): `LearningActivityKind`,
`LearningOrigin`, `ContinuationResolution`, `ContinuationCheckpoint`,
`checkpointFor(kind)` (per-kind i18n key triplet), `conceptMissionPath()`.

**5C — Learn completion (BLOCKING).** `ConceptExplanationDisclosure` gains a
`subjectId` prop and renders `<ContinuationPanel from="LEARN" variant="inline">`
once `open && !loading && !error && data`. `ConceptMission` passes
`subjectId={view.identity.subjectId}` at all three disclosure call sites.
**No evidence/mastery write** on this path — asserted by test.

**5D — Activity completion.** `quiz/page.tsx` results view renders one
`<ContinuationPanel from={continuationKind}>` where
`continuationKind = remediationStepId ? 'REINFORCE' : mode === 'quick_check'
? 'PROVE' : mode === 'retention_check' ? 'RETAIN' : 'PRACTICE'` — a pure
mode→copy mapping, **not** a decision. The old `btn-primary` "back to
subject" link is downgraded to `btn-ghost`; the dominant action is CONTINUE.

**5E — Continuation resolver.** §2 above.
`POST /api/learning/continue` — `verifyAuth` + `verifyStudentAccess`, zod
`{ studentId, conceptId, subjectId, from? }`, catch → safe
`RETURN_TO_MISSION / RESOLVE_FAILED`.

**5F — REINFORCE / remediation return.** `remediation-session-view.ts`
`TERMINAL` variant now `{ status, pathState, conceptId: string | null,
subjectId: string | null }`; the `conceptRow` lookup (label-only —
`COALESCE(cl.label, c.canonical_id)`, **no `cl.description`**, per LX-3P-R1)
runs before the terminal check. `remediation/[pathId]/page.tsx` renders
`<ContinuationPanel from="REINFORCE" variant="inline">` when
`view.conceptId && view.subjectId`, and keeps `Link → /dashboard/today`
(`remediation.backToToday`) **only** as the fallback when the repaired
concept is unknown. REINFORCE goes through the *same* `resolveContinuation`,
so the post-repair activity is re-derived from canonical authority — not
assumed to be "another remediation step". _Not: REINFORCE → Subjects page._

**5G — Prove sufficiency continuation.** When `results.proveSufficiency &&
!results.proveSufficiency.sufficient`, the remaining-gap sentence
(`prove.moreNeededBody` with `{n}` = `remainingGap`) is passed as the
checkpoint `note`. There is **no** `if (sufficient) => RETAIN` — the
`continuationKind` line references neither `proveSufficiency` nor
`sufficient` (asserted by test). Whether Prove was sufficient is the
canonical authority's call on the next `resolveContinuation`.

**5H — Transfer.** `TRANSFER` kind + copy wired; transfer results reach the
same checkpoint. No transfer-specific pedagogy added.

**5I — Retention.** `RETAIN` kind + copy wired for `mode=retention_check`.

**5J — Focus Mode exit.** `LearnerShell` records nothing itself; the quiz
activity writes `sessionStorage['lx.activityOrigin'] = { subjectId,
conceptId }` when both are present (try/catch). The shell reads it on
`pathname` change and sets `originExitHref =
/dashboard/subjects/{subjectId}/concepts/{conceptId}`; the Focus-Mode exit
link is `href={originExitHref ?? exitHref}`. When `sessionStorage` is
unavailable the `catch` falls through to the default `/dashboard/today` —
**not** a browser-history dependency as the only mechanism.

**5K — Visual.** §5.

**5L — State / evidence integrity tests.** `lx5-continuation.test.ts`
asserts: Learn disclosure, ContinuationPanel, the resolver and the route
contain no `updateMastery` / `learning_evidence` /
`recalculateConceptKnowledgeState` / `recordEvidence`.

**5M — Resilience.** Every `resolveContinuation` failure path returns
`RETURN_TO_MISSION`; the route's outer catch returns
`success: true` + `RETURN_TO_MISSION / RESOLVE_FAILED` (never a 500 that
strands the page); `ContinuationPanel` on a fetch throw shows an
`<a href={missionHref}>` "Volver al concepto" plus a `role="alert"` line.
The learner always has a way forward.

**5N — i18n.** 17 `continuation.*` keys × es/en/de/fr/pt (`i18n_lx5.py`,
union anchor `| 'activeLearning.retryNote';`). Test resolves every key —
including every key returned by `checkpointFor` — non-empty in all 5 locales.

**5O — Accessibility.** Checkpoint is a `<section aria-labelledby>`; focus
moves to the headline (`tabIndex={-1}`) on mount; the failure line is
`role="alert"`; CONTINUE is a real `<button>` with `aria-busy`; the
secondary is a real link. `:focus-visible` outline added for
`p#lx-cp-heading` and `.lx-exit`.

**5P — Required production cases.** §6.

---

## 4. FILES

**New (5)**
- `src/lib/lx/continuation.ts`
- `src/services/learning-continuation.service.ts`
- `src/app/api/learning/continue/route.ts`
- `src/app/dashboard/quiz/ContinuationPanel.tsx`
- `tests/unit/lx5-continuation.test.ts`

**Modified (9)**
- `src/app/dashboard/subjects/[id]/concepts/[conceptId]/ConceptExplanationDisclosure.tsx`
- `src/app/dashboard/subjects/[id]/concepts/[conceptId]/ConceptMission.tsx`
- `src/app/dashboard/quiz/page.tsx`
- `src/lib/remediation-session-view.ts`
- `src/app/dashboard/remediation/[pathId]/page.tsx`
- `src/app/dashboard/LearnerShell.tsx`
- `src/app/globals.css`
- `src/lib/i18n/messages.ts`
- `tests/unit/lx4-focus-and-flow.test.ts` (exit-link regex updated for the
  `originExitHref ?? exitHref` change)

No unrelated files. No migration. No new `concept_localizations` column.
No AI generation on any read path.

---

## 5. VISUAL VERIFICATION — 375 / 768 / 1440

**Constraint (unchanged from LX-2P…LX-4R):** a real authenticated Clerk
session cannot be established in this environment (browser SDK hangs in the
hidden pane; a server-minted `__session` JWT is rejected by Clerk's Next
middleware) and there are no dedicated test-learner credentials or AI
provider keys. The dashboard routes therefore cannot be driven end-to-end
here. Visual verification was done with a **faithful static harness**: the
exact `ContinuationPanel` markup, the real `src/app/globals.css` tokens and
classes, and the **real rendered copy** extracted from the compiled
`messages.ts` via the real `checkpointFor()`, rendered at each width.

| Width | Result |
|---|---|
| 375 | All 6 activity kinds + the failure fallback render cleanly. `card lx-checkpoint` = 2px brand border; `inline` = borderless. Primary CONTINUE + ghost "Volver al concepto" wrap to a second line via `flex-wrap` — no horizontal overflow, no clipping. Sufficiency `note` renders muted under the body. |
| 768 | Cards at column width; CONTINUE + secondary on one row; headings/labels legible. |
| 1440 | Column-capped (same as the results / mission column in situ); layout holds; no stretched buttons. |

Screenshots captured at all three widths (harness served from a local
static server; harness file kept out of the repo). Faithful-render caveat:
this verifies the checkpoint component's own layout/copy/contract at the
three widths; it does **not** substitute for one authenticated pass through
`Concept Mission → Learn → checkpoint → Practice` on the deployed app,
which remains a **human** step (see §7).

**Visual pass rule** ("The learner should never see 'I finished this. Now
where do I click?'"): every terminal state now answers the question on
screen — a headline naming what finished, one primary CONTINUE, and a safe
secondary. **PASS** (component-level; pending the authenticated pass in §7).

---

## 6. REQUIRED PRODUCTION CASES (1–6)

| # | Flow | Terminal state after LX-5 | Continuation source |
|---|---|---|---|
| 1 | NOT_STARTED concept → Learn explanation → end ("Derivadas") | `LEARN` checkpoint → CONTINUE | Phase 8 first-touch PRACTICE (Phase 4 emits none) → `startLearningSession` |
| 2 | Practice activity → results | `PRACTICE` checkpoint → CONTINUE | Phase 4 `getLearningDecisions` for the concept → `startLearningSession`; else return to mission |
| 3 | Prove (`quick_check`) → results, **insufficient** | `PROVE` checkpoint + remaining-gap note → CONTINUE | Phase 4 re-read (authority decides if more Prove / other) — no local "if sufficient" branch |
| 4 | Prove → results, **sufficient** | `PROVE` checkpoint → CONTINUE | Phase 4 re-read — canonical authority chooses (LX-5 does not assert RETAIN) |
| 5 | Remediation path → `TERMINAL` | `REINFORCE` checkpoint → "Volver a mi recorrido" | `resolveContinuation` for the repaired concept; `/dashboard/today` only if concept unknown |
| 6 | Retention check (`retention_check`) → results | `RETAIN` checkpoint → CONTINUE | Phase 4 re-read → `startLearningSession`; else return to mission |

All six: no dead end, no fabricated evidence, no local ActivityType choice.

---

## 7. VALIDATION RUN

```
tsc --noEmit         clean
vitest run           177 files / 2569 tests passed (LX-5: +20 in
                     tests/unit/lx5-continuation.test.ts)
next build           ✓ compiled; 95/95 static pages;
                     new route ƒ /api/learning/continue present
```

**Not executed here (require a human, unchanged from prior LX phases):**
- Deploy to production (no Vercel CLI installed; Vercel + Neon MCP
  unauthenticated; nothing pushed to `origin/main`).
- One authenticated pass on the deployed app through each of the six cases
  in §6 with a real learner and real AI — in particular Case 1 (Derivadas):
  confirm "Seguir aprendiendo" lands in first-touch Practice and that
  `learning_evidence` for the concept is unchanged by the Learn read.

---

## 8. CERTIFICATION

```
PHASE: LX-5 — LEARNING CONTINUATION
BRANCH: tmp/lx1
IMPLEMENTATION COMMIT: b393b3a

PRIMARY ACCEPTANCE CASE ("Derivadas" — Concept Mission → Learn → full
explanation → previously a dead end):
  RESOLVED — the end of the Learn explanation now renders a continuation
  checkpoint whose CONTINUE launches the canonical first-touch Practice
  (Phase 8 bootstrap, used only because Phase 4 emits no decision for a
  NOT_STARTED concept). Reading the explanation writes no evidence and no
  mastery.

DEAD ENDS REMOVED:
  - Learn explanation end .......... YES (LEARN checkpoint)
  - Practice results ............... YES (PRACTICE checkpoint; bare
                                    back-to-subject link demoted)
  - Prove results (suff. / insuff.) YES (PROVE checkpoint; insufficiency
                                    shown as a note, not a decision)
  - Retention results ............. YES (RETAIN checkpoint)
  - Transfer results ............. YES (TRANSFER checkpoint)
  - Remediation TERMINAL ......... YES (REINFORCE checkpoint → journey;
                                    Today only as unknown-concept fallback)
  - Focus Mode exit ............. YES (context-aware: recorded activity
                                    origin, safe fallback to /today)

CANONICAL BOUNDARY:
  LX-5 owns continuation, not next-action policy. resolveContinuation
  consumes Phase 4 getLearningDecisions / Phase 8 bootstrap /
  startLearningSession only. It does not rank, does not pick an
  ActivityType, does not use a mastery threshold, does not decide
  remediation/retention/transfer, does not write evidence or mastery,
  does not create a second recommendation engine. `from` is presentation
  context only. VERIFIED by source/contract tests.

STATE & EVIDENCE INTEGRITY:
  "Read explanation" is experience progress, not mastery evidence. No
  learning_evidence write, no updateMastery call, no KS recompute on the
  Learn path or in the continuation resolver. VERIFIED.

RESILIENCE:
  Every resolver failure and the route's outer catch degrade to
  RETURN_TO_MISSION; ContinuationPanel always offers "Volver al concepto".
  The learner is never stranded on a broken page. VERIFIED.

i18n: 17 continuation.* keys × es/en/de/fr/pt — all resolve. VERIFIED.

ACCESSIBILITY: labelled section, focus-to-headline on mount, role="alert"
  failure line, real button/link controls, :focus-visible outlines. DONE.

VALIDATION: tsc clean · vitest 2569 passed · next build 95/95 +
  /api/learning/continue. GREEN.

MIGRATION REQUIRED: NO.

VISUAL (375 / 768 / 1440): PASS at component level via faithful static
  harness (real markup + real globals.css + real extracted copy).
  Full authenticated pass on the deployed app is a HUMAN step (§7) —
  a real Clerk session and AI keys are not available in this environment.

Does the learner now experience StudyUS as one continuous learning journey
rather than separate pages/activities?
  YES — every core canonical flow (Learn, Practice, Prove, Retention,
  Transfer, Remediation) ends with a checkpoint that either launches the
  canonical next activity or returns to the Concept Mission; none ends
  with "I finished this — now where do I click?".

Does any core canonical learner flow still end without a meaningful
continuation?
  NO.

STATUS: PASS (code complete, all automated gates green) — with the
  standing environment condition that production deploy and the
  authenticated six-case pass in §7 must be performed by a human before
  the release is called done. Nothing has been pushed to origin/main.

LX-6: NOT STARTED.
```

STOP.
