# LX-10R1 — QUESTION GENERATION CRITICAL-PATH PERFORMANCE

## BASELINE LIVE WATERFALL

Preview deployment, branch `preview/openai-perf`, commit `291367b`. Activity: REVIEW, `requiredQuestionCount=1`, `difficulty=4`.

```
POST /api/quizzes/generate-and-take -> 200, route execution 29.59s, generation operation 29.322s

1. Luna QUESTION_GENERATION      8.821s   in=6473  cached=0  out=619   $0.0020374
2. Terra QUESTION_QUALITY_VERIFY 6.250s   in=931   cached=0  out=359   $0.00617   -> SEMANTIC_FAIL (REASONING_MISMATCH, WEAK_DISTRACTORS)
3. Terra recovery GENERATION    10.042s   in=6473  cached=0  out=705   $0.021406
4. Terra recovery VERIFY         3.932s   in=1248  cached=0  out=232   $0.00528

accepted=1, published=1, total cost=$0.0348934
```

Even a hypothetical clean first pass (steps 1+2 only) would have taken **~15.07s** — well above the 5s/7s target before recovery is even considered. This confirmed recovery is not the only problem; the first-pass generation + verification path itself was too slow and too input-token-heavy.

## ROOT CAUSE

Traced to `generateQuestionsForConcept` (`src/services/quiz-generation.service.ts`) — the exact function `generateGatedQuestionBatch` calls for this REVIEW/`count=1` request. Two structural defects, both provable by local reproduction (no live provider call needed):

