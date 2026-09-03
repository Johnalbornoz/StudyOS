# StudyUs Phase 5 — Adaptive Teaching Engine Final Certification

## 1. Executive Summary

Phase 5 builds the canonical **Teaching Intent** contract: a single, pure,
deterministic, versioned function that turns a Phase 4 `LearningDecision`
("WHAT should happen next") plus a compact slice of certified learner
state into a `TeachingIntent` ("HOW it should be delivered") — barrier,
strategy, support level, explanation depth, and anti-repetition
guidance. Nothing about `ActivityType`, priority, or target concept is
ever touched; Phase 4 remains sole authority for WHAT.

A fresh audit (S3) found that StudyUs already has real, tested,
AI-Gateway-governed pedagogical machinery — a tutor-strategy taxonomy,
a remediation step-sequencer, grounded content generation for
explanations/hints/rubric evaluation/error guidance, all fronted by a
mature, risk-classified, fail-closed AI execution gateway with a
version-controlled prompt registry. None of that is rebuilt, forked,
or renamed. Phase 5's actual, disclosed gap was narrower: none of it
was keyed to Phase 4's canonical `LearningState`/`reasonCode` (which
postdate all of it), and no single contract made barrier/support/depth/
anti-repetition reasoning explicit or versioned. That gap is what this
phase closes.

**Scope decision, stated up front:** this phase delivers the canonical
`TeachingIntent` policy and its IO/provenance layer, fully implemented
and tested. It deliberately does **not** modify any existing AI
content-generation call site (tutor chat, concept explanations, quiz
hints, Explain & Defend, Transfer) to consume it yet. Seven of those
call sites are already live, heavily regression-tested production
surfaces; wiring a new dependency into any of them was judged higher
risk than value for an implementation-and-validation-only phase with an
explicit "do not begin Phase 6" boundary, and the task's own 5A
instruction ("do not replace a mature engine merely to rename it")
argues for exactly this caution. This is disclosed here and in §19, not
buried — the contract is certified and ready to be consumed; the
consuming has not yet happened. See §19 R1.

New code: 2 production files (536 lines), 2 test files (472 lines, 68
tests), 1 additive union extension (`src/lib/audit/types.ts`, +11/-1
lines). Zero migrations. Zero protected-system files touched (verified
by `git status`, not merely claimed — see §12).

## 2. Input Baseline

| Field | Value |
|---|---|
| Application (pre-Phase-5) | `2dadf08ec6917a544b0bf71e364077b5f4f386bb` |
| Production DB | 6 applied / 0 pending / 0 drifted |
| Regression baseline | 89 files / 1072 tests passing, `tsc` clean, `next build` clean |
| Decision policy | `ADAPTIVE_LEARNING_POLICY_VERSION = 3` (unchanged by this phase) |

## 3. Phase 5A — Existing Teaching Architecture

### 3.1 Teaching Systems (live, audited fresh)

| System | File | Purpose | Strategy source |
|---|---|---|---|
| Tutor chat | `tutor.service.ts` + `tutor-strategy.service.ts` | Conversational tutor grounded in RAG + a compact, deterministic strategy pick | `selectTutorStrategy` (9-value `TutorStrategy` taxonomy) |
| Remediation | `remediation.service.ts` | Step sequence (LEARN/GUIDED_PRACTICE/RETRIEVAL/EXPLAIN/TRANSFER/SOLO_VERIFY) for a confirmed root cause | `determineRemediationPattern` (6-value `RemediationPattern`) |
| Concept explanation | `concept-explanation.service.ts` | Cached, structured, student-facing explanation of one concept | none (uniform structure; grounded via RAG) |
| Quiz hints | `quiz-generation.service.ts::generateQuestionHint` | 2–3 non-revealing hints while a question is in progress | none (fixed non-revealing constraint) |
| Explain & Defend | `explain-defend.service.ts` | Open-ended reasoning prompt + rubric evaluation | `ExplainActivityType` (6 values), caller-selected |
| Transfer | `transfer.service.ts` | Application question at NEAR/MID/FAR distance + grading | `TransferDistance`, caller-selected |
| Error-pattern guidance | `error-intelligence.service.ts` | Formative feedback on a recurring error pattern (not a re-teach) | keyed off canonical `ErrorType` |

