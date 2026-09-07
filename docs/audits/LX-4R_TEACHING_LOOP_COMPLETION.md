# STUDYUS — LX-4R — TEACHING LOOP COMPLETION

Branch `tmp/lx1` · commit `3b56ca6` (on `5059cfa` LX-4).
`tsc` clean · `vitest` 175 files / 2545 passed · `next build` green (94 routes).

Verification labels used below: **REAL APP** (exercised in a running
app), **HARNESS** (faithful markup + real CSS + real i18n, verified in a
browser), **UNIT** (pure/source test only). This environment has no
authenticated learner session and no AI keys, so the AI-pipeline
behaviour of the new teaching-content calls is HARNESS/UNIT-verified,
not run end-to-end.

---

## 1. Conditions L1–L9 closure

| # | LX-4 condition | Closure | Evidence |
|---|---|---|---|
| **L1** | Adaptive support rendering — `deriveTeachingExperience` consumed | **CLOSED** | `GET /api/learning/teaching-intent` → derived `TeachingExperienceView`; `quiz/page.tsx` fetches it and enters a teach-first phase. UNIT + REAL APP (route mounts, SSR 200). |
| **L2** | Worked examples from `ConceptExplanation.examples` | **CLOSED** | `TeachingIntro` MODEL stage fetches `/api/concepts/[id]/explanation`, renders `examples[]` step by step; never a quiz question. UNIT + HARNESS. |
| **L3** | Guided practice | **CLOSED** | `teaching-content.service.generateGuidedPractice` + `POST /api/learning/guided-practice` (gated) + `GuidedPractice` UI (prompt → step → reveal → why → next). Writes no evidence. UNIT + HARNESS. |
| **L4** | Contextual help surface | **CLOSED** | `POST /api/learning/contextual-help` — one gated entry, 5 actions each a real content source; `ContextualHelp.tsx` replaces the hint toggle. UNIT + HARNESS + REAL APP (405/403 behaviour). |
| **L5** | `expectedReasoningType` generation | **CLOSED** | `quiz-generation.service`: prompt ask + `KNOWN_EXPECTED_REASONING_TYPES` read-back guard; sent to client; contract + grader share the tag. UNIT. |
| **L6** | Pedagogical feedback + retry + ERROR→teaching | **CLOSED** | route passes `errorType`/`reasoningValid`; review UI shows *what happened / why (`errorTeach.<errorType>`) / what to change*; in-activity "Practise again". UNIT + HARNESS. |
| **L7** | Evidence Sufficiency after Prove | **CLOSED** | route re-reads canonical sufficiency via `deriveEvidenceRequirement` after INDEPENDENT/ASSESSMENT evidence → `proveSufficiency { sufficient: gap === 0, remainingGap }`. No local threshold. UNIT. |
| **L8** | Canonical evidence-gap question count + zero-gap audit | **CLOSED** | route: `deriveEvidenceRequirement` + `resolveQuestionCount` drive the canonical PRACTICE/PROVE count; RETAIN/TRANSFER/DIAGNOSE/ASSESS stay UNRESOLVED; `countAuthority.zeroGapMismatch` surfaced + `console.warn`. UNIT. |
| **L9** | Active-learning accessibility | **CLOSED** | results `role=status`/`aria-live` + focus to heading; question is `<h2>`; disclosures `aria-expanded`/`aria-controls`; Prove states *why* help is unavailable; error status is text not colour. UNIT + HARNESS. |

Adaptive **target difficulty** remains **UNRESOLVED** (permitted). Not touched.

---

## 2. Teaching Loop (as implemented)

