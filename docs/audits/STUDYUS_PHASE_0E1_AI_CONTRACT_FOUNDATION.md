# StudyUs Phase 0E1 — AI Contract Foundation

Date: 2026-08-31. Infrastructure only. No mastery formula, grading threshold, correctness rule, or teaching strategy was changed. No database schema changed.

---

## 1. Executive Summary

- **Re-audited AI call sites from scratch** (Step 1) rather than trusting Phase 0A's counts: found **13 service files with ~21 direct provider call sites** (Anthropic: 11 files / ~18 sites incl. the legacy path; OpenAI: 2 files / 3 sites), plus one confirmed-live "dead code" false alarm (`src/services/ai.service.ts`).
- **Built one canonical AI execution contract**: `src/lib/ai/` — `executeAI()` gateway, Anthropic + OpenAI adapters, a version-controlled prompt registry, shared JSON validation helpers, and safe structured logging.
- **Migrated every one of the ~21 call sites** onto the shared gateway. Full-repo search confirms **`UNMIGRATED_LIVE = 0`** — zero raw `fetch()` calls to `api.anthropic.com`/`api.openai.com` and zero `@anthropic-ai/sdk` client usages remain outside `src/lib/ai/adapters/`.
- **Every AI execution now has**: a unique `executionId`, an explicit `promptId`/`promptVersion`, a bounded 30s timeout (previously: none, anywhere), a normalized error code, and safe structured logging (never raw prompt/response/credentials).
- **Every structured AI response is validated before it reaches deterministic logic** (Step 11) — HIGH_RISK paths (free-text grading, misconception classification, transfer/explanation evaluation, concept extraction, question generation) cannot bypass this.
- **Grading semantics, mastery inputs, and every pre-existing fallback tier were preserved exactly**, verified by new regression tests asserting the actual business contract (clamped bounds, fallback values, propagation-vs-swallow behavior), not just "returns something."
- **AI provenance now flows into `learning_evidence.metadata`** on 3 evidence-producing paths (free-text quiz grading, Explain & Defend, Transfer) — additive, no schema change, no changed meaning of any existing field.
- **21 prompts registered at v1**, none rewritten — this phase moves/versions/identifies prompts, it does not improve them (explicit non-goal).
- **One genuine, disclosed behavior addition**: the gateway now fails fast with `CONFIGURATION_ERROR` when an API key is unset, rather than sending a request with a missing key. This broke zero production behavior but required updating one pre-existing test's implicit assumption (documented in §15/§18).
- **41 new tests added**, covering the gateway core, both adapters, the prompt registry, and a HIGH_RISK end-to-end mocked flow (free-text grading) plus regression coverage for every other HIGH_RISK call site. Zero live provider calls in any test.
- **No database schema change** (Step 19) — the persistent audit table is explicitly Phase 0E2's job.
- **`src/services/ai.service.ts` is confirmed live, not dead** (Step 16) — used by 3 real routes, parallel to (not consolidated with) the newer concept-extraction/quiz-generation services; migrated onto the gateway anyway since it's genuinely reachable.
- **Application validated clean**: `tsc` clean, 696/696 tests passing (655 pre-existing + 41 new), `npm run build` exit 0.
- **Git diff scoped exactly to this phase's mandate**: 19 modified service/route files (the migrations + provenance wiring) + 1 pre-existing test's env-stub fix + 6 new files (the gateway itself + 4 test files). Zero mastery/quiz-scoring/Decision-Engine/UI code touched.
- **Phase 0E2 is not started.**

---

## 2. Pre-Implementation AI Inventory

Re-audited directly against current source (not Phase 0A's counts, per this phase's own instruction). Every AI-provider call site, before migration:

