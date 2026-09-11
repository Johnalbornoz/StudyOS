# STUDYUS — LX-4P-PERF LIVE REPAIR
## PERF-R1F — OPENAI STRUCTURED QUESTION RESPONSE COMPATIBILITY

Branch: `tmp/lx1`
Repair commit: `3c36c6b`
Builds on: `fe4ed4f` / `3b2b906` (R1E-R1).

LX-6 not started. Not deployed. Nothing pushed to `origin/main`.

---

## ROOT CAUSE

**Exact function:** the `validate` closure inside each of the four
QUESTION_GENERATION call sites in `src/services/quiz-generation.service.ts`
— `generateQuestionsForConcept` (the canonical batch), `generateQuickCheckQuestions`'s
`requestSlot`, `generatePracticeQuestions`'s `requestChunk`, and
`generateRetentionCheckQuestions`'s `requestChunk`.

**Exact incompatible contracts:**

1. Every one of the four did `parsed = parseAIJson<any[]>(repaired)`.
   `parseAIJson` is `JSON.parse` plus markdown-fence stripping — **the
   `<any[]>` is a compile-time-only generic parameter with zero runtime
   check.** Whatever `JSON.parse` returns is trusted to be an array.
2. **None of the four passed `jsonSchema: GENERATED_QUESTION_BATCH_SCHEMA`**
   to `callModel` — the strict schema built in R1C (`schemas.ts`) was
   never actually wired into a live call. Without `jsonSchema`,
   `callModel`'s dispatcher (`responseFormatJson: !p.jsonSchema`) falls
   back to legacy `response_format: { type: 'json_object' }`.
3. **`json_object` mode requires the model's top-level output to be a
   JSON *object*.** The prompt text at every one of the four sites still
   said `"Output a JSON array... [ ... ]"`. This is a direct contradiction:
   the API-level contract demands an object; the prompt demands an
   array.
4. The model, constrained by the API to emit an object, returns
   something like `{"questions": [...]}"` (exactly the primary
   hypothesis). `parsed` is then that object, not an array — but still
   typed `any[]` by the lying generic.
5. The very next line, `parsed.filter((q) => !isLatexCorrupted(q))`
   (or `parsed[0]` for quick_check), runs against an **object**.
   `.filter` does not exist on a plain object → `TypeError: parsed.filter
   is not a function`, thrown **inside `validate`**.
6. `executeAI` wraps `opts.validate(raw)` in a try/catch
   (`src/lib/ai/gateway.ts`): a **thrown** validate error is classified
   `errorCode: 'INVALID_RESPONSE'`, `validationStatus: 'FAILED'` — this
   is the exact signature in both live attempts.
7. `generateGatedPracticeBatch`'s Luna call (`generateQuestionsForConcept`,
   default model) and Terra retry (`generateQuestionsForConcept` with
   `modelOverride: TERRA`) share the identical `validate` closure — so
   **both attempts fail identically**, exactly matching the live evidence
   (`luna: 0 generated, 0 passed, 0 det-fail, 0 sem-fail` → Terra → the
   same failure again).

This is a StudyUS internal contract mismatch: the runtime asked for one
shape (array) while the transport contract it was actually using
(`json_object`, then correctly the strict schema once wired) requires
another (object). Confirmed by tracing, not assumed — quick_check's
`requestSlot` (which does `parsed[0]` instead of `.filter`) would *not*
throw on the same object (bracket access on a plain object just returns
`undefined`), so it would have failed as an ordinary `VALIDATION_ERROR`
instead — proving the failure mode is genuinely about the shape
mismatch, not a fluke of one call site's code.

---

## OPENAI RESPONSE SHAPE

Before this repair, live: object-rooted content (forced by
`json_object` mode) while the prompt asked for an array — the exact
mismatch above. After: `response_format: { type: 'json_schema',
json_schema: { strict: true, schema: GENERATED_QUESTION_BATCH_SCHEMA.schema } }`,
which makes OpenAI **guarantee** `{"questions": [GeneratedQuestion, ...]}`
— an object root with one `questions` array property, matching what the
prompt now explicitly asks for at every one of the four sites.