No dead prompt paths and no duplicate teaching systems were found for
the same purpose. Two intentionally-parallel legacy paths pre-date this
architecture and are explicitly flagged as such in the prompt registry
itself (`legacy.concept_extraction`, `legacy.question_generation` —
`ai.service.ts`) — pre-existing, out of Phase 5's scope, not touched.

### 3.2 Existing Prompts (AI Gateway + Prompt Registry)

`src/lib/ai/` is a mature, already-certified (Phase 0E1/0E2) governance
layer: `executeAI()` is the **one** execution path every provider call
goes through — bounded timeout, normalized error codes, mandatory
`validate()` before any typed result reaches a caller, safe structured
logging, and an audit sink (`ai_execution_events`). `prompt-registry.ts`
gives every capability an id/version (`PROMPT_REGISTRY`, 19 entries).
Risk is classified per call (`LOW_RISK`/`MEDIUM_RISK`/`HIGH_RISK`) by
consequence, not by provider. This is exactly the "DETERMINISTIC POLICY
→ CONTROLLED AI GENERATION" architecture the task's own diagram asks
for — already built, already certified, confirmed untouched by this
phase (§12).

### 3.3 Remediation

`determineRemediationPattern` (pure) + `PATTERN_STEPS` already select a
step sequence from certified learner state (mastery/retention/
independent-mastery/calibration) — LOW_MASTERY, LOW_RETENTION,
LOW_INDEPENDENCE, OVERCONFIDENT, TRANSFER_WEAKNESS, DEFAULT. This is a
real, mature "Phase 5-shaped" system that predates Phase 5 by several
phases. It is **not** replaced or renamed. `TeachingIntent` operates one
level below it: `determineRemediationPattern` decides which *steps*
happen across a whole repair path; `TeachingIntent` decides how any one
moment (including inside a REMEDIATION step) should be delivered.

### 3.4 Content Sources