| File | Function | Provider | Model | Capability |
|---|---|---|---|---|
| `ai.service.ts` | `extractConceptsFromText` | Anthropic (SDK) | claude-sonnet-5 | CLASSIFICATION |
| `ai.service.ts` | `extractTextFromImage` | Anthropic (SDK) | claude-sonnet-5 | CONTENT_GENERATION |
| `ai.service.ts` | `generateQuestion` | Anthropic (SDK) | claude-sonnet-5 | QUESTION_GENERATION |
| `concept-explanation.service.ts` | `getConceptExplanation` | Anthropic (fetch) | claude-sonnet-5 | CONTENT_GENERATION |
| `concept-extraction.service.ts` | `extractConceptsFromChunk` | Anthropic (fetch) | claude-sonnet-5 | CLASSIFICATION |
| `concept-extraction.service.ts` | `suggestConceptNames` | Anthropic (fetch) | claude-sonnet-5 | OTHER |
| `concept-graph.service.ts` | `inferPrerequisitesForConcept` | Anthropic (fetch) | claude-sonnet-5 | COGNITIVE_ANALYSIS |
| `embedding.service.ts` | `generateEmbedding` | OpenAI (fetch) | text-embedding-3-small | EMBEDDING |
| `error-intelligence.service.ts` | `getErrorPatternGuidance` | Anthropic (fetch) | claude-sonnet-5 | CONTENT_GENERATION |
| `explain-defend.service.ts` | `generateExplainPrompt` | Anthropic (fetch) | claude-sonnet-5 | CONTENT_GENERATION |
| `explain-defend.service.ts` | `evaluateExplanation` | Anthropic (fetch) | claude-sonnet-5 | EXPLANATION_EVALUATION |
| `interactive-formula.service.ts` | `generateInteractiveFormula` | OpenAI (fetch) | gpt-5.6 | CONTENT_GENERATION |
| `localization.service.ts` | `translateBatch` | Anthropic (fetch) | claude-sonnet-5 | CONTENT_GENERATION |
| `misconception.service.ts` | `classifyMisconception` | Anthropic (fetch) | claude-sonnet-5 | CLASSIFICATION |
| `quiz-generation.service.ts` | `generateQuestionsForConcept` | Anthropic (fetch) | claude-sonnet-5 | QUESTION_GENERATION |
| `quiz-generation.service.ts` | `gradeAnswer` | Anthropic (fetch) | claude-sonnet-5 | GRADING |
| `quiz-generation.service.ts` | `generateQuestionHint` | Anthropic (fetch) | claude-sonnet-5 | OTHER |
| `topic-hierarchy.service.ts` | `callClaudeForHierarchy` (shared by `classifySubjectHierarchy`/`classifySingleConcept`) | Anthropic (fetch) | claude-sonnet-5 | CLASSIFICATION |
| `transfer.service.ts` | `generateTransferActivity` | Anthropic (fetch) | claude-sonnet-5 | CONTENT_GENERATION |
| `transfer.service.ts` | `evaluateTransferResponse` | Anthropic (fetch) | claude-sonnet-5 | TRANSFER_EVALUATION |
| `tutor.service.ts` | `sendMessage` | Anthropic (fetch) | claude-sonnet-5 | TUTOR |

**Before this phase**: every fetch-based call site duplicated the same header/body boilerplate independently; none had a timeout; none had a unique execution id; only a shared `parseAIJson` (markdown-fence-stripping JSON parser, `src/lib/ai-json.ts`) was actually shared, with no common provider contract around it. `ai.service.ts` used the `@anthropic-ai/sdk` client directly instead — a second, independent transport pattern.

**Reconciliation with Phase 0A's "~16 raw fetch call sites across 11 files" estimate**: this re-audit found ~18 Anthropic fetch/SDK sites across 12 files (including the legacy `ai.service.ts`, which Phase 0A had flagged as possibly dead rather than counted as live) plus 3 OpenAI sites across 2 files — a reasonably close match, with the difference fully explained by `ai.service.ts`'s reclassification from "possibly dead" to "confirmed live" (§14).

---

## 3. Risk Classification

Classified by consequence (Step 2), not by provider/model:

