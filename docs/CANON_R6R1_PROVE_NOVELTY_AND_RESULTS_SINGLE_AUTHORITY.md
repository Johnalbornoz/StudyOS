# CANON-R6R1 — PROVE EXACT-DUPLICATE NOVELTY + RESULTS SINGLE AUTHORITY

## STATUS

**CODE_PASS.** Both open CANON-R6 blockers are closed with surgical, minimum-scope fixes. `tsc --noEmit`, the full `vitest` suite, and `npm run build` are all clean. **Not LIVE PASS** — this environment has no live database/Preview access. Nothing pushed to `origin/main`, nothing deployed, no live database touched.

## R6 BLOCKERS

1. PROVE did not prevent exact repetition of a question already seen during the qualifying Practice attempt(s). **Closed** — see NOVELTY SCOPE / GENERATION FILTER below.
2. Results UI rendered canonical next-step copy AND the legacy `messageText` next-step line for v1 attempts, leaving two visual authorities. **Closed** — see RESULTS SINGLE AUTHORITY below.

## NOVELTY SCOPE

Deliberately MINIMUM: **exact-duplicate exclusion only.** A question is non-novel if its normalized fingerprint byte-matches a previously administered qualifying-Practice question for the same (student, concept), or another question already accepted earlier in the same Prove batch. No embeddings, no similarity model, no paraphrase detection — confirmed by a source-audit test that strips comments from `src/lib/lx/exact-duplicate-novelty.ts` and asserts the remaining code contains no `cosine`/`paraphrase`/`embedding`/`similarity` token, and that the module exports exactly its three documented functions.

## PRIOR QUESTION SOURCE

The REAL, previously-administered question text, not a re-derivation from `learning_evidence` score rows (which never carry question text). A new function, `loadPriorPracticeQuestionFingerprints(studentId, conceptId)` in `quiz-persistence.service.ts`, queries:

```sql
SELECT questions FROM quiz_sessions
WHERE student_id = $1
  AND quiz_mode = 'topic_practice'
  AND pedagogical_policy_version IS NOT NULL
  AND $2::uuid = ANY(concept_ids)
```

`pedagogical_policy_version IS NOT NULL` restricts this to v1-authorized Practice sessions (legacy pre-v1 rows carry no comparable authorization to compare against). Per the phase's own Part 3 guidance, this conservatively excludes **every** prior v1 Practice question for the (student, concept) pair rather than isolating only the single attempt that currently satisfies canonical PRACTICE — the schema has no such per-row marker, and excluding more than strictly necessary is the safer fallback the spec explicitly permits. Each returned row's questions are further filtered by `question.conceptId === conceptId` before fingerprinting, so a question belonging to an unrelated concept swept in by `concept_ids` (a multi-concept row) is never excluded.

## FINGERPRINT RULE

`normalizeQuestionForExactNovelty(text)`: Unicode-normalize (NFKC), trim, collapse internal whitespace runs, lowercase. Nothing else — mathematical symbols and all other punctuation are left untouched, since this is exact-duplicate detection, not semantic novelty.

`fingerprintQuestion(question)` normalizes `question.question` only — the one field every `GeneratedQuestion` type populates as "the actual prompt shown to the learner" (including structured types: `fill_blank`'s own type contract documents `question` as holding the prose prompt, with `blankTemplate` only the display template). `matchingPairs`/`orderingItems`/`classificationItems`/`correctAnswer` are answer-shape metadata, not the visible prompt, and are deliberately excluded; volatile fields (`id`, `askConfidence`) are never included either.

## GENERATION FILTER

For `canonical_prove` only, inserted between the existing question-generation call and the pre-existing "short of `maxQuestions`" choke point in `generate-and-take/route.ts`:

1. Load prior-Practice fingerprints (`loadPriorPracticeQuestionFingerprints`).
2. `filterExactDuplicates(candidates, excludeFingerprints)` — a pure function that rejects a candidate whose fingerprint is already in `excludeFingerprints`, and simultaneously deduplicates *within* `candidates` itself (an intra-batch repeat is rejected on its second occurrence). Returns `{ accepted, rejectedCount, fingerprints }`, where `fingerprints` is the input set plus every fingerprint just accepted.
3. `excludeFingerprints` is reassigned to that returned `fingerprints` set before any refill, so a later batch is checked against **both** prior Practice **and** every Prove question already accepted so far.

## REFILL STRATEGY

If accepted count is short of `maxQuestions` (10) and the retry budget isn't exhausted, request exactly the missing slots (`needed = maxQuestions - accepted.length`) from the SAME `generateGatedQuestionBatch` generator already used for the initial batch (Part 6's "reuse existing retry/fallback mechanics," never new generation infrastructure), then re-filter the new candidates against the carried-forward `excludeFingerprints`. Repeat until either `accepted.length >= maxQuestions` or the retry budget is exhausted.