---

## STRUCTURED SCHEMA

`GENERATED_QUESTION_BATCH_SCHEMA` (`src/lib/ai/schemas.ts`) is now
**wired** into `callModel(...)` at all four QUESTION_GENERATION call
sites (previously built, never connected). R7 audit against OpenAI's
confirmed-supported strict-mode subset (`type`/`properties`/`required`/
`additionalProperties`/`items`/`enum`/`anyOf`/`$ref`):

- Every object already had `additionalProperties: false` and `required`
  listing every property key — verified structurally by a new contract
  test that walks the *exact request body* `callOpenAIChat` would send,
  recursively, for every nested object (`generatedQuestion`, `visualAid`,
  `visualAid.chartData`, `options`/`matchingPairs`/`classificationItems`
  item schemas, the batch root).
- **Finding:** `difficulty: { type: 'integer', minimum: 1, maximum: 5 }`
  used `minimum`/`maximum`, numeric range keywords **not** in the
  confirmed-supported strict-mode subset. **Fixed:** removed the range,
  kept `type: 'integer'`. The 1–5 range is still enforced downstream by
  the deterministic Question Quality Contract
  (`checkQuestionQualityDeterministic`), unchanged.
- No `minLength`/`maxLength`/`pattern`/`format`/`minItems`/`maxItems`
  anywhere in the schema — confirmed by the same recursive contract
  test.
- Nullable optionals correctly use the `type: [T, "null"]` +
  enum-including-`null` pattern OpenAI's strict mode documents.

This audit is a **static, best-effort verification** against documented
strict-mode behavior — final confirmation that OpenAI's live API accepts
this exact schema requires a real request with `OPENAI_API_KEY`, which
this environment does not have (same caveat as every prior phase).

---

## ADAPTER EXTRACTION

`callOpenAIChat` (`src/lib/ai/adapters/openai.ts`) — **unchanged, already
correct**: reads `data.choices[0].message.content` (Chat Completions,
not the Responses API's `output_text`, not an SDK-parsed field, not
Anthropic content blocks). Already throws `INVALID_RESPONSE` on
`message.refusal` **before** `validate` ever runs — this is what makes a
refusal distinguishable from a validate-time structural defect
(`validationStatus: 'NOT_APPLICABLE'` vs `'FAILED'`), verified by a new
test. No API-family migration was needed or made.

---

## DOMAIN PARSER

New, private, single boundary: `parseGeneratedQuestionBatch(rawText,
finishReason)` in `quiz-generation.service.ts`. Never throws. Pipeline:

```
rawText
  -> repairInvalidJsonEscapes (unchanged CLASS A backslash repair)
  -> parseAIJson (JSON.parse + fence-strip)
       parse fails -> salvageQuestionBatch (object-wrapper-aware
                       truncation recovery) -> questions[] or INVALID_JSON
                       / OUTPUT_TRUNCATED (if finishReason === 'length')
  -> root is not a plain object, or `.questions` is not an array
       -> BATCH_WRAPPER_INVALID
  -> otherwise -> { ok: true, questions: [...] }
```

All four call sites call it exactly once and do not re-implement their
own `JSON.parse(...).questions` unwrap (verified by a source-contract
test). `salvageJsonArray` (bare-array truncation salvage) was removed —
superseded by `salvageQuestionBatch`, which closes both the array and
the wrapping object (`]}`) when recovering a truncated
`{"questions": [ ...` payload.

**R6 (legacy compatibility):** `parseGeneratedQuestionBatch` is the LIVE
OpenAI runtime boundary only — it does **not** accept a bare array (that
would silently hide a real regression going forward). Historical /
offline `GeneratedQuestion[]` (the Sonnet quality-baseline corpus, cached
`quiz_sessions.questions` rows) is read directly from storage as
already-typed `GeneratedQuestion[]` and never passes through this parser
— that compatibility stays explicit at the storage boundary, untouched
by this repair.

---

## QUALITY GATE ENTRY

