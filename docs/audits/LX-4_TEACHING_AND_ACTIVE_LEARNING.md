# STUDYUS — LX-4 — TEACHING & ACTIVE LEARNING EXPERIENCE

Branch `tmp/lx1` · commit `e36dccb` (on `09cc450` LX-3R).
`tsc` clean · `vitest` 174 files / 2513 passed · `next build` green.

> **Scope honesty (read first).** LX-4 as specified is a multi-PR
> transformation touching question generation, AI grading, evidence
> writes and a full UI rebuild. This session delivered the subset that
> is **safe** (no unverifiable AI-pipeline rewrites against a live
> learning system) and **verifiable** (unit + in-browser + faithful
> harness). Several sub-phases (worked examples, guided practice, the
> contextual-help surface, adaptive-support *rendering*, the
> pedagogical-feedback restructure, `expectedReasoningType` generation)
> are **designed and contracted but not yet wired into the UI** and are
> carried as explicit LX-4 conditions. Every claim below is labelled
> REAL APP VERIFIED / HARNESS VERIFIED / UNIT ONLY / NOT DONE.

---

## 1. LX-4A — current teaching audit

### A1 — current experience map (`/dashboard/quiz`, `generate-and-take`)

| Step | Component | Pedagogical authority | Teaching value | UX problem |
|---|---|---|---|---|
| **SETUP** | `quiz/page.tsx` `phase==='setup'` — mode label, **`maxQuestions` range slider**, topic multi-select | none (learner picks) | none | a configuration form; learner decides evidence sufficiency |
| **GENERATE** | `POST /api/quizzes/generate-and-take` → `generateQuestionsForConcept` / `generateQuickCheckQuestions` / `generatePracticeQuestions` | `quiz-generation.service` (AI), `difficulty = options.difficulty ?? 3` | questions grounded in the learner's content | difficulty is a static `3`; `expectedReasoningType` never populated |
| **QUESTION** | `quiz/page.tsx` `phase==='quiz'` — `<MathText>` + answer editor; **5 difficulty dots**, calculator chip, `LearningSupportStatus`, **"Hint" button**, confidence radios | `ANSWER_FORMAT_BY_TYPE`, `PRACTICE_EVIDENCE_MODES` (client mirror), server `canUseAI` on `/hint` | shows assisted-vs-independent | metric chips / dots / breadcrumb clutter; "Hint" reads as a test aid; nothing tells the learner what a *complete* response is |
| **ANSWER** | `MathAnswerEditor` (text+math toolbar) / choice / matching / ordering / classification | — | direct manipulation exists | fine |
| **GRADE** | route grading loop — `gradeStructuredAnswer` (deterministic) / `gradeAnswer` (AI, `HIGH_RISK`) | `quiz-generation.service` | per-type rubric in the grader prompt | **no contract in front of the grader** — a numeric answer can be docked for "no work" |
| **FEEDBACK** | results view — per-question `feedback` string + `explanation`, `errorType`, `reasoningValid` | grader output; `recordError` → `error-intelligence.service` | error is classified canonically | rendered as one sentence + "Next"; no what/why/change/now structure; no retry |
| **EVIDENCE** | `updateMastery({ evidence: { difficulty: 3, ... } })` per concept bucket | `mastery.service` (sole `learning_evidence` writer) | canonical | **`difficulty: 3` hardcoded** — never the real question difficulty |
| **RESULTS** | results view + verification sub-flow (`/api/quizzes/verify`) | `assessment-verification.service` | verification preserved | a page-shaped dead end; "back to subject" only |
| **RESUME** | `?verifyAttemptId=` self-contained mini-flow | verify pipeline | continuation of a pending verification | separate render path, untouched |

### A2 — teaching capability inventory (traced, not assumed)

