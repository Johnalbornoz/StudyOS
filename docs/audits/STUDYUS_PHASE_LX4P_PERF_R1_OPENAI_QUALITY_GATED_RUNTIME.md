# STUDYUS — PERFORMANCE + AI QUALITY ARCHITECTURE REPAIR
## LX-4P-PERF-R1 — OPENAI LUNA-FIRST + QUALITY-GATED PARALLEL LEARNING RUNTIME
### REPORT & CERTIFICATION

Branch: `tmp/lx1`
Partial-repair commit: `7a8839c`
Baseline: `c58cfad`.

---

## SCOPE OF THIS DELIVERY (read first)

This phase has two halves:

| Half | Status here |
|---|---|
| **A. Provider-independent performance architecture** — parallel teach-first runtime, TeachingIntent decoupling, activity-language rule, journey marks | **DELIVERED** (`7a8839c`), fully typed + tested |
| **B. OpenAI Luna-first quality-gated runtime** — provider migration (R2/R7), Question Quality Gate (R8/R9), deterministic academic validators (R10), Terra fallback (R11), Sonnet quality baseline + comparison (R12/R13), visual question contract + renderers (R14/R15/R16), token/cache/cost measurement (R17/R19/R23), all live benchmarks (R24/R26) | **NOT DELIVERED — BLOCKED** |

**Half B is blocked by the standing environment constraint** (every LX
phase this session): no AI provider credentials (`OPENAI_API_KEY`
unset), no authenticated Clerk session, no deploy path (no Vercel CLI /
unauthenticated MCP). Additionally, `gpt-5.6-luna` / `gpt-5.6-terra` /
`gpt-5.6-sol` are not model identifiers whose behaviour, schema support,
or pricing can be verified from here. Building the provider migration +
quality gate + Terra fallback + 13 visual renderers + a Sonnet baseline
**blind and untestable** would be speculative and unsafe, and would
still be uncertifiable. Half B needs an environment with provider keys +
a preview deploy.

**The phase is certified FAIL** — its defining objective (StudyUS no
longer depends on a frontier model on the first try; measured accepted
quality ≥ Sonnet baseline; p50 < 5 s / p95 ≤ 7 s TTFI) is not met and
cannot be verified here. The delivered subset is documented below and is
safe to keep.

---

## 1. AI ROUTING — BEFORE

| capability (canonical learner runtime) | provider | model |
|---|---|---|
| `quiz.question_generation` v3 — canonical PRACTICE (count ≤ 4) | anthropic | **claude-sonnet-5** |
| `quiz.question_generation` v3 — chunk path (count > 4) / quick_check / retention 2×3 | anthropic | **claude-haiku-4-5-20251001** |
| concept explanation (`concept-explanation.service`) | anthropic | **claude-sonnet-5** |
| worked example | (sourced from concept explanation — same call) | claude-sonnet-5 |
| guided practice (`teaching-content.service`) | anthropic | **claude-sonnet-5** |
| contextual help / hint | anthropic | claude-sonnet-5 (hint), cached explanation for others |
| pedagogical feedback / free-text grading (`quiz.free_text_grading`) | anthropic | **claude-sonnet-5** |
| remediation content | anthropic | claude-sonnet-5 |
| `quiz.question_localization` (LX-4P-R2, switch-only) | anthropic | claude-sonnet-5 |
| `quiz.question_localization_verify` (LX-4P-R2R1, switch-only) | anthropic | claude-sonnet-5 |
| embeddings | openai | text-embedding-3-* (existing) |

Central boundary: **already present** — every call goes through
`executeAI` (`src/lib/ai/gateway.ts`) with `provider` + `model` fields
and `src/lib/ai/adapters/{anthropic,openai}.ts`. There is no scattered
SDK use in quiz generation / TeachingIntro / GuidedPractice /
ContextualHelp / localization.

## 2. AI ROUTING — AFTER

