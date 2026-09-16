# CANON-R6 — PROVE v1: EXACT 10 INDEPENDENT ASSESSMENT

## STATUS

**CODE_PASS.** Full implementation, real-engine and source-audit tests, `tsc --noEmit`, the full `vitest` suite, and `npm run build` are all clean. **Not LIVE PASS** — this environment has zero live database, Preview, or AI-provider access. Nothing was pushed to `origin/main`, nothing was deployed, and no live database was touched at any point in this phase.

## CURRENT LIVE STATE (as reported by the user, not independently verified)

Real Preview fixture provided for this phase:

- `studentId: ec77cac5-841c-41cc-b959-af8ec69ccec5`
- `conceptId: 1fb2b93c-0909-4127-9854-a91379825661`
- A real canonical decision after a genuine 3/3 Practice v1 attempt: `stage=PROVE, actionState=EXECUTABLE, nextCanonicalAction=PROVE`, with `activityContract: { activityType: 'PROVE', itemCount: { min: 10, max: 10 }, difficulty: { target: 3, min: 3, max: 4 }, independence: true, supportLevel: 'NONE', minimumScorePercent: 80, evidenceContract: 'PROVE_NO_HINTS_NO_TUTOR_NO_WORKED_EXAMPLES' }`.

This is exactly the shape `verifyV1PracticeLaunchMarker` now produces (confirmed by unit test against the real engine using these fixture IDs — see `tests/unit/canon-r6-prove-v1-exact10-independent-assessment.test.ts`, "19-25 -- PERSISTENCE" block). The fix that unblocked this concept's PROVE readiness is `activity-launch-readiness.ts`'s PROVE case (previously `NOT_READY`, now `{ ready: true }`).

## LEGACY QUICK_CHECK SEPARATION

`quick_check`'s dedicated fast path (`generateQuickCheckQuestions`, `defaultMax: 6`) is byte-unchanged. `canonical_prove` is a wholly new, distinct `QuizMode` literal — it is never inferred from, aliased to, or dispatched through `quick_check`'s branch of the generation ternary in `generate-and-take/route.ts`. Verified by source audit (`tests/.../canon-r6-....test.ts`, "4/6 -- GENERATION MODE").

## PROVE AUTHORIZATION

