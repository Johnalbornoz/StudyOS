# LX-9R7 — PROVIDER 400 ROOT CAUSE

## STATUS

**PASS_WITH_CONDITIONS.** Two independently provable infrastructure defects are found
and fixed at the shared, lowest-common layer (`src/lib/ai/errors.ts`/`gateway.ts`/
`logging.ts`), applied uniformly to every QUESTION_GENERATION call site. The **exact**
malformed request field that produced this specific HTTP 400 is **not asserted** — a
rigorous structural audit of the JSON schema found no violation of OpenAI's documented
strict-mode rules, and this environment has no live provider access to reproduce the
call and read the real error body. What is fixed and certain: the error body was never
being captured (so no one could have known the exact reason from the logs alone), and a
deterministic 400 was being blindly retried on Terra (doubling the cost of every
failure). Both are now closed. Full regression suite green (**3802/3802**).

## LIVE FAILURE

`quizMode=quick_check`, `activityType=SOLO_CHECK`, `operationId cabdd24b-2797-4fd1-a9ad-fcfeefaea346`:
6 initial Luna calls → HTTP 400 → 6 Terra "recovery" calls → HTTP 400 again. ~704ms
total — far too fast to be inference; the request was rejected before the model ever
ran. Every one of the 12 calls failed identically.

## PROVIDER ERROR BODY

**Not capturable from this environment.** Before this phase, `providerHttpError`
(`src/lib/ai/errors.ts`) took the provider's raw HTTP response text and only ever did
`body.slice(0, 500)` — appended as an opaque string suffix to a generic message, never
parsed into `error.type`/`error.code`/`error.param`/`error.message`. There is no log
line anywhere in the pre-existing code that would have shown the real reason, even in
this exact incident's own logs. This is fixed (see FIX below); it does not retroactively
recover the body from the incident that already happened.

## PROVIDER ERROR CODE

Before this phase: generic `PROVIDER_ERROR` for HTTP 400 — indistinguishable in the logs
and in the retry/fallback decision from a transient HTTP 500. This is the reason every
domain generator treated the 400 exactly like a would-be-transient failure and retried
it on Terra.

## INVALID REQUEST FIELD