Untouched (`src/services/gated-question-generation.service.ts` — verified
by a source-contract test that it contains no `jsonSchema` /
`parseGeneratedQuestionBatch` / `GENERATED_QUESTION_BATCH_SCHEMA`
reference). Once `generateQuestionsForConcept` returns a genuine
`GeneratedQuestion[]` (which it now can), `applyQuestionQualityGate` runs
exactly as before: deterministic contract → semantic verify where
required → accept/reject. Verified end-to-end: a structurally valid Luna
batch now reaches the gate and is **accepted with zero Terra calls**; a
genuine deterministic-gate rejection still escalates to **exactly one**
Terra attempt, unchanged.

---

## FAILURE CLASSIFICATION

No new `AIErrorCode` was added to the shared gateway enum (that type is
used across every AI capability and DB/audit-persisted metadata —
widening it was out of scope and unnecessary). Instead:

| Class | Where it's visible |
|---|---|
| `PROVIDER_HTTP_ERROR` | existing `providerHttpError` → `errorCode: 'PROVIDER_ERROR'` (unchanged) |
| `PROVIDER_REFUSAL` | `callOpenAIChat` throws before `validate` → `errorCode: 'INVALID_RESPONSE'`, **`validationStatus: 'NOT_APPLICABLE'`** (distinguishable from a structural defect) |
| `OUTPUT_TRUNCATED` | `parseGeneratedQuestionBatch`'s `failureStage` when `finish_reason === 'length'` and nothing/not-enough could be salvaged |
| `EMPTY_RESPONSE` | `failureStage: 'EMPTY_RESPONSE'` when `raw.text` is empty |
| `INVALID_JSON` | `failureStage: 'INVALID_JSON'` — `JSON.parse` failed and nothing salvageable |
| `BATCH_WRAPPER_INVALID` | `failureStage: 'BATCH_WRAPPER_INVALID'` — valid JSON, wrong root shape (array/null/scalar) or missing/non-array `questions` |
| `DOMAIN_PARSE_INVALID` | (reserved — per-question shape issues are filtered by `isLatexCorrupted`/the Quality Gate downstream, never a batch-level failure) |
| `QUALITY_GATE_REJECTED` | unchanged — `gated-question-generation.service.ts`'s own `qualityGateResult` |

Every batch-level class surfaces via the **new `[ai-structure]`
diagnostic log** (safe fields only — model, finishReason, hasContent,
contentLength, hasRefusal, hasUsage, parsedRoot, keys, questionsCount,
failureStage, parseMs) and via the `errors: [...]` text StudyUS's own
`VALIDATION_ERROR` message carries (`"${failureStage}: ${detail}"`) —
**never** logs question text, options, explanations, prompts, or RAG
content (verified by a test asserting the exact key set and absence of
any generated field value).

---

## USAGE TELEMETRY

`hasUsage` (and, when present, the real token counts are visible in
`raw.raw.usage` and reflected by `hasUsage: true`) is captured in the
new `[ai-structure]` log **even when domain validation later fails** —
verified: a response with `usage: { prompt_tokens: 500, completion_tokens: 200 }`
that fails with `BATCH_WRAPPER_INVALID` still logs `hasUsage: true`.
When no usage is returned, `hasUsage: false` — never fabricated.

Full propagation of *numeric* usage into the older `[ai-runtime]`
gate-quality events (`emitGateEvent` etc., which still hardcode
`inputTokens: null` / `outputTokens: null`) is **not done in this
repair** — it would require changing `generateQuestionsForConcept`'s
return contract to also surface usage, rippling into
`generateQuestionVariant`, `generateGatedQuestionBatch`, and every mode
test asserting on that return shape. Flagged as a follow-up, not
attempted here to keep this a focused, bounded repair.

---

## LUNA FALLBACK BEHAVIOR

Verified directly: a structurally valid Luna response now reaches the
gate and is accepted with **zero** additional `callModel` calls (R11 —
no Terra for a pure parsing win). A genuine deterministic-gate rejection
still triggers **exactly one** Terra attempt (unchanged bound). A
pure wrapper defect on the Luna side (e.g. a stray bare-array response,
now correctly classified `BATCH_WRAPPER_INVALID` instead of crashing)
is treated by `gateUnitWithTerraFallback` exactly like an empty Luna
batch — one Terra attempt, same as before, never a masquerade as a
"quality" rejection and never more than the existing bound.