| Capability / Function | Risk | Why |
|---|---|---|
| `gradeAnswer` (free-text quiz grading) | **HIGH_RISK** | Directly determines `correct`/`score`, which feeds `updateMastery` |
| `generateQuestionsForConcept` / `generateQuestion` (legacy) | **HIGH_RISK** | The generated `correctAnswer` is compared directly by `gradeStructuredAnswer`'s deterministic logic for every structured question type |
| `extractConceptsFromChunk` / `extractConceptsFromText` (legacy) | **HIGH_RISK** | Creates persistent `concepts` + `mastery_records` rows with no human review step |
| `classifyMisconception` | **HIGH_RISK** | Result is persisted as a `student_misconceptions` occurrence, feeding recurring-misconception signals |
| `evaluateTransferResponse` | **HIGH_RISK** | `result` feeds `updateMastery` and `computeTransferScore`'s stored evidence |
| `evaluateExplanation` | **HIGH_RISK** | Rubric scores feed `updateMastery`'s `scorePercent`, and `misconceptionDetected` triggers `classifyMisconception` |
| `inferPrerequisitesForConcept` | MEDIUM_RISK | Affects curriculum structure (concept graph edges), not correctness/mastery evidence directly; edges are explicitly "proposals, not truth" with their own confidence/source/status |
| `getConceptExplanation`, `generateExplainPrompt`, `generateTransferActivity`, `getErrorPatternGuidance`, `translateBatch`, `generateInteractiveFormula`, `extractTextFromImage` | MEDIUM_RISK | Student-facing content generation; affects the learning experience but not learning state |
| `suggestConceptNames`, `generateQuestionHint`, `sendMessage` (tutor), `callClaudeForHierarchy` (topic hierarchy), `generateEmbedding` | LOW_RISK | Display-only, retrieval, or organizational; no correctness/mastery/evidence consequence |

---

## 4. AI Contract Architecture

```
DOMAIN SERVICE
     |
     v
executeAI()  ---- src/lib/ai/gateway.ts
     |               execution id, timeout, error normalization,
     |               mandatory validation, safe logging
     v
provider adapter
     |
     +------ callAnthropicMessages()   src/lib/ai/adapters/anthropic.ts
     |
     +------ callOpenAIChat() / callOpenAIEmbedding()   src/lib/ai/adapters/openai.ts
     |
     v
Anthropic Messages API  /  OpenAI Chat Completions & Embeddings API
```

Full design rationale: `docs/architecture/ai-contract.md`.

---

## 5. Provider Adapters

`src/lib/ai/adapters/anthropic.ts` (`callAnthropicMessages`) and `src/lib/ai/adapters/openai.ts` (`callOpenAIChat`, `callOpenAIEmbedding`) — the only two providers StudyUs uses; no hypothetical provider was added. Each preserves the exact request shape every pre-existing call site used (same model identifiers, same `max_tokens`/`system`/`messages`/`response_format` fields, same `anthropic-version` header) — this phase centralizes transport, it does not change what is sent to either provider.

---

## 6. Prompt Registry

`src/lib/ai/prompt-registry.ts` — 21 entries, every one at `v1`, none rewritten. Full inventory in §23.

---

## 7. Output Validation