**Unchanged in code.** The `capability → { provider, primaryModel,
fallbackModel }` map (R1) is **not added** — it would be an unused,
untested config pointing at unverifiable model ids. Recommended shape
for the follow-up (in an environment with keys):

```
CAPABILITY_MODEL: Record<AICapability, { provider, primary, fallback }>
  QUESTION_GENERATION  -> { openai, 'gpt-5.6-luna', 'gpt-5.6-terra' }
  CONTENT_GENERATION   -> { openai, 'gpt-5.6-luna', 'gpt-5.6-terra' }   // explanation, guided practice
  EXPLANATION_EVALUATION / GRADING -> { openai, 'gpt-5.6-terra', 'gpt-5.6-terra' }  // evaluation stays on the stronger model
```
Resolved once in `executeAI`; callers stop passing `model:` literals.

## 3. SONNET RUNTIME REMOVAL

**Remaining runtime Sonnet calls: ALL of them.** No canonical learner
runtime call was moved off `claude-sonnet-5` in this delivery — the
migration is Half B (blocked). Expected target of the phase: NONE.
**Actual: unchanged.** This alone makes STATUS = FAIL.

## 4. BEFORE CRITICAL PATH (teach-first, from the accepted audit)

```
Continue → generate-and-take  [Sonnet: ~3 questions + RAG + storeQuiz]   ← blocks
        → teaching-intent      [DB orchestrator; keyed off quizId]        ← serial
        → TeachingIntro
            Promise.all([ explanation (Sonnet), guided-practice (Sonnet) ])  ← serial, both awaited
        → MODEL renders
```
3 serial Sonnet round-trips before MODEL; the question batch is on the
critical path for no pedagogical reason.

## 5. AFTER CRITICAL PATH (this delivery)

```
Continue → /dashboard/quiz mounts → startCanonicalActivity(sid)
   ├─ wave A: teaching-intent?studentId&conceptId&mode     (DB orchestrator, no quizId)
   │      └─ resolves → setTeachingStage('teaching'); setPhase('quiz')   ← MODEL can paint NOW
   └─ wave B: generate-and-take                            (background, genState:'loading')
          └─ resolves → applyGenResult(); genState:'ready'

   TeachingIntro (mounted once wave A resolves):
     ├─ effect 1: /api/concepts/:id/explanation  (needs only conceptId)  → MODEL/EXPLAIN ready
     └─ effect 2: /api/learning/guided-practice  (waits for quizId from wave B) → GUIDE ready, in background

   learner works MODEL → (GUIDE if ready; brief hold if still preparing) → Start Practice
     └─ questions[0] if genState==='ready'
        else "Preparing your practice" / retry   (recoverable, never a dead end)
```

Serial AI round-trips before **MODEL**: **1** (explanation) — down from 3.
`generate-and-take` and `guided-practice` are off the MODEL path.

## 6. TTFI ARCHITECTURE

- **Teach-first TTFI** now = `Continue → mount → teaching-intent (DB) →
  explanation (1 AI call) → MODEL paints`. Question generation +
  guided-practice run concurrently and are normally done before the
  learner leaves MODEL.
- **Direct-Practice TTFI** unchanged in structure: still waits on the
  one `generate-and-take` call (there is no teaching stage to overlap
  with). The model on that call is still Sonnet (Half B would move it to
  Luna).
- **Measured p50/p95: NOT AVAILABLE** — no provider, no auth, no deploy.
  The `[perf]` marks (R22) make it measurable in preview/production.

## 7. LEARNINGDECISION REUSE

**BEFORE:** `getLearningDecisions(studentId)` runs up to 3× per journey
— Concept Mission, `/api/learning/continue`, `/api/learning/teaching-intent`.