## RETRY BUDGET

`MAX_NOVELTY_REFILL_ATTEMPTS = 2` — a hard-coded, bounded constant. This means at most 3 total calls to `generateGatedQuestionBatch` for one Prove generation request (the initial batch + at most 2 refills). Never an unbounded loop; documented inline at the constant's declaration.

## FAILURE MODE

Unchanged from CANON-R6: if the loop exits with `accepted.length < maxQuestions`, `questions` is set to that short array, which then falls straight into the **pre-existing, unmodified** universal choke point (`questions.length > 0 && questions.length < maxQuestions` / `questions.length === 0`) — both already return the Prove-specific `V1_PROVE_GENERATION_INCOMPLETE` reason code (unchanged, still exactly 2 occurrences in the route) before `storeQuiz` is ever called. No new failure path was invented for the novelty case; it reuses the exact same fail-closed guard CANON-R6 already established. This structurally guarantees Part 11's "no session should have been persisted as valid Prove" with zero additional runtime check: an under-novel batch can never reach `storeQuiz`.

## NOVELTY DIAGNOSTICS

`QuizSessionV1Marker` gained an additive, optional `novelty` field: `{ priorPracticeFingerprintCount, rejectedExactDuplicateCount, acceptedNovelQuestionCount, noveltyPolicy: 'EXACT_DUPLICATE_EXCLUSION_V1' }`. Computed only for `canonical_prove`, then merged into a NEW object (`v1MarkerToPersist = { ...v1Marker, novelty: noveltyDiagnostics }`) built right before the `storeQuiz` call — the original `v1Marker` (used for authorization/difficulty/count throughout generation) is never mutated. `storeQuiz` serializes it into the existing `canonical_activity_contract` JSONB (`novelty: v1Marker.novelty ?? undefined`, omitted entirely when absent); `getQuizSession` reads it back as `contract.novelty ?? null`. No full prior-question text is ever persisted — counts only.

## RESULTS SINGLE AUTHORITY

`quiz/page.tsx` now computes `const isV1Result = results.canonicalResultsStatus !== 'NOT_V1';` and gates the legacy next-step line on it: `{!isV1Result && <p>{messageText}</p>}`. Since `canonicalResultsStatus` defaults to `'NOT_V1'` and is only ever reassigned inside the v1-authorized branch (unchanged route logic), this suppresses `messageText` for exactly the three v1-specific statuses (`OK`, `V1_ACTIVITY_CONTRACT_VIOLATION`, `CANONICAL_RESULTS_UNAVAILABLE`) and renders it exactly as before for every legacy (non-v1) attempt. The factual score/correct/incorrect outcome card is unconditional — it is declared and rendered before `isV1Result` is even referenced in JSX, and is never itself wrapped in an `isV1Result` conditional.

## CANONICAL_RESULTS_UNAVAILABLE

