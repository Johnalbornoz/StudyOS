# StudyUs AI Contract

Established Phase 0E1, in response to Phase 0A's finding that every AI capability in StudyUs (~19 call sites across 13 service files, plus a parallel legacy path) built its own raw HTTP call to Anthropic or OpenAI, with no shared transport, no execution identity, no prompt versioning, and inconsistent validation. This document describes the resulting shared contract. It is infrastructure, not pedagogy: nothing here changes a mastery formula, a grading threshold, a correctness rule, or a teaching strategy. See `docs/audits/STUDYUS_PHASE_0E1_AI_CONTRACT_FOUNDATION.md` for the full audit, risk classification, and migration-by-migration evidence.

## Current AI architecture

```
DOMAIN SERVICE
     |
     v
executeAI()  ---- src/lib/ai/gateway.ts
     |               - execution id, timeout, error normalization,
     |                 validation enforcement, safe logging
     v
provider adapter
     |
     +------ callAnthropicMessages()   src/lib/ai/adapters/anthropic.ts
     |
     +------ callOpenAIChat()          src/lib/ai/adapters/openai.ts
     +------ callOpenAIEmbedding()     src/lib/ai/adapters/openai.ts
     |
     v
Anthropic Messages API / OpenAI Chat Completions & Embeddings API
```

Every AI-provider call in `src/` (13 service files, ~21 call sites) now goes through `executeAI()`. There are zero raw `fetch()` calls to `api.anthropic.com`/`api.openai.com` and zero direct `@anthropic-ai/sdk` client usages left outside `src/lib/ai/adapters/` -- confirmed by full-repo search (Step 22 of the Phase 0E1 audit; `UNMIGRATED_LIVE = 0`).

## The canonical gateway: `executeAI()`

`src/lib/ai/gateway.ts`. Every call site supplies:

- `capability`, `risk` -- what this call does and its consequence class (see Risk below).
- `provider`, `model`, `promptId`, `promptVersion` -- identity of this specific execution.
- `call(signal)` -- performs the actual provider request via an adapter; must respect the given `AbortSignal`.
- `validate(raw)` -- parses/validates the raw response into a typed domain result. **Never optional.**
- `fallback(error)` (optional) -- when the pre-existing call site had a safe fallback value (e.g. "return `[]`/`null` on failure"), the migration passes the exact same value here so behavior is unchanged; call sites that previously let an error propagate pass no fallback, and `executeAI` throws.

It returns `{ result, execution, provenance }` on success, or (with no fallback configured) throws `AIExecutionFailure` -- a normalized error carrying a `.code` and the `execution` metadata that was recorded before the throw.

The gateway makes no pedagogical decisions. It has no notion of mastery, grading thresholds, or correctness -- it only gets a typed, validated result from a provider to the caller's own deterministic business logic.

### Execution metadata

Every execution, success or failure, produces an `AIExecutionMetadata` object (`src/lib/ai/types.ts`):

```
executionId, capability, risk, provider, model, promptId, promptVersion,
startedAt, durationMs, success, validationStatus, fallbackUsed, errorCode?
```

`executionId` is a fresh UUID per call (`crypto.randomUUID()`), enabling a future audit trail (Phase 0E2) to trace `learning_evidence -> AI execution -> provider/model/prompt version` -- this phase establishes the identifier and metadata shape; the persistent, cross-engine audit table itself is explicitly deferred (see below).

### Timeout

`DEFAULT_AI_TIMEOUT_MS = 30_000`. Every call is wrapped in an `AbortController`; the adapter's `fetch` call is given the signal. No AI request in StudyUs can hang indefinitely -- before this phase, none of the 19+ raw call sites had any timeout at all. No retries were introduced: a bounded, single-attempt call with a normalized `TIMEOUT` error preserves every pre-existing site's actual retry behavior (none had any), and Step 7 explicitly cautioned against inventing a retry that could duplicate an expensive/state-affecting operation.

### Error normalization

`src/lib/ai/errors.ts`. Every failure -- a thrown network error, an aborted request, a non-ok HTTP response, a validator that returns `{valid:false}`, a validator that throws -- collapses into one `AIExecutionError` with a `code`:

| Code | When |
|---|---|
| `TIMEOUT` | The request was aborted by the gateway's own timeout |
| `RATE_LIMIT` | Provider responded HTTP 429 |
| `CONFIGURATION_ERROR` | Missing API key, or provider responded HTTP 401/403 |
| `PROVIDER_ERROR` | Any other non-ok HTTP response, or a network-level throw |
| `INVALID_RESPONSE` | The response couldn't be parsed at all (validator threw) |
| `VALIDATION_ERROR` | The response parsed, but didn't satisfy the validator's contract |

No provider internals or API keys are ever included in a normalized error's message -- only the provider's own error response body (already non-secret; the same text every pre-existing call site already surfaced in its own ad hoc error message), truncated defensively.

## Provider adapters

`src/lib/ai/adapters/anthropic.ts` and `src/lib/ai/adapters/openai.ts` -- the only two providers StudyUs actually uses. Each adapter is the one place in the codebase that knows the endpoint URL, the auth header shape, and how to pull text/embedding data out of that provider's specific response envelope. Domain services never construct a request envelope or parse a provider-specific response shape themselves.

