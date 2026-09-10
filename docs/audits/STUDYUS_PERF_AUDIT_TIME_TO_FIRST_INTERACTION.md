# STUDYUS — PERFORMANCE REGRESSION AUDIT
## AI QUESTION GENERATION / TIME TO FIRST INTERACTION

No code changed. Audit only. Branch `tmp/lx1` @ `c58cfad`. Baseline
compared: production `5a2d0b7`.

---

## 1. CURRENT CRITICAL PATH — Concept Mission → Continue → canonical PRACTICE → first interaction

Chronological, server requests and their internal dependencies. "AI" =
an `executeAI` provider round-trip.

| # | Trigger | Endpoint / work | AI calls | Blocks |
|---|---|---|---|---|
| A | Concept Mission renders | `concept-mission-view.service` → `getBestLearningDecisionForConcept` → **`getLearningDecisions(studentId)`** (Phase-4 orchestrator: `loadLearningSignals` → `Promise.all` over **every** active subject's knowledge state, then consolidate/build/rank) | 0 (DB-heavy) | page render |
| B | learner clicks **Continue** | `POST /api/learning/continue` → `resolveContinuation` → **`getLearningDecisions(studentId)` again** → (NOT_STARTED) `bootstrapNotStartedLearningDecision` → `startLearningSession` → `verifyConceptOwnership` (DB) → `ready('/dashboard/quiz?…mode=topic_practice&conceptId&subjectId')` | 0 | the navigation |
| C | `/dashboard/quiz` mounts | `init()`: `GET /api/me`, `GET /api/language`, `GET /api/subjects/:id/concepts` | 0 | `studentId` |
| D | auto-start effect (`isCanonicalFlow`) | **`POST /api/quizzes/generate-and-take`** (see §2). Internally, serial: `resolveLanguageForSubject`(DB) → `getSubjectIBContext`(DB) → **LX-4R R8**: `getActiveMasteryPolicy`(DB) + `getConceptKnowledgeState`(DB) → `retrieveContext`(DB fast-path, `conceptId` set) → **`generateQuestionsForConcept` → `claude-sonnet-5`** (~3 questions, `maxTokens≈4200`, 30 s timeout) ‖ `computeAskConfidenceFlags`(DB) → `storeQuiz`(DB write) → response with the **full** question array | **1 Sonnet** | `setPhase('quiz')` — the loading spinner |
| E | right after D resolves | `generateQuiz` fires (not awaited) **`GET /api/learning/teaching-intent?quizId=`** → `getQuizSession`(DB) → `getTeachingIntentForConcept` → **`getLearningDecisions(studentId)` a THIRD time** → `getTeachingIntent` (DB) → returns `TeachingExperienceView` | 0 (DB orchestrator) | whether teach-first is entered |
| F | teaching-intent resolves with EXPLAIN/MODEL/GUIDE | `setTeachingStage('teaching')` → `<TeachingIntro>` mounts → its effect runs `Promise.all([` `GET /api/concepts/:id/explanation` → `retrieveContext`(DB) + **`claude-sonnet-5`** (full explanation) `,` `POST /api/learning/guided-practice` → `retrieveContext`(DB) + **`claude-sonnet-5`** (guided sequence) `])` | **2 Sonnet (parallel with each other, serial after D+E)** | MODEL / GUIDE first render |
| G | learner reads MODEL, then GUIDE, clicks through | — | 0 | — |
| H | GUIDE done → PRACTICE | `questions[0]` (already in memory from D) renders | 0 | first question visible |

**Blocking point:** For a **teach-first concept** (the audited case — a
first-touch Derivadas / Fuerza centrípeta), the learner stares at a
spinner through **D → E → F**, i.e. **three serial `claude-sonnet-5`
round-trips** (question batch → *then* explanation + guided-practice) plus
the Phase-4 orchestrator run **three times** across A/B/E. The question
batch generated in D is not shown until step H — after MODEL + GUIDE — so
D's Sonnet call is on the critical path to the teaching UI for **no
pedagogical reason**.

For a **non-teach-first concept**, E returns no stages and the path is
just D: one Sonnet call for ~3 questions + DB → question view.

---

## 2. QUESTION GENERATION PATH — per mode

`POST /api/quizzes/generate-and-take` → `handleGenerateQuiz`:

`maxQuestions` = per-mode default, **then** for a canonical
single-concept PRACTICE/SOLO_CHECK/RETENTION/... flow overridden by
**LX-4R R8** to `resolveQuestionCount(deriveEvidenceRequirement(...))`
= `clamp( max(1, minimumEvidenceCount − haveEvidence), [1,20] )`.
For NOT_STARTED PRACTICE: `max(1, 3 − 0) = 3`.

Then `questionArrays = await Promise.all([ <one of> , computeAskConfidenceFlags ])`:

| quizMode | requested count (canonical) | path taken | chunks | conc. | model | prompt | timeout | retry | fallback |
|---|---|---|---|---|---|---|---|---|---|
| `quick_check` | 6 (fixed) | `generateQuickCheckQuestions` | 6 slots × 1 q | **6 parallel** | **`claude-haiku-4-5-20251001`** | `quiz.question_generation` v3 | 30 s | none (all-or-nothing per slot) | empty ⇒ `[]` ⇒ 500 |
| `topic_practice` / `review` | **3** (evidence gap) | `generatePracticeQuestions` → `planChunks(3)=[3]` ⇒ **delegates to `generateQuestionsForConcept`** | 1 (no chunking) | 1 (serial) | **`claude-sonnet-5`** | `quiz.question_generation` v3 | 30 s | none; JSON-salvage on truncation | empty ⇒ `[]` ⇒ 500 |
| `topic_practice` (manual `?setup=1`, 20) | 20 | `generatePracticeQuestions` → `planChunks(20)=[4,4,4,4,4]` | **5 × 4** | **5 parallel** | **`claude-haiku-4-5-20251001`** | v3 | 30 s | none; failed chunk contributes 0, others still used | all-empty ⇒ `[]` |
| `retention_check` (count 6) | 6 | `generateRetentionCheckQuestions` | 2 × 3 | **2 parallel** | `claude-haiku-4-5-20251001` | v3 | 30 s | regen the failed chunk (bounded) | both fail ⇒ `[]` |
| `retention_check` (count ≠ 6) | n | `generateQuestionsForConcept` | 1 | 1 | `claude-sonnet-5` | v3 | 30 s | JSON-salvage | `[]` ⇒ 500 |
| `cumulative_assessment` / `exam_simulation` | up to 20, N concepts | `Promise.all(conceptIds.map(generateQuestionsForConcept))` | 1 per concept | **N parallel** (one per concept) | `claude-sonnet-5` | v3 | 30 s | per-concept salvage | `[]` ⇒ 500 |
| `diagnostic_check` | 2–4 | `generateQuestionsForConcept` | 1 | 1 | `claude-sonnet-5` | v3 | 30 s | salvage | `[]` ⇒ 500 |

**`topic_practice` (canonical): one blocking `claude-sonnet-5` call for
~3 questions. The Haiku 5×4 parallel chunk path is NOT exercised** —
`planChunks(3)` returns a single element and
`generatePracticeQuestions` delegates straight to the legacy single-call
`generateQuestionsForConcept`, which is Sonnet-5.

---

## 3. CURRENT CHUNKING CONFIGURATION

- `MAX_QUESTIONS_PER_CHUNK = 4`.
- `planChunks(n, 4)`: `n ≤ 4` ⇒ `[n]` (sentinel meaning "**do not chunk,
  use the legacy single call**"); `n > 4` ⇒ balanced chunks of ≤4,
  larger first (`[4,4,4,4,4]` for 20).
- Chunk model: `PRACTICE_CHUNK_MODEL = claude-haiku-4-5-20251001`.
- Dispatch: `await Promise.all(plan.map(requestChunk))` — fully parallel.
- Merge: flatten → deterministic AI-free cross-chunk de-dup → slice to
  `maxQuestions`.
- **Effective for the canonical PRACTICE flow: 1 chunk, i.e. no
  chunking, i.e. Sonnet-5.**

---

## 4. CURRENT MODEL + PROMPT

| Call site (critical path) | model | prompt id / version | maxTokens |
|---|---|---|---|
| `generateQuestionsForConcept` (canonical PRACTICE, count ≤ 4) | `claude-sonnet-5` | `quiz.question_generation` **v3** | `min(16000, 900·count + 1500)` ≈ 4200 for 3 |
| `generatePracticeQuestions` chunk (count > 4) | `claude-haiku-4-5-20251001` | `quiz.question_generation` **v3** | `900·chunkSize + 1500` ≈ 5100 for 4 |
| `generateQuickCheckQuestions` slot | `claude-haiku-4-5-20251001` | `quiz.question_generation` **v3** | 2400 |
| `/api/concepts/:id/explanation` | `claude-sonnet-5` | (concept-explanation.service) | — |
| `/api/learning/guided-practice` | `claude-sonnet-5` | `learning.guided_practice` v1 (teaching-content.service) | — |
| `/api/learning/teaching-intent` | — (no AI; DB orchestrator) | — | — |

`quiz.question_generation` is still **v3** (STABILIZATION Step 18). The
prompt version was not regressed.

---

## 5. BLOCKING POINT — what makes the learner wait

**Teach-first concept (regressed case):** the spinner from `setPhase('loading')`
to MODEL render spans **D + E + F** =
`Sonnet(question batch)` → `getLearningDecisions` (DB, 3rd run) →
`Sonnet(explanation)` ‖ `Sonnet(guided-practice)`. Three serial Sonnet
round-trips (the third pair parallel with each other), each up to 30 s,
plus three full Phase-4 orchestrator runs across the journey (A, B, E).
The question batch (D) is dead weight on this path — it is not seen until
after GUIDE.

**Non-teach-first concept:** blocking point is the single
`generateQuestionsForConcept` `claude-sonnet-5` call in D (≈3 questions).

There is **no streaming and no first-chunk render** — `generate-and-take`
returns the entire batch in one response and the client does
`setQuestions(genBody.data.quiz.questions)` (all at once). T5 ≈ T4.

---

## 6. TEACHING vs QUESTION GENERATION — parallel or serial

**Serial**, in this order:

```
generate-and-take (full question batch, Sonnet)      [D]  ← blocks everything
        ↓  (client only has quizId now)
GET /api/learning/teaching-intent                     [E]
        ↓  (client only knows the stages now)
TeachingIntro mounts →
   Promise.all([ /concepts/:id/explanation (Sonnet),  [F]  ← these two parallel
                 /learning/guided-practice (Sonnet) ])       with EACH OTHER only
        ↓
MODEL renders
```

Unnecessary serial dependencies:
1. **Question generation before teaching.** Nothing pedagogical needs the
   Practice questions to exist before MODEL/GUIDE. `generate-and-take`
   could run concurrently with (or after) the teaching content.
2. **teaching-intent after generate-and-take.** It is fired only once
   `quizId` exists, purely because the route keys off
   `quiz_sessions.evidenceMode`. The `TeachingIntent` itself
   (`getBestLearningDecisionForConcept`) does not need a quiz session —
   it needs `studentId` + `conceptId`, both known at step C.
3. **Three `getLearningDecisions` runs** (Concept Mission, `/continue`,
   `/teaching-intent`), each re-deriving the whole Phase-4 signal set
   across every active subject, uncached.
4. **explanation content is fetched only after teaching-intent** even
   though a first-touch concept almost always needs EXPLAIN/MODEL — it
   could be prefetched in parallel with generate-and-take.
5. `retrieveContext(conceptId)` runs 3× (questions, explanation,
   guided-practice) — cheap DB fast-path each, but uncached and
   repeated.

---

## 7. HISTORICAL OPTIMIZATION STATUS — ACTIVE / BYPASSED / PARTIAL / REMOVED

| Optimization | Status | Evidence |
|---|---|---|
| Quick Check 6× Haiku parallel fast path | **ACTIVE** | `generateQuickCheckQuestions`, `QUICK_CHECK_MODEL = claude-haiku-4-5-20251001`, `Promise.all` of 6 slots — unchanged |
| `quiz.question_generation` **v3** | **ACTIVE** | `getPrompt('quiz.question_generation').version === 'v3'` at every call site |
| topic_practice 5×4 parallel Haiku chunking | **BYPASSED for the canonical flow** (still present & used for manual `?setup=1` / count > 4) | LX-4R R8 sets canonical PRACTICE `maxQuestions ≈ 3`; `planChunks(3) = [3]` ⇒ `generatePracticeQuestions` delegates to the legacy single `generateQuestionsForConcept` call, which uses **`claude-sonnet-5`**, not the Haiku chunk path. The chunk path is now dead code for canonical PRACTICE. |
| retention_check 2×3 parallel Haiku | **ACTIVE** (count === 6 only) | `generateRetentionCheckQuestions`, `RETENTION_CHUNK_MODEL = claude-haiku…` |
| "≤7 s time to first usable interaction" | **NOT MET for teach-first** | §1/§5 — 3 serial Sonnet round-trips before MODEL |

Net: the *chunking machinery* was not removed, but LX-4R's evidence-gap
count reduction (20 → ~3) **routes the canonical PRACTICE flow around it**
onto a single Sonnet call, and LX-4R **added** two more serial Sonnet
calls (explanation, guided-practice) plus a DB-orchestrator round-trip in
front of the teaching UI.

---

## 8. LANGUAGE HOTFIX IMPACT — YES / NO + proof

**NO.** LX-4P-R2 / R2R1 add **zero** AI calls to initial quiz generation.

Call-graph proof:
- `localizeGeneratedQuestion` / `verifyLocalizationEquivalence` live only
  in `src/services/question-localization.service.ts`.
- Their only caller is `src/app/api/quizzes/localize-question/route.ts`.
- `generate-and-take/route.ts` does **not** import
  `question-localization.service` (its 3 "localization" string hits are 2
  comments + one unrelated `concept_localizations` label `SELECT`).
- `/api/quizzes/localize-question` is fetched only from
  `quiz/page.tsx` in `localizeQuestionAt`, called by
  `attemptSameItemLocalization` (reached **only** from `changeQuizLanguage`,
  i.e. the question-language `<select>` `onChange`) and by the lazy
  `useEffect`, whose body returns immediately while
  `quizLanguage === sessionOriginalLanguage` — which is always true right
  after generation (both are set from `genBody.data.language`).

So the translate + semantic-verify pair runs **only on an explicit
question-language switch mid-attempt**, never during initial generation
or teaching.

---

## 9. EXPECTED CURRENT LATENCY (from the implementation, order-of-magnitude)

Per-call estimates: `claude-sonnet-5` structured generation ≈ 5–12 s
(30 s cap); `claude-haiku-4-5` ≈ 3–6 s; DB fast-path `retrieveContext` /
`storeQuiz` ≈ 50–300 ms; `getLearningDecisions` (all subjects) ≈
0.3–2 s.

| Marker | Non-teach-first | Teach-first (regressed) |
|---|---|---|
| T0 → T4 (full question batch) | ~1 Sonnet + DB ≈ **6–13 s** | same ≈ 6–13 s |
| T1 (teaching-intent ready) | +DB orchestrator ≈ +0.5–2 s (no stages) | +0.5–2 s |
| T2 (Teaching UI first render / MODEL) | n/a | + `max(Sonnet explanation, Sonnet guided)` ≈ **+6–12 s** → **≈ 13–27 s total** |
| T5 (first Practice question visible) | ≈ **6–13 s** (borderline / over the 7 s target) | after MODEL+GUIDE reading — **not** latency-bound, but only reachable ≈ 13–27 s + reading time in |

Quick Check remains near its ≈4.76 s reference (unchanged Haiku path).
The canonical **Practice** and especially **teach-first Practice** paths
are the regression: 1 → 3 serial Sonnet round-trips, and the historical
20-question Haiku-parallel path no longer applies.

---

## 10. RECOMMENDED REPAIR (NOT IMPLEMENTED)

Ordered by impact / smallest-safe-first. All preserve TeachingIntent
authority, canonical question count, Response Contract, evidence
integrity, LX-5 continuation.

1. **Decouple question generation from the teaching UI.** When
   `teaching-intent` prescribes EXPLAIN/MODEL/GUIDE, render the teaching
   stage as soon as its own content is ready; kick off
   `generate-and-take` **in parallel** (or lazily, on GUIDE-complete) so
   PRACTICE is ready by the time the learner finishes teaching. The
   learner should never wait on the Practice batch to see MODEL.
2. **Fetch `teaching-intent` from `studentId + conceptId`, not
   `quizId`.** It already resolves via
   `getBestLearningDecisionForConcept(studentId, conceptId)`; the quiz
   session is only used for `evidenceMode`, which is derivable from the
   ActivityType. This removes the D→E serial hop and lets teaching-intent
   + explanation start at step C, concurrent with (or before)
   generate-and-take.
3. **Reinstate a fast question-generation path for small canonical
   counts.** `planChunks` treats `count ≤ 4` as "single legacy call" —
   which is Sonnet. Either (a) route small canonical PRACTICE counts
   through a Haiku single-call fast path (same `v3` prompt, Haiku model),
   or (b) lower `MAX_QUESTIONS_PER_CHUNK` / special-case so 3 questions
   still get the Haiku path. Benchmark Haiku-vs-Sonnet quality at N=3
   before switching.
4. **Cache / share the Phase-4 decision within one learner journey.**
   `getLearningDecisions(studentId)` runs 3× (Concept Mission,
   `/continue`, `/teaching-intent`) with no reuse. A short request- or
   session-scoped memo would cut two full orchestrator passes.
5. **Prefetch EXPLAIN/MODEL content at Concept Mission or on Continue**
   for a NOT_STARTED / low-mastery concept, so it is warm when
   `/dashboard/quiz` mounts.
6. **Add T0–T5 + per-phase timing** (see §11) so any future regression is
   measurable rather than "feels slower".

---

## 11. OBSERVABILITY (reported, not changed)

Available:
- `executeAI` emits one `console.log('[ai]', {promptId, promptVersion,
  durationMs, success, fallbackUsed, errorCode, model, provider})` per
  provider round-trip, and persists the same to the `ai_execution_events`
  audit sink (`context.sourceComponent` identifies the call site).
  ⇒ **per-AI-call provider latency IS visible**, attributable to a prompt
  id and a source component.

Gaps (no instrumentation today):
- No **full-endpoint** latency for `/api/quizzes/generate-and-take`,
  `/api/learning/teaching-intent`, `/api/concepts/:id/explanation`,
  `/api/learning/guided-practice` (only Vercel access logs, not in-app,
  not broken down).
- No **per-chunk** timing beyond correlating individual `[ai]` lines by
  timestamp.
- No **validation** latency separate from provider `durationMs`.
- No **DB / `storeQuiz` / `retrieveContext` / `getLearningDecisions`**
  timing.
- No **time-to-first-chunk** (the `Promise.all` is all-or-nothing).
- No **client-side** marks — nothing records T0 (request start), T1
  (teaching-intent ready), T2 (teaching first paint), T3 (first chunk),
  T4 (batch ready), T5 (first question visible). "Time to first usable
  learning interaction" is currently unmeasurable end-to-end.
- No `Server-Timing` response header.

---

# CERTIFICATION

## PERFORMANCE REGRESSION IDENTIFIED: **YES**

**Root regression:** LX-4R (`3b56ca6`) put the teach-first learning loop
**in series in front of the learner** and did not parallelise it with
question generation:

1. `generate-and-take` generates the **full Practice question batch**
   (now a single `claude-sonnet-5` call) **before** anything teaching-related,
   and the client blocks on it — even though for a teach-first concept
   those questions are not shown until after MODEL + GUIDE.
2. `GET /api/learning/teaching-intent` (new in LX-4R) runs **after**
   generate-and-take (keyed off `quizId`), re-running the Phase-4
   orchestrator a third time in the journey.
3. `<TeachingIntro>` then makes **two more serial `claude-sonnet-5`
   calls** (`/concepts/:id/explanation`, `/learning/guided-practice`) —
   new in LX-4R — before MODEL renders.

Net for a first-touch teach-first concept: **1 → 3 serial Sonnet
round-trips** to the first learning interaction, plus 3× the Phase-4
orchestrator across Concept Mission / `/continue` / `/teaching-intent`.

**Contributing regression:** LX-4R R8 reduced the canonical PRACTICE
question count from `defaultMax 20` to the evidence gap (~3). That is
pedagogically correct, but it routes the canonical flow **around** the
historical 5×4 parallel **Haiku** chunk path (`planChunks(3) = [3]` ⇒
single legacy call) and onto **`claude-sonnet-5`**. The chunking
optimization is intact but no longer on the canonical path; the model on
the canonical question path went Haiku → Sonnet.

**Not a factor:** LX-4P-R2 / R2R1 language localization + semantic
verification — proven by call graph to run only on an explicit
mid-attempt question-language switch, never during initial generation
(§8).

**Cannot be quantified from telemetry:** per-AI-call latency is logged,
but full-endpoint, per-phase, DB, and client T0–T5 timings are not — the
7-second "time to first usable interaction" KPI is currently
unmeasurable end-to-end (§11).

No code was modified. Recommended repair in §10 — not implemented.
Do NOT start LX-6.

STOP.