Previously produced by the backend (CANON-R5R1's re-fetch failure path) but never rendered distinctly in the UI — it fell through to showing only the legacy `messageText`, silently reintroducing a second/wrong authority exactly when the canonical one was unavailable. Now renders a dedicated, neutral block (`quiz.canonicalResultsUnavailable`, new i18n key added to all 5 locales: es/en/de/fr/pt) saying the next step is temporarily unavailable — never legacy progression copy, never an invented stage — while the factual score card above it still shows the real attempt outcome.

## LEGACY COMPATIBILITY

- `quick_check` untouched: still `defaultMax: 6`, its own dedicated fast path, and its `QUIZ_MODE_CONFIG` entry carries no novelty-related text (source-audited).
- `topic_practice`/`review` generation call sites never reference `loadPriorPracticeQuestionFingerprints` or `filterExactDuplicates` (source-audited) — Practice generation is byte-identical to before this phase.
- A legacy (`NOT_V1`) Results attempt renders `messageText` exactly as before — unaffected by the `isV1Result` gate.
- The one guidance-string addition (an "avoid repeating previously seen questions" sentence) is scoped to the `canonical_prove` entry of `QUIZ_MODE_CONFIG` only; no other entry was touched.

## TESTS

New file: `tests/unit/canon-r6r1-prove-novelty-and-results-single-authority.test.ts` — 39 tests covering the full Part 18/19 matrix:

- **Normalization/fingerprint (1-4, 18)**: deterministic; whitespace-only and case-only differences normalize equal; materially different text stays different; no similarity/embedding code (comment-stripped source audit); fingerprint reads only `question.question`.
- **Filtering (7-9)**: exact prior-Practice duplicate rejected; intra-batch duplicate rejected (first occurrence kept); 10 genuinely distinct candidates all accepted; pure (no mutation); returns an updated fingerprint set for chaining.
- **DB loader (5-6)**: loads real fingerprints scoped to (student, concept) via a real (mocked) `db.query` call, asserting the actual SQL text; a different concept's question within the same row is excluded; empty history returns an empty Set.
- **Generation flow (10-14, 17)**: novelty block runs only for `canonical_prove`, before the pre-existing choke point; bounded `MAX_NOVELTY_REFILL_ATTEMPTS = 2`; refill requests exactly the missing slots; `excludeFingerprints` carried forward across refills; loop exit conditions; diagnostics computed and merged into `v1MarkerToPersist` without mutating `v1Marker`; the SAME pre-existing `V1_PROVE_GENERATION_INCOMPLETE` reason is reused (still exactly 2 occurrences).
- **Guidance isolation (9)**: the "do not repeat" sentence is scoped to the `canonical_prove` config entry only.
- **Regression (15-16)**: `quick_check`'s fixed 6/fast path/no-novelty-tag; `topic_practice`/`review` call sites never reference the new novelty functions; novelty filtering is structurally unreachable outside `canonical_prove`.
- **Results (19-24, 29)**: `isV1Result` derived purely from `canonicalResultsStatus`; `messageText` gated on `!isV1Result` for all three v1 statuses; a legacy attempt still shows it; the score card is unconditional and precedes every v1-specific block; the new `CANONICAL_RESULTS_UNAVAILABLE` block renders the neutral message and never legacy-next-step copy; the `canonicalResults`-driven block never reads `results.results.score`/`correctCount`.
- **Stage copy (25-28)**: PRACTICE/PROVE/RETAIN+WAITING/CONSOLIDATED copy all still wired, unbroken by the single-authority change.
- **Firewall**: no new import from `@/lib/pedagogical-engine`, `@/lib/ai/adapters`, or `@/lib/pedagogical-migration` in the route or the new novelty module; `retention_check`'s generation call site has no novelty reference.

Three pre-existing test files were updated for the intentional `v1Marker` → `v1MarkerToPersist` rename at the `storeQuiz` call site (a source-audit regex needed updating, not a behavior regression): `canon-r5r1-generate-and-take-wiring.test.ts`, `canon-r5r1b-zero-gap-authority-bypass.test.ts`, and `canon-r5r1-quiz-session-v1-marker.test.ts` (whose `FULL_MARKER` fixture gained an explicit `novelty: null` to match the now-always-present round-tripped field). The CANON-R6 test file's own persistence test was extended with a second case covering the `novelty: null` backward-compat path for a hypothetical pre-R6R1 Prove row.

## FULL REGRESSION

- `npx tsc --noEmit`: clean.
- `npx vitest run`: **250 test files, 4508 tests, all passing.**
- `npm run build`: clean, all routes compiled.

## DB IMPACT

**None. No new migration.** The existing `canonical_activity_contract` JSONB column (added CANON-R5R1A) already generalizes cleanly to carry the additive `novelty` diagnostics object — confirmed by a round-trip persistence test. No new column, no new table.

## PREVIEW LIVE PLAN (not executed — no live DB/Preview access in this environment)

Using the real fixture (`studentId: ec77cac5-841c-41cc-b959-af8ec69ccec5`, `conceptId: 1fb2b93c-0909-4127-9854-a91379825661`, currently PROVE/EXECUTABLE after a real 3/3 Practice v1 attempt):

- **A. Launch**: `session/start` → PROVE / READY / `canonical_prove` (unchanged from CANON-R6).
- **B. Generate**: `POST /api/quizzes/generate-and-take` with `v1Launch: true` → expect exactly 10 questions.
- **C. Compare with prior Practice**: fetch the prior 3-question Practice `quiz_sessions` row for this (student, concept), normalize each question's text with the same rule, and confirm none of the 10 Prove questions' normalized fingerprints match any of the 3 Practice fingerprints. Also inspect the persisted Prove row's `canonical_activity_contract.novelty` — expect `priorPracticeFingerprintCount: 3`, `acceptedNovelQuestionCount: 10`, and `rejectedExactDuplicateCount` reflecting whatever the live generator actually produced as duplicates (0 in the ordinary case).
- **D. UI**: confirm no hint/Tutor controls render during the Prove attempt (unchanged from CANON-R6, not re-verified live here).
- **E. Results**: submit and complete the attempt; confirm the Results page renders ONLY the canonical next-step block (or the contract-violation/unavailable block, depending on outcome) — never the legacy `messageText` line alongside it.

Semantic novelty is explicitly NOT certified by this plan or this phase.

## FILES CHANGED

Implementation:
- `src/lib/lx/exact-duplicate-novelty.ts` (new)
- `src/services/quiz-persistence.service.ts`
- `src/app/api/quizzes/generate-and-take/route.ts`
- `src/app/dashboard/quiz/page.tsx`
- `src/lib/i18n/messages.ts`

Tests (updated for the intentional `v1Marker` → `v1MarkerToPersist` rename):
- `tests/unit/canon-r5r1-generate-and-take-wiring.test.ts`
- `tests/unit/canon-r5r1-quiz-session-v1-marker.test.ts`
- `tests/unit/canon-r5r1b-zero-gap-authority-bypass.test.ts`
- `tests/unit/canon-r6-prove-v1-exact10-independent-assessment.test.ts` (persistence test extended)

Tests (new):
- `tests/unit/canon-r6r1-prove-novelty-and-results-single-authority.test.ts`

## COMMITS

- `fix(canon-r6r1): PROVE exact-duplicate novelty + Results single authority` — implementation + all test changes.
- This docs commit (report only).

## REMAINING BLOCKERS

1. **No live Preview execution occurred** (no live DB/AI access in this environment). The Preview Live Plan above is written but unexecuted against the real fixture.
2. **Semantic novelty remains explicitly out of scope**, as directed — a Prove question that is a close paraphrase (not an exact text match) of a prior Practice question is NOT detected or excluded by this phase, by design. If the product ever needs that guarantee, it requires a genuinely new capability (embeddings/similarity scoring) deliberately deferred here.
3. Everything else in the required test matrix (Parts 1-29) is covered by real unit tests and/or source audit, and the full regression suite is green with zero touch to the pedagogical engine, AI provider adapters, migration recognition logic, cache architecture, or Retention/Transfer/Learn Check generation.