**Not proven.** A rigorous, automated structural audit of `GENERATED_QUESTION_BATCH_SCHEMA`
(and every other OpenAI structured-output schema in `src/lib/ai/schemas.ts`) against
OpenAI's documented strict-mode requirements — every property listed in `required`,
`additionalProperties: false` on every object node, no keyword outside the
documented-supported set — found **zero violations** across all five schemas (see
`tests/unit/lx9r7-provider-error-classification-contract.test.ts`, "8. schema request
shape valid"). The wrapping (`response_format: { type: 'json_schema', json_schema:
{ name, strict: true, schema } }`) and the request body construction
(`model`/`messages`/`max_completion_tokens`/`prompt_cache_key`/`reasoning_effort`) also
match OpenAI's current documented Chat Completions contract — no legacy or
Responses-API-only field is present.

The one candidate difference this audit surfaced without being able to confirm it:
`reasoningEffort: 'minimal'` is used ONLY by `question_generation_slot` (quick_check's
budget) and two unrelated capabilities (`contextual_help`, `question_localization`) —
every other QUESTION_GENERATION call site (`question_generation_practice`,
`question_generation_chunk`) uses `'low'`. This is flagged as a candidate, not asserted
as the cause — there is no live evidence either confirming or ruling it out, and "Do not
speculate" is taken literally here.

## OUTBOUND REQUEST SHAPE

```
endpoint:              POST https://api.openai.com/v1/chat/completions
model:                 gpt-5.6-luna (primary) / gpt-5.6-terra (fallback)
messages:              [{role:'system',...}, {role:'user',...}]
response_format:       {type:'json_schema', json_schema:{name:'generated_question_batch', strict:true, schema:{...}}}
max_completion_tokens: budgetFor(...).maxOutputTokens (2400 for quick_check's slot budget)
reasoning_effort:      budgetFor(...).reasoningEffort ('minimal' for quick_check)
prompt_cache_key:      not sent by this call site (optional field, unset)
tools/tool_choice:     none
```

No `max_tokens` (deprecated legacy field), no `input`/`text.format` (Responses-API
shape) — this adapter targets Chat Completions exclusively and correctly.

## SHARED AFFECTED GENERATORS

Confirmed (Part C): PRACTICE, SOLO_CHECK, RETENTION_CHECK, and — via
`generateGatedQuestionBatch`/`generateQuestionsForConcept` — DIAGNOSTIC, CUMULATIVE, and
MOCK all route through the exact same `GENERATED_QUESTION_BATCH_SCHEMA`, the same
`quiz.question_generation` prompt (v3), and the same `callModel`/`callOpenAIChat`
adapter. The fix therefore applies at that one shared layer (`errors.ts`) rather than
per-mode — no mode-specific workaround was created, per Part E's explicit instruction.

## ROOT CAUSE

**Confirmed, provable component:** the retry-classification gap. `executeAI`
(`gateway.ts`) never makes its own retry decision — each domain generator's own
`fallback: () => null/[]` callback decides whether to attempt Terra, and until this
phase that callback discarded the classified error entirely, treating a deterministic
400 identically to a transient 5xx. This is why the live evidence shows the SAME failure
twice: the code had no way to know the second attempt was pointless.

**Not confirmed:** the exact provider-side reason for the 400 itself. Reported honestly
as unknown rather than guessed.

## FIX

1. **`src/lib/ai/errors.ts`** — `providerHttpError` now safely parses the provider's
   JSON error envelope (`parseProviderErrorBody`, never throws) and attaches it as
   `.providerDetail` on the thrown `AIExecutionError`. HTTP 400/404 now classify as a
   new `INVALID_REQUEST` code (previously generic `PROVIDER_ERROR`), kept distinct from
   401/403 (`CONFIGURATION_ERROR`, unchanged) and 429/5xx (`RATE_LIMIT`/`PROVIDER_ERROR`,
   still retryable). New `isRetryableAIError(code)` is the one authority every generator
   now consults.
2. **`src/lib/ai/gateway.ts`** — logs a dedicated `[ai-provider-error]` line
   (`logAIProviderError`) whenever a provider HTTP error occurs, unconditionally —
   before any fallback has a chance to swallow it — and attaches the same safe fields
   to the execution metadata so the existing `[ai]` summary line carries them too.
3. **`generateQuickCheckQuestions`** (quick_check) — a slot's `fallback` now reports a
   non-retryable code; if ANY of the 6 initial slots failed non-retryably, the whole
   activity fails immediately with zero Terra calls (previously: 6 pointless Terra
   calls, exactly matching the live incident).
4. **`generatePracticeQuestions`** (topic_practice/review) — each chunk's `fallback`
   reports non-retryability; a chunk whose initial call failed non-retryably skips its
   own per-chunk Terra regeneration (the other chunks are unaffected — they're
   independent requests).
5. **`generateRetentionCheckQuestions`** — `RetentionChunkOutcome` gained a
   `'NON_RETRYABLE'` reason (with the exact code preserved); Rule 6B's bounded recovery
   round is skipped when the failed chunk's error was non-retryable, failing closed
   with the exact code instead of spending the one Terra call it's normally allowed.
6. **`generateQuestionsForConcept`** (shared by `generateGatedQuestionBatch` — i.e.
   DIAGNOSTIC/CUMULATIVE/MOCK/small-count Practice) — gained an additive
   `onNonRetryableError` callback (same pattern as the pre-existing `onUsage`);
   `generateGatedQuestionBatch` uses it to skip its own Terra regeneration entirely when
   the initial call already failed non-retryably.

No mode-specific request reconstruction. `GENERATED_QUESTION_BATCH_SCHEMA`, the quality
gate, the exact-count contracts (LX-9R6/LX-9R6-R1), novelty, and adaptive difficulty are
all untouched — the provider request itself was not proven invalid, so it was not
changed.

---

## RETRY CLASSIFICATION

### NON-RETRYABLE

`INVALID_REQUEST` (HTTP 400/404 — malformed request shape, or an invalid model/endpoint)
and `CONFIGURATION_ERROR` (HTTP 401/403 — auth/permission). The exact request that was
rejected is the one about to be resent to Terra; retrying can never succeed. Every
generator now fails fast on these, preserving the exact code, with the same calm
learner-facing "couldn't prepare this activity" copy (unchanged, per Part D's "return
the normal calm learner-facing error").

### RETRYABLE

`TIMEOUT`, `RATE_LIMIT` (HTTP 429), `PROVIDER_ERROR` (5xx/network) — genuinely
transient, where a different model or a fresh attempt might succeed. Also
`VALIDATION_ERROR`/`INVALID_RESPONSE` (StudyUS-side parse/schema rejection of an
otherwise-successful provider response) — unchanged, since a different model
genuinely might follow the schema better. Every existing bounded-fallback behavior
(exactly one Terra attempt, never a loop) is preserved for these.

---

## REQUEST CONTRACT TEST

`tests/unit/lx9r7-provider-error-classification-contract.test.ts`, "7. QUESTION_GENERATION
outbound payload matches current adapter contract" and "8. schema request shape valid":
constructs a real `callOpenAIChat` call with `GENERATED_QUESTION_BATCH_SCHEMA` against a
mocked `fetch`, captures the exact JSON body sent, and asserts it matches the documented
current contract (model/messages/response_format/max_completion_tokens/reasoning_effort,
no legacy or Responses-API fields) — plus an automated strict-mode schema validator
applied to every OpenAI structured-output schema in the registry. This test would catch
a FUTURE regression to either the wrapping or the schema; it cannot retroactively prove
what this specific incident's malformed field was, since that requires the live error
body this environment cannot obtain.

## OBSERVABILITY

`[ai-provider-error]` (new): `operationId, capability, model, status, providerErrorType,
providerErrorCode, providerErrorParam, providerErrorMessage` — logged unconditionally on
every provider HTTP error, safe fields only (never the API key, Authorization header,
prompt/question content, or student PII — verified by source audit in "5/6" below). The
existing `[ai]` execution-summary line also now carries the same fields when present.

---

## TESTS

22 tests in `tests/unit/lx9r7-provider-error-classification-contract.test.ts`, covering
all 21 required items: safe error-body parsing and logging (1-6), the outbound request
contract and schema validator (7-9), the retry-classification behavioral tests proving
HTTP 400/401/403 make zero Terra calls while 429/5xx/timeout still make the existing
bounded 12 (10-15), and regression confirmation that quick_check/retention/practice's
exact-count contracts, novelty, and adaptive difficulty are untouched (16-21).

Full verification:
- `npx tsc --noEmit` — clean.
- `npx vitest run` — **3802/3802 passing** (226 files).
- `npm run build` — clean.

## COMMIT

`e421917` — `fix: capture provider error detail and stop retrying non-retryable AI errors (LX-9R7)`.
(This report is a separate docs commit, delivered via SendUserFile.)

---

# CERTIFICATION

**PASS_WITH_CONDITIONS.** FAIL conditions avoided: provider errors are no longer opaque
(structured type/code/param/message now captured and logged on every occurrence); a
deterministic 400/401/403/404 no longer triggers a Terra fallback anywhere in the
QUESTION_GENERATION path (verified behaviorally for quick_check, by classification
audit for practice/retention/gated-batch). PASS is not fully claimed because this
environment cannot deploy to Preview and make a real provider call — **whether the
underlying request itself is now accepted by OpenAI cannot be confirmed from here**.
The condition: once deployed, the new `[ai-provider-error]` log is exactly what will
show, on the very next occurrence (if any), the provider's own `type`/`code`/`param` —
closing this loop with certainty rather than a guess.

DO NOT start LX-10.

STOP.