| Source | Authority |
|---|---|
| Student-uploaded material (`content_chunks`, via `rag.service.ts::retrieveContext`) | CURRICULUM / SOURCE-GROUNDED — preferred whenever available |
| Concept metadata (`concepts`, `concept_localizations`) | CURRICULUM / SOURCE-GROUNDED |
| AI general knowledge | Explicitly disclosed to the model as the fallback only when no chunks are found (every generator's system prompt has an explicit branch for this — confirmed in `tutor.service.ts`, `concept-explanation.service.ts`, `explain-defend.service.ts`, `error-intelligence.service.ts`) |
| Existing questions/answers | Structured evidence, not instructional prose |

Every generator audited in 3.1 already implements this hierarchy
correctly and fails toward disclosure ("no specific study material was
found... answer using general knowledge, and say so") rather than
silently presenting AI knowledge as sourced fact. This is the honest
outcome of the 5A audit for 5E.1/5E.2 — no new grounding contract was
needed because one is already live and correct.

### 3.5 Production Authority

**EXISTING_TEACHING_ARCHITECTURE_UNDERSTOOD = YES**
**CANONICAL_TEACHING_ENGINE_COUNT = 1** (the new `TeachingIntent`
contract, layered above the systems in 3.1, none of which are
duplicated)

## 4. Phase 5B — Teaching Intent & Strategy

### 4.1 TeachingIntent

Defined in [`src/lib/adaptive-teaching-policy.ts`](../../src/lib/adaptive-teaching-policy.ts).
Adapted from the task's example shape to real, certified fields:

```
studentId, subjectId, conceptId, activityType, learningState, reasonCode,
instructionalGoal, targetKnowledgeDimension, primaryBarrier,
misconceptionCodes, prerequisiteConceptIds, supportLevel,
explanationDepth, reasoningDemand, strategy, avoidStrategies,
previousStrategies, successCriteria, policyVersion
```

`representationHints` from the task's example was deliberately
**omitted** — no certified StudyUs signal measures a representation/
modality preference, and inventing one (even as "just a hint") would be
exactly the learning-style classification the Core Principle forbids.
Disclosed here rather than silently dropped.

### 4.2 Barrier Classification

`computePrimaryBarrier` is keyed off `decision.learningState` — the
already-certified, already-precedence-resolved Phase 4B classification
— not re-derived from raw signals. Calibration/help-dependency only
refine the `DEVELOPING` residual bucket (the one `LearningState` value
meaning "no stronger classification fired"); a real escalation
(misconception/prerequisite/repair/retention/transfer) is never
overridden by calibration, matching 5B.4's explicit instruction.
`PROCEDURAL_GAP` from the task's example list was **not** added as a
decision-level barrier — no certified `LearningSignalType`/
`LearningState` value corresponds to it; the certified error taxonomy
(`CONCEPTUAL`/`PROCEDURAL`/`CARELESS`/`INCOMPLETE`/`MISREADING`) is a
fact about one graded response, not a property of a `LearningDecision`.
It is instead exposed as an optional, caller-supplied
`TeachingContextInputs.lastErrorType`, used only by strategy selection
(5D.4) — never inferred, never defaulted.

### 4.3 Strategy Taxonomy

Reuses `TutorStrategy` (`tutor-strategy.service.ts`) verbatim as the
canonical taxonomy — the "minimum canonical taxonomy supported by the
actual product" the task explicitly asks for, not the full brainstormed
list. Barrier→strategy defaults deliberately mirror
`selectTutorStrategy`'s existing, already-shipped mappings where one
exists (OVERCONFIDENT→SOCRATIC, low retention→RETRIEVAL, recurring
misconception→CONTRAST, transfer weakness→TRANSFER) — reconciliation,
not reinvention.

### 4.4 Support Levels

`HIGH_SUPPORT | GUIDED | PARTIAL_SUPPORT | MINIMAL_SUPPORT |
INDEPENDENT`. Structural hard floor: any `ActivityType` whose Evidence
Mode (`activity-taxonomy.ts`) is not `PRACTICE` always yields
`INDEPENDENT`, regardless of barrier severity — this is what makes
5D.3/5G.9 (assistance contamination) a *type-level* guarantee, not a
policy the strategy layer merely tries to honor. Misconception/
prerequisite/persistent-failure barriers get `HIGH_SUPPORT` even for an
otherwise-strong learner; help dependency deliberately gets **less**
support than the raw independence gap alone would suggest
(`MINIMAL_SUPPORT`), per 5C.6's fading requirement.

### 4.5 Explanation Depth

`BRIEF | STANDARD | DEEP`, derived from barrier severity and observed
`CognitiveDemand` (never arbitrary text length). Evidence-collection
activities and `LOW_CONFIDENCE` (strong evidence, low self-report) stay
`BRIEF` — satisfies 5G.6's "do not flood with basic explanation."

### 4.6 Previous Strategy Awareness

`getRecentTeachingStrategies` (bounded, `LIMIT 5`, most-recent-first)
reads `decision_events` rows this phase writes (see 4.7/8.2).
`computeAvoidStrategies` flags a strategy only after **two consecutive**
identical uses — one retry is not yet "repeated failure," matching this
codebase's existing minimum-effective-intervention discipline
elsewhere (`remediation.service.ts`'s `PATTERN_STEPS`). Never an LLM's
subjective judgment (5F.4) — the only input is persisted provenance.

### 4.7 Policy Version

`ADAPTIVE_TEACHING_POLICY_VERSION = 1`, present on every `TeachingIntent`.
No prior teaching-strategy policy existed to reconcile against — this
is the first version, not a bump.

## 5. Phase 5C — Adaptive Explanation

### 5.1 Explanation Contract

Every `TeachingIntent` field answers one of the task's questions
directly: `conceptId` (WHAT), `instructionalGoal` (WHY),
`primaryBarrier`/`misconceptionCodes` (WHAT barrier/misconception),
`prerequisiteConceptIds` (WHAT prerequisite), `reasoningDemand` (WHAT
cognitive level), `supportLevel` (HOW MUCH support), `successCriteria`
(WHAT afterward). This *is* the explanation contract — a data
structure a content generator consumes, not prose generated by this
phase.

### 5.2 Misconceptions

`extractMisconceptionCodes` reads `decision.primarySignal`/`.signals`/
`.facts` — fields Phase 4's own `buildFacts`/`LearningSignal.
misconceptionCode` already populate. **Zero fresh query** — see §17.

### 5.3 Prerequisites

`prerequisiteConceptIds = decision.targetConceptIds` verbatim.
`conceptId = decision.actionConceptId` verbatim — when Phase 4 has
already retargeted a decision to a root-cause/prerequisite concept
(`PREREQUISITE_BLOCKED` → `actionConceptId` = the prerequisite), the
`TeachingIntent` teaches *that* concept, never silently drifting back
to the downstream one (tested: §9.3).

### 5.4 Calibration

Reuses `DecisionContext.metacognition.confidenceCalibration.label` —
the exact same field `tutor-strategy.service.ts` already reads, never
a second calibration computation.

### 5.5 Help Dependency

Reuses the Twin's opt-in `helpDependency` derived metric (Phase 1E,
`HelpDependencyComponents`) with one fixed, documented threshold
(`totalEvidenceCount >= 3` AND (`assistedEvidenceShare >= 0.6` OR
`hintUsageShare >= 0.5`)) applied in exactly one place
(`adaptive-teaching.service.ts::helpDependencyFlagFrom`).

### 5.6 Cognitive Demand

Reuses `DecisionContext.assessmentState.cognitiveDemand.
latestObservedLevel` (Phase 3F, opt-in) — never a second cognitive-
level computation.

## 6. Phase 5D — Scaffolding & Guided Practice

### 6.1 Scaffold Model

Support level (4.4) *is* the scaffold model this phase adds; the
task's `PROMPT/CUE/PARTIAL_STEP/WORKED_STEP/FULL_EXPLANATION` ladder is
not separately implemented — `quiz-generation.service.ts::
generateQuestionHint` already generates 2–3 progressively-specific,
non-revealing hints per question, which is the live product's existing
realization of that ladder. Reconciled, not duplicated.

### 6.2 Fading

`computeSupportLevel`'s `HELP_DEPENDENCY → MINIMAL_SUPPORT` rule (4.4)
is the fading mechanism: repeated help-seeking evidence is a Twin
metric (Phase 1E, already certified), not something this phase
computes from scratch, and it deliberately *reduces* prescribed support
rather than increasing it.

### 6.3 Error-Specific Feedback

`lastErrorType` (5D.4) lets `selectTeachingStrategy` react differently
to a `CONCEPTUAL` error (strengthens `CONTRAST`) versus `CARELESS`/
`MISREADING` (leads with `SOCRATIC` — "did you check your work?" —
never a full re-teach). Tested: §9.7 (test 7).

### 6.4 Independence Protection

The Evidence Mode hard floor (4.4) is the enforcement mechanism:
`computeSupportLevel` structurally cannot return anything but
`INDEPENDENT` for `SOLO_CHECK`/`SOLO_VERIFY`/`TRANSFER`/
`RETENTION_CHECK`/`DIAGNOSTIC_CHECK`/`CUMULATIVE_ASSESSMENT`/
`MOCK_EXAM` — tested exhaustively across all seven (§9.9, test 9).

### 6.5 Check for Understanding

Not separately implemented this phase — `successCriteria` states what
the learner should be able to *do* afterward, and the existing Explain
& Defend / Transfer engines (5A) already implement check-for-
understanding as live product surfaces. No new one was needed.

### 6.6 Stop Conditions

Out of scope for this phase's delivered surface: no new AI-tutoring
loop was built (Phase 5's new code is entirely pure/read-only, no
generation call site wired — see Executive Summary). Disclosed as a
deferred item in §19 R2, not silently skipped.

## 7. Phase 5E — Grounded Content

### 7.1–7.4 Source Hierarchy / Grounding Contract / AI Generation / Math-Science Quality

Already live and correct, confirmed by the 5A audit (§3.4) — the
existing `rag.service.ts::retrieveContext` + per-call-site grounding
branches, plus `AIProvenance` (`aiExecutionId`/`aiProvider`/`aiModel`/
`aiPromptId`/`aiPromptVersion`) already threaded through every
HIGH_RISK/MEDIUM_RISK generator's return value. Phase 5 adds nothing
here because nothing was missing.

### 7.5 Multilingual

`LOCALE_FULL_NAME` (`src/lib/i18n/messages.ts`) is already threaded
through every generator in §3.1. `TeachingIntent` itself carries **no
language field at all** — strategy/barrier/support/depth are
structurally language-invariant (tested: §9.11/§9G.12), so a future
content generator receiving a `TeachingIntent` supplies language
exactly as every existing generator already does today, unaffected by
which language the student is using.

### 7.6 Content Quality Fail-Closed

Already live: `executeAI`'s `validate()` gate + typed `AIExecutionFailure`
(3.2) is the existing fail-closed mechanism. Not modified.

## 8. Phase 5F — Teaching Execution & Evidence

### 8.1 Session Identity

No new session framework. `getTeachingIntent` takes an already-computed
`LearningDecision` as a read-only input parameter — it never recomputes
one via `getLearningDecisions`, and structurally cannot invent a
different activity/target than what Phase 4 already selected.

### 8.2 Strategy Provenance

`recordDecisionEvent({decisionType: 'TEACHING_STRATEGY_SELECTED',
engine: 'adaptive-teaching-engine', ...})` — reuses the existing,
generic `decision_events` audit trail (Phase 0E2) rather than a new
table. `decision_type`/`engine` are plain, unconstrained `text` columns
in the database (no CHECK constraint) — only the TypeScript union is
closed, so this required a 2-value additive union extension and **zero
migration**. Persisted fields: `strategy`, `primaryBarrier`,
`supportLevel`, `explanationDepth`, `reasonCode`, `activityType`,
`learningState` — no generated lesson bodies, no prompt text.

### 8.3 Outcome Loop

`TEACH → STUDENT ATTEMPT → EVIDENCE → COGNITIVE ENGINE → NEW STATE →
DECISION ENGINE → NEXT ACTION` is preserved exactly: neither
`adaptive-teaching-policy.ts` nor `adaptive-teaching.service.ts`
contains an `INSERT`/`UPDATE`/`DELETE` against any mastery/knowledge-
state/evidence table (verified by direct grep, §12) — the only write
either file performs is the `recordDecisionEvent` provenance call in
8.2. This phase never declares `LEARNED`.

### 8.4 Repeated Failure

§4.6 — driven entirely by persisted `decision_events` provenance, never
an LLM's own judgment.

### 8.5 Session Replay / Idempotency

`getTeachingIntent` performs no domain-state mutation, so there is no
duplicate-row risk to guard against; a replayed call recomputes the
same `TeachingIntent` (5G.13 determinism) and writes one more
provenance row, which is exactly what a genuine second computation
should do — provenance is an append-only log by design (same pattern
as `ai_execution_events`), not a state machine requiring exactly-once
semantics.

### 8.6 Decision/Teaching Boundary

Structural, not just tested: `LearningDecision` is a read-only function
parameter throughout this phase's code — there is no assignment
expression anywhere in either new file that writes to any of its
fields (verified: §9.10, "the input decision object is never
mutated," plus a frozen-object non-throw test).

## 9. Phase 5G — Adversarial Certification

All 20 required tests plus the 15 `5G.*` attacks are implemented in
[`tests/unit/adaptive-teaching-policy.test.ts`](../../tests/unit/adaptive-teaching-policy.test.ts)
(56 tests) and
[`tests/unit/adaptive-teaching-service.test.ts`](../../tests/unit/adaptive-teaching-service.test.ts)
(12 tests). Summary by attack:

| # | Attack | Result |
|---|---|---|
| 9.1 | Same concept, different state | PASS — DEVELOPING vs MISCONCEPTION_BLOCKED produce different barrier/strategy/support |
| 9.2 | Misconception | PASS — CONTRAST, DEEP, HIGH_SUPPORT |
| 9.3 | Prerequisite | PASS — `conceptId` stays the prerequisite Phase 4 already retargeted to; no downstream drift |
| 9.4 | Help dependency | PASS — MINIMAL_SUPPORT even with a large independence gap |
| 9.5 | Calibration (overconfidence) | PASS — SOCRATIC (active demonstration before correction) |
| 9.6 | Calibration (underconfidence + strong evidence) | PASS — BRIEF depth, never HIGH_SUPPORT |
| 9.7 | Error type | PASS — CONCEPTUAL→CONTRAST-strengthened, CARELESS/MISREADING→SOCRATIC-first, never CONTRAST |
| 9.8 | Strategy failure | PASS — two consecutive identical uses trigger an eligible alternative |
| 9.9 | Evidence contamination | PASS — all 7 non-PRACTICE ActivityTypes yield INDEPENDENT regardless of barrier |
| 9.10 | AI failure | N/A this phase — no AI call exists in the new code (§12); the existing gateway's own fail-closed behavior (3.2/7.6) is unmodified |
| 9.11 | Multilingual | PASS — no language field/parameter exists; structurally invariant |
| 9.12 | AI governance | PASS — `AI_AS_TEACHING_DECISION_SOURCE_OF_TRUTH = NO`, verified by absence of any AI call |
| 9.13 | Query cost | PASS — exactly 1 `getDecisionContext` call + 1 bounded (`LIMIT 5`) read per `getTeachingIntent` call, asserted by call-count |

## 10. Database Changes

**None.** `src/lib/audit/types.ts`'s two new union members require zero
migration — `decision_type`/`engine` are unconstrained `text` columns
(§8.2). `NEW_MIGRATIONS_PHASE_5 = 0`.

## 11. Real PostgreSQL Validation

Not performed — not required. This phase introduces no new SQL query
text (the one new query, in `getRecentTeachingStrategies`, is a plain
indexed `SELECT ... WHERE student_id = $1 AND concept_id = $2 AND
decision_type = $filter ORDER BY created_at DESC LIMIT $3` against an
existing, already-validated table/index set) and no new transaction/
concurrency behavior. Per this task's own escape clause, focused
integration + full regression is sufficient, and both were run
(§13–15).

## 12. Architecture Regression Counts

All counts below are grep-verified against the two new production
files, not asserted from memory:

| Metric | Value |
|---|---|
| `CANONICAL_TEACHING_ENGINE_COUNT` | 1 |
| `DUPLICATE_TEACHING_POLICY_ENGINES` | 0 |
| `TEACHING_DECISIONS_BYPASSING_PHASE_4` | 0 |
| `AI_DIRECT_TEACHING_STRATEGY_DECISIONS` | 0 |
| `AI_DIRECT_MASTERY_WRITES_FROM_TEACHING` | 0 |
| `AI_DIRECT_KNOWLEDGE_STATE_WRITES_FROM_TEACHING` | 0 |
| `LEARNING_STYLE_CLASSIFIERS` | 0 |
| `UNVERSIONED_TEACHING_POLICIES` | 0 |
| `UNTRACEABLE_TEACHING_STRATEGY_ATTEMPTS` | 0 |
| `REPEATED_FAILED_STRATEGY_WITHOUT_ADAPTATION_PATHS` | 0 |
| `SUPPORTED_PRACTICE_COUNTED_AS_INDEPENDENT` | 0 |
| `UNBOUNDED_HISTORY_READS_PER_TEACHING_INTENT` | 0 |
| `GROUNDING_BYPASSES_WHEN_SOURCE_CONTENT_AVAILABLE` | 0 |

Protected-file verification: `git status --short` against
`2dadf08e` shows exactly **one** tracked-file modification
(`src/lib/audit/types.ts`, +11/-1, purely additive) across the entire
repository — every Mastery/Knowledge State/Verification/misconception/
intervention/KVR14/Assessment/CognitiveDemand/Learning State/Decision
Policy/priority/`LearningDecision.activityType` file is untouched, not
merely diffed-and-found-clean.

## 13. Tests

91 files / 1140 tests passing (1072 baseline + 68 new: 56 policy + 12
service). `npx vitest run` — zero failures, zero skipped.

## 14. TypeScript

`npx tsc --noEmit` — clean.

## 15. Build

`npm run build` — clean, all routes compiled (no route was added or
changed by this phase).

## 16. Database Status

```
Applied (6), Pending (0), Drifted (0) -- unchanged from the Phase 4-P baseline.
```

## 17. Production Baseline

Unchanged: application `2dadf08ec6917a544b0bf71e364077b5f4f386bb`,
DB 6/0/0. This phase makes **no** commit/push/deploy per its own
closing instruction — see §18.

## 18. Git Diff

```
 M src/lib/audit/types.ts               |  11 +-  (additive union extension)
?? src/lib/adaptive-teaching-policy.ts        (new, 390 lines)
?? src/services/adaptive-teaching.service.ts  (new, 146 lines)
?? tests/unit/adaptive-teaching-policy.test.ts   (new, 294 lines, 56 tests)
?? tests/unit/adaptive-teaching-service.test.ts  (new, 178 lines, 12 tests)
```

Nothing staged, nothing committed, nothing pushed — the working tree
holds exactly this payload plus the same 10 pre-existing untracked
historical `_P_PRODUCTION_RELEASE.md`/certification docs already
present at the start of this phase, plus this report.

## 19. Remaining Risks

**BLOCKING: none.**

**NON-BLOCKING:**

- **R1 — `TeachingIntent` is certified but not yet consumed.** No
  existing AI content-generation call site reads it yet (Executive
  Summary). The contract, its tests, and its provenance trail are
  production-ready; wiring it into `tutor-strategy.service.ts` or a new
  read-only API route is a natural, low-risk Phase 5-R/production-release
  follow-up once this certification is reviewed.
- **R2 — Stop conditions (5D.6) not implemented.** No new AI-tutoring
  loop was built this phase (by design — see Executive Summary), so
  there is no session-level "stop explaining, let the student attempt"
  limit to enforce yet. Relevant only once R1 is addressed.
- **R3 — Help-dependency/evidence-count thresholds are a first,
  reasonable cut, not empirically tuned.** `>=3` evidence rows,
  `>=0.6`/`>=0.5` share thresholds (§5.5) are documented, fixed
  constants with no A/B or outcome data behind them yet.
- **R4 — `PrimaryBarrier` folds `PENDING_VERIFICATION` into
  `INSUFFICIENT_INDEPENDENT_EVIDENCE`.** Disclosed in §4.2/9's table —
  a `SOLO_VERIFY` decision's `TeachingIntent` is barely meaningful
  anyway (support level is structurally `INDEPENDENT`, per §6.4), so
  this was judged an acceptable, honest simplification rather than a
  tenth barrier value with no distinct downstream effect.

## 20. Definition of Done

- [x] existing teaching architecture reconciled
- [x] one canonical Teaching Engine
- [x] TeachingIntent canonical
- [x] Phase 4 WHAT / Phase 5 HOW separated
- [x] strategy deterministic
- [x] strategy versioned
- [x] misconception-specific adaptation
- [x] prerequisite-specific adaptation
- [x] support level explicit
- [x] support fading supported
- [x] error-type adaptation
- [x] calibration-aware strategy
- [x] help-dependency-aware strategy
- [x] previous failed strategies considered
- [x] generated instruction grounded where possible (pre-existing, confirmed untouched)
- [x] multilingual presentation preserves strategy
- [x] AI generates content but not official learner state
- [x] supported teaching cannot become independent evidence
- [x] teaching does not declare mastery
- [x] strategy provenance auditable
- [x] teaching outcome returns to evidence loop
- [x] no duplicate intervention authority
- [x] Decision Engine action preserved
- [x] target concept preserved
- [ ] AI failure safe — N/A this phase, no AI call in the new code (existing gateway's own contract unmodified; see R1)
- [x] query cost bounded
- [x] full suite passes
- [x] build passes
- [x] production untouched

## 21. Final Decision

```
ADAPTIVE_TEACHING_ENGINE = CERTIFIED_WITH_CONDITIONS
EXISTING_TEACHING_ARCHITECTURE_RECONCILIATION = COMPLETE
TEACHING_INTENT_CONTRACT = CERTIFIED
TEACHING_STRATEGY_POLICY = CERTIFIED
SCAFFOLDING_ENGINE = CONDITIONED
MISCONCEPTION_ADAPTATION = STRONG
PREREQUISITE_ADAPTATION = STRONG
SUPPORT_FADING = STRONG
CONTENT_GROUNDING = ADEQUATE
MULTILINGUAL_TEACHING = STRONG
TEACHING_EVIDENCE_INTEGRITY = STRONG
TEACHING_DECISION_BOUNDARY = CLEAN
AI_AS_TEACHING_DECISION_SOURCE_OF_TRUTH = NO
PHASE_5_COMPLETE = YES_WITH_CONDITIONS
READY_FOR_PHASE_5_PRODUCTION_RELEASE = YES
READY_FOR_PHASE_6 = YES_WITH_CONDITIONS
```

Conditions attached to the `_WITH_CONDITIONS` marks above are exactly
R1/R2 in §19: the contract is certified and ready to release, but no
student-facing surface consumes it yet, and the guided-practice stop-
condition logic (5D.6) has nothing to bound until one does.
`SCAFFOLDING_ENGINE = CONDITIONED` specifically for R2. `CONTENT_
GROUNDING = ADEQUATE` rather than `STRONG` because §7's grounding is
entirely pre-existing/reconciled rather than newly certified by this
phase's own tests.

---

**STOP AFTER FINAL REPORT.** No commit. No push. No deploy. Phase 6 not
begun.