| Capability | Exists | Authority / service | Learner-facing today | Reusable |
|---|---|---|---|---|
| Concept explanation | yes | `concept-explanation.service.getConceptExplanation` (AI, **generates + persists on miss**) + `ConceptExplanationPanel` + `GET /api/concepts/[id]/explanation` | yes (Subjects list, LX-3 Concept Mission disclosure) | yes — lazy, existing API |
| Alternative explanation | partial | same service, re-prompted; no "explain differently" entry point | no | yes (needs an entry point) |
| Worked example | **content only** | `ConceptExplanation.examples[]` (AI, in the cached explanation payload); the generator also emits `numeric_problem`/`step_by_step` questions with model answers | no dedicated surface | **yes — from `ConceptExplanation.examples` / a model answer; do NOT repurpose assessment questions as teaching** |
| Hint | yes | `POST /api/quizzes/hint` → `getTeachingIntentForConcept` + hint generation; server `canUseAI` gate | yes (PRACTICE modes) | yes |
| First step | **no** | — | no | not reliably — would need a new teaching-content call |
| Guided practice ("solve one together") | **no** | — | no | not without new content generation + a step state machine |
| Error diagnosis | yes | grader `errorType` + `error-intelligence.service` + `cognitive-diagnosis.service` (`diagnostic_check`) | `errorType` implicitly via feedback text | yes — **client must not re-diagnose** |
| Misconception detection | yes | `misconception.service`, `knowledge-state.criticalMisconceptionCount` | via remediation routing | yes (read-only) |
| Remediation | yes | `remediation.service` + 6L-B1 shell `/dashboard/remediation/[pathId]` | yes | yes (canonical launch chain) |
| Adaptive support level | **computed, invisible** | `adaptive-teaching-policy.computeSupportLevel` → `TeachingIntent.supportLevel` (HIGH_SUPPORT/GUIDED/PARTIAL_SUPPORT/MINIMAL_SUPPORT/INDEPENDENT); non-PRACTICE ⇒ INDEPENDENT (hard floor) | **no** — nothing renders it | yes — LX-4B contract built |
| AI tutor | yes | `tutor.service` + `/dashboard/tutor` | yes (separate page) | as a link only (spec: no generic sidebar) |
| Feedback | yes | grader `feedback`/`score`/`errorType`/`reasoningValid` | yes (one sentence) | yes |
| Retry (same question, act on feedback) | **no** | — | no | possible inside the existing state machine |
| Independent attempt | yes | `EvidenceMode` (`activity-taxonomy`), `ai-permission-policy.canUseAI`, `active-evidence-guard` | implicit (mode in URL) | yes — canonical |

**`computeSupportLevel` semantics (audited):** non-PRACTICE activity ⇒
`INDEPENDENT`. Else: misconception / prerequisite / persistent-failure
barrier ⇒ `HIGH_SUPPORT`; help-dependency ⇒ `MINIMAL_SUPPORT`; unknown
mastery or `masteryScore − independentMastery > 20` ⇒ `GUIDED`; gap
10–20 ⇒ `PARTIAL_SUPPORT`; gap ≤ 10 ⇒ `MINIMAL_SUPPORT`.

---

## 2. Teaching experience architecture (LX-4B) — **built (pure), UNIT ONLY**

`src/lib/lx/teaching-experience.ts` — pure, versioned, 20 unit cases:

```
deriveTeachingExperience({ supportLevel, explanationDepth, evidenceMode,
                           primaryBarrier, hasActiveMisconception })
  -> { mode, stages[], showWorkedExample, scaffolding, helpAvailable,
       retryAllowed, explanationProminence, reinforceCorrect, isProve }
```

Modes `EXPLAIN → MODEL → GUIDE → PRACTICE → INDEPENDENT` are
**presentation modes, never persisted, never new LearningStates**. The
module **never computes `SupportLevel`** (asserted by test). `EvidenceMode`
is the integrity backstop: any non-`PRACTICE` mode forces a no-help,
no-retry, no-worked-example Prove experience regardless of the
`supportLevel` input.

**CONDITION L1 — not consumed by any surface yet.** The quiz page does
not yet fetch a `TeachingIntent` and render `deriveTeachingExperience`.
`SupportLevel` therefore still does not visibly change the experience.

## 3. Adaptive support mapping (LX-4B2)

| canonical `SupportLevel` | mode / stages | worked example | scaffolding | help | retry | explanation |
|---|---|---|---|---|---|---|
| HIGH_SUPPORT | EXPLAIN→MODEL→GUIDE→PRACTICE | yes | FULL | yes | yes | PRIMARY |
| GUIDED | MODEL→GUIDE→PRACTICE | yes | GUIDED | yes | yes | SECONDARY (→PRIMARY if DEEP) |
| PARTIAL_SUPPORT | PRACTICE | no (unless misconception/prereq) | LIGHT | yes | yes | ON_REQUEST |
| MINIMAL_SUPPORT | PRACTICE | no (unless …) | NONE | yes | yes | ON_REQUEST |
| INDEPENDENT / non-PRACTICE EvidenceMode | INDEPENDENT | no | NONE | **no** | **no** | HIDDEN |

## 4. Worked example system (LX-4C) — **NOT DONE**

Audit result (§A2): worked examples can be sourced safely from
`ConceptExplanation.examples[]` (already AI-generated, cached) — no new
service required, and assessment questions must **not** be repurposed.
The rendering surface + the "source from cached explanation" wiring are
**not built**. **CONDITION L2.**