Every adapter call preserves the exact request shape the pre-existing raw `fetch()` at that call site used -- same model identifiers (`claude-sonnet-5` for every Anthropic call, `gpt-5.6` for OpenAI chat, `text-embedding-3-small` for OpenAI embeddings), same `max_tokens`/`system`/`messages` fields, same `anthropic-version` header. This phase centralizes transport; it does not change what gets sent to either provider (Step 6).

## Prompt registry

`src/lib/ai/prompt-registry.ts`. A plain, version-controlled-in-code map from `promptId` to `{ version, capability, service, description }` -- not a remote prompt-management platform. Every AI capability StudyUs has today is registered, starting at `v1`. The registry tracks identity and version; the actual prompt text still lives in each service file exactly where it always has (`service` field points to it) -- this phase did not move, rewrite, or "improve" a single prompt's wording. See the full inventory in the Phase 0E1 audit report, section 23.

A future prompt change becomes `v2` (a new registry entry, or a version bump with the service updated) -- never a silent edit to what `v1` means.

## Output validation

Every `executeAI()` call supplies a `validate` function (`src/lib/ai/validation.ts` provides `validateJson`, `checks`, `clamp` as shared helpers reusing the pre-existing `parseAIJson` markdown-fence-stripping parser). A validator that returns `{valid:false}` or throws is treated identically -- a normalized failure, never a partially-trusted value handed to the caller. Where a pre-existing call site already had good validation (`interactive-formula.service.ts`'s `validateFormula`/`validateVariable`), it's reused as-is inside the new `validate` step rather than replaced.

Phase 0E1 deliberately did **not** introduce new pedagogical thresholds or stricter rejection rules beyond what the pre-existing code already implied (e.g. `gradeAnswer`'s validator does not newly reject a response missing the `correct` field, because the original code never did either -- see the audit report's Step 12 section for the one narrow, disclosed exception: rejecting a non-object JSON value, which no real prompt response has ever produced).

## High-risk AI boundary

Every HIGH_RISK call (see the audit report's risk classification) follows the same shape:

```
AI provider -> parse -> validate -> typed domain result -> existing deterministic business logic
```

The typed result is the only thing that ever reaches `updateMastery`, `gradeStructuredAnswer`, `computeTransferScore`, or any other deterministic, mastery-affecting code. No AI provider ever writes to the database directly, and no AI output is treated as a mastery verdict -- the deterministic algorithms in `src/lib/algorithms/mastery.ts` and the Phase 2.2 Knowledge State projector remain the only things that ever decide mastery, exactly as before this phase.

## Safe logging

`src/lib/ai/logging.ts`. `logAIExecution()` -- called by the gateway on every success and failure -- emits only the fields on `AIExecutionMetadata`: `executionId`, `capability`, `provider`, `model`, `promptId`, `promptVersion`, `durationMs`, `success`, `validationStatus`, `fallbackUsed`, `errorCode`. It never logs a student's name, email, the raw prompt, the raw response, or any credential -- proven by a dedicated test (`tests/unit/ai-gateway.test.ts`) that feeds secret-shaped content through the gateway and asserts none of it appears in the logged line.

An explicit, opt-in-only `logAIDebugRaw()` exists for local development, gated behind `STUDYUS_AI_DEBUG_RAW=1` (absent by default everywhere, including local dev) -- no call site in the app currently invokes it.

## Execution metadata and provenance

`AIProvenance` (`{ aiExecutionId, aiProvider, aiModel, aiPromptId, aiPromptVersion }`) is the safe, DB-storable subset of execution metadata. Where a HIGH_RISK call's result already flows into `learning_evidence.metadata` (an existing, flexible `jsonb` column with no changed meaning), the migrated call sites attach it additively:

- Free-text quiz grading (`/api/quizzes/generate-and-take`, `/api/quizzes/verify`) -- `metadata.aiGrading` / the qualified-evidence `metadata.aiExecution`.
- Explain & Defend rubric evaluation and (when triggered) misconception classification (`/api/cognitive/explain/submit`) -- `metadata.aiExecution` / `metadata.misconceptionAiExecution`.
- Transfer response evaluation (`/api/cognitive/transfer/submit`) -- merged into the existing `transferDistance`/`assisted` metadata UPDATE.

No `learning_evidence` column was added or changed; provenance rides inside the existing `metadata` jsonb exactly the way `transferDistance`/`questionSemantics`/`assessmentConfidence` already do. See the audit report, section 11, for the exact list of evidence-producing paths that now carry provenance.

## What this phase deliberately defers to Phase 0E2

- **The persistent, queryable audit table** (`ai_execution_events` or equivalent) that would let a query answer "show me every AI execution behind this student's mastery history." This phase only produces the execution metadata and the additive `learning_evidence.metadata` provenance fields describe above -- no new table, no schema migration (Step 19).
- **Cross-engine decision auditability** -- linking an AI execution to a specific Learning Decision Engine / Adaptive Teaching Engine decision. Neither engine exists yet; this phase is infrastructure they will eventually sit on top of.
- **Consolidating the legacy parallel path** (`src/services/ai.service.ts`, used by `/api/concepts/extract`, `/api/quizzes/generate`, `src/lib/extract-text.ts`) with the newer, more complete `concept-extraction.service.ts` / `quiz-generation.service.ts`. Both paths are now migrated onto the same gateway and prompt registry, but they remain two separate implementations of overlapping capabilities -- a real consolidation is a deliberate, separately-tested future change, not something to do silently while building the transport layer.
- **Prompt quality improvements.** Every prompt registered at `v1` is the exact prompt already live before this phase.