**AFTER:** still **3×**. R5 (reuse the `/continue` decision snapshot) is
**not implemented** in this delivery — it needs either a short
request/session-scoped `LearningContextPackage` threaded from `/continue`
to the quiz page, or a cache, and the spec forbids a long-lived
heuristic cache. What *did* change: the 3rd call
(`/api/learning/teaching-intent`) now runs **in parallel** with
`generate-and-take` instead of serially after it, so it no longer adds
wall-clock latency to the teaching path even though the call count is
the same. Recommended follow-up: pass the resolved
`{ teachingExperience, conceptId, subjectId }` from `/continue` in the
launch params so the quiz page skips the teaching-intent round-trip
entirely.

## 8. TEACHINGINTENT AUTHORITY (after repair)

`/api/learning/teaching-intent`:
- `SupportLevel` / `explanationDepth` / `primaryBarrier` /
  misconception state → **only** from the canonical
  `getTeachingIntentForConcept(studentId, conceptId)` →
  `getBestLearningDecisionForConcept` → `getLearningDecisions`. Unchanged.
- `EvidenceMode` → from the canonical `QuizMode → ActivityType →
  EvidenceMode` taxonomy (`evidenceModeForQuizMode`) — the **same fixed
  mapping** `storeQuiz` uses to stamp `quiz_sessions.evidence_mode`. When
  a `quizId` is supplied it is still read from the row (back-compat).
- `conceptId` from the URL is authorised implicitly:
  `getTeachingIntentForConcept` returns a decision only for a concept
  genuinely in the student's curriculum.
- React computes **nothing** — it renders `deriveTeachingExperience(...)`
  output. `computeSupportLevel` is not referenced client-side.

## 9. MODEL/GUIDE PARALLELISM

`TeachingIntro` — the blocking `Promise.all([explanation, guided])` is
**gone**. Two independent effects:
- `[conceptId, locale]` → explanation (EXPLAIN/MODEL). Component's
  whole-view loading gate = `expLoading` only.
- `[conceptId, quizId, locale]` → guided-practice (GUIDE), fired once
  `quizId` exists; `if (!quizId) { setGpLoading(true); return; }`.