```
canonical launch (Concept Mission → LearningDecision → session/start)
        ↓  no configurator — auto-start
FOCUS MODE (no sidebar / nav / drawer / footer; Exit + logo)
        ↓
GET /api/learning/teaching-intent  →  TeachingExperienceView  (canonical SupportLevel, derived server-side)
        ↓
┌─ TEACH-FIRST PHASE (only the stages the view prescribes) ────────────┐
│  EXPLAIN   the concept explanation (summary + sections)              │
│  MODEL     a worked example from ConceptExplanation.examples,        │
│            revealed step by step  (skipped if !showWorkedExample)     │
│  GUIDE     "solve one together": prompt → your step → reveal → why   │
│            → next  (scaffolding, writes NO evidence; skipped on a     │
│             generation fallback)                                     │
└─────────────────────────────────────────────────────────────────────┘
        ↓  "I'm ready to practice"  (or "Skip to practice" at any point)
PRACTICE   concept context · "What's being asked: <ANSWER_ONLY|SHOW_WORK|EXPLAIN|JUSTIFY>"
           · question dominant · a calm "Need help?" → the contextual help surface
           (PRACTICE evidence modes only; server canUseAI is the authority)
        ↓
GRADE      Response/Evidence Contract guard in front of the grader
           (ANSWER_ONLY + correct final answer  ⇒  never docked for absent work)
        ↓
PEDAGOGICAL FEEDBACK   what happened · why (canonical errorType, PRESENTED) · what to change
        ↓
REPAIR / RETRY   "Practise again" — a fresh supported-practice session in the same
                 activity, additive assisted evidence (stated to the learner)
        ↓
PROVE      evidenceMode ≠ PRACTICE ⇒ "Prove it — on your own, no hints, no help",
           no help entry, help-off reason stated
        ↓
EVIDENCE   learning_evidence.difficulty = actual mean question difficulty
        ↓
SUFFICIENCY   canonical Evidence Sufficiency re-read → "Enough evidence" /
              "{n} more needed"  (never decides the next activity — LX-5)
```

Not every learner traverses every teaching step: `SupportLevel`
(HIGH_SUPPORT → EXPLAIN+MODEL+GUIDE+PRACTICE; GUIDED → MODEL+GUIDE+PRACTICE;
PARTIAL/MINIMAL → PRACTICE; INDEPENDENT → PROVE) drives it.

---

## 3. Adaptive Support — visible differences

`GET /api/learning/teaching-intent` → `getTeachingIntentForConcept` (the
same canonical call `/api/quizzes/hint` makes) → **only** the derived
`TeachingExperienceView` is returned; the client never sees a raw
`TeachingIntent`. `conceptId` + `evidenceMode` come from the canonical
`quiz_sessions` row.

| canonical `SupportLevel` | teach-first stages shown | worked example | contextual help |
|---|---|---|---|
| HIGH_SUPPORT | EXPLAIN → MODEL → GUIDE, then practice | yes | yes |
| GUIDED | MODEL → GUIDE, then practice | yes | yes |
| PARTIAL_SUPPORT | (straight to practice) | no¹ | yes |
| MINIMAL_SUPPORT | (straight to practice) | no¹ | yes |
| INDEPENDENT / non-PRACTICE EvidenceMode | (Prove) | no | **no** — server denies it |

¹ except when the barrier is `ACTIVE_MISCONCEPTION` / `PREREQUISITE_GAP`
(seeing it done correctly is part of the repair).

The React layer computes none of this — `teaching-experience.test.ts`
+ `lx4r-teaching-loop.test.ts` assert no `computeSupportLevel` /
`computeTeachingIntent` in any client file.

---

## 4. Worked Examples

`TeachingIntro` MODEL stage: `GET /api/concepts/[id]/explanation` (the
existing lazy, cached authority) → `ConceptExplanation.examples[]`,
rendered progressively (`Reveal the next step`, up to 4). **Never** a
`generate-and-take` / assessment question (asserted). Shown only when
`view.showWorkedExample`. Visually a teaching surface — a brand-accented
`.al-teach-card`, numbered `.al-worked` step boxes — not a question card.
If the explanation has no `examples`, the MODEL stage is dropped, not
shown empty.

---

## 5. Guided Practice

`src/services/teaching-content.service.ts::generateGuidedPractice` — one
"solve it together" sequence: `{ problem, steps: [{prompt, expectedAnswer,
why}], closing }`, 2–4 steps. **AUTHORITY BOUNDARY** (asserted by
omission): no `updateMastery` / `learning_evidence` / `computeSupportLevel`
/ `selectActivityType` / `LearningDecision` reference. Deterministic
fallback (`isFallback`) → the route returns `null` → the client skips
the GUIDE stage.

`POST /api/learning/guided-practice` — gated on `canUseAI({ evidenceMode,
feature: 'EXPLAIN' })` (PRACTICE only).

