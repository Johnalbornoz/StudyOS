# STUDYUS — LX-4P-PERF LIVE REPAIR
## PERF-R1D — REMOVE INTERACTIVE FORMULA FROM MODEL CRITICAL PATH

Branch: `tmp/lx1`
Repair commit: `ad7a029`
Builds on: `49f4ebe` / `f5f5807` (R1C-R1).

LX-6 not started. Not deployed. Nothing pushed to `origin/main`.
The question-generation `INVALID_RESPONSE` live blocker was **not** touched
here (separate, next).

---

# R1 — CURRENT EXPLANATION PATH (why it was serial)

`GET /api/concepts/[id]/explanation` → `route.ts` → `getConceptExplanation`
(`concept-explanation.service.ts`), one `await` chain:

1. `query` — concept row (subject_id / student_id / label).
2. `query` — `concept_explanations` cache lookup.
3. `retrieveContext` — RAG chunks (bounded).
4. `executeAI` — **`concept.explanation`** (`gpt-5.6-luna`, ~6.8 s live).
5. parse `hasFormula` / `formulaHint` from the raw response.
6. **`if (hasFormula) { await generateInteractiveFormula(...) }`** —
   `executeAI` **`formula.interactive_widget`** (`gpt-5.6`, ~3.2 s live).
   This `await` sat *between* the ready explanation and the endpoint
   response.
7. `query` — `INSERT` the explanation (with the formula merged in).
8. `return explanation`.

So the endpoint response = step 4 **+** step 6 **+** step 7. The live
`10.11 s` = `6772 ms` (step 4) `+ 3203 ms` (step 6) `+` overhead.

**Two independent defects:**
- The optional formula call was on the endpoint's response path.
- `TeachingIntro` (the MODEL surface) **never renders the interactive
  formula widget at all** — only `ConceptExplanationPanel`
  (subject-detail Learn) does. So the 3.2 s was spent producing content
  the learner going Practicar → MODEL never saw.

---

# R2 — MODEL-REQUIRED vs ENRICHMENT

| MODEL-required (gates MODEL availability) | Optional enrichment (never gates) |
|---|---|
| `concept.explanation` — summary, sections, worked-example `examples` | `formula.interactive_widget` — slider-driven formula widget |
| — | (future) enhanced visualisation / supplemental interaction |

Enrichment may enhance MODEL *after* first render. It must not gate it.

---

# R3 — FORMULA WIDGET REMOVED FROM THE SERVER CRITICAL PATH

`getConceptExplanation` (`concept-explanation.service.ts`):
- **deleted** the `if (hasFormula) { await generateInteractiveFormula(...) }`
  block.
- returns + `INSERT`s the explanation immediately after step 4, storing
  `hasFormula` + `formulaHint` in the persisted JSON so the deferred
  request never re-runs `concept.explanation` to decide eligibility.

New `getInteractiveFormula(studentId, conceptId, language)` +
`GET /api/concepts/[id]/interactive-formula`:
- **A real, independent GET request**, not an unawaited server promise
  (nothing in the explanation service is fire-and-forget; the serverless
  runtime can never kill a half-done widget generation).
- Eligibility (R6): loads the persisted explanation; returns `null`
  **with no AI call** when there is no explanation yet, or
  `hasFormula !== true`.
- Cache: a generated widget is merged back into the persisted
  explanation JSON (`UPDATE concept_explanations`), so it is generated
  **at most once** per concept+language; subsequent calls are a cache
  read.
- The route degrades to `{ interactiveFormula: null }` on any unexpected
  error — never a 500 a client could treat as blocking.

---

# R4 — CLIENT PROGRESSIVE ENHANCEMENT

New hook `src/lib/hooks/useInteractiveFormula.ts`:
- fires **only** once `enabled` is true (`TeachingIntro`:
  `wantsFormula && !!explanation` — i.e. after MODEL content is ready);
- fetches at most once per concept+language — an `attemptedRef` key
  guard makes effect re-runs / React StrictMode double-invokes
  idempotent (**test 5**);
- degrades silently to `null` on any failure.

`TeachingIntro`:
1. renders MODEL as soon as `explanation` resolves — the whole-component
   loading gate still `if (expLoading)` only, never the widget;