- `guidePending = needsGuided && gpLoading` — a canonical GUIDE that
  hasn't loaded is **pending, not absent**: `isLast = idx >=
  effectivePlan.length - 1 && !guidePending`, and if the learner
  finishes the loaded stages while GUIDE is pending the component holds
  on a brief loading card rather than skipping GUIDE.
- Stage ORDER stays canonical (`view.stages` order preserved).

## 10. PRACTICE BACKGROUND GENERATION

`genState: 'idle' | 'loading' | 'ready' | 'error'`.
- `startCanonicalActivity` sets `'loading'` and fires `generate-and-take`
  without awaiting it on the teaching path.
- On success → `applyGenResult(data)` (quizId, questions, countAuthority,
  the LX-4P-R2 `originalQuestionsRef`/`sessionOriginalLanguage`) →
  `'ready'`.
- On failure → `'error'` (not fatal while teaching is up).
- Render: `teachingStage === 'questions' && questions.length === 0 &&
  genState !== 'ready'` → `'loading'` shows `practice.preparing`
  (`role="status"`); `'error'` shows `practice.prepareFailed*` + a retry
  that re-runs `generateQuiz(studentId)`. **No `router.push`, no
  Concept-Mission bounce, no fabricated questions** (R25).

## 11. OPENAI PROVIDER INTEGRATION

**Not changed.** The boundary already exists (`executeAI` +
`adapters/openai.ts::callOpenAIChat`, used today for embeddings +
`interactive-formula.service`). No runtime capability was routed to
OpenAI. **BLOCKED**: `OPENAI_API_KEY` unset; cannot exercise or verify.

## 12. LUNA STRUCTURED OUTPUT

**Not implemented.** `quiz.question_generation` still targets
`claude-sonnet-5` (chunk path: Haiku). No OpenAI Structured Outputs /
strict JSON schema wiring. **BLOCKED.**

## 13. QUESTION QUALITY CONTRACT

**Not formalized in this delivery.** The `GeneratedQuestion` contract
already carries most of R8's fields (`conceptId`, `type`,
`cognitiveLevel`, `questionIntent`, `difficulty`,
`expectedReasoningType`, `evidenceDimensions?`, `correctAnswer`,
`explanation`, `options`, `visualAid`). Not yet promoted to a validated
"Quality Contract" with a gate. **Deferred to Half B.**

## 14. DETERMINISTIC VALIDATORS

**None added.** R10 (bounded numeric recompute for
arithmetic/formula/unit answers) is genuinely doable and low-risk, but
it only *materially* pays off wired into the R9 Quality Gate that
consumes it — which is blocked. Note: LX-4P-R2R1 already ships bounded
**deterministic** unit/scale + numeric-token + formula-token multiset
checks (`reconcileLocalization`), but those guard *localization*, not
*generation*. **Deferred.**

## 15. TERRA FALLBACK

**Not implemented.** No second-model quality fallback exists. **BLOCKED**
(no models, no gate). `LX-4P-R2R1`'s `SEMANTIC_*` fail-closed reasons are
localization-only.

## 16. SONNET QUALITY BASELINE

**Not established.** Requires provider calls to generate the 300–500
question evaluation set and score it. **BLOCKED.**

## 17. QUALITY COMPARISON

**Not run.** Sonnet vs Luna-first-pass vs Luna+Terra — none measurable.
**BLOCKED.**

## 18. VISUAL QUESTION CONTRACT

**Audited, not extended.** Current `visualAid` schema
(`quiz-generation.service.ts`): `{ kind: 'diagram' | 'chart', svg?,
chartData?: { chartType: 'line'|'bar', labels, values, xLabel?, yLabel? },
caption? }`. `toClientQuestion` forwards it; the client `MiniChart`
renders `chartData` line/bar and inline `svg` diagrams. R14's structured
semantic types (`FORCE_DIAGRAM`, `FUNCTION_GRAPH`, `NUMBER_LINE`, …) +
their renderers + a visual quality gate (R16) are **not added** — R14
itself says only ship a renderer you can validate, and building/testing
13 renderers + a generation-time visual gate is out of scope for a
performance repair and is coupled to the (blocked) Luna generation
pipeline. **Deferred.**

## 19. RAG REUSE

**Not implemented.** `retrieveContext(conceptId)` still runs separately
in the 3 producers (questions, explanation, guided-practice). Each is the
DB **fast path** (`getChunksByConceptId`, no embedding call) so the
per-call cost is a single query, but it is uncached and repeated.
Recommended: a request-scoped `LearningContextPackage` passed to the
parallel producers. **Deferred (R5/R18).**

## 20. PROMPT / TOKEN OPTIMIZATION

**Not done.** No per-capability input/output budget, reasoning-effort, or
cacheable-prefix separation was added (R17/R19). Measuring the savings
needs live provider usage. **Deferred.**

## 21. COST COMPARISON

**Not available** — no live token usage, no accepted-question stream, no
provider. Every R23 KPI (cost per accepted question, per Practice
launch, per MODEL/GUIDE, per teach-first launch, fallback rate,
tokens/accepted-question) is **NOT MEASURED**.

## 22. ACTIVITY LANGUAGE REGRESSION (R20)

**Implemented + tested.** The entire active learning surface follows the
**activity/question language**, superseding the LX-4P-R2 R13
`uiLocale` split:
- `TeachingIntro` + `GuidedPractice`: `const t = getMessages(locale)`
  (`locale` = `quizLanguage`). "WORKED EXAMPLE / Reveal the next step /
  Continue / Skip to practice / your step / Check" now render in the
  activity language.
- `ContextualHelp`: `const t = getMessages(locale)` — "Need help?", the
  action labels, and errors follow the activity language; help content
  request already did (`language: locale`).
- The `uiLocale` prop is removed from all three components and their call
  sites.
- Global shell (`LearnerShell`, Today, My Path, Progress, profile,
  nav/settings) still uses `interface_language` — untouched.
- LX-4P-R2 / R2R1 same-item localization + semantic verification
  unchanged; the language `<select>`'s mid-attempt gate
  (`attemptSameItemLocalization` / restart) is unchanged.

Expected result: `interface_language = Spanish`, `activity language =
English` → global shell Spanish, active learning surface (MODEL/GUIDE/
PRACTICE incl. chrome) English. ✔

## 23. EVIDENCE / MASTERY REGRESSION

**None.** No change to grading, `learning_evidence`, `updateMastery`,
mastery policy, evidence thresholds, `operation_key`, EvidenceMode, or
the submit path. `generate-and-take` internals untouched (the LX-4R R8
canonical count logic still runs). `applyGenResult` is a pure
state-move refactor of the block that was already in `generateQuiz`.
LX-5 Continue, Transfer, Retention paths unchanged. Full LX-5 / LX-5R /
LX-4P-R1 / R2 / R2R1 test files still green.

## 24. OBSERVABILITY

Added: client `[perf]` marks `T0_start`, `T4_gen_start`,
`T1_teachingintent_ready`, `T5_gen_ready`, `T6_first_practice_question`
(one `console.log` each, `{label, t, conceptId, quizMode}` — no learner
content). Server per-phase timing, `Server-Timing`, per-chunk /
validation / DB / Quality-Gate / Terra timings, and the AI-event token/
cost fields (R22's full list) are **not added** (most require Half B or
provider usage to be meaningful). Existing `[ai] {promptId, durationMs,
model, ...}` per-call logging is unchanged.

## 25. TESTS

```
npx tsc --noEmit    clean
npx vitest run      182 files / 2672 passed
                    (+ tests/unit/lx4p-perf-r1-parallel-runtime.test.ts, 16:
                     R3 parallel waves + teach-first gate no longer needs quizId +
                     R25 recoverable preparing state; R4 teaching-intent from
                     conceptId+mode, quizId path preserved, React computes no
                     SupportLevel; R6 split effects, MODEL not blocked on GUIDE,
                     guidePending; R21 no localization on initial launch; R22 marks;
                     authority unchanged)
                    (lx4p-r1 R3/R5/R7 + lx4p-r2 R13->R20 assertions updated for
                     applyGenResult + the split TeachingIntro effects)