`V1PracticeLaunchMarker` (kept, generalized in place per the phase's "do not over-generalize" instruction) now covers `canonicalActivityType: 'PRACTICE' | 'REINFORCE' | 'PROVE'`, with 3 new fields: `independence: boolean`, `supportLevel: 'ASSISTED' | 'NONE'`, `minimumScorePercent: number`. For PROVE, `verifyV1PracticeLaunchMarker` builds the authorization directly from the fresh decision's own `activityContract` — never a second, duplicated constant. A new `requestedActivityType` (derived purely from the client's own `quizMode`, never a claim) gates which activity type may even be requested (`topic_practice` -> PRACTICE, `canonical_prove` -> PROVE, everything else -> `null`), and the final `v1Marker` is only honored when the FRESH decision's own `canonicalActivityType` matches what was requested — structurally preventing wrong-stage authorization (Part 25) without widening `verifyV1PracticeLaunchMarker`'s own signature.

A hard-fail guard exists specifically for `canonical_prove` (which, unlike `topic_practice`, has no legitimate legacy meaning): `if (validated.quizMode === 'canonical_prove' && !v1Marker)` -> `403 V1_PROVE_AUTHORIZATION_FAILED`.

## EXACT-10 GENERATION

`canonical_prove` is never a "fast path" mode — it structurally falls through to the SAME `generateGatedQuestionBatch` branch already used by `cumulative_assessment`/`exam_simulation`/`diagnostic_check`. That generator is an existing, unmodified "Universal Count Contract" implementation: one Luna attempt + one bounded Terra fallback, returning exactly `opts.count` accepted questions or `[]` — never a partial result. `maxQuestions` is forced to `v1Marker.itemCount.authorized` (10) before `perConceptCap`/`conceptIds` are resolved, so the forced count reaches the generator call. The route's pre-existing universal choke point (`questions.length > 0 && questions.length < maxQuestions` / `questions.length === 0`) still runs before `storeQuiz`, so a short-of-10 result is refused, never silently administered. A `canonical_prove`-specific reason, `V1_PROVE_GENERATION_INCOMPLETE`, is layered additively onto both of those pre-existing failure branches via a ternary keyed on `quizMode === 'canonical_prove'` — never a silent fallback to 6, never a relabel as legacy quick_check.

## NOVELTY

**Not implemented — see REMAINING BLOCKERS.** `generateGatedQuestionBatch` was audited directly (`grep` for `excludeQuestion`/`priorQuestion`/`history`/`novel` in `gated-question-generation.service.ts`) and has no mechanism today to exclude previously-seen questions or bias toward novel variants. Part 6 of the spec explicitly said Prove questions "should be new/novel where existing infrastructure supports it" — since no such infrastructure exists to reuse, and building new novelty/history-tracking infrastructure was outside this phase's firewall (no new AI/prompt logic beyond the one guidance string), this requirement is honestly left unaddressed rather than fabricated as satisfied.

## DIFFICULTY

Server-derived only. `v1EffectiveDifficulty` (`= v1Marker.difficulty.target`, 3 for the frozen Prove policy) is read FIRST in every generation call site's difficulty expression (`v1EffectiveDifficulty ?? validated.difficulty ?? resolvedDifficulty?.level ?? 3`), including the multi-concept `perConceptDifficulty` variable feeding the `canonical_prove` branch. The client's own `difficulty` param is structurally unreachable once `v1Marker` exists. Both authorized (`v1Marker.difficulty`) and actual (`bucket.actualDifficulty` at submission) difficulty are persisted; `checkV1ActivityContractCompliance` verifies the actual value falls within `[3, 4]`.

## INDEPENDENCE

Real, not merely recorded — enforced at the source, by reuse:

- `canonical_prove` maps to `ActivityType: 'SOLO_CHECK'` (`ACTIVITY_TYPE_BY_QUIZ_MODE`), which already carries `EvidenceMode: 'INDEPENDENT'` via `evidenceModeForActivity` (`activity-taxonomy.ts`) — the SAME derivation `quick_check` already uses, zero new code.
- `canUseAI({ evidenceMode, feature })` (`ai-permission-policy.ts`, unmodified) denies every `STUDENT_ASSISTANCE_FEATURES` entry (HINT, EXPLAIN, ASK_AI, SOLVE, REWRITE, IMPROVE_ANSWER, AUTOCOMPLETE, PRE_SUBMIT_CHECK) for any `evidenceMode !== 'PRACTICE'`.
- The quiz page's `coarseEvidenceModeForQuizMode` defaults any unrecognized mode to `INDEPENDENT` — `canonical_prove` was never added to `PRACTICE_EVIDENCE_MODES`, so it inherits this default automatically.
- `checkV1ActivityContractCompliance` gains optional `actualHintsUsed`/`actualAiAssistanceType` checks, enforced ONLY when `authorization.independence === true` — Practice's own compliance path (`independence` always `false`) is completely unaffected. This is defense-in-depth behind the source-level denial above, not the primary enforcement mechanism.

## HINT/TUTOR ENFORCEMENT

`/api/quizzes/hint` calls `canUseAI({ evidenceMode: quizSession.evidenceMode, feature: 'HINT' })` before doing anything else (unmodified). Since a `canonical_prove` session's persisted `evidence_mode` is `INDEPENDENT` (derived from `SOLO_CHECK`, per above), this call deterministically rejects every hint request for a trusted v1 Prove session — with zero new code in the hint route itself. The quiz page's `ContextualHelp` (Tutor) component is gated on `PRACTICE_EVIDENCE_MODES.includes(quizMode)`, which `canonical_prove` never satisfies, so Tutor is never rendered.

## SESSION PERSISTENCE

`session/start` returns READY (not `V1_PROVE_GENERATION_NOT_READY`) for PROVE/EXECUTABLE — `activity-launch-readiness.ts`'s PROVE case changed from a `NOT_READY` object to `{ ready: true }`, with the removed reason literal deleted from the `V1ActivityNotReadyReason` union entirely (so it can never silently reappear as a stale branch). `buildPracticeLaunch` selects the session-start launch mode via a new `v1QuizModeForActivityType` function (`'canonical_prove'` for PROVE, `'topic_practice'` otherwise) in `canonical-session-launch.ts`.

## SUBMISSION COMPLIANCE

At submission, `checkV1ActivityContractCompliance` is called with `authorization: quizSession.v1Marker!`, `actualItemCount: bucket.total`, `actualDifficulty`, `actualHintsUsed: hintsUsed`, and `actualAiAssistanceType` (derived from real telemetry) — before any v1 evidence stamping. A violation is recorded in `v1ContractViolation`/`canonicalResultsStatus: 'V1_ACTIVITY_CONTRACT_VIOLATION'`, never silently treated as compliant. Idempotency is unaffected: the pre-existing `quizSession.status === 'completed'` guard (unmodified, not mode-specific) still refuses a repeated submission of the same quiz before any new evidence write is attempted.

## EVIDENCE WRITE

When `v1Qualifies` (authorized AND contract-compliant), the v1 metadata stamp written into `learning_evidence.metadata` now also includes `canonicalActivityType: quizSession.v1Marker!.canonicalActivityType` alongside the existing `pedagogicalPolicyVersion`/`canonicalRevision`/`canonicalStage`/`itemCount`/`correctCount`/`scorePercent`/`difficulty`/`hintsUsed`/`aiAssistanceType`/`independence`/timestamp fields (all pre-existing from CANON-R5R1, unmodified in shape). CANON-R3's evidence adapter (`SOLO_CHECK -> 'PROVE'` PedagogicalActivityType mapping, `resolveIndependent` reading the real `hints_used`/`ai_assistance_type` DB columns) required zero changes — confirmed correct by direct source read, not merely assumed.

## PASS/FAIL SEMANTICS

Confirmed directly from the frozen, unmodified engine (`evidence-qualification.ts`'s PROVE case): `item.scorePercent < p.minimumScorePercent` (80) fails; the comparison is strict `<`, so exactly 80% (8/10) QUALIFIES and exactly 70% (7/10) DOES_NOT_QUALIFY — matching the spec's own worked example precisely. `item.itemCount !== p.itemCount` (10) returns `UNRESOLVED` regardless of score — a second, independent backstop behind the route's own contract-compliance check, in case a wrong-count row were ever persisted. `p.independenceRequired && !item.independent` returns `DOES_NOT_QUALIFY` unconditionally. All three confirmed by real-engine unit tests using `evaluateCanonicalLearningState` directly, unmocked.

## RETENTION WAIT

A qualifying PROVE pass moves `stage` to `RETAIN` with `actionState: WAITING` — confirmed via the real, unmocked engine (`tests/.../canon-r6-....test.ts`, "28"). The 3-day minimum wait itself is frozen, pre-existing Retention policy, untouched by this phase. A failed PROVE attempt returns `stage: 'PRACTICE'` via the engine's own pre-existing `PROVE_FAILURE_RETURN_TO_PRACTICE` rollback case (`engine.ts` line ~258, unmodified) — confirmed by real-engine test ("29"). The route itself contains no `stage = 'PRACTICE'`/`stage = 'RETAIN'` literal anywhere near the submission response construction (source audit) — it only writes evidence, then re-fetches a fresh canonical decision; the engine alone decides.

## RESULTS UI

A new block in `quiz/page.tsx`, gated on `results.canonicalResultsStatus === 'OK' && results.canonicalResults`, renders next-step copy purely from `canonicalResults.stage`/`actionState`/`nextEligibleAt`, checked in this priority order: `actionState === 'WAITING'` -> the existing, reused `conceptMission.noActionRetentionWaitingBody(WithDate)` copy (Prove pass, waiting on Retention); else `stage === 'PROVE'` -> `quiz.canonicalNextProve` ("Next: Prove", i.e. a Practice pass); else `stage === 'PRACTICE'` -> `quiz.canonicalNextPractice` ("Return to Practice", i.e. a Prove fail); else `stage === 'CONSOLIDATED'` -> `quiz.canonicalNextConsolidated`. A separate block, gated on `canonicalResultsStatus === 'V1_ACTIVITY_CONTRACT_VIOLATION'`, renders a neutral `quiz.canonicalContractViolation` message instead. Both blocks are placed additively before the existing `messageText` line, which remains completely unconditional and unchanged for every attempt (legacy and v1 alike). Legacy (non-v1) Results — where `canonicalResultsStatus` is neither of the two v1 values — render only the pre-existing `messageText`/milestone system, byte-unchanged.

## LEGACY COMPATIBILITY

`quick_check`'s `defaultMax: 6` and dedicated `generateQuickCheckQuestions` fast path are untouched. `topic_practice`'s own R5R1A server-derived override block (`maxQuestions = v1Marker.itemCount.authorized; v1EffectiveDifficulty = v1Marker.difficulty.target;`) is untouched and unaffected by the PROVE widening. All certified Practice v1 behavior (3-question contract, server-derived difficulty, assistance allowed, v1 evidence, progression to Prove) is re-verified green in the full regression run below.

## TESTS

New file: `tests/unit/canon-r6-prove-v1-exact10-independent-assessment.test.ts` — 35 tests, covering:

- **AUTHORIZATION**: PROVE authorization built from the fresh decision's own contract (itemCount 10/10/10, difficulty 3-4, independence true, supportLevel NONE, minimumScorePercent 80); wrong-stage/contract-violation never compliant.
- **GENERATION**: `canonical_prove -> SOLO_CHECK` mapping; not a fast-path mode; falls through to `generateGatedQuestionBatch`; maxQuestions/difficulty forced from the authorization before per-concept resolution; the universal short-of-target guard still runs before `storeQuiz`; `V1_PROVE_GENERATION_INCOMPLETE` present exactly twice (insufficient + empty cases).
- **INDEPENDENCE**: `PRACTICE_EVIDENCE_MODES` never includes `canonical_prove`; `ContextualHelp` gated on that same list; `canUseAI`'s `evidenceMode === 'PRACTICE'` gate and `SOLO_CHECK: 'INDEPENDENT'` taxonomy entry; `checkV1ActivityContractCompliance`'s hints/assistance checks wired at the route's compliance call site.
- **PERSISTENCE**: a real fresh PROVE authorization end-to-end via `verifyV1PracticeLaunchMarker`; `storeQuiz`/`getQuizSession` round-trip of the widened marker's independence/supportLevel/minimumScorePercent fields; `canonicalActivityType` present in the evidence metadata stamp.
- **QUALIFICATION**: real-engine 8/10 (80%) QUALIFIES, 7/10 (70%) does not, wrong itemCount UNRESOLVED (never SATISFIED), non-independent never qualifies; pass -> RETAIN/WAITING; fail -> PRACTICE via the engine's own rollback; the route itself has no PRACTICE/RETAIN stage literal near the response.
- **RESULTS**: the canonical re-fetch gate (`v1Marker && v1Qualifies && conceptId`, unchanged from R5R1/R5R1A); the new UI block's `PROVE`/`PRACTICE`/`WAITING` branches; the contract-violation block; the untouched `messageText` line.
- **REGRESSION**: Practice's own override block untouched; `quick_check`'s fixed 6 untouched; LEARN_CHECK/RETENTION_CHECK/TRANSFER remain the only three `NOT_READY` reasons (PROVE was the one and only case widened this phase); firewall audit (no new import from `@/lib/ai/adapters` or a Quality Gate module; `CANONICAL_POLICY.prove` byte-identical to its CANON-R2R1 frozen shape).

Six pre-existing test files were updated to reflect the intentional PROVE-readiness change (not regressions): `canon-r5-canonical-decision-service.test.ts`, `canon-r5r1-v1-practice-launch-marker.test.ts`, `canon-r5r1-generate-and-take-wiring.test.ts`, `canon-r5r1a-contract-enforcement.test.ts`, `canon-r5r1b-zero-gap-authority-bypass.test.ts`, `lx9r6-canonical-quiz-generation-reliability.test.ts`, plus `canon-r5r1-quiz-session-v1-marker.test.ts`'s fixture widened with the 3 new marker fields.

## FULL REGRESSION

- `npx tsc --noEmit`: clean.
- `npx vitest run`: **249 test files, 4468 tests, all passing.**
- `npm run build`: clean, all routes compiled (including `/api/quizzes/generate-and-take`, `/api/quizzes/hint`, `/dashboard/quiz`).

## DB MIGRATION

**None required, none written.** The existing `canonical_activity_contract` JSONB column (added in CANON-R5R1A) already generalizes cleanly to carry Prove's authorization shape (`independence`, `supportLevel`, `minimumScorePercent` added as new keys within the existing JSON blob, not new columns). Confirmed by direct read of `storeQuiz`/`getQuizSession`'s (de)serialization logic and by a round-trip persistence unit test.

## PREVIEW LIVE PLAN (not executed — no live DB/Preview access in this environment)

1. **Launch**: `POST /api/learning/session/start` for the fixture (studentId, conceptId) -> expect `authority: CANONICAL_ENGINE_V1, stage: PROVE, actionState: EXECUTABLE`, launch URL using `mode=canonical_prove`.
2. **Generation**: `POST /api/quizzes/generate-and-take` with `v1Launch: true`, no client `maxQuestions`/`difficulty` -> expect exactly 10 questions, difficulty in [3,4], no client override taking effect even if forged.
3. **Persistence**: inspect the `quiz_sessions` row -> `quiz_mode = 'canonical_prove'`, `activity_type = 'SOLO_CHECK'`, `evidence_mode = 'INDEPENDENT'`, `canonical_activity_contract` containing `independence: true, supportLevel: 'NONE', minimumScorePercent: 80`.
4. **Hint rejection**: attempt `POST /api/quizzes/hint` mid-quiz -> expect a deterministic rejection (403/consistent with `canUseAI` denial), and confirm the quiz page renders no Tutor/hint UI.
5. **Pass -> RETAIN/WAITING**: answer 8/10 correctly, submit -> expect `canonicalResultsStatus: 'OK'`, `canonicalResults.stage: 'RETAIN'`, `actionState: 'WAITING'`, `nextEligibleAt` ≈ submission timestamp + 3 days; Results UI shows the retention-waiting copy.
6. **Fail -> PRACTICE (different concept, to avoid corrupting the validated pass case)**: on a second concept at the identical PROVE/EXECUTABLE starting state, answer 7/10 correctly, submit -> expect `canonicalResults.stage: 'PRACTICE'`; confirm a fresh `session/start` call now offers Practice again, and that a subsequent Practice pass generates a NEW Prove session (never reusing the failed attempt's question set).

## FILES CHANGED

Implementation:
- `src/lib/pedagogical-decision/activity-launch-readiness.ts`
- `src/lib/pedagogical-decision/canonical-session-launch.ts`
- `src/lib/pedagogical-decision/v1-practice-launch-marker.ts`
- `src/lib/pedagogical-decision/concept-mission-override.ts`
- `src/services/quiz-persistence.service.ts`
- `src/services/learner-model.service.ts`
- `src/app/api/quizzes/generate-and-take/route.ts`
- `src/app/dashboard/quiz/page.tsx`
- `src/lib/i18n/messages.ts`

Tests (updated for the intentional PROVE-readiness change):
- `tests/unit/canon-r5-canonical-decision-service.test.ts`
- `tests/unit/canon-r5r1-v1-practice-launch-marker.test.ts`
- `tests/unit/canon-r5r1-generate-and-take-wiring.test.ts`
- `tests/unit/canon-r5r1a-contract-enforcement.test.ts`
- `tests/unit/canon-r5r1b-zero-gap-authority-bypass.test.ts`
- `tests/unit/canon-r5r1-quiz-session-v1-marker.test.ts`
- `tests/unit/lx9r6-canonical-quiz-generation-reliability.test.ts`

Tests (new):
- `tests/unit/canon-r6-prove-v1-exact10-independent-assessment.test.ts`

## COMMITS

- `feat(canon-r6): PROVE v1 exact-10 independent assessment` — implementation + all test changes.
- This docs commit (report only).

## REMAINING BLOCKERS

1. **NOVELTY (Part 6) is not implemented.** `generateGatedQuestionBatch` has no existing question-history/novelty-exclusion mechanism to reuse, and building one was out of scope for this phase's firewall (no new AI/prompt logic beyond the isolated guidance-string change). Prove questions today are generated the same way any other `generateGatedQuestionBatch` consumer's questions are — fresh per call, but with no explicit exclusion of a student's prior Practice questions for the same concept. A future phase should audit whether `generateGatedQuestionBatch`'s own prompt/context already implicitly avoids repeats (it was not audited beyond a keyword search) and, if not, design an explicit history-exclusion mechanism.
2. **No live Preview execution occurred in this environment** (no live DB/AI access). The Preview Live Plan above is written but unexecuted; it should be run against the real fixture (`studentId: ec77cac5-841c-41cc-b959-af8ec69ccec5`, `conceptId: 1fb2b93c-0909-4127-9854-a91379825661`) before this is considered LIVE PASS.
3. Everything else in the required 40-item test matrix (Parts 1-40) is covered by source audit and/or real-engine unit tests, and the full regression suite is green with zero touch to the pedagogical engine, AI provider adapters, or migration recognition logic.