## 5. Guided practice (LX-4D) — **NOT DONE**

No canonical content or state machine exists for "solve one together"
(§A2). Building it needs a new teaching-content generation call
(explanation/steps/hints only — never concept/activity/mastery/support
selection) plus a step state machine. **CONDITION L3.** The integrity
rule (guided responses are assisted evidence, never independent proof)
is already structurally guaranteed by `EvidenceMode` + `computeSupportLevel`'s
hard floor.

## 6. Contextual help (LX-4E) — **partially done**

- **Done:** the "Hint" button is now a calm **"Need help?"** entry
  (`activeLearning.needHelp`), `aria-expanded` wired; it renders only in
  PRACTICE evidence modes; the server (`/api/quizzes/hint` → `canUseAI`)
  remains the authority. Independent/Prove modes show no help entry.
- **NOT DONE (CONDITION L4):** the multi-action help surface (Explain
  differently / Show an example / Give a hint / Remind me of the idea /
  Show the first step / Why is this wrong?). The six `help.*` i18n keys
  are added (×5 locales) but no menu consumes them; only the existing
  single hint action is available. The "Why is this wrong?" action
  after a failed attempt, and passing grader `errorType` /
  misconception context into help, are not wired.

## 7. Response / Evidence Contract integration (LX-4F)

| Surface | Status |
|---|---|
| **Question presentation** — "What's being asked: {…}" line from `deriveResponseEvidenceContract(q, evidenceMode)`, shown **before** answering (`responseContract.ANSWER_ONLY/SHOW_WORK/EXPLAIN/JUSTIFY`) | **REAL APP VERIFIED** (renders; HARNESS-verified visually) |
| **Grader guard (runtime)** — `applyResponseContractGuard(contract, gradeResult, {studentAnswer, correctAnswer})` wired into `generate-and-take` after `gradeAnswer` for every `text`-format answer. `ANSWER_ONLY` + demonstrably-correct final answer ⇒ repaired to a clean pass (score 1, `errorType` null); `SHOW_WORK`/`EXPLAIN`/`JUSTIFY` unchanged | **REAL APP wired · UNIT ONLY behaviourally** (11 cases incl. the numeric-no-work regression; not run end-to-end — no AI/auth env) |
| **The critical regression** — plain numeric + correct answer + no work ⇒ not penalised | **UNIT ONLY** (`lx4-response-contract-grading.test.ts`: `finalAnswersMatch` `"4"`/`"4.0"`/`"x = 4"` + guard repair) |
| `expectedReasoningType` populated in generation | **NOT DONE (CONDITION L5)** — the generator deliberately leaves it null; the defensible path (add it to the prompt ask + a known-enum read-back guard, mirroring `cognitiveLevel`) is designed, not implemented. The contract already tightens correctly *when the tag is present*. |

## 8. Practice experience (LX-4G) — **partially done**

Done: difficulty dots removed, breadcrumb removed, "Need help?" calm
entry, response-contract line, single dominant Submit, Focus Mode
chrome. **NOT DONE (CONDITION L6):** the feedback restructure
(what happened / why / what to change / what now) and the in-activity
**retry** affordance. `feedback.*` i18n keys are added; the results
view still renders a sentence + Next.

## 9. Pedagogical feedback / error teaching (LX-4G) — **NOT DONE (CONDITION L6)**

The ERROR → DIAGNOSE → EXPLAIN → EXAMPLE → GUIDED RETRY loop is not
built. Canonical `errorType` / `error-intelligence` / misconception
data is available and **must not be re-diagnosed client-side** when it
is wired.

## 10. Prove experience (LX-4H) — **partially done · REAL APP VERIFIED (framing)**

- The active view shows a **"Prove it / Now show that you can do this on
  your own — no hints, no help"** block when `evidenceMode !== PRACTICE`
  (`isProveMode`), and renders **no help entry**. HARNESS-verified.
- `EvidenceMode` remains the sole independence authority — **no
  `isProveMode` flag was added to any engine**; the page-local
  `isProveMode` const is presentation only, derived from the same
  `PRACTICE_EVIDENCE_MODES` mirror already in the file.
- **NOT DONE (CONDITION L7):** wiring canonical **Evidence Sufficiency**
  after a correct Prove answer (the page still does not claim mastery
  from one answer — it never did — but it also does not consult a
  sufficiency gate). Verification engine untouched and not bypassed.

## 11. Question count (LX-4I)