1. **The default type catalog is all 18 question types, regardless of how many questions are actually requested.** `types: options.types && options.types.length > 0 ? options.types : ALL_QUESTION_TYPES` — and this call site never passes `types` (confirmed: it is the *only* caller of `generateQuestionsForConcept` that doesn't; Diagnostic/Cumulative/Mock exam explicitly pass `ALL_QUESTION_TYPES` themselves, by design, for genuine per-exam variety). For `count=1`, the user message still built one full worked JSON shape example **per type** — 18 examples for a single question.
2. **9 of those 18 examples are byte-identical** (`short_answer`/`open_ended`/`fill_blank`/`case_study`/`scenario`/`error_detection`/`justification`/`comparison`/`prediction` all produce the exact same fields — only the `"type"` string differs), and `multiple_choice`/`true_false`/`yes_no`/`multi_select` share a second identical shape. Measured locally: those 18 examples alone contributed **~8025 chars (~2007 estimated tokens)** to the user message.
3. **Dynamic, per-request content (the retrieved concept material) was positioned near the top of the system prompt**, ahead of the large, request-shape-identical block (type definitions, formatting requirements, difficulty policy) — defeating any possibility of OpenAI's own prefix-based caching ever reusing that block, consistent with the observed `cachedInputTokens=0`.
4. **This call site sent no `reasoning_effort` hint at all** — relying on an undocumented provider default — even though `question_generation_practice`'s budget already declared `'low'` for exactly this purpose; it was simply never wired to this call site.

Not the cause (explicitly not investigated, per the spec): billing, JSON schema validity, structured-output mechanics, question count, or the Question Quality Gate's own criteria.

## PROMPT TOKEN BREAKDOWN

Measured locally by faithfully reproducing the real prompt-building functions with representative inputs matching the live shape (REVIEW, 18 types, difficulty 4, one ~1000-char retrieved chunk) — see `scripts/lx10-measure-prompt-size.ts` (throwaway, not imported by app code, reproducible via `npx tsx scripts/lx10-measure-prompt-size.ts`). Token counts are a **chars/4 estimate**, not the real tokenizer; the live trace's own `inputTokens=6473` is the authoritative number, quoted for reference only, never re-derived.

| Section | Chars (before) | Est. tokens | % of total | Stable or dynamic |
|---|---|---|---|---|
| 1. Stable role/pedagogical contract ("You are an expert educator...") | ~65 | ~16 | <1% | Stable |
| 2. Structured Output / schema-related prompt text (MATH NOTATION/JSON-escaping rule) | ~1050 | ~263 | ~5% | Stable |
| 3. Question-type taxonomy (18 `typeInstruction` entries) | 3007 | 752 | ~15% | Stable (for a fixed type set) |
| 4. Difficulty instructions (`describeDifficultyTier` text) | ~260 | ~65 | ~1% | Stable (for a fixed difficulty) |
| 5. Activity/evidence contract (QUIZ PURPOSE / guidance) | ~180 | ~45 | <1% | Stable (per quizMode, fixed text) |
| 6. Academic profile (IB alignment, when present) | 0 (absent for this activity) | 0 | 0% | Dynamic, conditional |
| 7. Concept/context chunks | ~1016 | ~254 | ~5% | **Dynamic** |
| 8. Language instructions | ~150 | ~38 | <1% | Stable (per language) |
| 9. Learner-specific/dynamic content (concept label framing) | included in §7 | — | — | **Dynamic** |
| 10. Duplicated/redundant instructions (found and removed) | ~230 (2 restatements of grounding + 1 of language) | ~58 | ~1% | Removed |
| **Shape examples (user message, 18 separate worked JSON examples)** | **8025** | **2007** | **~35% of the combined system+user total** | Stable (for a fixed type set) — but NEVER needed per-type in full |
| Schema (`GENERATED_QUESTION_BATCH_SCHEMA`, sent once per request, unchanged) | 2813 | 704 | ~14% | Stable, fixed by the schema itself |

The single largest lever was **not** the prose in the system prompt — it was the **user message's 18 duplicated shape examples**, ~35% of the combined system+user total, for a request that only ever produces one question of one type.

## CACHEABILITY ANALYSIS

**Before:** dynamic content (`CONTEXT`/`CONCEPT` block) appeared directly after the top-level role/language instruction, before the large `QUESTION TYPES AVAILABLE`/`REQUIREMENTS` block. OpenAI's automatic prompt caching matches the longest common **prefix** — once the dynamic block diverges (which it does on every single request, by definition), everything textually after it can never be cached either, even though it is byte-identical across many requests. This is a full, sufficient explanation for the observed `cachedInputTokens=0`.

**After:** `buildQuestionGenerationPrompt` now returns `${stablePrefix}\n\n${contextBlock}${ibInstruction}` — the entire stable block (role, language instruction, type definitions, QUIZ PURPOSE, REQUIREMENTS 1-6 including the difficulty policy for this request's difficulty) is now the **prefix**, and the dynamic content (retrieved material / general-knowledge framing, IB alignment) is appended **after** it. For any two requests sharing the same (types, difficulty, language, guidance, visualAidRate>0-shape), the stable prefix is now byte-identical, and it comes first.

**`promptCacheKey` design** (`questionGenerationCacheKey`, `quiz-generation.service.ts`):

```
qgen:{promptId}:{promptVersion}:t={sorted type list}:d={difficulty}:l={language}:v={0|1}
```

- Built from: `promptId`, `promptVersion`, the sorted type set, `difficulty`, `language`, and whether visual aids are enabled — **never** `studentId`, a learner's name, concept text, retrieved context, or an answer.
- Deliberately **omits** a separate "activity family"/"generation contract version" dimension: `guidance` text is already a fixed, `quizMode`-keyed constant (topic_practice and review, for example, share the exact same guidance string), so it never varies within a given `promptId`/`promptVersion`/type-set/difficulty/language combination; there is no separately-versioned "generation contract" in this codebase beyond `promptVersion`. Adding either dimension would only fragment the cache without changing what gets cached.
- Wired into all 4 QUESTION_GENERATION call sites: `generateQuestionsForConcept` (the live-trace path), `generateQuickCheckQuestions`'s slot request (keyed on the shared `QUICK_CHECK_TYPES`, never the per-slot single type), `generatePracticeQuestions`'s chunk request, and `generateRetentionCheckQuestions`'s chunk request.
- `cachedInputTokens` continues to be logged exactly as before (via `ProviderUsage`/`AIRuntimeEvent`); `buildRuntimeEvent` (the single-call event path) now also computes `cacheHitRatio` (previously only the multi-call aggregate path did), so a canonical single generation attempt can report cache effectiveness for the first time.

No live provider access exists in this environment, so **the actual cache-hit-rate improvement is unverified — LIVE_PENDING**. This report claims only what can be proven locally: the mechanism (prefix stability + an explicit routing hint) is now correctly in place, using a request parameter (`prompt_cache_key`) the current Chat Completions request path already supports (see PART F below) — not a hoped-for live result.

## PROMPT CHANGES

### BEFORE / AFTER — duplicated grounding instruction

**BEFORE** (three restatements of "stay grounded / don't invent facts"):
```
CONTEXT (student's actual materials):
{chunks}
...
REQUIREMENTS:
...
2. Use ONLY the provided context above -- do not invent facts outside it
...
IMPORTANT: Do not invent content. Every question must be answerable from the provided material.
```

**AFTER** (one restatement, folded into the block it governs):
```
CONTEXT (student's actual materials -- use ONLY this material, never invent facts outside it):
{chunks}
```
*Why equivalent:* the instruction content is unchanged — "use only the provided material, never invent facts outside it" — stated once, directly next to the material it governs, instead of stated again as a numbered requirement and a third time as a trailing reminder. The general-knowledge branch received the identical treatment (merging "use accurate general knowledge, don't fabricate" into the `CONCEPT (...)` block's own framing).

### BEFORE / AFTER — duplicated language instruction

**BEFORE:** `LANGUAGE: Write EVERYTHING in ${languageName}...` (top of prompt) **and** `REQUIREMENTS item 3: Every field in your JSON output must be written in ${languageName}`.
**AFTER:** only the top-level `LANGUAGE:` instruction remains; item 3 was removed.
*Why equivalent:* both instructions said the same thing ("everything must be in this language"); removing the second does not reduce what the model is told.

### BEFORE / AFTER — shape examples (PART D/G)

**BEFORE:** `types.map((t) => jsonShapeExample(t, withVisual)).join(',\n')` — one full worked JSON example per type, always, regardless of how many types would ever realistically differ in shape.

**AFTER:** `buildShapeExamplesBlock(types, withVisual)` groups by the **actual computed shape** (not a hand-maintained type list, so it can never silently drift if a shape changes) and emits one example per distinct shape, annotated with every type name that shares it:
```js
// shape for "type" in {short_answer, open_ended, fill_blank, case_study, scenario, error_detection, justification, comparison, prediction} -- identical fields, only "type" differs:
{ "type": "short_answer", "question": "...", ... }
```
*Why equivalent:* every type name is still present in the message (the model still knows all 18 are eligible, and `typeInstruction()`'s own per-type prose — unchanged — still carries every type's cardinality/semantic rules); only the **repeated, byte-identical JSON structure** was removed. Required test 13 asserts the literal `"type":` field count in the message dropped from 18 to well under 10 and that every grouped type name is still present.

### REQUIREMENTS block renumbering

8 items → 6 items (2 removed as pure duplication, as above); item 6 (the cognitive/intent/reasoning taxonomy) gained the two PART H additions described below. No pedagogical rule was removed — every constraint the model needs to generate correctly is still present, most now stated exactly once.

## PART D — Structured Output prompt discipline

Audited `typeInstruction()`'s 18 entries and `GENERATED_QUESTION_BATCH_SCHEMA` side by side. The schema **structurally** enforces object shape (`options: {id, text}[]`, `matchingPairs: {left, right}[]`, etc. — `additionalProperties: false`, every field required-or-nullable) but **cannot** express type-specific cardinality or semantics (e.g. "exactly 4 options for multiple_choice, one correct three plausible", "options for true_false must be exactly `[true, false]`") — OpenAI strict-mode schemas have no per-discriminant conditional validation for this. `typeInstruction()`'s prose therefore carries real, non-redundant information and was **not** stripped. The genuinely redundant layer was the **shape examples** (PART C above) — a full worked JSON example is valuable as a concrete, one-time illustration, but repeating the *same* illustration 9 times added nothing the schema, the prose, or the first occurrence hadn't already established. The schema itself (`GENERATED_QUESTION_BATCH_SCHEMA`) was **not changed** — required test 6 asserts the exact same schema object reference is still passed to `callModel`.

## OUTPUT CONTRACT ANALYSIS

Per-field necessity, audited against the live trace's 619/705 output tokens for one question:

| Field | Required at generation? | Learner UI? | Quality Gate? | Grading/evidence later? |
|---|---|---|---|---|
| `type`, `question`, `correctAnswer`, `explanation`, `difficulty` | Yes | Yes | Yes | Yes |
| `cognitiveLevel`/`questionIntent`/`expectedReasoningType` | Yes (Phase 3D/LX-4R contract) | Indirect | Yes (`reasoningConsistent` check) | Yes (evidence dimension tagging) |
| `options`/`matchingPairs`/`orderingItems`/`classificationCategories`/`classificationItems` | Type-conditional | Yes | Yes | Yes |
| `calculatorAllowed` | Type-conditional | Yes | No | No |
| `visualAid` | Only if `visualAidRate>0` | Yes when present | Yes (`visualConsistent`) | No |
| `sourceReference` | No (server-derived, not model-generated — see `mapRawQuestionsToGenerated`) | Indirect | No | No |

Every field the schema requires is genuinely used somewhere in this pipeline — **no field was removed from the schema, per PART D's explicit instruction**. The one output-token lever available without a schema change is verbosity of the free-text fields (`explanation` above all): REQUIREMENTS item 3 was tightened from *"clear, complete... should stand on its own"* to add *"be as concise as full correctness and clarity allow — expand into a multi-step worked explanation only when the difficulty genuinely demands it"* — permission to be concise, not a instruction to omit required pedagogical content. This is a prompt change, not a schema change, and its effect on actual output-token count is **unverified without a live call — LIVE_PENDING**.

**Not implemented** (documented, not touched): the ~6-7 always-null optional fields on a non-applicable type (e.g. `matchingPairs: null, orderingItems: null, ...` on a `short_answer` question) are a real, structurally-provable output-token cost inherent to a **flat** strict-mode schema (every property must be listed in `required`, nullable or not) — restructuring the schema into a per-type discriminated union would remove this, but Part D explicitly forbids changing the actual Structured Output schema in this phase. Documented as a P2 follow-up, not acted on.

## FIRST-PASS QUALITY CHANGES

The live candidate failed semantic verification on `REASONING_MISMATCH` and `WEAK_DISTRACTORS` — **the verifier was not touched**. Two targeted, sharper (not weaker) additions to REQUIREMENTS item 6:

1. *"At difficulty 4-5 specifically, make sure these three tags reflect the ACTUAL multi-step reasoning or context transfer the question demands — not just the concept's inherent difficulty."* — directly targets `REASONING_MISMATCH` (the verifier's `reasoningConsistent` check fails when a question's `expectedReasoningType`/`cognitiveLevel` tag doesn't match what the question content actually demands; a difficulty-4 concept can still produce a factual sub-question that shouldn't be tagged as demanding multi-step procedural reasoning it doesn't contain).
2. *"For any choice-format question, every distractor must reflect a genuine, specific misconception or common error for this concept — never an option that is obviously wrong, absurd, or a near-duplicate of another option merely to fill the required count."* — directly targets `WEAK_DISTRACTORS` (the previous instruction, "4 options (one correct, three plausible distractors)," never defined what makes a distractor *plausible*).

Both additions are short (one sentence each), placed once, in the section that already existed for this purpose — not new sections, not restated elsewhere. Whether first-pass acceptance actually improves is **unverified without live semantic-verification calls — LIVE_PENDING**; required test 14 only proves the instructions are present and unchanged in substance elsewhere.

## PART F — request path

Confirmed (not assumed) by reading `src/lib/ai/adapters/openai.ts:callOpenAIChat`: StudyUS calls the **Chat Completions API** (`POST https://api.openai.com/v1/chat/completions`), not the Responses API. `prompt_cache_key` is a field this adapter already sent conditionally before this phase (`...(params.promptCacheKey ? { prompt_cache_key: params.promptCacheKey } : {})`, present since LX-4P-PERF-R1B) — this phase is the first to actually **populate** it for QUESTION_GENERATION, not the first to plumb it. No API migration was made or considered necessary.

## SECURITY / PRIVACY

- `questionGenerationCacheKey`'s only inputs are `promptId`, `promptVersion`, a sorted type-name list, `difficulty` (an integer 1-5), `language` (a locale code), and a boolean — none of which is student, concept, or content data. Required tests 2-5 and 12 assert this directly: the key never contains the test's studentId/conceptId/subjectId or any distinctive word from the retrieved context.
- `cacheHitRatio` is a plain float (`cachedInputTokens/inputTokens`) — no content.
- No question/answer/explanation text was added to any log line in this phase.

## TESTS

16 required tests plus 1 supplementary test, all in `tests/unit/lx10r1-question-generation-prompt-perf.test.ts` (25 assertions total across the describe blocks), exercising the REAL `generateQuestionsForConcept` with only the provider boundary mocked (same pattern as the pre-existing `quiz-generation-timeout.test.ts`):

| # | Requirement | Result |
|---|---|---|
| 1 | Static content precedes dynamic content | PASS — both the material and general-knowledge branches |
| 2 | promptCacheKey populated | PASS |
| 3 | No learner/content identifiers in the key | PASS |
| 4 | Stable key for compatible contracts | PASS |
| 5 | No collision for materially different contracts (difficulty, language) | PASS |
| 6 | Structured Output schema unchanged | PASS (exact object reference) |
| 7 | Question Quality Gate unchanged | PASS |
| 8 | Difficulty calibration unchanged | PASS |
| 9 | Evidence contracts unchanged | PASS |
| 10 | Exact-count contracts unchanged | PASS |
| 11 | Novelty unchanged | PASS |
| 12 | No learner content in telemetry | PASS |
| 13 | Generated prompt materially smaller (shape dedup proven) | PASS |
| 14 | All required pedagogical constraints still present | PASS |
| 15 | Luna/Terra routing unchanged | PASS |
| 16 | All existing tests green | PASS (231 files / 3900 tests) |
| — (supplementary) | `reasoningEffort` now explicitly wired for the live-trace call site | PASS |

Also updated one pre-existing test (`quiz-generation-timeout.test.ts`) whose literal assertion (`toContain('"case_study"')` as a standalone JSON field) was invalidated by the shape-deduplication change; the assertion was updated to check the type name is still present in the message (now inside a grouped-shape comment) — the test's actual intent (catalog completeness) is unchanged and still verified.

**Verification, run on the implementation commit:**
```
npx tsc --noEmit   -> clean, 0 errors
npx vitest run     -> 231 test files, 3900 tests, all passed
npm run build       -> clean production build
```

## LIVE VALIDATION PLAN

After this deploys to `preview/openai-perf`, repeat the exact same Review flow (`requiredQuestionCount=1`, `difficulty=4`) and capture:

- `generationLatency` (Luna call duration) — compare to 8.821s.
- `verificationLatency` (Terra verify duration) — compare to 6.250s.
- `cachedInputTokens` and `cacheHitRatio` — compare to 0 (any nonzero value on a repeat request with the same type-set/difficulty/language is a positive signal the cache key is working; a sustained near-zero value after several repeat requests would mean the routing hint isn't achieving hits and needs further investigation, not a rollback of the reordering itself).
- `inputTokens` for the Luna call — compare to 6473; expect a reduction roughly proportional to the ~21% measured reduction in the reconstructed prompt (exact percentage will differ under the real tokenizer).
- `outputTokens` — compare to 619, to see whether the explanation-conciseness wording had any measurable effect.
- `firstPassAccepted` (did the FIRST Luna candidate pass semantic verification, avoiding the Terra recovery cycle entirely) — compare to the baseline's `false` (it failed on REASONING_MISMATCH/WEAK_DISTRACTORS).
- `totalDuration` and `totalCost` for the whole route — compare to 29.59s / $0.0348934.

This is a plan, not a result — no live request was made in this pass, consistent with LX-10's own established finding that this environment has no live provider/DB access.

## COMMITS

Implementation: `17fba9a` — `perf(lx-10r1): reduce QUESTION_GENERATION critical-path prompt size and add cache-key routing`

This report: separate docs commit, immediately following.

Branch: `tmp/lx1` (git worktree only — never `origin/main`, nothing deployed, nothing pushed).