npm run build       ✓ compiled; 96/96 static pages
```

Regression matrix (spec's 36 cases): #22–#31, #36 (localization
unchanged, no localization on launch, activity language, evidence/mode/
Response-Contract/LX-5/Transfer/Retention unchanged, no client
SupportLevel) — covered by the passing suite. #1–#21, #32–#35
(SupportLevel-gated teach-first orderings, Luna/Terra/quality-gate/
visual/numeric-validation, background-failure recovery under real timing)
— **require a browser + provider and are NOT executed here**; the
recoverable "preparing" path (#35) is source-verified only.

## 26. LIVE BENCHMARK

**Not run.** 10 teach-first + 10 direct-Practice launches, the
question-quality set, and every p50/p95/max TTFI + token + cost figure
require provider credentials, an authenticated learner, and a deploy —
none available. This is the phase's mandatory certification input and it
is absent.

## 27. FILES CHANGED

**Modified**
- `src/app/api/learning/teaching-intent/route.ts` — R4: resolve from
  `conceptId` + `mode`; `evidenceModeForQuizMode`; keep `quizId` path.
- `src/app/dashboard/quiz/page.tsx` — R3: `startCanonicalActivity`
  (parallel waves), `applyGenResult` / `genBody` refactor, `genState`,
  recoverable "preparing"/retry render, teach-first gate no longer needs
  `quizId`, `perfMark` (R22); R20: drop `uiLocale` on `<TeachingIntro>` /
  `<ContextualHelp>`.
- `src/app/dashboard/quiz/TeachingIntro.tsx` — R6: split explanation /
  guided-practice effects, `expLoading` / `gpLoading` / `guidePending`,
  nullable `quizId`; R20: `getMessages(locale)` for all chrome, drop
  `uiLocale` (component + `GuidedPractice`).
- `src/app/dashboard/quiz/ContextualHelp.tsx` — R20: `getMessages(locale)`,
  drop `uiLocale`.
- `src/lib/i18n/messages.ts` — +4 `practice.*` keys × es/en/de/fr/pt.
- `tests/unit/lx4p-r1-language-integrity.test.ts` — R3/R5/R7 assertions
  for `applyGenResult` + split effects.
- `tests/unit/lx4p-r2-same-item-localization.test.ts` — R13 block → R20.

**New**
- `tests/unit/lx4p-perf-r1-parallel-runtime.test.ts` (16).

No migration.

## 28. REPAIR COMMIT

`7a8839c` — `perf(lx): LX-4P-PERF-R1 (partial) -- parallel teach-first
runtime + R20 activity-language rule`.

---

# LX-4P-PERF-R1 — OPENAI QUALITY-GATED PERFORMANCE CERTIFICATION

## STATUS

**FAIL** — the phase's defining objective (OpenAI Luna-first,
quality-gated, quality ≥ Sonnet baseline, measured p50 < 5 s / p95 ≤ 7 s
TTFI, cost/token reduction) is **not delivered and not verifiable** in
this environment. A provider-independent performance subset is delivered
(`7a8839c`) and is safe to keep.

## PRIMARY MODEL

Unchanged — `claude-sonnet-5` (canonical PRACTICE, explanation, guided
practice, grading) / `claude-haiku-4-5-20251001` (chunked & quick_check).
Target was `gpt-5.6-luna`. **Not migrated.**

## FALLBACK MODEL

None. Target was `gpt-5.6-terra`. **Not implemented.**

## SONNET IN CANONICAL RUNTIME

**PRESENT — all of it.** Question generation, concept explanation,
worked example, guided practice, hint, free-text grading, remediation
content, and the switch-only localization pair all still run on
`claude-sonnet-5`. Target: NONE.

## TTFI TARGET

p50 < 5 s, p95 ≤ 7 s.

## TEACH-FIRST TTFI

**NOT MEASURED.** Architecture improved: serial AI round-trips before
MODEL cut from 3 → 1 (question generation + guided-practice moved off the
MODEL path; explanation/guided split). Real p50/p95 need a provider +
deploy.

## DIRECT-PRACTICE TTFI

**NOT MEASURED.** Structurally unchanged — one `generate-and-take` call,
still `claude-sonnet-5` for the canonical ~3-question count (the Luna
swap + small-count fast path are Half B).

## QUESTION QUALITY VS SONNET

**NOT YET MEASURED.** No Luna pipeline, no baseline, no comparison set.

## QUESTION CORRECTNESS

NOT MEASURED.

## AMBIGUITY RATE

NOT MEASURED.

## SCHEMA VALIDITY

Existing `GeneratedQuestion` schema validation unchanged; no new
generation-time Quality Gate. NOT MEASURED for a new model.

## VISUAL QUESTION SUPPORT

Unchanged: `visualAid` = inline `svg` diagram or `chartData` line/bar
(`MiniChart`). No structured semantic types / renderers / visual quality
gate added.

## TERRA FALLBACK RATE

N/A — no Terra fallback exists.

## TOKEN REDUCTION

NOT MEASURED — no per-capability budgets, no cache-prefix split, no live
usage.

## COST REDUCTION

NOT MEASURED.

## LATENCY REDUCTION

Architecturally: teach-first MODEL path 3 serial AI calls → 1, plus
`teaching-intent` moved from serial-after-`generate-and-take` to parallel.
**Numeric reduction: NOT MEASURED.**

## LEARNING DECISION CALL COUNT

BEFORE 3× per journey. AFTER **3×** (the teaching-intent call now runs in
parallel, so it adds no wall-clock latency, but R5 decision-reuse is not
implemented).

## QUESTION BACKGROUND GENERATION

**Implemented.** `genState` machine; `generate-and-take` runs in the
background off the teaching path; recoverable "Preparing your practice" /
retry at the Practice transition; never a dead end, never a
Concept-Mission bounce, never fabricated questions.

## EVIDENCE INTEGRITY

**Unchanged.** No change to grading / evidence writes / mastery policy /
thresholds / EvidenceMode / Response Contract / operation keys / submit
path. LX-5 / Transfer / Retention unchanged. Full prior suites green.

## LANGUAGE INTEGRITY

Confirmed:
- **GLOBAL APP → `interface_language`** (shell, Today, My Path, Progress,
  profile, nav — untouched).
- **ACTIVE LEARNING EXPERIENCE → activity/question language** — MODEL,
  GUIDE, PRACTICE, PROVE: question, worked example, guided practice,
  activity-local buttons, "Need help?", contextual-help labels,
  captions, teaching-stage labels, pedagogical explanation, local
  feedback — all `getMessages(quizLanguage)`. R13 `uiLocale` split
  reverted.
- Same-item localization (LX-4P-R2/R2R1) and the mid-attempt
  language-switch gate — **not regressed**.

## MIGRATION REQUIRED

NO.

## TESTS

tsc clean · vitest 182 files / 2672 passed
(`lx4p-perf-r1-parallel-runtime.test.ts` 16; lx4p-r1 / lx4p-r2 updated)
· build 96/96.

## LIVE PERFORMANCE RESULTS

**NONE.** No provider credentials, no authenticated session, no deploy.
Mandatory certification input absent.

## REPAIR COMMIT

`7a8839c`.

## REMAINING CONDITIONS

Every item of Half B, all blocked on provider access + a preview deploy:
1. Central `capability → { provider, primary, fallback }` model map (R1)
   and route the canonical learner runtime to `gpt-5.6-luna` (R2/R7)
   with OpenAI Structured Outputs.
2. Question Quality Gate — deterministic checks + AI verification (R8/R9);
   bounded deterministic academic recompute (R10).
3. One-shot Terra fallback with recorded reason (R11); fail-closed if
   Terra also fails.
4. Offline Sonnet quality baseline (300–500 items) + Sonnet vs Luna vs
   Luna+Terra comparison; **accepted output quality ≥ Sonnet baseline**
   (R12/R13).
5. Structured `VisualQuestion` contract + only-safely-renderable types +
   visual quality gate (R14/R15/R16).
6. RAG reuse (`LearningContextPackage`) + decision-snapshot reuse from
   `/continue` (R5/R18); per-capability token budgets + cacheable
   prefixes (R17/R19).
7. Full server + AI-event observability incl. token/cost fields (R22);
   cost KPIs (R23).
8. Live benchmark: ≥10 teach-first + ≥10 direct-Practice launches with
   per-run TTFI / tokens / cost + p50 / p95 / max (R24/R26); production
   TTFI verification against p50 < 5 s / p95 ≤ 7 s.
9. Full 36-case regression matrix executed against a real provider +
   browser (only #22–#31, #36 are covered here).

## NEXT STEP

Code is **not** a full PASS (Half B undelivered) and the real-provider
benchmark is **absent**. Per the phase's own rule: **do NOT certify
production performance.**

- Deploy `tmp/lx1` HEAD to **preview** only, for authenticated
  performance + quality measurement of the delivered parallel runtime
  (`[perf]` marks) and the R20 language behaviour.
- Implement Half B in an environment that has OpenAI credentials + a
  preview deploy, then re-run this certification with live numbers.

Do NOT start LX-6 until: (1) production TTFI verified; (2)
accepted-question quality ≥ Sonnet baseline; (3) cost/token measurements
available; (4) evidence + language regressions pass on a real provider.

Nothing has been pushed to `origin/main`.

STOP.