2. calls `useInteractiveFormula(...)` independently;
3. inserts `<InteractiveFormulaWidget>` **inside the MODEL stage block**,
   guarded by `{interactiveFormula && ...}` — a plain conditional, no
   spinner, no error branch. MODEL is fully usable whether the widget is
   pending, failed, or arrives late.

`ConceptExplanationPanel` (subject-detail Learn surfaces —
`ConceptList`, `ConceptExplanationDisclosure`, `AddConceptTab`) uses the
same hook via new optional `conceptId` / `studentId` props, so those
surfaces keep the widget as progressive enhancement too.

---

# R5 — MODEL ROUTING

Before: `interactive-formula.service.ts` hard-coded
`provider: 'openai', model: 'gpt-5.6'` and called `callOpenAIChat`
directly.

After: `const route = resolveModels(prompt.capability)` — the
`formula.interactive_widget` prompt is already `CONTENT_GENERATION`, which
the central registry routes to **`gpt-5.6-luna`** (fallback Terra). The
call goes through `callModel({ provider: route.provider, model:
route.primary, ... })`. No generic `gpt-5.6` literal remains in this
learner-runtime path (**test 7**).

No Terra escalation is wired: an optional widget that fails to generate
just returns `null` (the existing `fallback: () => null` covers provider
errors). Documented — Terra is not justified for optional enrichment.

---

# R6 — COST

- **Model:** Luna (via the registry).
- **Bounded output budget:** new `interactive_formula` key —
  `maxOutputTokens: 1500`, `maxContextChars: 3000`, `reasoningEffort:
  'low'`. Applied in `generateInteractiveFormula` and to the RAG context
  in `getInteractiveFormula`.
- **Generated once:** cached back into the persisted explanation JSON; a
  second request is a DB read.
- **Not invoked when it can't help:** `getInteractiveFormula` returns
  `null` with **no AI call** unless the persisted explanation's
  `hasFormula` flag is `true` — plain conceptual content (history,
  language, qualitative topics) never reaches the widget model.

**Eligibility condition:** `getInteractiveFormula` performs an AI call
only when *all* hold — (a) a persisted `concept_explanations` row exists
for this concept+language, (b) its parsed `hasFormula === true` (set by
`concept.explanation` when the concept centres on one clean numeric
formula), and (c) no `interactiveFormula` is already cached in that row.

---

# R7 — TTFI OBSERVABILITY

Existing `T0..T6` `[perf]` journey marks in the quiz page: **untouched**.

Added:

| mark | where | layer |
|---|---|---|
| `EXPLANATION_READY` | `TeachingIntro` explanation `.then` | MODEL TTFI |
| `MODEL_RENDERED` | `TeachingIntro` effect, once MODEL stage is visible | MODEL TTFI |
| `FORMULA_WIDGET_REQUEST_STARTED` | `useInteractiveFormula`, before `fetch` | enrichment (excluded) |
| `FORMULA_WIDGET_READY` | `useInteractiveFormula`, in `.then` | enrichment (excluded) |

The formula-widget request is a separate `fetch` in a separate hook fired
after `explanation` is set — its timing is structurally outside the
`EXPLANATION_READY → MODEL_RENDERED` interval.

---

# REQUIRED TESTS

`npx tsc --noEmit` clean · `npx vitest run` **190 files / 2793 tests
pass** · `npm run build` compiles (`/api/concepts/[id]/interactive-formula`
registered).

New: `tests/unit/lx4p-perf-r1d-model-ttfi.test.ts` (source-contract +
routing/budget) and `tests/unit/lx4p-perf-r1d-formula-eligibility.test.ts`
(behavioural eligibility/cache).