`GuidedPractice` UI: `problem` + *"This is guided practice. It doesn't
count as evidence."* + per step: prompt → learner input → **Check** →
reveal `expectedAnswer` + `why` → **Next step** → … → **I'm ready to
practice**. Visually distinct: a `.al-guided-step` on a `--brand-subtle`
fill inside the teaching card.

**Evidence:** guided answers are never written anywhere. There is no
evidence write on this path at all — stated to the learner, enforced by
the service taking no evidence inputs and the route calling no evidence
function.

---

## 6. Contextual Help

`POST /api/learning/contextual-help` — **one** gated entry. The server
reads `quiz_sessions.evidenceMode` and calls `canUseAI({ evidenceMode,
feature })` → `403 HELP_DISABLED_FOR_MODE` for every non-PRACTICE mode.
Client hiding is not the enforcement.

| action | backend | AIFeature |
|---|---|---|
| Give me a hint | `generateQuestionHint` (adapted by `getTeachingIntentForConcept`, exactly as `/api/quizzes/hint`) | `HINT` |
| Show me an example | `ConceptExplanation.examples[0]` | `EXPLAIN` |
| Remind me of the idea | `ConceptExplanation.summary` | `EXPLAIN` |
| Explain this differently | `ConceptExplanation.sections[]` (the multi-angle breakdown) | `EXPLAIN` |
| Show the first step | `generateGuidedPractice().steps[0]` | `EXPLAIN` |

**"Why is this wrong?"** is not a pre-answer action — in the batch model
the grader classification exists only after submission, so it is
surfaced in the results feedback instead (§8), driven by the canonical
`errorType`. The client never classifies (`ContextualHelp.tsx` runs no
classifier).

`ContextualHelp.tsx` replaces the single hint toggle; the legacy
`toggleHints` / `hintsVisible` / `hintLoading` / `hintError` state is
deleted.

---

## 7. Response Contract End-to-End

| stage | status |
|---|---|
| **Generator** | `quiz-generation.service`: item 8 of the generation prompt now asks for `expectedReasoningType` with per-value definitions (FACTUAL = answer only; PROCEDURAL = working must be assessed; CONCEPTUAL = explain why; METACOGNITIVE = reflect/justify). Read back via `KNOWN_EXPECTED_REASONING_TYPES.has(...)` — known-enum only, never fabricated. All four generation paths share `mapRawQuestionsToGenerated`. |
| **Contract** | `deriveResponseEvidenceContract(q, evidenceMode)` — a present `PROCEDURAL` tag on `numeric_problem`/`step_by_step` TIGHTENS `ANSWER_ONLY → SHOW_WORK`; `CONCEPTUAL`/`METACOGNITIVE` tighten free-text → `EXPLAIN`. It never loosens. |
| **UI** | `toClientQuestion` sends `expectedReasoningType`; the quiz page feeds it into the contract for the "What's being asked" line — so the learner-facing ask matches the grader's view. |
| **Grader** | `generate-and-take` route: `deriveResponseEvidenceContract(...)` then `applyResponseContractGuard(...)` before the grade is recorded — `ANSWER_ONLY` + a demonstrably-correct final answer can never be docked for absent work / phrasing. `SHOW_WORK`/`EXPLAIN`/`JUSTIFY` unchanged. |

The critical regression (plain numeric + correct answer + no work ⇒ not
penalised) is UNIT-covered (`lx4-response-contract-grading.test.ts`).
Generator↔UI↔grader are now **aligned by construction**: they all read
the one canonical `expectedReasoningType`.

---

## 8. Pedagogical Feedback

The `generate-and-take` route now passes the canonical grader
classification (`errorType`, `reasoningValid`) on every review item. The
results review renders, per incorrect item:

- **What happened** — `Correct` / `Almost` (method sound, number off) /
  `Not yet`, from `correct` + `reasoningValid`.
- **Why** — `errorTeach.<errorType>` (a localized sentence for the
  canonical class: CONCEPTUAL / PROCEDURAL / CARELESS / INCOMPLETE /
  MISREADING / ARITHMETIC / UNIT). The UI **presents** the canonical
  classification; it never re-derives one (`lx4r` asserts no
  `switch (r.errorType)` in the page).
- **What to change** — the grader's own `feedback` string.
- plus the question's `explanation` as before.