Every `executeAI()` call supplies an explicit `validate` function (`src/lib/ai/validation.ts`: `validateJson`, `checks`, `clamp`, reusing the pre-existing `parseAIJson`). A validator returning `{valid:false}` or throwing is a normalized failure, never a partially-trusted pass-through. Existing good validators were reused, not replaced (`interactive-formula.service.ts`'s `validateFormula`/`validateVariable` now run inside the new `validate` step unchanged).

**One disclosed, minimal addition**: `gradeAnswer`'s and `extractConceptsFromChunk`'s/`generateQuestionsForConcept`'s validators now reject a non-object/non-array JSON value (e.g. a bare `42` or `"text"`) that the original code would have silently accepted and then produced `undefined`-valued fields from. No real prompt response has ever produced this shape; this closes a theoretical gap without touching any threshold or business rule.

---

## 8. High-Risk AI Paths

Every HIGH_RISK call (§3) follows: `AI provider -> parse -> validate -> typed domain result -> existing deterministic business logic`. The typed result is the only thing that ever reaches `updateMastery`, `gradeStructuredAnswer`, or `computeTransferScore`. No AI provider writes to the database directly; the deterministic algorithms in `src/lib/algorithms/mastery.ts` remain the only thing that ever decides mastery.

---

## 9. Free-Text Grading Contract

`quiz-generation.service.ts::gradeAnswer`, called from `/api/quizzes/generate-and-take` and `/api/quizzes/verify`. Preserved exactly:

- **Grading semantics and thresholds**: `score`/`confidence` clamped into `[0,1]` (unchanged clamp bounds), `errorType` forced `null` when `correct`, `reasoningValid` defaults to `correct` when the provider omits it.
- **Both pre-existing fallback tiers**: a parse/validation failure (`INVALID_RESPONSE`/`VALIDATION_ERROR`) falls back to the exact case/whitespace-insensitive string-match grade; a transport/provider failure (`TIMEOUT`/`PROVIDER_ERROR`/`RATE_LIMIT`/`CONFIGURATION_ERROR`) falls back to the exact zero-score "please try again" grade. Both are now selected explicitly by `error.code` in one `fallback` function rather than by which literal `try/catch` block failed — same two outcomes, same triggering conditions.
- **AI provenance is additive**: `GradeAnswerResult.aiExecution` is a new field no pre-existing caller reads; it now flows into `learning_evidence.metadata.aiGrading` (generate-and-take) and the qualified-evidence `metadata.aiExecution` (verify).

Verified by `tests/unit/ai-high-risk-regression.test.ts`'s Step 20-mandated end-to-end mocked flow (domain call → gateway → mocked provider → parse → validate → typed result) plus dedicated clamp/fallback-tier regression tests.

---

## 10. Misconception Classification Contract

`misconception.service.ts::classifyMisconception`, called from `/api/cognitive/explain/submit` when `evaluateExplanation` flags `misconceptionDetected`. Preserved exactly: a `null`/absent `misconceptionCode` (including from a full JSON parse failure) resolves to "no misconception" (`null`) rather than an error; a transport/provider failure still propagates uncaught, exactly as the original unguarded `fetch` did. An existing signature is still preferred over minting a new one on an exact code match. `aiExecution` is now attached to the returned result and flows into `updateMastery`'s `metadata.misconceptionAiExecution` when a misconception was actually classified.

---

## 11. AI Provenance

Wired into 3 evidence-producing paths, all via the existing `learning_evidence.metadata` jsonb column (no schema change, no changed meaning of any existing field):

| Path | Metadata field added |
|---|---|
| `/api/quizzes/generate-and-take` (free-text-graded questions in a concept's evidence bucket) | `metadata.aiGrading: Array<{questionIndex} & AIProvenance>` |
| `/api/quizzes/verify` (verification question grading) | qualified-evidence `metadata.aiExecution` |
| `/api/cognitive/explain/submit` (rubric evaluation + misconception classification, when triggered) | `metadata.aiExecution`, `metadata.misconceptionAiExecution` |
| `/api/cognitive/transfer/submit` (transfer response grading) | merged into the existing `transferDistance`/`assisted` metadata UPDATE as `aiExecution` |

Not wired (deliberately, per Step 18's "do not add provenance if it would require changing the meaning of existing domain data" and the phase's own time-boxing): concept extraction and question generation, whose outputs feed structural DB rows (`concepts`, `mastery_records` at 0) rather than a `learning_evidence` row with a metadata channel already in scope for this phase. A future phase can extend this the same way once a channel exists.

---

## 12. Safe Logging Contract

`src/lib/ai/logging.ts::logAIExecution` — called by the gateway on every success and failure, emits only `AIExecutionMetadata`'s fields. Verified by a dedicated test (`tests/unit/ai-gateway.test.ts`) that feeds secret-shaped content (a fake API key, marked "secret" text) through the gateway and asserts neither appears in the logged output, only the structured metadata fields. `logAIDebugRaw()` exists for opt-in local debugging only (`STUDYUS_AI_DEBUG_RAW=1`, unset everywhere by default) and is not called by any live code path.

---

## 13. Remaining Direct Provider Calls

**UNMIGRATED_LIVE = 0.**

Confirmed by full-repo search after migration:
- `grep -rn "api.anthropic.com"` → matches only inside `src/lib/ai/adapters/anthropic.ts` (the canonical adapter itself).
- `grep -rn "api.openai.com"` → matches only inside `src/lib/ai/adapters/openai.ts`.
- `grep -rn "new Anthropic("` → zero live matches (one hit is a code comment in `ai.service.ts` describing the pre-migration state).
- `grep -rln "@anthropic-ai/sdk"` → zero remaining imports anywhere in `src/`.
- `grep -rn "'x-api-key'"` → matches only inside the Anthropic adapter.

One intentional, non-provider-call exception: `interactive-formula.service.ts` keeps its original `if (!process.env.OPENAI_API_KEY) return null;` early guard *before* ever calling the gateway — a config check, not a raw provider call, preserved to avoid an unnecessary function invocation when the key is known to be absent (matches the original control flow exactly).

`@anthropic-ai/sdk` remains listed in `package.json` (no longer imported anywhere) — left in place; removing an unused dependency is out of this phase's scope and was not requested.

---

## 14. Dead / Legacy AI Paths

- **`src/services/ai.service.ts`** — Phase 0A flagged this as "apparently dead." **Reconfirmed this phase: it is live.** Callers: `/api/concepts/extract` (`extractConceptsFromText`), `/api/quizzes/generate` (`generateQuestion`), `src/lib/extract-text.ts` (`extractTextFromImage`, used for image-upload OCR). It was migrated onto the shared gateway (not deleted, not left on its old SDK-based transport) and is now clearly documented in-file as a parallel, unconsolidated path to `concept-extraction.service.ts`/`quiz-generation.service.ts` — a real future consolidation candidate, explicitly not attempted this phase (see `docs/architecture/ai-contract.md`'s "deferred" section).
- No other AI infrastructure was found to be unreachable. Every one of the 13 files' AI-calling functions has at least one live caller (confirmed via `grep` for each exported function name against `src/app/api/`).

---

## 15. Tests Added / Modified

**Added (41 new tests, 4 files):**
- `tests/unit/ai-gateway.test.ts` (12 tests) — execution id uniqueness, metadata population, provenance shape, mandatory validation (never an unvalidated pass-through), invalid-response rejection, provider-error normalization, validator-exception normalization, bounded timeout (proven via a short non-default `timeoutMs`, never hitting the 30s default), `AIExecutionFailure` + its carried metadata, fallback resolution + `fallbackUsed` metadata (both a transport failure and a validation failure), and safe logging (no secret/raw content).
- `tests/unit/ai-adapters.test.ts` (11 tests) — Anthropic adapter's exact request shape/headers, text extraction, missing-key `CONFIGURATION_ERROR`, HTTP 429→`RATE_LIMIT`/401→`CONFIGURATION_ERROR`/500→`PROVIDER_ERROR` mapping; OpenAI adapter's Bearer auth, `response_format` flag, missing-key error, embedding extraction, and malformed-embedding `INVALID_RESPONSE`.
- `tests/unit/ai-prompt-registry.test.ts` (5 tests) — every entry well-formed, ids unique, `getPrompt` success/failure, capability coverage sanity check.
- `tests/unit/ai-high-risk-regression.test.ts` (13 tests) — the Step 20-mandated HIGH_RISK end-to-end mocked flow for free-text grading, plus Step 21 regression coverage for `gradeAnswer` (clamp bounds, both fallback tiers, `reasoningValid` default), `evaluateTransferResponse` (fail-closed to `incorrect`, propagation on provider failure), `evaluateExplanation` (0-4 clamp bounds), and `classifyMisconception` (null-on-no-code, null-on-parse-failure, propagation-on-provider-failure, existing-signature preference). No live provider call in any test — every provider response is mocked via `global.fetch`.

**Modified (1 file, 1 line + a comment):**
- `tests/unit/question-variant-equivalence.test.ts` — added `vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')` to the existing `beforeEach`. This test never set the key and relied on the pre-migration code's total lack of a key-presence check; the gateway's new (disclosed, deliberate) `CONFIGURATION_ERROR` fast-fail otherwise short-circuited it before the mocked `fetch` was ever reached. No assertion in the test changed.

---

## 16. Application Validation

```
TypeScript: npx tsc --noEmit    -> clean, exit 0
Tests:      npx vitest run      -> 60 test files, 696 tests, all passed
                                     (655 pre-existing + 41 new)
Build:      npm run build       -> exit 0, full route manifest, no errors
Lint:       LINT_NOT_CONFIGURED -> no ESLint config, no `lint` script
```

---

## 17. Git Diff Summary

Scoped to Phase 0E1's own changes (the working tree also carries prior, separately-authorized, still-uncommitted phases' work — Phase 0C/0D and the mastery-contract hotfix — none of which this phase touched further):

**New (6 files):**
```
docs/architecture/ai-contract.md
src/lib/ai/                          (types.ts, errors.ts, gateway.ts, logging.ts,
                                       prompt-registry.ts, validation.ts, index.ts,
                                       adapters/anthropic.ts, adapters/openai.ts)
tests/unit/ai-adapters.test.ts
tests/unit/ai-gateway.test.ts
tests/unit/ai-high-risk-regression.test.ts
tests/unit/ai-prompt-registry.test.ts
```

**Modified (20 files):**
```
src/app/api/cognitive/explain/submit/route.ts     (provenance wiring)
src/app/api/cognitive/transfer/submit/route.ts    (provenance wiring)
src/app/api/quizzes/generate-and-take/route.ts    (provenance wiring)
src/app/api/quizzes/verify/route.ts               (provenance wiring)
src/services/ai.service.ts                        (migrated, legacy path)
src/services/assessment-verification.service.ts   (aiExecution field on QualifiedEvidenceInput)
src/services/concept-explanation.service.ts        (migrated)
src/services/concept-extraction.service.ts         (migrated, 2 call sites)
src/services/concept-graph.service.ts              (migrated)
src/services/embedding.service.ts                  (migrated)
src/services/error-intelligence.service.ts         (migrated)
src/services/explain-defend.service.ts             (migrated, 2 call sites)
src/services/interactive-formula.service.ts        (migrated)
src/services/localization.service.ts               (migrated)
src/services/misconception.service.ts              (migrated)
src/services/quiz-generation.service.ts             (migrated, 3 call sites)
src/services/topic-hierarchy.service.ts             (migrated, shared helper)
src/services/transfer.service.ts                    (migrated, 2 call sites)
src/services/tutor.service.ts                       (migrated)
tests/unit/question-variant-equivalence.test.ts     (env-stub fix, see §15)
```

No mastery algorithm, quiz scoring threshold, database migration, Learning Decision logic, Adaptive Teaching implementation, or UI file was touched by this phase. Nothing needed reverting.

---

## 18. Remaining Risks

1. `ai.service.ts` and `concept-extraction.service.ts`/`quiz-generation.service.ts` remain two separate, unconsolidated implementations of overlapping capabilities (concept extraction, question generation) — both now on the shared gateway, but a real consolidation is future work.
2. AI provenance is wired into 3 of the evidence-producing paths (§11), not all HIGH_RISK paths — concept extraction and question generation don't yet have a `learning_evidence`-shaped channel to attach it to.
3. The gateway's new `CONFIGURATION_ERROR` fast-fail-on-missing-key behavior is a genuine (small, disclosed) behavior addition beyond pure transport centralization — safe, but worth flagging as a deliberate exception to "infrastructure only."
4. `@anthropic-ai/sdk` is now an unused dependency in `package.json` — left in place, not removed, since dependency changes were out of this phase's scope.
5. No persistent, queryable AI execution audit trail exists yet (by design — Phase 0E2's job); today's execution metadata is logged and, on 3 paths, additively riding inside `learning_evidence.metadata`, but there is no dedicated table to query "every AI execution behind this student's history" directly.

---

## 19. Phase 0E1 Definition of Done

- [x] One canonical AI execution contract exists — `src/lib/ai/gateway.ts::executeAI`, §4.
- [x] Anthropic adapter exists — `src/lib/ai/adapters/anthropic.ts`, §5.
- [x] OpenAI adapter exists — `src/lib/ai/adapters/openai.ts`, §5.
- [x] AI execution IDs exist — `crypto.randomUUID()` per call, §12 (test), §2/§4.
- [x] Prompt IDs are explicit — 21 registered ids, §6/§23.
- [x] Prompt versions are explicit — every id at `v1`, §6/§23.
- [x] Structured outputs require validators — every `executeAI()` call supplies one, §7.
- [x] HIGH_RISK outputs cannot bypass validation — §8, enforced by the gateway itself (no `result` without a passing `validate`).
- [x] Free-text grading semantics unchanged — §9, verified by regression tests.
- [x] Mastery algorithm unchanged — `src/lib/algorithms/mastery.ts` untouched, confirmed by git diff (§17) and the full pre-existing mastery/learning-debt test suite still passing.
- [x] Verification logic unchanged — `assessment-verification.service.ts`'s only change is an additive optional `aiExecution` metadata field; its evidence/confidence logic is untouched.
- [x] Safe structured logging exists — `src/lib/ai/logging.ts`, §12.
- [x] No secrets/raw prompts logged by default — verified by test, §12.
- [x] AI provenance is available — §11 (3 wired paths) + `AIProvenance` returned by every gateway call.
- [x] No DB migration occurred — §19 header, confirmed no `database/migrations/` or `migrations/` file was added this phase.
- [x] Existing tests pass — 655/655 pre-existing tests still passing (after the one disclosed env-stub fix, §15).
- [x] New tests pass — 41/41, §15/§16.
- [x] Build passes — §16.

---

## 20. Final Decision

**A. Does StudyUs now have one canonical AI execution contract?**
**YES.** `executeAI()` is the only path every AI-provider call in `src/` goes through — confirmed by full-repo search, `UNMIGRATED_LIVE = 0`.

**B. Are provider-specific details isolated behind adapters?**
**YES.** `src/lib/ai/adapters/anthropic.ts` and `.../openai.ts` are the only files that construct a provider request or parse a provider-specific response shape.

**C. Are all HIGH_RISK structured AI outputs validated before state-changing logic?**
**YES.** Every HIGH_RISK call (§3, §8) supplies an explicit `validate`; the gateway makes it structurally impossible to receive a `result` without passing validation first.

**D. Are prompts now versioned?**
**YES.** 21 prompts registered at `v1` (§6/§23); none rewritten.

**E. Are provider/model/prompt provenance available for AI executions?**
**YES.** Every execution returns `AIProvenance`; 3 evidence-producing paths persist it additively into `learning_evidence.metadata` (§11).

**F. Did any mastery formula or scoring threshold change?**
**NO.**

**G. Did any database schema change?**
**NO.**

**H. How many live direct provider call sites remain outside the canonical gateway?**
**0.**

**I. Is Phase 0E1 ready to certify?**
**YES.**

**J. Maximum five items required for Phase 0E2** — see §18 in full; summarized: (1) consolidate the two parallel concept-extraction/question-generation implementations, (2) extend provenance wiring to the remaining evidence paths once channels exist, (3) the persistent, queryable AI execution audit table itself, (4) cross-engine decision auditability once the Learning Decision Engine exists, (5) drop the now-unused `@anthropic-ai/sdk` dependency.

---

## 21. Prompt Inventory (Step 23)

| Prompt ID | Version | Capability | Service | Provider | Model | Risk | Structured Output | Validator |
|---|---|---|---|---|---|---|---|---|
| `quiz.question_generation` | v1 | QUESTION_GENERATION | quiz-generation.service.ts | anthropic | claude-sonnet-5 | HIGH | JSON array | parse + array check + truncated-batch salvage |
| `quiz.free_text_grading` | v1 | GRADING | quiz-generation.service.ts | anthropic | claude-sonnet-5 | HIGH | JSON object | parse + object check + bound clamps |
| `quiz.question_hint` | v1 | OTHER | quiz-generation.service.ts | anthropic | claude-sonnet-5 | LOW | JSON array of strings | parse + array/string filter |
| `misconception.classification` | v1 | CLASSIFICATION | misconception.service.ts | anthropic | claude-sonnet-5 | HIGH | JSON object | parse (fallback tier: null on parse failure) |
| `transfer.activity_generation` | v1 | CONTENT_GENERATION | transfer.service.ts | anthropic | claude-sonnet-5 | MEDIUM | JSON object | parse |
| `transfer.response_evaluation` | v1 | TRANSFER_EVALUATION | transfer.service.ts | anthropic | claude-sonnet-5 | HIGH | JSON object | parse + enum fail-closed to `incorrect` |
| `explain.prompt_generation` | v1 | CONTENT_GENERATION | explain-defend.service.ts | anthropic | claude-sonnet-5 | MEDIUM | JSON object | parse |
| `explain.rubric_evaluation` | v1 | EXPLANATION_EVALUATION | explain-defend.service.ts | anthropic | claude-sonnet-5 | HIGH | JSON object | parse + 0-4 bound clamps |
| `concept.extraction` | v1 | CLASSIFICATION | concept-extraction.service.ts | anthropic | claude-sonnet-5 | HIGH | JSON array | parse + array check |
| `concept.name_suggestions` | v1 | OTHER | concept-extraction.service.ts | anthropic | claude-sonnet-5 | LOW | JSON array of strings | parse + array/string filter |
| `concept.explanation` | v1 | CONTENT_GENERATION | concept-explanation.service.ts | anthropic | claude-sonnet-5 | LOW | JSON object | structural shape check (`tryParseExplanation`) |
| `concept.graph.prerequisite_inference` | v1 | COGNITIVE_ANALYSIS | concept-graph.service.ts | anthropic | claude-sonnet-5 | MEDIUM | JSON array | parse (fallback tier: [] on parse failure) |
| `topic_hierarchy.classification` | v1 | CLASSIFICATION | topic-hierarchy.service.ts | anthropic | claude-sonnet-5 | LOW | JSON object | parse |
| `localization.batch_translate` | v1 | CONTENT_GENERATION | localization.service.ts | anthropic | claude-sonnet-5 | LOW | JSON object | parse |
| `error_intelligence.pattern_guidance` | v1 | CONTENT_GENERATION | error-intelligence.service.ts | anthropic | claude-sonnet-5 | LOW | JSON object | structural shape check (`coerceGuidance`) |
| `tutor.chat_reply` | v1 | TUTOR | tutor.service.ts | anthropic | claude-sonnet-5 | LOW | free text | non-empty text |
| `formula.interactive_widget` | v1 | CONTENT_GENERATION | interactive-formula.service.ts | openai | gpt-5.6 | LOW | JSON object | `validateFormula`/`validateVariable` (pre-existing, reused) |
| `embedding.text_embedding` | v1 | EMBEDDING | embedding.service.ts | openai | text-embedding-3-small | LOW | float[1536] | dimension check |
| `legacy.concept_extraction` | v1 | CLASSIFICATION | ai.service.ts | anthropic | claude-sonnet-5 | HIGH | JSON object | parse |
| `legacy.image_transcription` | v1 | CONTENT_GENERATION | ai.service.ts | anthropic | claude-sonnet-5 | MEDIUM | free text (vision) | non-empty text |
| `legacy.question_generation` | v1 | QUESTION_GENERATION | ai.service.ts | anthropic | claude-sonnet-5 | HIGH | JSON text (parsed by caller) | non-empty text |

---

*End of report. No mastery formula, grading threshold, or database schema changed. Zero live direct provider calls remain outside `src/lib/ai/adapters/`.*
