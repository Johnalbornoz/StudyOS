# StudyUs Phase 1D — Behavioral Evidence: Response Time Telemetry

**Date**: 2026-09-01
**Scope**: Capture trustworthy-enough, non-invasive response-time telemetry for learning interactions, storable additively in `learning_evidence.metadata`, readable by the Digital Learning Twin as a raw behavioral observation. No schema change, no migration, no derived interpretation.
**Deployment status**: **NOT DEPLOYED.** Nothing in this phase has been committed, pushed, or deployed. Production HEAD remains `b0529f264a1cc64f95021179907c06fe80b6d5ed` (Phase 1C-P). Implementation and external architecture review happen before any commit; Phase 1E has not started.

---

## Phase 1D-R — Timing Quality Semantics Closure

External architecture review found one semantic inconsistency in this report's §13/§19 as originally written: they described the Twin reader's counting as "VALID/OUTLIER vs INVALID/CLOCK_SKEW," which is exactly correct for what the *original* implementation actually did — `readResponseTimingSignal` counted `VALID` **and** `OUTLIER` together into a single `validSampleCount`. That was flagged as dangerous: an `OUTLIER` is a real, preserved observation for transparency, but not necessarily an analytically usable one, and a future Phase 1E minimum-sample gate reading `validSampleCount` (or `quality.sampleSize`, which was derived from it) could have been satisfied by outliers alone.