| Mode class | Authority | Status |
|---|---|---|
| Canonical Practice / Prove (concept + single-concept mode) | route per-mode execution count (`QUIZ_MODE_CONFIG.defaultMax`, and the fixed `quick_check`/`retention_check` counts) | **learner control removed** — canonical flow omits `maxQuestions` and skips the setup form entirely (REAL APP VERIFIED: setup skipped, `.lx-shell--focus` chrome, `maxQuestions` not in the request for canonical flow) |
| Canonical evidence-**gap**-driven count (LX-1R: PRACTICE total-evidence gap, PROVE independent-evidence gap) | `mastery_policies` gaps via `evidence-sufficiency-contract` | **NOT DONE (CONDITION L8)** — the route still uses its execution default; the evidence gap is not consulted. Labelled here as a compatibility limitation, not presented to the learner as pedagogical truth. |
| RETAIN / TRANSFER / DIAGNOSE / ASSESS | none | **UNRESOLVED (preserved)** — legacy execution counts kept for compatibility; not shown to the learner as "StudyUS decided N questions are sufficient". |
| Zero-gap audit | — | **NOT DONE (CONDITION L8)** — no check that a canonical activity with zero remaining gap isn't launched for one execution-minimum question. |
| Legacy / manual multi-concept (`cumulative_assessment` / `exam_simulation`, or `?setup=1`) | learner slider | **preserved as a compatibility seam** |

## 12. Difficulty authority (LX-4J)

**Intrinsic question difficulty** — owned by the generator, carried on
`GeneratedQuestion.difficulty` (1–5). Unchanged.

**Observed difficulty** — not represented (no surface claims it).

**Target challenge (learner-relative)** — **STILL UNRESOLVED.** Design
gate audited: the candidate inputs exist (Knowledge-State dimensions,
`LearningDecision.targetDimension`, `ActivityType`, `EvidenceMode`,
`TeachingIntent.supportLevel`, `learning_evidence.difficulty` history,
`GeneratedQuestion.difficulty`) but **no canonical authority combines
them**, and the LX-1R rule stands: *do not fabricate a `masteryScore`-band
mapping or a Practice−1 / Transfer+1 bias*. A defensible pure domain
policy is not established in this session; per the spec, target
difficulty is left `UNRESOLVED` (`difficulty-contract.resolveTargetDifficulty()`)
rather than invented. **The homepage "adjusts difficulty" claim was NOT
restored** (test-locked).