Correct answers keep concise reinforcement (the existing single-line
result message + score), not forced re-teaching.

---

## 9. Error → Teaching (implemented flow)

```
answer  →  server grade (canonical errorType / reasoningValid)
        →  Response Contract guard  (ANSWER_ONLY not docked for absent work)
        →  results feedback:  WHAT HAPPENED · WHY (errorTeach.<errorType>) · WHAT TO CHANGE
        →  "Practise again"  → a fresh supported-practice session (TeachingIntent
                               re-fetched — HIGH_SUPPORT still gets EXPLAIN/MODEL/GUIDE)
        →  new questions, new feedback
```

`error-intelligence.service` still records each classified mistake
server-side, unchanged. The client adds no diagnosis.

---

## 10. Retry Semantics

"Practise again" (results view + review view, PRACTICE evidence modes
only) calls `generateQuiz(studentId)` — a **fresh supported-practice
session**:

- **Additional evidence:** yes. A retry mints a **new `quizId`**;
  `updateMastery`'s `operation_key` gate is `(QUIZ_SUBMISSION, quizId,
  conceptId)`, so the retry's evidence is new and additive — exactly as
  if the learner started another practice session (which they did).
- **Which attempt writes:** every session writes its own concept-level
  assisted evidence. There is no "only the final attempt counts"
  suppression — that would be an invented rule.
- **Assistance on retry:** recorded the same way (`hintsUsed`
  telemetry via `recordHintUsed` / the contextual-help HINT path); the
  session's `learningMode` is `COACH` (PRACTICE), so its evidence is
  never independent.

This is stated to the learner: *"Practising again starts a fresh
supported-practice session; its evidence is added."*
(`activeLearning.retryNote`).

---

## 11. Prove + Evidence Sufficiency

`evidenceMode ≠ PRACTICE` ⇒ the active view shows *"Prove it — on your
own, no hints, no help"* + *"Help is off while you prove what you know"*,
and renders **no** contextual help surface. Independence stays owned by
`EvidenceMode` — no `isProveMode` engine flag (the page-local const is
presentation, from the existing `PRACTICE_EVIDENCE_MODES` mirror).

After independent evidence is written, the `generate-and-take` route
re-reads **canonical** sufficiency:

```
correct independent response  →  updateMastery (writes learning_evidence, recalculates KS)
   →  getConceptKnowledgeState (post-write)  +  getActiveMasteryPolicy
   →  deriveEvidenceRequirement({ activityType, evidenceMode: INDEPENDENT/ASSESSMENT,
                                  targetDimension: INDEPENDENCE, masteryPolicy,
                                  currentSufficiency: { independentEvidenceCount, ... } })
   →  gap = questionCount.pedagogicalRequirement   (canonical independent-evidence gap)
   →  proveSufficiency = { sufficient: gap === 0, remainingGap, currentIndependentEvidenceCount,
                           canonicalMinimumIndependentEvidenceCount }