**Original counting behavior** (verified by direct code inspection before any change, matching the report's original prose exactly): `entry.timingQuality === 'VALID' || entry.timingQuality === 'OUTLIER'` incremented one shared `validSampleCount`; only `INVALID`/`CLOCK_SKEW` went to `invalidSampleCount`. `quality.sampleSize` was set to that same combined `validSampleCount`.

**Final contract**: `ResponseTimingSignal` now exposes three mutually exclusive counts — `validSampleCount` (quality === `VALID` only), a new `outlierSampleCount` (quality === `OUTLIER` only, still visible in `recentObservations` for transparency), and `invalidSampleCount` (`INVALID`/`CLOCK_SKEW`, unchanged). `quality.sampleSize` now always equals the corrected `validSampleCount`. No storage change, no normalizer change, no capture-path change — this was a read-side interpretation correction only. Protected by a dedicated release-blocking test proving `9 VALID + 20 OUTLIER` produces `validSampleCount = 9`, not `29`, plus a full A–E quality-matrix test suite. Full detail: `docs/audits/STUDYUS_PHASE_1D_R_TIMING_QUALITY_CLOSURE.md`.

---

## 1. Executive Summary

**`RESPONSE_TIME_TELEMETRY = IMPLEMENTED`**

Response time is precisely defined (§3), normalized by one pure, fail-open helper (§4/§5), and captured at 4 of the 6 canonical evidence-writing paths: structured and free-text quiz answers, Verification, Explain & Defend, and Transfer (§9–§11). Two paths were deliberately not instrumented because they have no genuine presentation→submission lifecycle to measure (§1, §12/§13 in the interaction audit table). Timing is stored additively in `learning_evidence.metadata.behavior.responseTimes` — no new table, no new column, no migration — and merges safely alongside every existing metadata shape in the codebase (AI provenance, transfer distance, verification fields, quiz question semantics), proven by dedicated tests (§17). The Digital Learning Twin reads it back as a new `ConceptView.behavior.responseTiming` signal, read-only, tagged `BEHAVIOR_OBSERVATION` (§13/§18). A release-blocking regression test proves, against the real `updateMastery` function, that identical evidence produces an identical mastery/Knowledge-State/decision-event outcome whether or not timing metadata is present (§16). No FAST/SLOW/GUESS/FLUENT/STRUGGLE classification, Learning Velocity, Help Dependency, or any other derived interpretation was implemented — that is explicitly Phase 1E's work.

---

## 2. Pre-Implementation Interaction Audit

| Interaction | Presentation point | Submission point | Evidence point | Telemetry feasible? | Notes |
|---|---|---|---|---|---|
| Structured quiz answer (choice/matching/ordering/classification) | `quiz/page.tsx`'s per-question `useEffect([current, questions.length])` — fires exactly when a new question becomes the one on screen | `nextQuestion()` (encodes the answer for `current`, advances or triggers final submit) | `mastery.service.ts::updateMastery`, called once per concept-bucket from `POST /api/quizzes/generate-and-take` | **YES** | Multi-question, multi-concept quiz: evidence is aggregated per-concept, not per-question, so one evidence row can carry several questions' worth of timing (handled as an array, §7). |
| Free-text quiz answer (AI-graded) | Same as above | Same as above | Same `updateMastery` call, same route | **YES** | Client clock stops at `nextQuestion()`, before the server's AI grading call ever runs — never measures AI latency. |
| Verification answer | The verification card in `quiz/page.tsx`'s results screen, first rendered when `results.verificationNeeded` is set | `submitVerification(conceptId)` | `assessment-verification.service.ts::submitQualifiedAssessmentEvidence`, called from `POST /api/quizzes/verify` | **YES** | One verification question per concept, presented once, submitted once — a clean single-item lifecycle. |
| Explain & Defend | `cognitive/explain/page.tsx`: `phase` becomes `'answering'` right after the prompt is fetched | `submit()`, before the fetch fires | Same `updateMastery` call, from `POST /api/cognitive/explain/submit` | **YES** | Client clock stops before `evaluateExplanation`'s AI rubric call. |
| Transfer | `cognitive/transfer/page.tsx`: `phase` becomes `'answering'` right after the prompt is fetched | `submit()`, before the fetch fires | Same `updateMastery` call, plus a pre-existing follow-up `UPDATE ... metadata` merge, from `POST /api/cognitive/transfer/submit` | **YES** | Client clock stops before `evaluateTransferResponse`'s AI call; timing merges into the same pre-existing additive-UPDATE pattern this route already used for `transferDistance`/`aiExecution`. |
| Generic evidence recording (`POST /api/learning/record-evidence`) | *(none)* | *(none)* | Same `updateMastery` call | **NO** | No client-side caller exists anywhere in the app (`grep` found none) — no presentation point to measure from. Left completely uninstrumented; the route is unchanged. |
| Real school exam result (`exam-result.service.ts::recordExamResult`) | *(none — a form for reporting a past, real-world outcome)* | *(the form submission itself, but there is no "question" it answers)* | Same `updateMastery` call, called once per attributed concept | **NO** | Fundamentally not a live answerable item — a parent/student reports what already happened at school. Per Step 15, fabricating "response time" around a real-world after-the-fact report would misrepresent what was observed. Deliberately deferred/excluded, not instrumented. |

All 6 paths funnel through the same canonical writer, `mastery.service.ts::updateMastery` — confirmed by a fresh `grep` for its callers before implementation began (matches the count found in Phase 1C/1C-R's own audits of this file).

---

## 3. Response Time Definition

```
RESPONSE_TIME_MS = time from the first meaningful presentation of the
answerable item to the explicit student answer submission.
```

Excludes question generation time, server grading time, AI grading latency, database write latency, verification-generation latency, and page-load before the item becomes answerable. The clock starts only when the learner can actually see and answer the item — enforced by capturing the presentation timestamp at the exact UI transition where the question/prompt becomes interactive (§6), and the submission timestamp at the exact moment the student's explicit submit action fires, before any network request or AI call begins (§8).

---

## 4. Timing Contract

`src/lib/algorithms/response-timing.ts`:

```ts
interface BehavioralTimingInput { questionPresentedAt?: string | null; answerSubmittedAt?: string | null; }
interface ResponseTiming { responseTimeMs: number | null; quality: TimingQuality; }
type TimingQuality = 'VALID' | 'MISSING' | 'INVALID' | 'CLOCK_SKEW' | 'OUTLIER';
```

`normalizeResponseTiming(input)` is the single normalization function every writer calls. It is pure and cannot throw — every branch returns a normal `ResponseTiming`, never an exception (Step 23's fail-open requirement, verified by a dedicated adversarial-input test, §17/§19). Request schemas accept both timestamps as **loose optional strings** (not `z.string().datetime()`), specifically so a malformed timestamp degrades the `quality` label instead of failing Zod validation and blocking the whole request.

---

## 5. Timing Quality / Validation

| Condition | Quality | `responseTimeMs` |
|---|---|---|
| Either timestamp absent/null/empty | `MISSING` | `null` |
| Either timestamp unparseable (non-finite `Date.parse`) | `INVALID` | `null` |
| `answerSubmittedAt` before `questionPresentedAt` (negative duration) | `CLOCK_SKEW` | `null` |
| Duration exceeds `MAX_VALID_RESPONSE_TIME_MS` | `OUTLIER` | the raw duration (kept, not discarded) |
| Otherwise | `VALID` | the raw duration |

Invalid timing never blocks or rejects the answer — the learning interaction always completes; only the `quality` label reflects the problem (§17's malicious-input tests). `MAX_VALID_RESPONSE_TIME_MS = 2 hours`, chosen from actual product behavior discovered in §2: structured quiz questions are already bounded by the quiz session's own 45-minute TTL (`quiz-persistence.service.ts`), so 2 hours is generous well beyond any legitimate structured-quiz duration; single-item interactions with no session TTL (Explain & Defend, Transfer, Verification) have no hard product bound, so the ceiling is set generously enough to tolerate a real break without accepting a multi-day-stale timestamp as real thinking time. Not used pedagogically anywhere in this phase — only to tag a sample `OUTLIER`.

---

## 6. Presentation Lifecycle

Each instrumented UI captures the presentation timestamp exactly once, at the specific state transition where the item first becomes visible/answerable, using a `useRef` (never `useState`, so the write itself triggers no re-render and nothing resets it):

- **Quiz questions**: the pre-existing `useEffect(() => {...}, [current, questions.length])` that already resets per-question local UI state (choice selection, hint visibility, etc.) on every new question — a hint request, confidence pick, or validation error re-renders the page without changing `current`, so the guard `if (!questionPresentedAtRef.current[current])` never fires twice for the same question.
- **Verification**: a new `useEffect(() => {...}, [results])` stamps each `verificationNeeded` item's `conceptId` once, the first time it renders as part of the results screen.
- **Explain & Defend / Transfer**: stamped once, immediately after the prompt is fetched and `phase` becomes `'answering'`.

No timer resets from hints, AI assistance, confidence entry, or minor UI changes — verified by the guard conditions above and by the fact that none of those interactions change the dependency arrays the presentation effects key on.

---

## 7. Storage Contract

```ts
interface ResponseTimingEntry {
  responseTimeMs: number | null;
  timingQuality: 'VALID' | 'INVALID' | 'CLOCK_SKEW' | 'OUTLIER'; // never 'MISSING' -- see below
  questionIndex?: number; // only for multi-question writers
}
```

Stored at `learning_evidence.metadata.behavior.responseTimes: ResponseTimingEntry[]`. `MISSING` samples are never stored as an entry at all — no timing data is represented by the *absence* of an entry, never a null-filled placeholder (§10 data minimization, §14 old-evidence distinction). A structured/free-text quiz's per-concept evidence bucket can span multiple questions (quiz evidence is aggregated per concept, not per question — §2's key finding), so the array holds one entry per question in that bucket rather than forcing an artificial single aggregate value.

---

## 8. Canonical Evidence Integration

One reusable pair of helpers, used by every writer: `toResponseTimingEntries(samples)` turns one or more normalized `ResponseTiming` values into storable entries, and `withBehaviorMetadata(metadata, entries)` additively merges them onto an existing metadata object — emitting **nothing at all** when there are no usable entries, so a request with no timing produces byte-identical metadata to pre-Phase-1D behavior. No second Learning Evidence write path was created: every writer still calls the same `updateMastery` (or, for Transfer, the same pre-existing follow-up `UPDATE ... metadata` pattern that route already used for `transferDistance`/`aiExecution` before this phase).

---

## 9. Structured Answers

Instrumented in `POST /api/quizzes/generate-and-take`. `SubmitQuizSchema`'s per-answer schema gained two loose optional string fields (`questionPresentedAt`, `answerSubmittedAt`). Each answer is normalized in the same `validated.answers.map(...)` grading loop that already ran, carried through the per-concept `bucket.responseTimings` array (mirroring the existing `gradingConfidences`/`questionTypes`/`aiGrading` bucket fields), and merged into the concept's evidence metadata via `withBehaviorMetadata`. Grading, scoring, and mastery-update logic are completely untouched — proven by §16's mastery-invariant test.

---

## 10. Free-Text Answers

Same route and same instrumentation as §9 — `question.answerFormat === 'text'` answers are normalized identically, before `gradeAnswer`'s AI call runs. Client clock stops at `nextQuestion()`, strictly before the request is even sent, so no AI grading latency is ever included in the measured duration.

---

## 11. Verification

Instrumented. `VerifySchema` gained the same two loose optional fields; `POST /api/quizzes/verify` normalizes them once (before `gradeAnswer`'s AI call, same guarantee as free-text quiz answers) and passes the already-normalized `ResponseTiming` into `QualifiedEvidenceInput.responseTiming`, a new optional field on `assessment-verification.service.ts::submitQualifiedAssessmentEvidence`, which merges it additively into the same metadata object it already builds (`assessmentConfidence`, `verificationOutcome`, `aiExecution`, etc.) via `withBehaviorMetadata`. No change to variant generation, equivalence checking, trigger logic, grading, or resolution — `verification-triggers.ts` has zero diff this phase (confirmed by `git diff --stat`).

---

## 12. Explain / Transfer

Both instrumented, using the identical pattern (§6): a `presentedAtRef` stamped once the prompt is fetched, a submission timestamp captured at the top of `submit()` before the fetch. Explain & Defend merges `behavior` directly into `updateMastery`'s `metadata` param, alongside the existing `aiExecution`/`misconceptionAiExecution` fields. Transfer merges `behavior` into its pre-existing follow-up `UPDATE ... metadata` statement, alongside `transferDistance`/`assisted`/`aiExecution` — the same additive JSON-merge pattern that route already used before this phase, not a new write path. Neither activity was classified as an `ACTIVITY_DURATION_CANDIDATE`: both have a genuine single prompt → single response lifecycle comparable to a question, not a multi-page workflow or background-processing task.

---

## 13. Twin Integration

New sub-reader `readResponseTimingSignal` (`src/lib/learner-twin/readers.ts`) reads only from `learning_evidence.metadata` (no new table), issues a plain bounded `SELECT` (`rowLimit=20` rows scanned, `observationLimit=10` observations returned, most-recent-first), and performs zero writes — covered by the existing read-only-invariant static scan test that already covers the whole `readers.ts` file. Exposed as `ConceptView.behavior: { responseTiming: ResponseTimingSignal }`. `DecisionContext` gained **no** new field, per Step 16/Phase 1B's rule: raw timing never enters `DecisionContext` without a current decision consumer, and none exists in this phase.

---

## 14. Old Evidence / Missing Data

Existing `learning_evidence` rows predate Phase 1D and carry no `behavior` key at all — this is normal, not backfilled, not fabricated. `readResponseTimingSignal` treats a row with `metadata` but no `behavior.responseTimes` array (or no `metadata` at all) as contributing nothing, and a concept with zero timing-instrumented evidence reads back as an **empty** `ResponseTimingSignal` (`recentObservations: []`, `validSampleCount: 0`) — `NO_TIMING_DATA`, explicitly distinct from a fabricated `0ms` or an implied "fast," verified by a dedicated test (§17).

---

## 15. Privacy / Minimization

Stored: `responseTimeMs` (a duration in milliseconds) and `timingQuality` (an enum label), optionally `questionIndex` (an integer already present elsewhere in the same evidence's context). Never stored: keystrokes, intermediate drafts, mouse movement, focus history, full navigation history, the raw client presentation/submission timestamps themselves (only the derived duration persists — no debugging/traceability reason was found to justify keeping the raw timestamps), student PII, raw answer text, AI prompts/responses, browser fingerprints, or device identifiers. Confirmed by direct inspection of every write site added this phase — none of them touch any of the above.

---

## 16. Mastery Invariant Verification

`tests/unit/response-timing-mastery-invariant.test.ts` calls the real `updateMastery` (not a reimplementation) twice with an otherwise-identical input — once with `metadata.behavior` present, once without — and asserts: (1) the returned `MasteryUpdateResult` is identical; (2) the `UPDATE mastery_records` call (same SQL, same params) is identical; (3) the `INSERT INTO mastery_events` call is identical; (4) the recorded `MASTERY_UPDATED` decision-event (`reasonDetails`, `newState`) is identical; (5) `recalculateConceptKnowledgeState` is invoked with identical `(studentId, conceptId)` arguments; (6) the `INSERT INTO learning_evidence` call is identical in every parameter except the metadata JSON blob itself, which differs only by the added `behavior` key. All 6 assertions pass. This is the release-blocking proof required by Step 21.

---

## 17. Metadata Merge Verification

`tests/unit/response-timing-metadata-merge.test.ts` proves `behavior.responseTimes` coexists, without overwriting anything, alongside every existing metadata shape found in the codebase: AI grading provenance (Explain/Transfer), transfer metadata (`transferDistance`/`assisted`/`aiExecution`), assessment-verification metadata (`assessmentConfidence`/`verificationOutcome`/trigger IDs), and quiz question semantics + AI grading arrays. It also exercises the real `submitQualifiedAssessmentEvidence` with a mocked `updateMastery`, confirming the actual metadata object passed downstream carries both AI provenance and behavioral timing together, and that `behavior` is omitted entirely (not present as an empty/null placeholder) when no timing was supplied or when timing normalized to `MISSING`.

---

## 18. Invalid Input Handling

`tests/unit/response-timing.test.ts`'s `normalizeResponseTiming` suite directly exercises every case Step 23 lists: negative duration, NaN-like/non-date strings, far-future client timestamps (both directions), presentation-after-submission, extremely large durations, missing timestamps, and a battery of adversarial input shapes (oversized strings, `Infinity`/`-Infinity`, HTML injection attempts) — every one degrades to a `quality` label without throwing. Because the schema-level validation for every route is a loose `z.string().optional()` (not a strict datetime validator), none of these inputs can 400 the request on their own; the underlying learning interaction (grading, mastery update) always completes. `PRIMARY_LEARNING_OPERATION = SUCCESS`, `BEHAVIOR_TIMING = INVALID/OMITTED` in every case.

---

## 19. Tests Added / Modified

| File | Status | Tests | Covers |
|---|---|---|---|
| `tests/unit/response-timing.test.ts` | NEW | 20 | `normalizeResponseTiming` (VALID/MISSING/INVALID/CLOCK_SKEW/OUTLIER, boundary at the ceiling, adversarial input), `toResponseTimingEntries`, `withBehaviorMetadata`. |
| `tests/unit/response-timing-mastery-invariant.test.ts` | NEW | 6 | Step 21's release-blocking invariant against the real `updateMastery`. |
| `tests/unit/response-timing-metadata-merge.test.ts` | NEW | 8 | Step 22's metadata-coexistence proofs, including the real `submitQualifiedAssessmentEvidence`. |
| `tests/unit/learner-twin-response-timing.test.ts` | NEW | 7 | `readResponseTimingSignal` (flattening, bounding, VALID/OUTLIER vs INVALID/CLOCK_SKEW counting, NO_TIMING_DATA), `ConceptView.behavior.responseTiming` end-to-end read-only integration. |
| `tests/unit/learner-twin.test.ts` | MODIFIED | +0 (mock branch only) | New mock branch for `readResponseTimingSignal`'s query, so existing Phase 1C/1C-R fixtures keep passing unmodified. |
| `tests/unit/learner-twin-consumer-regression.test.ts` | MODIFIED | +0 (mock branch only) | Same. |

**41 new tests this phase** (20 + 6 + 8 + 7). Full suite: 806 tests across 73 files, all passing.

---

## 20. Architecture Regression Counts

```
RESPONSE_TIME_CAPTURE_PATHS       = 4   (structured+free-text quiz, verification, explain & defend, transfer)
LEARNING_EVIDENCE_TIMING_WRITERS  = 1 canonical path (mastery.service.ts::updateMastery's metadata param,
                                     via the shared toResponseTimingEntries/withBehaviorMetadata helpers) --
                                     Transfer's pre-existing additive-UPDATE pattern now also carries behavior,
                                     but that write path existed before Phase 1D; no second write path was created.
NEW_DB_TABLES                     = 0
NEW_DB_COLUMNS                    = 0
NEW_MIGRATIONS                    = 0
MASTERY_BEHAVIOR_CHANGES          = 0   (proven §16)
KNOWLEDGE_STATE_BEHAVIOR_CHANGES  = 0   (proven §16; knowledge-state.service.ts has zero diff)
VERIFICATION_TRIGGER_CHANGES      = 0   (verification-triggers.ts has zero diff)
NEW_DERIVED_BEHAVIOR_METRICS      = 0   (no FAST/SLOW/GUESS/FLUENT/STRUGGLE classification anywhere)
LEARNER_MODEL_DB_WRITES           = 0   (readResponseTimingSignal is a plain SELECT, covered by the existing read-only static scan)
```

---

## 21. Application Validation

```
npx tsc --noEmit     -> clean, 0 errors
npx vitest run       -> 73 test files passed (73), 806 tests passed (806)
npm run build        -> succeeded, full route manifest generated
npm run db:status    -> LEDGER = FOUND; 2 applied, 0 pending, 0 drifted
```

---

## 22. Production Baseline

Verified before implementation and again at completion: local `HEAD` = `b0529f264a1cc64f95021179907c06fe80b6d5ed` ("feat: establish canonical digital learning twin", Phase 1C-P), matching the last-verified production commit exactly. Nothing has been committed or pushed this phase. Per explicit instruction, Phase 1D is **not deployed** — implementation and external architecture review happen first.

---

## 23. Git Diff

**New** (5): `src/lib/algorithms/response-timing.ts`, `tests/unit/response-timing.test.ts`, `tests/unit/response-timing-mastery-invariant.test.ts`, `tests/unit/response-timing-metadata-merge.test.ts`, `tests/unit/learner-twin-response-timing.test.ts` — plus this report and the architecture-doc amendment.

**Modified** (13, tracked): `src/app/api/cognitive/explain/submit/route.ts`, `src/app/api/cognitive/transfer/submit/route.ts`, `src/app/api/quizzes/generate-and-take/route.ts`, `src/app/api/quizzes/verify/route.ts`, `src/app/dashboard/cognitive/explain/page.tsx`, `src/app/dashboard/cognitive/transfer/page.tsx`, `src/app/dashboard/quiz/page.tsx`, `src/lib/learner-twin/readers.ts`, `src/lib/learner-twin/service.ts`, `src/lib/learner-twin/types.ts`, `src/services/assessment-verification.service.ts`, `tests/unit/learner-twin-consumer-regression.test.ts`, `tests/unit/learner-twin.test.ts` — 294 insertions, 34 deletions.

`docs/architecture/digital-learning-twin.md` also amended with the new "Behavioral Evidence — Response Time" section (§30 requirement). No migration file. No change to `mastery.ts`, `knowledge-state.service.ts`, or `verification-triggers.ts` (all confirmed zero diff). No UI redesign — every client-side change is a `useRef` timestamp capture wired into an existing state transition, with zero visible/layout change.

(Two untracked local files predate this phase and are out of its scope, unrelated to Phase 1D: `docs/audits/STUDYUS_PHASE_0G_PRODUCTION_ALIGNMENT.md` and `docs/audits/STUDYUS_PHASE_1C_P_PRODUCTION_RELEASE.md`.)

---

## 24. Remaining Risks (max 5)

1. **A concept's evidence bucket in a multi-question quiz can carry an unbounded-in-principle number of `responseTimes` entries** (bounded in practice only by `maxQuestions`, itself capped at 20 per the route's own generation ceiling) — not a real minimization concern today, but worth a small explicit cap on `bucket.responseTimings` if `maxQuestions` is ever raised significantly in a future phase.
2. **`readResponseTimingSignal`'s `rowLimit=20` window can under-represent `validSampleCount` for a concept with many small evidence rows** (each carrying only 1 observation) if more than 20 evidence rows exist — the reader reports what it saw in the scanned window honestly, but a caller reading `validSampleCount` alone (without noting the window) could slightly undercount true historical sample size. Not a correctness bug (nothing is fabricated), but a documented scanning-window limitation.
3. **The 2-hour `MAX_VALID_RESPONSE_TIME_MS` ceiling is a single global constant**, not tuned per interaction type (a 45-minute-TTL-bounded quiz question vs. an untimed Explain & Defend prompt) — chosen deliberately generous and simple for this phase; a future phase could justify a tighter, per-feature ceiling once real distributions are observed.
4. **No production traffic has exercised any of these paths yet** — all verification here is against unit fixtures and the real (mocked-DB) `updateMastery`/`submitQualifiedAssessmentEvidence` functions, not a staging/production smoke test, per the explicit no-deploy constraint.
5. **Client clocks are inherently untrustworthy and this phase does not attempt server-side corroboration** beyond the quality classification itself (Step 6's documented limitation) — a determined actor could still submit a plausible-looking but fabricated `VALID` duration. Acceptable for Phase 1D's stated purpose (observational, non-decision-affecting telemetry) but a genuine limit on how much confidence any future Phase 1E derivation can place in a single sample without corroborating signals.

---

## 25. Definition of Done

- [x] response time precisely defined
- [x] client presentation point identified
- [x] canonical normalization exists
- [x] timing stored in learning_evidence metadata
- [x] old evidence remains valid
- [x] structured answers supported where applicable
- [x] free-text answers supported where applicable
- [x] verification assessed/instrumented or explicitly deferred
- [x] Explain/Transfer assessed honestly
- [x] Digital Twin can read timing signal
- [x] invalid timing cannot block learning
- [x] no raw surveillance data stored
- [x] mastery unchanged
- [x] Knowledge State unchanged
- [x] Verification triggers unchanged
- [x] no schema change
- [x] no migration
- [x] tests pass
- [x] build passes

---

## 26. Final Decision

**A. Is response-time telemetry implemented end to end?** **YES** — capture (client) → normalize (server, one pure helper) → store (additive metadata, canonical writer) → read (Digital Twin sub-reader) is complete for 4 of 6 evidence-writing paths, with the remaining 2 explicitly and correctly excluded (no genuine presentation lifecycle exists for either).

**B. Does response time influence correctness or mastery?** **NO** — proven by the release-blocking invariant test (§16) against the real `updateMastery`.

**C. Is timing persisted through the canonical Learning Evidence pipeline?** **YES** — every writer uses the same shared normalize→entries→merge helper and the same `updateMastery`/pre-existing additive-UPDATE writes; no second write path was created.

**D. Does the Digital Learning Twin expose the behavioral signal?** **YES** — `ConceptView.behavior.responseTiming`, read-only, `BEHAVIOR_OBSERVATION`-tagged, bounded, honest about `NO_TIMING_DATA`.

**E. Were any DB tables/columns added?** **NO** — `db:status` unchanged (2 applied, 0 pending, 0 drifted).

**F. Were any new derived behavioral interpretations implemented?** **NO** — no FAST/SLOW/GUESS/FLUENT/STRUGGLE label, no Learning Velocity/Help Dependency/Persistence/Productive-Struggle score exists anywhere in this diff.

**G. Can old evidence without timing coexist safely?** **YES** — verified directly by test (§14/§17): rows with no `behavior` key contribute nothing and never fabricate a duration.

**H. Is Phase 1D ready to certify?** **YES_WITH_CONDITIONS** — functionally complete and fully tested; conditioned on external architecture review before commit/deploy, per the explicit instruction governing this phase, and on the 5 documented, non-blocking risks in §24.

**I. Maximum five issues entering Phase 1E.** See §24 (5 listed): unbounded-in-principle per-bucket entry count (practically capped), the reader's scanning-window sample-size limitation, the single global outlier ceiling, no production-traffic verification yet, and the inherent untrustworthiness of unverified client clocks.