**Evidence consistency (LX-1R D) — RESOLVED.** The `generate-and-take`
route's hardcoded `difficulty: 3` on the `learning_evidence` write is
replaced with `aggregateEvidenceDifficulty(bucket.questionDifficulties)`
— the mean of the actual generated difficulties of that concept's
questions. **REAL APP wired · source-verified · unit-covered** (the
contract's `aggregateEvidenceDifficulty` was already tested in LX-1R).

**Learner-facing:** the 5 intrinsic-difficulty dots were **removed** from
the question view — showing a five-level scale implied a learner-relative
authority that does not exist.

## 13. Focus Mode (LX-4K) — **REAL APP VERIFIED**

`LearnerShell` collapses to a minimal chrome on any active-learning
route (`FOCUS_MODE_PREFIXES = /dashboard/quiz`, `/dashboard/remediation`,
`/dashboard/cognitive/explain`, `/dashboard/cognitive/transfer`). No
nested layout, no second nav system — the LX-2 `chrome` seam.

Verified in-browser at 1440px and 375px:
- `/dashboard/quiz?…` → `.lx-shell--focus` present; **`.lx-sidebar`,
  `.lx-topbar`, `<nav aria-label>`, `Footer` all absent**; a slim
  `.lx-focusbar` with `← Exit` (localized `nav.exitActivity`, keyboard
  focus ring, → `/dashboard/today`) + logo; content in a centered
  720px column.
- `/dashboard/today` → unchanged full shell (`.lx-shell--focus` absent,
  `<nav aria-label="Navegación principal">` present).

The canonical flow also **skips the configurator**: entered with a
concept + single-concept mode, the page auto-starts (no mode picker, no
question-count slider). Verified: `phase==='setup' && isCanonicalFlow`
renders a loading state, not the form.

**No fake progress counter:** the `N / total` shown is genuine — the
questions are already generated when the active view renders, so `total`
is real, not a guess.

## 14. Before / after visual transformation

| Screen | Before (dominant) | After (dominant) | Controls gone | Info demoted | One primary action | Still the legacy quiz? |
|---|---|---|---|---|---|---|
| **Arrival / setup** | a config card: mode label, **question-count slider**, topic checkboxes, "Start" | *(canonical flow)* nothing — auto-starts into the activity | mode picker, count slider, topic multiselect, Start | — | (implicit: begin) | **No** — the configurator is gone |
| **Active question** | full sidebar + breadcrumb + language select + **5 difficulty dots** + calculator chip + "Hint" button + question + editor + confidence | Focus bar (Exit / logo) · genuine progress · support indicator · **"What's being asked"** line · question · calm **"Need help?"** · editor · Submit | sidebar, drawer, breadcrumb, difficulty dots | language picker → corner; progress → thin bar | **Submit** | **Environment: no. Inner loop: partly** — the answer→feedback core is still recognisable (teaching loop not built — L2/L3/L6) |
| **Prove** | identical to Practice minus the Hint button | "Independent — no hints" + **"Prove it / …on your own — no hints, no help"** framing; help entry absent | Hint button, all nav | — | Submit | **No** — Prove is now framed and stripped |
| **Feedback** | one sentence + Next | *unchanged* | — | — | Next | **Yes — CONDITION L6** |
| **Results** | page-shaped dead end | *unchanged, subordinate to the redesign* | — | — | back to subject | **Yes — LX-5 debt** |

**HARNESS VERIFIED** at 375px: Focus bar + supported-practice (support
indicator, response-contract line, "Need help?", single Submit, no
dots/chips/breadcrumb) + Prove framing. Screenshots in the session log.

---

## 15. Responsive (375 / 768 / 1440)

| width | Focus chrome | active view |
|---|---|---|
| 375 | REAL APP VERIFIED — focus bar sticky, no h-overflow, Exit ≥ 40px target | HARNESS VERIFIED — single column, dominant question, one Submit |
| 768 | REAL APP VERIFIED (route SSR) | HARNESS VERIFIED |
| 1440 | REAL APP VERIFIED — centered 720px column, no sidebar | HARNESS VERIFIED |

Math rendering / horizontal overflow inside `MathText` / `MathAnswerEditor`
is unchanged from before (Smart Math is LX-8); the new wrapper does not
introduce overflow.

## 16. Accessibility (material)

- **REAL APP VERIFIED:** Focus Mode exit is a real `<Link>` with
  `aria-label`, a visible `:focus-visible` ring, ≥ 40px target. The
  `aria-modal` drawer / focus trap from LX-2P is simply not rendered in
  Focus Mode (no background nav to trap against).
- **Done:** "Need help?" carries `aria-expanded`; the response-requirement
  line is plain text (not colour-coded).
- **CONDITION L9:** the deeper active-learning a11y audit (feedback
  announced via a live region, focus order across teaching stages,
  disabled-help explanation in Prove beyond the framing line, semantic
  question labelling) belongs with the teaching-loop build (L2/L3/L6).
  The `activeLearning.helpUnavailable` string exists for the Prove
  explanation but is not yet surfaced.

## 17. i18n

+27 keys, one per key in every locale (es/en/de/fr/pt), via
`scratchpad/i18n_lx4.py`:
`nav.exitActivity` · `teachingExperience.mode.{EXPLAIN,MODEL,GUIDE,PRACTICE,INDEPENDENT}`
· `responseContract.{ANSWER_ONLY,SHOW_WORK,EXPLAIN,JUSTIFY,label}` ·
`activeLearning.{needHelp,tryAgain,continue,proveTitle,proveBody,helpUnavailable}`
· `feedback.{whatHappened,why,whatToChange,correctReinforce}` ·
`help.{explainDifferently,showExample,giveHint,remindRule,showFirstStep,whyWrong}`.
The `feedback.*` and most `help.*` keys are staged for L4/L6 and are not
yet consumed. All are interface language (UI ≠ instruction ≠ target
language stays an LX-8 concern; nothing here blocks it).

## 18. Files changed

| File | Purpose | Domain / Presentation |
|---|---|---|
| `src/lib/lx/teaching-experience.ts` | **new** — pure `SupportLevel` → teaching-experience config | **presentation contract** (consumes canonical, computes none) |
| `src/lib/lx/response-contract-grading.ts` | **new** — pure `applyResponseContractGuard` + `finalAnswersMatch` | **presentation/enforcement contract** (grader whitelist) |
| `src/app/api/quizzes/generate-and-take/route.ts` | wire the grader guard after `gradeAnswer`; replace hardcoded evidence `difficulty: 3` with `aggregateEvidenceDifficulty`; collect per-question difficulty | route (execution) — no engine change |
| `src/app/dashboard/LearnerShell.tsx` | Focus Mode: collapse to minimal chrome on `FOCUS_MODE_PREFIXES`; `exitLabel`/`exitHref` props | presentation |
| `src/app/dashboard/layout.tsx` | pass `exitLabel={t['nav.exitActivity']}` | presentation |
| `src/app/dashboard/quiz/page.tsx` | canonical-flow detection + auto-start (skip configurator); omit learner `maxQuestions` for canonical flow; remove difficulty dots + breadcrumb; "Need help?" entry; response-contract line; "Prove it" framing | presentation |
| `src/app/globals.css` | `.lx-shell--focus` / `.lx-focusbar` / `.lx-exit` / `.lx-main--focus` (+ mobile) | presentation |
| `src/lib/i18n/messages.ts` | +27 keys ×5 | presentation |
| `tests/unit/lx4-teaching-experience.test.ts` | 20 cases | test |
| `tests/unit/lx4-response-contract-grading.test.ts` | 18 cases incl. the numeric-no-work regression | test |
| `tests/unit/lx4-focus-and-flow.test.ts` | Focus Mode / configurator removal / evidence difficulty / Response Contract wiring / i18n | test |

**No canonical engine, service, schema, route contract, or evidence
boundary was modified.** `mastery.service`, `adaptive-teaching-policy`
(`ADAPTIVE_TEACHING_POLICY_VERSION` still 1), `adaptive-learning-policy`
(v3), `knowledge-state.service`, `ai-permission-policy`,
`active-evidence-guard`, the verification pipeline, the LX-1 contracts —
all untouched.

## 19. Tests

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| LX-4 unit (3 files) | 56 passed |
| full `npx vitest run` | **174 files / 2513 passed** (was 2475 at LX-3R) |
| `npm run build` | green — compiled OK, 91/91 static pages, no warnings |
| visual | Focus Mode REAL APP VERIFIED at 375 / 1440 (`/dashboard/quiz` vs `/dashboard/today` contrast); transformed active view HARNESS VERIFIED at 375 |

## 20. Compatibility

- Legacy / manual quiz entry (assessment / exam, or `?setup=1`) keeps
  the full setup form and the `maxQuestions` slider.
- The `?verifyAttemptId=` resume flow is untouched.
- `generate-and-take` still accepts `maxQuestions` (legacy callers);
  only the canonical UI stops sending it.
- Focus Mode is purely additive chrome — every activity route still
  renders its own page unchanged inside it.
- The grader guard only ever *repairs* an `ANSWER_ONLY` grade upward on
  a demonstrably-correct final answer; it never lowers a score and never
  touches `SHOW_WORK`/`EXPLAIN`/`JUSTIFY`.

## 21. Deferred findings

| # | Item | Phase |
|---|---|---|
| L1 | `deriveTeachingExperience` not consumed — `SupportLevel` still invisible in the UI | **LX-4 condition** (this phase) |
| L2 | Worked-example surface (source from `ConceptExplanation.examples`) | **LX-4 condition** |
| L3 | Guided practice ("solve one together") — needs a teaching-content call + step machine | **LX-4 condition** |
| L4 | Multi-action contextual-help surface (6 actions, error/misconception context, "why is this wrong?") | **LX-4 condition** |
| L5 | `expectedReasoningType` populated in generation (prompt ask + read-back guard) | **LX-4 condition** |
| L6 | Pedagogical feedback restructure (what/why/change/now) + in-activity retry + ERROR→teaching loop | **LX-4 condition** |
| L7 | Canonical Evidence Sufficiency consulted after a correct Prove answer | **LX-4 condition** |
| L8 | Canonical evidence-**gap**-driven question count for Practice/Prove; zero-gap audit | **LX-4 condition** |
| L9 | Deep active-learning a11y (feedback live region, teaching-stage focus order, Prove help-off explanation surfaced) | **LX-4 condition** (with L6) |
| — | Cross-activity continuation / "what next" after an activity; the Results dead end | **LX-5** |
| — | Today redesign | **LX-6** · My Path | **LX-7** |
| — | Smart Math workspace, TTS, STT, listening/speaking, curated external content | **LX-8** |
| — | Rewards / motivation | **LX-9** · Measurement framework | **LX-10** |

---

# LX-4 — TEACHING & ACTIVE LEARNING EXPERIENCE CERTIFICATION

## STATUS
**PASS_WITH_CONDITIONS**

## TEACHING LOOP
Final **implemented** loop:

```
(canonical launch: Concept Mission → LearningDecision → session/start)
        ↓  no configurator — auto-start
FOCUS MODE  (no sidebar / nav / drawer / footer; Exit + logo only)
        ↓
CHALLENGE   concept context · "What's being asked: <ANSWER_ONLY|SHOW_WORK|EXPLAIN|JUSTIFY>"
        ↓
RESPONSE    one answer surface · one Submit · (PRACTICE only) a calm "Need help?" entry
        ↓
GRADE       Response/Evidence Contract guard in front of the grader:
            ANSWER_ONLY + correct final answer  ⇒  never docked for absent work
        ↓
FEEDBACK    grader feedback + canonical errorType   (structure + retry = CONDITION L6)
        ↓
EVIDENCE    learning_evidence.difficulty = actual mean question difficulty
```

The **teach-first** half of the target loop (I SHOW YOU → WE DO IT
TOGETHER → YOU TRY WITH HELP) is **contracted but not built** —
conditions L1–L4, L6.

## ADAPTIVE SUPPORT
Canonical `TeachingIntent.supportLevel` is now **mappable** to a visible
experience (`deriveTeachingExperience`, §3) — HIGH_SUPPORT gets a
worked-example-first flow, INDEPENDENT gets a stripped Prove. **It is
not yet rendered** (CONDITION L1): the quiz page does not fetch a
`TeachingIntent`. Adaptive Teaching remains technically present but
still largely invisible until L1.

## PRACTICE
Supported Practice today: Focus Mode chrome · genuine progress ·
assisted/independent indicator · response-requirement line · the
question dominant · a calm "Need help?" (PRACTICE evidence modes only,
server `canUseAI` authoritative) · single Submit. Removed: the
configurator, the 5 difficulty dots, the breadcrumb, the "Hint" test-aid
framing. Not yet: worked examples, guided steps, the restructured
feedback, in-activity retry.

## ERROR → TEACHING
**Not implemented (CONDITION L6).** Feedback is still a grader sentence
+ Next. Canonical `errorType` / `error-intelligence` / misconception
data is available and must not be re-diagnosed client-side when wired.

## PROVE
`evidenceMode !== PRACTICE` ⇒ a **"Prove it — on your own, no hints, no
help"** framing block and **no help entry**. Independence stays owned by
`EvidenceMode` — **no `isProveMode` engine flag** (the page-local const
is presentation only, from the existing `PRACTICE_EVIDENCE_MODES`
mirror). Evidence Sufficiency after a correct answer is not yet
consulted (CONDITION L7); the verification engine is untouched and not
bypassed.

## RESPONSE CONTRACT
Generator → UI → grader alignment:
- **UI:** `deriveResponseEvidenceContract(q, evidenceMode)` → the
  "What's being asked" line, shown before answering. REAL APP wired.
- **Grader:** `applyResponseContractGuard` in `generate-and-take` —
  `contractPermitsGradingOn` is consulted at runtime; an `ANSWER_ONLY`
  question can no longer lose points for absent work. UNIT-verified
  (incl. the numeric-no-work regression); not run end-to-end (no
  AI/auth env).
- **Generator:** `expectedReasoningType` still not populated
  (CONDITION L5); the contract already tightens correctly when the tag
  *is* present, so the alignment is sound the moment L5 lands.

## QUESTION COUNT
Authority: **canonical Practice/Prove — the learner no longer sets it**
(configurator removed; `maxQuestions` omitted for the canonical flow).
The route's per-mode execution default is used. Canonical
evidence-**gap**-driven count (LX-1R) is **NOT wired (CONDITION L8)** and
is labelled a compatibility limitation, never shown to the learner as
pedagogical truth. RETAIN / TRANSFER / DIAGNOSE / ASSESS: **UNRESOLVED**,
legacy execution counts preserved for compatibility. Zero-gap audit: not
done (L8). Legacy manual entry keeps the slider.

## DIFFICULTY
- Intrinsic question difficulty: generator-owned, unchanged; the 5 dots
  are **removed** from the learner view.
- Evidence difficulty: **RESOLVED** — now the actual mean generated
  difficulty (`aggregateEvidenceDifficulty`), not a hardcoded `3`.
- Target challenge (learner-relative): **UNRESOLVED.** No canonical
  authority combines the candidate inputs; per LX-1R, not fabricated.
  Homepage "adjusts difficulty" claim **not** restored.

## FOCUS MODE
Final learner-facing chrome on an active-learning route: a 52px sticky
bar — **`← Exit`** (localized, keyboard-focusable, → Today) on the left,
the StudyUS logo on the right — above a centered ≤ 720px content column.
**No** persistent sidebar, primary nav, mobile drawer, streak footer,
account nav, Study Plan / Learning Debt / Tutor / Progress links.
Applies to `/dashboard/quiz`, `/dashboard/remediation`,
`/dashboard/cognitive/explain`, `/dashboard/cognitive/transfer` via the
LX-2 `chrome` seam — no second navigation system.

## VISUAL TRANSFORMATION
**Does the active learning experience still reasonably look like the
legacy quiz?**
**The environment does not** — Focus Mode removes all persistent
navigation, the configurator is gone, the difficulty dots / metric
chips / breadcrumb are gone, a response-requirement line and a Prove
framing are new. **The inner answer→feedback loop still partly does** —
worked examples, guided practice, the restructured pedagogical feedback
and in-activity retry are contracted but not built (L1–L4, L6).
Because the teach-first half of the loop is not yet visible, STATUS is
**PASS_WITH_CONDITIONS**, not PASS.

## WHAT WAS REMOVED
The setup configurator for the canonical flow (mode picker, question-count
slider, topic multiselect, "Start"); the persistent learner navigation
during an activity (sidebar / drawer / footer / account nav); the
in-question 5-level difficulty dots; the in-page breadcrumb; the "Hint"
test-aid framing; the hardcoded `difficulty: 3` evidence write.

## WHAT WAS PRESERVED
Every canonical engine and evidence boundary: `mastery.service` (sole
`learning_evidence` writer), `adaptive-teaching-policy` /
`adaptive-learning-policy` (versions unchanged), `knowledge-state.service`,
`ai-permission-policy`, `active-evidence-guard`, the verification /
assessment pipeline, `error-intelligence` / `cognitive-diagnosis` /
`misconception` services, `EvidenceMode` as the sole independence
authority, all LX-1 contracts, the `?verifyAttemptId=` resume flow, and
legacy/manual quiz entry.

## RESPONSIVE CERTIFICATION
- **375px** — Focus bar sticky, no horizontal overflow, Exit target ≥
  40px, single-column active view (REAL APP + HARNESS).
- **768px** — Focus chrome (route SSR REAL APP); active view HARNESS.
- **1440px** — centered 720px column, no sidebar (REAL APP); active view
  HARNESS.

## ACCESSIBILITY
Focus Mode exit: real link, `aria-label`, visible focus ring, ≥ 40px.
"Need help?" has `aria-expanded`; the response line is text, not colour.
Deeper active-learning a11y (feedback live region, teaching-stage focus
order, surfaced Prove help-off explanation) is **CONDITION L9**, bundled
with the teaching-loop build.

## CONDITIONS
L1 render `deriveTeachingExperience` (fetch `TeachingIntent`; make
`SupportLevel` visible) · L2 worked-example surface (from
`ConceptExplanation.examples`) · L3 guided practice · L4 multi-action
contextual-help surface · L5 `expectedReasoningType` in generation · L6
pedagogical-feedback restructure + in-activity retry + ERROR→teaching
loop · L7 Evidence Sufficiency after a correct Prove answer · L8
canonical evidence-gap question count + zero-gap audit · L9 deep
active-learning a11y.

## DEFERRED
LX-5 — cross-activity continuation / "what next" / the Results dead
end. LX-6 — Today. LX-7 — My Path. LX-8 — Smart Math, TTS, STT,
listening/speaking, curated external content. LX-9 — rewards. LX-10 —
measurement.

## ARCHITECTURAL INVARIANTS (future phases must preserve)
1. `TeachingIntent` / `SupportLevel` is canonical; the UI only renders
   support, never computes it (`deriveTeachingExperience` asserts this).
2. Error feedback may trigger teaching, but the UI never creates a
   diagnosis — canonical `errorType` / `error-intelligence` /
   `misconception` only.
3. Assisted Practice never becomes independent evidence — `EvidenceMode`
   + `computeSupportLevel`'s non-PRACTICE hard floor.
4. Prove never exposes teaching help — gated on `EvidenceMode`, not a
   client flag.
5. The grader evaluates only Response Contract axes — `applyResponseContractGuard`
   / `contractPermitsGradingOn` at runtime.
6. StudyUS decides pedagogical configuration — the learner does not set
   question count or difficulty for a canonical flow.
7. Execution defaults are not pedagogical truth — unresolved counts /
   target difficulty are labelled, never presented as decisions.
8. Difficulty policy lives in the learning domain or stays `UNRESOLVED`
   — never in React / the quiz page / an LX helper.
9. Focus Mode owns presentation only — the LX-2 `chrome` seam, no
   second navigation system.
10. LX-5 owns cross-activity continuation — LX-4 never adds a page-local
    "what next" resolver.

## NEXT PHASE
`LX-5 — Learning Continuation` — authorized only once this
certification (and its conditions) is accepted. **Do NOT implement
LX-5.**

STOP.
