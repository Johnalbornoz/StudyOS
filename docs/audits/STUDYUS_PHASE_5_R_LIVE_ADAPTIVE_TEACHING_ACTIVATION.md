# StudyUs Phase 5-R — Live Adaptive Teaching Activation

## 1. Executive Summary

External review found one structural release blocker in Phase 5: `TeachingIntent`
was computed and certified but consumed by nothing student-facing. This
remediation closes it by wiring the canonical `TeachingIntent` into
**three** real production content generators, adding a deterministic
stop/fading boundary to the one surface that needed one, and proving —
at the actual deterministic prompt/context layer, not by trusting AI
wording — that the student now receives materially different
instruction for materially different cognitive reasons.

**LIVE_TEACHING_INTENT_CONSUMERS = 3**

| Surface | File | Live student-facing path |
|---|---|---|
| A — Concept teaching | `tutor.service.ts::sendMessage` | `/api/tutor/message` → Tutor chat |
| B — Practice hints | `quiz-generation.service.ts::generateQuestionHint` | `/api/quizzes/hint` → PRACTICE quiz hint button |
| C — Remediation EXPLAIN step | `explain-defend.service.ts::generateExplainPrompt` | `/api/cognitive/explain/generate` → a remediation path's EXPLAIN step |

Remediation's LEARN/GUIDED_PRACTICE steps are **not** a fourth surface —
`remediationStepHref` (unchanged) already routes them to the same
`/dashboard/quiz?mode=topic_practice` flow as ordinary PRACTICE, so
wiring surface B covers them for free (the "prefer one canonical
generator over duplicating logic" instruction, applied).

A fourth candidate — `concept-explanation.service.ts::getConceptExplanation`
— was deliberately **not** wired; see §3 for why (a genuine, freshly-
found architectural incompatibility, not an oversight).

## 2. Fresh Live-Consumer Audit (S1)

| Generator | Live caller(s) | LearningDecision available? | student/subject/concept available? | Evidence Mode | Grounding |
|---|---|---|---|---|---|
| `tutor.service.ts::sendMessage` | `/api/tutor/message` | No (computed via new bounded bridge, §4) | Yes (studentId, conceptId optional; subjectId from conversation row) | N/A — conversational, not evidence-collecting (see §9 risk) | `rag.service::retrieveContext`, unchanged |
| `quiz-generation.service.ts::generateQuestionHint` | `/api/quizzes/hint` | No (bounded bridge) | Yes (quizSession has all 3) | Gated to `PRACTICE` only by the pre-existing `canUseAI` check | None (hints don't retrieve source material — pre-existing, unchanged) |
| `explain-defend.service.ts::generateExplainPrompt` | `/api/cognitive/explain/generate` | No (bounded bridge) | Yes | `PRACTICE`-shaped (submit route's `telemetry.learningMode: 'COACH'`, confirmed by fresh audit of `/api/cognitive/explain/submit`) | `rag.service::retrieveContext`, unchanged |
| `concept-explanation.service.ts::getConceptExplanation` | `/api/concepts/[id]/explanation` (reached from free concept browsing, `AddConceptTab`/`ConceptList` — **not** a Decision-Engine-driven surface at all) | Would require the bounded bridge, same as the others | Yes | N/A, display-only | `rag.service::retrieveContext`, unchanged |
| `error-intelligence.service.ts::getErrorPatternGuidance` | `/api/learning-debt/error-guidance` | No natural per-concept decision (keyed by error TYPE across a subject, not one concept) | Partial (no single conceptId — `topConceptId` only) | N/A, display-only | `rag.service::retrieveContext`, unchanged |
| `remediation.service.ts` | (step sequencer only, no AI generation of its own) | N/A | N/A | N/A | N/A |

## 3. Why `concept-explanation.service.ts` was NOT selected (fresh finding, not in the Phase 5 report)

`getConceptExplanation` caches its result in `concept_explanations`,
keyed **only** by `(concept_id, language)` — confirmed by its own SQL
(`WHERE concept_id = $1 AND language = $2`, `ON CONFLICT (concept_id, language)`).
This cache is **shared across every student** studying that concept.
Making its content depend on a per-student `TeachingIntent` (e.g. one
student's specific misconception code) would either corrupt the shared
cache (leaking one student's misconception-targeted content to
everyone else who opens that concept) or require bypassing the cache
whenever adaptive teaching applies, defeating its purpose. This is a
genuine architectural incompatibility, not a scope-avoidance choice —
disclosed exactly because the task's S1 explicitly asks not to rely on
assumptions. Surface A (Tutor chat) was chosen instead: it is
per-conversation, never cached, and already had the exact reconciliation
hook (`buildCompactTutorContext`) the task anticipates. See §19 R1.

## 4. The Live-Consumer Bridge (S1/S19)

None of the three live surfaces has a `LearningDecision` sitting in
hand at request time (Executive Summary's audit). `adaptive-teaching.service.ts`
gained two new functions, reusing Phase 4 verbatim:

```ts
getBestLearningDecisionForConcept(studentId, conceptId)  // reuses getLearningDecisions(studentId) VERBATIM, filters to one concept
getTeachingIntentForConcept(studentId, conceptId, options)  // composes the above + getTeachingIntent; null when Phase 4 has no active decision
```

`null` is a first-class, tested outcome (never an error, never a
fabricated decision) — every wired call site falls back to its
pre-existing, unadapted (Phase-5-R-unaware) behavior when it sees
`null`, wrapped in `.catch(() => null)` so a transient DB hiccup in the
adaptive layer degrades to "no adaptive teaching this call," never to
"content generation fails."

**Query cost (S19):** `getBestLearningDecisionForConcept` issues
exactly one `getLearningDecisions` call — the same, already-shipped,
already-certified function Today's Plan/Next Best Action already use,
completely unmodified (proven: `tests/unit/adaptive-teaching-service.test.ts`
asserts `getLearningDecisionsMock` is called exactly once and `queryMock`
zero times by the bridge function itself). No new query shape is
introduced by this bridge. On top of that, `getTeachingIntent` adds its
pre-existing, certified cost from Phase 5: 1 `getDecisionContext` read
(bounded to the one concept) + 1 `LIMIT 5` provenance read. This phase
does not re-measure `getLearningDecisions`' own raw SQL query count
(that number was never pinned by a permanent regression test in any
prior phase, only observed ad hoc) — the honest claim here is "reuses
an unmodified, already-accepted cost," not a freshly-fabricated precise
figure.

## 5. Canonical Content-Generation Contract (S4)

New, pure file: [`src/lib/adaptive-teaching-generation.ts`](../../src/lib/adaptive-teaching-generation.ts).

```ts
type TeachingGenerationContext = Pick<TeachingIntent,
  'instructionalGoal' | 'primaryBarrier' | 'strategy' | 'supportLevel' |
  'explanationDepth' | 'reasoningDemand' | 'misconceptionCodes' |
  'prerequisiteConceptIds' | 'avoidStrategies' | 'successCriteria'>;

buildTeachingConstraintsBlock(context) -> string  // the ONE canonical prompt-insertable text block
```

A strict `Pick` of `TeachingIntent` — no new learner-state model (tested:
`toTeachingGenerationContext -- reuses TeachingIntent fields verbatim`).
All 3 live surfaces build their adaptive prompt section through this
one function; none reinterprets `TeachingIntent` independently.

## 6. Misconception Experience (S6, release test 2) — VERIFIED

Tested at the actual system-prompt layer (not the AI's wording) in all
3 generators. Example (`explain-defend-adaptive-teaching.test.ts`): a
`MISCONCEPTION_BLOCKED` decision with `misconceptionCode: 'FORCE_ALONG_VELOCITY'`
produces a system prompt containing the exact code, the word "contrast,"
an instruction to explain why the incorrect model fails, and an explicit
"do not merely reveal" constraint — materially different from the
generic `LOW_UNDERSTANDING` block (`buildTeachingConstraintsBlock`
tests assert the two blocks are `not.toBe` each other).

## 7. Prerequisite Experience (S7, release test 3) — VERIFIED

`explain-defend-adaptive-teaching.test.ts`'s "prerequisite experience"
test constructs a decision whose `actionConceptId` is the
Phase-4-selected prerequisite (`targetConceptIds: ['downstream-concept']`
kept only as provenance) and asserts the actual system prompt contains
the prerequisite's own label and **never** contains the string
`'downstream-concept'` — the generator is structurally never even told
the downstream concept's identity, so it cannot drift to it.

## 8. Support Level Execution (S8, release test 6) — VERIFIED

```
HIGH_SUPPORT      -> full explanation + one worked example + guide first step
GUIDED            -> explanation + cues, guided attempt
PARTIAL_SUPPORT   -> short explanation + one partial cue
MINIMAL_SUPPORT   -> a light cue/prompting question, no explanation
INDEPENDENT       -> no instructional help of any kind
```

One deterministic mapping (`supportLevelInstruction`), reused by all 3
generators — not five separate AI systems. Tested directly against the
real system prompt sent to the provider (`quiz-hint-adaptive-teaching.test.ts`).

## 9. Assessment Help Is Never Adapted (S3, release tests 8-10) — VERIFIED

- **Hints**: `canUseAI({evidenceMode, feature:'HINT'})` (Phase 3A,
  unmodified) already denies HINT for every `evidenceMode` other than
  `PRACTICE` — the adaptive lookup runs **after** this gate, and tests
  prove `getTeachingIntentForConcept` is never even called for
  SOLO_CHECK/SOLO_VERIFY/RETENTION_CHECK/DIAGNOSTIC_CHECK/
  CUMULATIVE_ASSESSMENT/MOCK_EXAM (`hint-route-permission.test.ts`, all
  6 modes covered).
- **Explain & Defend**: confirmed `PRACTICE`-shaped (COACH telemetry,
  §2) by fresh audit — never an INDEPENDENT/ASSESSMENT evidence
  attempt in the current product.
- **Tutor chat**: not evidence-attempt-scoped at all, before or after
  this phase — see §19 R2 for the disclosed, pre-existing gap this
  implies.

**NON_PRACTICE_ASSISTANCE_PATHS = 0 / 3**

## 10. Deterministic Stop Condition (S10, release test 19) — VERIFIED

`/api/quizzes/hint/route.ts` now checks the quiz session's own,
pre-existing `hintsUsedQuestions` array (Phase 3A, zero schema change)
**before** generating: once a question has produced one hint-generation
event, further requests for that same question return
`{stopped: true, reason: 'MAX_SUPPORT_REACHED'}` without another AI
call — control returns to the student. A different question on the
same session is unaffected. Not token-based; reuses existing session
state exactly as instructed.

Explain & Defend and Tutor chat were audited for a stop condition too:
Explain & Defend already mints one fresh `activityId` per generation
(pre-existing, Phase 2B) — the client has no path to request a second
prompt-generation for the same attempt without starting a new one, so
no new boundary was needed there. Tutor chat is a genuinely open-ended
conversational surface; no artificial per-message cap was added — see
§19 R3.

## 11. Support Fading in the Live Experience (S11, release test 4) — VERIFIED

Adversarial comparison, tested at the deterministic input layer
(`adaptive-teaching-policy.test.ts` + `adaptive-teaching-generation.test.ts`):

| | Student A | Student B |
|---|---|---|
| Understanding | low | low (same) |
| Help dependency | low (flag false) | high (flag true) |
| `primaryBarrier` | `LOW_UNDERSTANDING` | `HELP_DEPENDENCY` |
| `supportLevel` | `GUIDED`/`HIGH_SUPPORT` (independence-gap-driven) | `MINIMAL_SUPPORT` (deliberately less, never more) |
| Actual prompt/context sent | includes worked-example/cue language | includes "light cue... do not explain outright" language |

## 12. Previous Strategy Awareness (S12, release test 20) — VERIFIED

`buildTeachingConstraintsBlock` appends, verbatim, "This approach has
already been tried repeatedly and has not worked — do not lead with
CONTRAST... as the primary method this time" whenever `avoidStrategies`
is non-empty (computed the same way as Phase 5: two consecutive
identical strategy uses, from persisted `decision_events` provenance).
Tested directly on the generated text, not inferred.

## 13. Grounding Preserved (S13, release test 15) — VERIFIED

Neither `tutor.service.ts` nor `explain-defend.service.ts` had a single
line of their `retrieveContext`/grounding logic touched — the adaptive
block is inserted **alongside**, never in place of, the existing
material block. Tested directly: both files' test suites assert the
retrieved chunk text is still present in the actual system prompt sent
to the provider, in the same call that also carries adaptive guidance.

## 14. Multilingual (S14, release test 16) — VERIFIED

`TeachingGenerationContext`/`buildTeachingConstraintsBlock` carry/take
no language field or parameter (`buildTeachingConstraintsBlock.length === 1`,
tested). `explain-defend-adaptive-teaching.test.ts` calls the same
`TeachingIntent` through in Spanish and English and asserts the
misconception code and "contrast" language are identical in both —
only the surrounding, pre-existing `LOCALE_FULL_NAME`-driven language
instruction differs, exactly as before this phase.

## 15. Fail-Closed AI Behavior (S15, release test 14) — SAFE

All 3 generators still route through the unmodified `executeAI()` — no
bypass was introduced. Confirmed at two levels:
1. Structural: none of the 3 changed generator functions contain a
   database write of any kind (`tests/unit/phase-5-r-release-checklist.test.ts`
   greps for `db.query`/SQL literals in the changed files).
2. Behavioral: `explain-defend-adaptive-teaching.test.ts`'s "AI failure"
   test forces the provider adapter to reject and asserts the call
   throws — `generateExplainPrompt` performs zero persistence of any
   kind either way, so there is no mutation to roll back.

**ADAPTIVE_AI_FAILURE = SAFE**

## 16. Strategy Provenance (S16) — traceable, not duplicated

`TEACHING_STRATEGY_SELECTED` (Phase 5, unmodified) still records the
computed strategy/barrier per call. The 3 now-adaptive generation calls
additionally thread `AIExecutionContext` (`studentId`/`subjectId`/
`conceptId`/`sourceComponent`) into their `executeAI()` calls — `generateExplainPrompt`
and `tutor.service.ts::sendMessage` did **not** carry this before (a
fresh-audit finding); `generateQuestionHint` gained it for the first
time via the route. Every AI execution this produces is already
recorded in `ai_execution_events` (Phase 0E2, unmodified) with its own
`promptId`/`promptVersion`/`executionId` — joinable to the
`TEACHING_STRATEGY_SELECTED` decision_events row by
`(studentId, conceptId, close-in-time)`, without a new table and
without persisting any generated transcript.

## 17. No Teaching Success From Viewing Content (S17, release tests 11-13) — VERIFIED, 0/N

`generateQuestionHint`, `generateExplainPrompt`, and `tutor.service.ts::sendMessage`
perform **zero** writes to `learning_evidence`/`mastery_records`/
`concept_knowledge_state`/`verification_attempts`/`student_misconceptions`
— verified by a permanent grep-based regression test
(`phase-5-r-release-checklist.test.ts`) scanning every changed file for
those patterns, in addition to the pre-existing architectural fact that
Mastery/Knowledge State mutation only ever happens in the separate
`/submit` routes (`explain/submit`, quiz answer submission), which this
phase did not touch at all.

**TEACHING_GENERATION_MASTERY_EFFECT = 0 / 3**
**TEACHING_GENERATION_KNOWLEDGE_STATE_EFFECT = 0 / 3**

## 18. Phase 4 Decision Immutability (S18, release tests 17-18) — VERIFIED, 0/N

`getBestLearningDecisionForConcept` returns the exact `LearningDecision`
object `getLearningDecisions` produced — never reconstructed, never
partially copied with overrides. `getTeachingIntentForConcept`/
`getTeachingIntent` take it strictly as a read-only parameter (Phase 5
invariant, re-confirmed this phase). A permanent regression test greps
every changed file for `decision.activityType =`/`decision.actionConceptId =`/
`decision.learningState =` assignment patterns and finds none.

**DECISION_ACTION_MUTATIONS = 0 / 3**

## 19. Remaining Risks

**BLOCKING: none.**

**NON-BLOCKING:**

- **R1 — `concept-explanation.service.ts` remains unwired.** Genuine
  cache-sharing incompatibility (§3), not an oversight. A future phase
  could either key the cache by a barrier bucket or bypass caching for
  adaptively-taught views — deliberately deferred rather than rushed.
- **R2 — Tutor chat is not scoped to "is there an active INDEPENDENT/
  ASSESSMENT attempt right now."** This is a pre-existing characteristic
  (true before Phase 5 too), not introduced by this phase — but Tutor
  chat is now capable of more targeted instructional content
  (misconception-specific correction) than before, which makes this gap
  marginally more consequential than it was. Closing it would mean
  threading "is the student mid-attempt" state into the tutor route,
  out of this remediation's stated scope (S1/S2 name concept teaching,
  practice assistance, remediation teaching — not cross-surface attempt
  awareness).
- **R3 — No stop condition on Tutor chat's conversation length.**
  Deliberately not added (§10) — the task's own stop-condition examples
  are quiz/remediation-shaped, and an arbitrary chat-turn cap would
  harm a legitimately open-ended product surface without addressing a
  real observed problem.
- **R4 — `getLearningDecisions`' own raw query count was not freshly
  re-measured this phase** (§4) — its cost is reused, not increased,
  but no permanent test pins an exact number for it, so "bounded" here
  means "a fixed, already-accepted computation," not "measured at N
  queries this session."

## 20. Tests

25 release-blocking test items, all covered:

| Test file | Count | Covers |
|---|---|---|
| `adaptive-teaching-generation.test.ts` | 10 | S4/S6/S7/S8/S11/S12/S14 (pure adapter) |
| `adaptive-teaching-service.test.ts` (+5 new) | 17 | S1/S19 bridge functions |
| `explain-defend-adaptive-teaching.test.ts` | 7 | Surface C, real system prompt |
| `explain-generate-route-adaptive-teaching.test.ts` | 4 | Surface C route wiring |
| `tutor-adaptive-teaching.test.ts` | 6 | Surface A, real system prompt |
| `quiz-hint-adaptive-teaching.test.ts` | 5 | Surface B, real system prompt |
| `hint-route-permission.test.ts` (+8 new) | 14 | S3/S9/S10, non-PRACTICE denial + stop condition |
| `phase-5-r-release-checklist.test.ts` | 14 | Tests 11-13, 17-18, 21, 22, 24 |

## 21. TypeScript

`npx tsc --noEmit` — clean.

## 22. Build

`npm run build` — clean, all routes compiled.

## 23. Database Status

```
Applied (6), Pending (0), Drifted (0) -- unchanged.
```

**NEW_MIGRATIONS_PHASE_5_R = 0**

## 24. Git Diff

```
 M src/app/api/cognitive/explain/generate/route.ts   (+15/-1)
 M src/app/api/quizzes/hint/route.ts                 (+29/-3)
 M src/lib/ai/prompt-registry.ts                     (+11/-4)
 M src/lib/audit/types.ts                            (unchanged this phase -- carried from Phase 5)
 M src/services/explain-defend.service.ts            (+7/-1)
 M src/services/quiz-generation.service.ts            (+20/-4)
 M src/services/tutor.service.ts                      (+25/-9)
 M tests/unit/hint-route-permission.test.ts           (+73/-2)
?? src/lib/adaptive-teaching-generation.ts             (new, 157 lines)
?? tests/unit/adaptive-teaching-generation.test.ts     (new)
?? tests/unit/explain-defend-adaptive-teaching.test.ts (new)
?? tests/unit/explain-generate-route-adaptive-teaching.test.ts (new)
?? tests/unit/tutor-adaptive-teaching.test.ts          (new)
?? tests/unit/quiz-hint-adaptive-teaching.test.ts      (new)
?? tests/unit/phase-5-r-release-checklist.test.ts      (new)
```

Nothing staged, nothing committed, nothing pushed.

## 25. Final Decision

```
LIVE_TEACHING_INTENT_CONSUMERS = 3
ADAPTIVE_CONCEPT_EXPLANATION = OPERATIONAL
ADAPTIVE_PRACTICE_ASSISTANCE = OPERATIONAL
ADAPTIVE_REMEDIATION_TEACHING = OPERATIONAL
NON_PRACTICE_ASSISTANCE_PATHS = 0 / 3
MISCONCEPTION_SPECIFIC_LIVE_TEACHING = VERIFIED
PREREQUISITE_SPECIFIC_LIVE_TEACHING = VERIFIED
SUPPORT_LEVEL_EXECUTION = VERIFIED
SUPPORT_FADING_EXECUTION = VERIFIED
PREVIOUS_STRATEGY_AVOIDANCE = VERIFIED
TEACHING_STOP_CONDITION = VERIFIED
GROUNDING_PRESERVED = VERIFIED
MULTILINGUAL_STRATEGY_INVARIANCE = VERIFIED
ADAPTIVE_AI_FAILURE = SAFE
TEACHING_GENERATION_MASTERY_EFFECT = 0 / 3
TEACHING_GENERATION_KNOWLEDGE_STATE_EFFECT = 0 / 3
DECISION_ACTION_MUTATIONS = 0 / 3
NEW_MIGRATIONS_PHASE_5_R = 0
FULL_TEST_COUNT = 1199
PHASE_5_RELEASE_BLOCKERS_CLOSED = YES
READY_FOR_PHASE_5_PRODUCTION_RELEASE = YES
READY_FOR_PHASE_6 = YES_WITH_CONDITIONS
```

`READY_FOR_PHASE_6 = YES_WITH_CONDITIONS` reflects §19's R1-R4 only —
none blocking, all disclosed, none touching a protected system.

---

**STOP.** No commit. No push. No deploy. Phase 6 not begun.