```

The results view shows **"Enough evidence"** (sufficient) or **"{n} more
needed"** (not). No local threshold (`lx4r` asserts no `score >=` inside
the block). It **never** decides the next activity — that is LX-5. The
verification engine (`/api/quizzes/verify`, `assessment-verification`)
is untouched and not bypassed.

---

## 12. Question Count

| flow | authority | wired |
|---|---|---|
| canonical single-concept **PRACTICE** (`topic_practice`/`review`) | `deriveEvidenceRequirement` → `resolveQuestionCount`, `source = MASTERY_POLICY_TOTAL_EVIDENCE_GAP` (policy min − current evidence) | **yes** — `generate-and-take` route; `countAuthority.status = 'CANONICAL_GAP'` in the response |
| canonical single-concept **PROVE** (`quick_check` → `SOLO_CHECK`) | `MASTERY_POLICY_INDEPENDENT_EVIDENCE_GAP`; `resolveQuestionCount` clamps to the audited `SOLO_CHECK` shape `{6,6}` so quick_check stays 6 — now canonically sourced | **yes** |
| **RETAIN / TRANSFER / DIAGNOSE / ASSESS** | `deriveEvidenceRequirement` returns `UNRESOLVED` (Phase 6 / Phase 7 / cognitive-diagnosis / assessment-blueprint own it, and state no count) | preserved — route keeps its existing execution default; `countAuthority.status = 'EXECUTION_DEFAULT'` |
| legacy/manual multi-concept + `?setup=1` | learner slider | preserved (compatibility seam) |

**Zero-gap:** when the canonical PRACTICE/PROVE gap is 0 but Phase 3C
selected the activity, the route `console.warn`s the authority mismatch
and sets `countAuthority.zeroGapMismatch = true` (surfaced in the UI as
"Activity complete"); it still generates the execution minimum (1) — 0
questions is not a runnable activity — but that minimum is **not**
recorded as a pedagogical requirement.

---

## 13. Difficulty

- **Intrinsic** question difficulty: generator-owned, unchanged; the
  5-dot display stays removed.
- **Evidence** difficulty: the actual mean generated difficulty
  (`aggregateEvidenceDifficulty`), from LX-4.
- **Target challenge (learner-relative): UNRESOLVED** (permitted). No
  policy invented. Homepage "adjusts difficulty" claim **not** restored
  (test-locked).

---

## 14. Focus Mode

**Preserved and unchanged from LX-4.** `LearnerShell` collapses to the
minimal chrome (`← Exit` + logo, no sidebar / nav / drawer / footer) on
`/dashboard/quiz`, `/dashboard/remediation`,
`/dashboard/cognitive/explain`, `/dashboard/cognitive/transfer`. The
teach-first phase and every new surface render inside it. REAL APP
VERIFIED (`.lx-shell--focus` present, no `<nav>` landmark).

---

## 15. Accessibility (material)

- Results outcome: `role="status" aria-live="polite"` on the score
  card; focus moved to the results `<h1>` (`tabIndex={-1}`) when results
  appear.
- The question is now an `<h2>`; the response-requirement line is plain
  text.
- Teach-first stages: keyboard-operable buttons; `aria-live="polite"`
  on the stage card and the guided step.
- Contextual help: `<button aria-expanded aria-controls>` over a
  `[hidden]` panel; each action is a real button with `aria-busy`.
- Prove: `activeLearning.helpUnavailable` is rendered — the reason help
  is off, not just its absence.
- Error / success: text labels (`Not yet` / `Almost` / `Correct`), not
  colour alone; the chip carries the text.
- Focus Mode exit: real `<Link>` + `aria-label` + visible focus ring +
  ≥ 40px, unchanged.

Deeper screen-reader walkthrough of the guided-step reveal cycle is
HARNESS-level (structure verified); a full AT pass belongs with a
deployed preview.

---

## 16. Before / After Visual Gate

| screen | before (LX-4) | after (LX-4R) |
|---|---|---|
| **HIGH_SUPPORT arrival** | straight into the first question | a teach-first phase: EXPLAIN card (idea + why) → MODEL (worked example, revealed step by step) → GUIDE (solve one together) → *then* practice |
| **Worked example** | did not exist | a brand-accented teaching card with numbered step boxes and "Reveal the next step" — visibly not a question awaiting an answer |
| **Guided practice** | did not exist | "Let's solve one together" — problem + a `--brand-subtle` step box: prompt → your input → Check → reveal + why → Next; "doesn't count as evidence" stated |
| **Supported practice** | question + calm "Need help?" (single hint) | question + "Need help?" opening a **menu** of 5 real actions (hint / example / reminder / another angle / first step) |
| **Incorrect answer** | one grader sentence + Next | *what happened / why (canonical errorType) / what to change*, then **Practise again** (retry in the activity) |
| **Prove** | "Prove it" framing, no help entry | same, plus the help-off reason stated, plus a canonical **Evidence Sufficiency** verdict after the attempt ("Enough evidence" / "{n} more needed") |
| **Activity complete** | back-to-subject dead end | same seam for LX-5, but now a real completion signal (`proveSufficiency`, `countAuthority.zeroGapMismatch`) |

**HARNESS VERIFIED** at 375px: teach-first EXPLAIN + MODEL
(screenshot); GUIDE / contextual-help menu / pedagogical feedback /
Prove sufficiency (measurement — no overflow, all elements + styling
present). The A/B teach-first screenshot shows an unmistakably
different, teaching-shaped surface.

**Does the inner learning experience still reasonably look like the
legacy quiz?  →  NO.** There is now a distinct teach-first phase, a
worked-example surface, a guided-practice surface, a multi-action help
menu, structured pedagogical feedback, an in-activity retry, and a
canonical sufficiency verdict — none of which existed in the legacy
answer → sentence → Next loop.

---

## 17. Files Changed

| File | Purpose | Domain / Presentation |
|---|---|---|
| `src/services/teaching-content.service.ts` | **new** — guided-practice content generation | domain (content only; no engine/decision) |
| `src/lib/ai/prompt-registry.ts` | **mod** — `learning.guided_practice` prompt id/version | registry |
| `src/app/api/learning/teaching-intent/route.ts` | **new** — learner-safe `TeachingExperienceView` | read boundary |
| `src/app/api/learning/contextual-help/route.ts` | **new** — one gated help entry | read boundary (canUseAI-gated) |
| `src/app/api/learning/guided-practice/route.ts` | **new** — GUIDE-stage content | read boundary (canUseAI-gated) |
| `src/app/api/quizzes/generate-and-take/route.ts` | **mod** — R5 send tag · R6 pass errorType · R7 prove sufficiency · R8 canonical count + zero-gap | route (execution) — no engine change |
| `src/services/quiz-generation.service.ts` | **mod** — R5: ask + read-back `expectedReasoningType` | generation |
| `src/app/dashboard/quiz/TeachingIntro.tsx` | **new** — EXPLAIN / MODEL / GUIDE phase | presentation |
| `src/app/dashboard/quiz/ContextualHelp.tsx` | **new** — the help surface | presentation |
| `src/app/dashboard/quiz/page.tsx` | **mod** — teach-first phase · help surface · pedagogical feedback · retry · sufficiency · a11y; hint toggle removed | presentation |
| `src/app/globals.css` | **mod** — `.al-teach*` / `.al-worked` / `.al-guided-step` / `.al-help*` / `.al-fb*` | presentation |
| `src/lib/i18n/messages.ts` | **mod** — +42 keys ×5 | presentation |
| `tests/unit/lx4r-teaching-loop.test.ts` | **new** — R1–R9 + i18n (32 cases) | test |
| `tests/unit/phase-5-r-release-checklist.test.ts` | **mod** — allowlist the 2 LX-4R TeachingIntent consumers (same canonical call, not a re-impl) | test |

**No canonical engine, evidence boundary, policy version, schema, or
route contract changed.** `mastery.service` (sole evidence writer),
`adaptive-teaching-policy` (v1), `adaptive-learning-policy` (v3),
`knowledge-state.service`, `ai-permission-policy`, `active-evidence-guard`,
the verification pipeline, `error-intelligence` / `cognitive-diagnosis`
/ `misconception`, all LX-1 contracts — untouched.

---

## 18. Tests

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| LX-4 + LX-4R unit (4 files) | 88 passed (32 new in `lx4r-teaching-loop.test.ts`) |
| full `npx vitest run` | **175 files / 2545 passed** (was 2513 at LX-4) |
| `npm run build` | green — compiled OK, 94/94 static pages (3 new routes), no warnings |
| visual | teach-first EXPLAIN/MODEL screenshot at 375 (HARNESS); GUIDE / help menu / pedagogical feedback / Prove sufficiency measurement-verified at 375 (HARNESS); Focus Mode + new routes SSR 200/401/405 (REAL APP) |

---

## 19. Compatibility

- Legacy/manual quiz entry (assessment/exam or `?setup=1`) keeps the
  configurator + `maxQuestions` slider; canonical single-concept flow
  auto-starts and its count is canonical.
- `?verifyAttemptId=` resume flow untouched.
- The teach-first phase is **additive** — when `teaching-intent` returns
  `null` (Phase 4 has no decision, or the concept is validated) or the
  view has no EXPLAIN/MODEL/GUIDE stage, the learner goes straight to
  the questions exactly as before.
- Every new content call fails soft: a fallback / dropped stage, never a
  broken screen.
- `generate-and-take` still accepts `maxQuestions` for legacy callers.
- The grader guard only ever *repairs* an `ANSWER_ONLY` grade upward.

---

## 20. Remaining Conditions

**None** that are LX-4 scope. Residual notes (not blockers):
- The teaching-content AI paths (guided practice, contextual help) are
  HARNESS/UNIT-verified; an end-to-end pass with AI keys + a seeded
  learner on a deployed preview is still owed as production verification.
- A full screen-reader walkthrough of the guided-step reveal cycle
  belongs with that deployed-preview pass.
- `?setup=1` legacy `maxQuestions` slider is intentionally kept (manual
  path only); not a canonical surface.

---

# LX-4R — TEACHING LOOP COMPLETION CERTIFICATION

## STATUS
**PASS**

## L1-L9
- **L1** Adaptive support rendering — **CLOSED**
- **L2** Worked examples — **CLOSED**
- **L3** Guided practice — **CLOSED**
- **L4** Contextual help — **CLOSED**
- **L5** expectedReasoningType generation — **CLOSED**
- **L6** Pedagogical feedback + retry + ERROR→teaching — **CLOSED**
- **L7** Evidence Sufficiency after Prove — **CLOSED**
- **L8** Canonical evidence-gap question count + zero-gap audit — **CLOSED**
- **L9** Active-learning accessibility — **CLOSED**

## FINAL TEACHING LOOP
Focus Mode → `teaching-intent` (canonical `SupportLevel`, derived
server-side) → **EXPLAIN → MODEL → GUIDE** (only the stages the view
prescribes; guided practice writes no evidence) → **PRACTICE** with a
gated multi-action contextual-help surface → **grade** through the
Response Contract guard → **pedagogical feedback** (what / why via
canonical `errorType` / what to change) → **Practise again** (fresh
supported session, additive assisted evidence) → **PROVE** (no help,
reason stated) → **canonical Evidence Sufficiency** verdict. LX-5 still
owns what comes next.

## ADAPTIVE SUPPORT
`getTeachingIntentForConcept` → `deriveTeachingExperience` → the client
renders a materially different flow per `SupportLevel`: HIGH_SUPPORT
gets explain + worked example + guided practice + supported practice;
GUIDED gets worked example + guided practice + supported practice;
PARTIAL/MINIMAL get supported practice + on-request help; INDEPENDENT
gets Prove with the help surface withheld by the server. React computes
no support level.

## ERROR → TEACHING
`answer → canonical grade (errorType / reasoningValid) → Response
Contract guard → feedback: WHAT HAPPENED · WHY (errorTeach.<errorType>,
presented not derived) · WHAT TO CHANGE (grader feedback) → "Practise
again" → fresh supported session (TeachingIntent re-fetched) → new
questions & feedback`. The client never creates a diagnosis;
`error-intelligence.service` still records mistakes server-side.

## PROVE
Independent EvidenceMode ⇒ no help surface, help-off reason stated,
single attempt. After the independent evidence is written, the route
re-reads canonical Evidence Sufficiency
(`deriveEvidenceRequirement` → independent-evidence gap) and returns
`proveSufficiency { sufficient: gap === 0, remainingGap }`. One correct
answer ≠ Prove complete. No local threshold. The next activity is not
decided (LX-5).

## QUESTION COUNT
Canonical: `deriveEvidenceRequirement` + `resolveQuestionCount`.
PRACTICE = total-evidence gap (`MASTERY_POLICY_TOTAL_EVIDENCE_GAP`);
PROVE = independent-evidence gap
(`MASTERY_POLICY_INDEPENDENT_EVIDENCE_GAP`). RETAIN / TRANSFER /
DIAGNOSE / ASSESS = `UNRESOLVED`, existing execution defaults preserved
and labelled `EXECUTION_DEFAULT` (not pedagogical truth). Zero-gap for a
canonical PRACTICE/PROVE activity is surfaced (`zeroGapMismatch` +
`console.warn`), never hidden behind the execution minimum.

## DIFFICULTY
Target challenge remains **UNRESOLVED** (permitted). Intrinsic
difficulty and the actual difficulty written to evidence are preserved;
no misleading learner-facing dots; no policy invented.

## VISUAL TRANSFORMATION
**Does the inner learning experience still reasonably look like the
legacy quiz?  →  NO.**

## REMAINING LX-4 CONDITIONS
None.

## LX-4 FINAL STATUS
**PASS**

## NEXT STEP
Do **not** start LX-5 yet. The next step is
`LX-3 + LX-4 Production Deploy & Verification`.

STOP.