| # | Requirement | Covered by |
|---|---|---|
| 1 | explanation ready → MODEL renders even if widget pending | `r1d-model-ttfi` — "loading gate blocks ONLY on the explanation"; widget is a plain `{interactiveFormula && ...}` conditional |
| 2 | widget takes 20 s → MODEL still renders immediately | same — `expLoading` gate is independent of the widget; hook fires *after* `explanation` |
| 3 | widget fails → MODEL still usable | `r1d-model-ttfi` — "no loading/error branch keyed on the widget"; hook `.catch(() => null)`; route degrades to `interactiveFormula: null` |
| 4 | widget succeeds later → inserted without resetting MODEL | `r1d-model-ttfi` — widget lives INSIDE the MODEL stage block; `interactiveFormula` is separate state, MODEL render is not remounted |
| 5 | no duplicate widget generation from React effects | `r1d-model-ttfi` — `attemptedRef` key guard in the hook |
| 6 | formula widget uses centralized OpenAI routing | `r1d-model-ttfi` — `resolveModels(prompt.capability)` + `callModel`; `resolveModels('CONTENT_GENERATION').primary === 'gpt-5.6-luna'` |
| 7 | no generic `gpt-5.6` literal in this learner-runtime path | `r1d-model-ttfi` — `FORMULA_SVC` has no `gpt-5.6` literal, no `callOpenAIChat` |
| 8 | activity language preserved | `r1d-model-ttfi` — `language=${locale}` on the explanation fetch; `language=${language}` in the hook fetch; `useInteractiveFormula(conceptId, studentId, locale, …)` |
| 9 | MODEL / GUIDE ordering preserved | `r1d-model-ttfi` — `stages`/`plan`/`guidePending` logic unchanged; `lx4p-perf-r1-parallel-runtime` + `lx4r-teaching-loop` still green |
| 10 | question-generation background architecture untouched | `r1d-model-ttfi` — "wave B -- question generation, in the background" + `generate-and-take` still present; `lx4p-perf-r1-parallel-runtime` green |
| 11 | evidence / mastery untouched | `r1d-model-ttfi` — `getInteractiveFormula` touches no `learning_evidence` / `knowledge_state` / `mastery` / `EvidenceMode`; only reads `concepts`/`subjects` + `concept_explanations`; eligibility suite |

---

# CERTIFICATION

## PERF-R1D — MODEL TTFI REPAIR

**STATUS: PASS**

### BEFORE
- concept explanation AI: **6772 ms**
- formula widget AI: **3203 ms** (serial, on the endpoint response path,
  not rendered on MODEL)
- explanation endpoint: **10110 ms**
- learner observed Practicar → MODEL: **~14 s**

### AFTER ARCHITECTURE

**MODEL blocking AI calls:**
- `concept.explanation` (`gpt-5.6-luna`, `concept_explanation` budget) —
  the only AI call between Practicar and a renderable MODEL.

**OPTIONAL background AI (never on MODEL TTFI):**
- `formula.interactive_widget` — via `GET
  /api/concepts/[id]/interactive-formula`, fired by
  `useInteractiveFormula` only after `EXPLANATION_READY`, cached after
  first generation, skipped entirely for `hasFormula !== true` concepts.

**FORMULA MODEL:** `resolveModels('CONTENT_GENERATION').primary` =
`gpt-5.6-luna` (fallback `gpt-5.6-terra`, not wired — optional
enrichment). No `gpt-5.6` literal in the service.

**FORMULA TOKEN BUDGET:** `interactive_formula` =
`{ maxOutputTokens: 1500, maxContextChars: 3000, reasoningEffort: 'low' }`.

**TTFI REGRESSION TESTS:** 11/11 covered (table above); `tsc` clean,
2793 tests pass, build compiles.

**LANGUAGE INTEGRITY:** activity/question `locale` flows to the
explanation fetch, the widget fetch, and `getInteractiveFormula`'s
concept-label + context lookups. R20 rule intact.

**EVIDENCE INTEGRITY:** no change to Knowledge State / LearningState /
LearningDecision / TeachingIntent authority / EvidenceMode / mastery
thresholds / `learning_evidence`. `getInteractiveFormula` is read-only
except for the `concept_explanations` cache merge.

**COMMIT:** `ad7a029` on `tmp/lx1` (after `49f4ebe`).

---

Live TTFI improvement is **not claimed** — it must be re-deployed to
Preview and measured. Expected AFTER: MODEL renders after
`concept.explanation` alone (~6–7 s in the current live run), with the
formula widget arriving asynchronously ~3 s later without blocking.

Do NOT start LX-6. Not deployed. Nothing pushed to `origin/main`.

STOP.