---

## PERFORMANCE IMPACT

The model call itself is already timed and logged by the gateway's own
`[ai]` execution record (`durationMs`) — unchanged. The new
`parseGeneratedQuestionBatch` step adds a `parseMs` field to the
`[ai-structure]` log proving the parse itself is negligible (a
`JSON.parse` + a handful of property checks — sub-millisecond in every
test run). No new serial AI call was introduced to fix parsing.
Stage-by-stage timing for the deterministic/semantic gate and the Terra
fallback (`DETERMINISTIC_GATE`/`SEMANTIC_GATE`/`TERRA_FALLBACK` buckets)
is a valuable but separate observability enhancement, not required to
fix this defect and not attempted here (same follow-up note as usage
propagation above).

---

## TESTS

`npx tsc --noEmit` clean · `npx vitest run` **193 files / 2868 tests
pass** · `npm run build` compiles.

New: `tests/unit/lx4p-perf-r1f-structured-response.test.ts` (26 cases).
37 existing assertions across 4 files updated to the new object-rooted
wire fixture shape (`cognitive-level-generation`,
`question-variant-equivalence`, `quiz-generation-latex-safety`,
`quiz-generation-retention`) — the OLD fixtures fed a bare array, which
this repair now correctly rejects; they were updated to the real wire
contract, not weakened.

| # | Requirement | Covered |
|---|---|---|
| 1 | strict `{"questions":[...]}` parses | ✓ |
| 2 | `GeneratedQuestion[]` after one centralized unwrap | ✓ |
| 3 | raw array rejected | ✓ |
| 4 | missing `questions` rejected | ✓ |
| 5 | null `questions` rejected | ✓ |
| 6 | malformed JSON → `INVALID_JSON` | ✓ |
| 7 | refusal → distinguishable via `NOT_APPLICABLE` | ✓ |
| 8 | `finish_reason:length` → `OUTPUT_TRUNCATED` | ✓ |
| 9/10 | valid response reaches the gate, accepted, no Terra | ✓ |
| 11 | semantic-required question reaches the semantic gate | ✓ (existing gate suites, untouched, still green) |
| 12 | genuine gate failure → exactly one Terra call | ✓ |
| 13 | structural defect ≠ quality rejection, same one-Terra bound | ✓ |
| 14 | Terra uses the same batch parser | ✓ |
| 15 | usage preserved on failure, never fabricated | ✓ |
| 16 | no learner/prompt/RAG content logged | ✓ |
| 17 | counts unchanged | ✓ |
| 18 | `ResponseEvidenceContract` untouched | ✓ |
| 19 | activity language unchanged | ✓ |
| 20 | universal Quality Gate module untouched | ✓ |
| 21 | MODEL/GUIDE independence (R1E-R1) untouched | ✓ |
| 22 | evidence/mastery untouched | ✓ |

---

## COMMIT

`3c36c6b` on `tmp/lx1` (after `fe4ed4f`).

---

## CERTIFICATION

**STATUS: PASS**

OpenAI structured question output can now traverse
`provider → schema → parser → GeneratedQuestion[] → Question Quality Gate`
without `INVALID_RESPONSE` caused by a StudyUS contract mismatch — the
one concrete pipeline the live evidence exercised. This is a code-level
proof (tsc clean, 193/193 files, 2868/2868 tests, an explicit contract
test against the exact strict-schema request body); it is **not** a live
run.

**Do not claim live success until pushed to QA and reproduced.**

## NEXT STEP

Push to QA and run **one** canonical Practice generation. Expected live
result:
- no `INVALID_RESPONSE`;
- `questionsCount > 0`;
- the Quality Gate executes;
- Luna accepted, **or** a legitimate Terra fallback (a real quality
  rejection, not a parser defect);
- a Practice question appears to the learner.

Do NOT start LX-6.

STOP.
