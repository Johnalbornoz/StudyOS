# F8 — Current Teaching/Diagnostic Architecture Assessment

Baseline: `origin/f7/assessment-framework-engine` @ `c4fa9f3c96019152b45c74bd01e22fbc93bc592d`
Date: 2026-09-18
Status: written before any F8 source change, per task §3.

This document synthesizes two independent research passes over F4–F7, Canonical V2, and the existing teaching/AI infrastructure. It is the required "inspect first" gate before any F8 implementation begins.

## 1. Existing teaching authority — two parallel systems

There are **two, not one**, "why is the learner struggling / what should happen next" systems already live:

1. **Legacy Phase 4/5 pipeline** (`src/lib/adaptive-learning-policy.ts` → `LearningDecision`/`LearningState`; `src/lib/adaptive-teaching-policy.ts` → `computeTeachingIntent`/`PrimaryBarrier`/`SupportLevel`/`ExplanationDepth`; `src/lib/lx/teaching-experience.ts::deriveTeachingExperience` → 5-mode presentation contract `EXPLAIN → MODEL → GUIDE → PRACTICE → INDEPENDENT`). This is authoritative whenever `CANONICAL_ENGINE_V1_ENABLED !== 'true'`.
2. **Canonical V2** (`src/lib/pedagogical-engine`, `-decision`, `-shadow`, `-migration`) — authoritative for pedagogical stage (`LEARN|PRACTICE|PROVE|RETAIN|TRANSFER|CONSOLIDATED`) whenever the flag is on. Read-only entry point: `getCanonicalPedagogicalDecision({studentId, conceptId})` (`src/lib/pedagogical-decision/canonical-decision.service.ts:77`).

**Decision for F8**: F8 targets Canonical V2 as the sole progression authority it reads from (per INV-F8-01), using `getCanonicalPedagogicalDecision` as its only read surface into pedagogical state — never re-deriving stage, never calling `evaluateCanonicalLearningState`/`qualifyEvidence`/`rebuildConceptCanonicalState` itself. F8 does not attempt to reconcile or feed the legacy `adaptive-teaching-policy.ts` pipeline; that pipeline's `PrimaryBarrier` taxonomy is left untouched and unextended. This is a real architectural fork already present in the codebase, not one F8 introduces.

`TeachingExperienceView`'s 5-mode taxonomy (`EXPLAIN`/`MODEL`(worked example)/`GUIDE`(guided practice)/`PRACTICE`(independent practice)/`INDEPENDENT`(Prove-equivalent)) is the closest existing analog to the task's required Explain→Worked Example→Guided Practice→Contextual Help→Independent Practice→Prove vocabulary. F8's intervention-type vocabulary reuses this naming (adding CONTEXTUAL_HELP as its own distinct value, since the legacy view collapses hints into `GUIDE`), rather than inventing new names for the same concepts.

## 2. Existing feedback paths

Four scattered graders already exist and are the ONLY graders F8 may wrap, never reimplement:

| Grader | File | Returns | Error-type richness |
|---|---|---|---|
| `gradeStructuredAnswer` | `quiz-generation.service.ts:2620` | `{correct, score, feedback}` | none — deterministic, no AI |
| `gradeAnswer` | `quiz-generation.service.ts:2769` | `{correct, score, feedback, confidence, errorType, reasoningValid, aiExecution}` | `GradingErrorType = CONCEPTUAL\|PROCEDURAL\|CARELESS\|INCOMPLETE\|MISREADING\|ARITHMETIC\|UNIT` |
| `evaluateExplanation` | `explain-defend.service.ts:117` | 4-dimension rubric + misconception flag | none (rubric-shaped, not error-typed) |
| `evaluateTransferResponse` | `transfer.service.ts:209` | `{result, feedback, aiExecution}` | none |

None of the four takes exam/framework context (command term, required structure, rubric, tool rules) as input, and none classifies a command-term-interpretation or required-structure failure. `GradingErrorType.INCOMPLETE`/`ARITHMETIC`/`UNIT`/`CARELESS` already cover part of F8's required Feedback Contract (task §19: "incomplete answer," "calculation/error-in-execution"); F8 extends this vocabulary additively rather than replacing it.

`assessment_components.procedure_required` (F7 schema) exists but is read by zero code today — F8 is its first consumer.

## 3. Existing help/assistance semantics

`ai_assistance_type` (`NONE|HINT|MULTIPLE_HINTS|TUTOR_GUIDANCE|TUTOR_EXPLANATION|WORKED_EXAMPLE|OTHER`, stored per `learning_evidence` row) plus `hints_used` (int) is the entire existing representation. Every downstream consumer (Knowledge State, F5 projectors, Canonical V2's `qualifyEvidence`) treats it as a **binary**: `NONE` = independent, anything else = assisted. The distinct stored values (`HINT` vs `WORKED_EXAMPLE` vs `TUTOR_EXPLANATION`) are captured but nothing branches on the difference today. This binary is load-bearing (INV-F8-06's "assisted ≠ independent" is already true at the data layer) — F8 must preserve it exactly, not redefine it, when writing intervention evidence.

`TeachingExperienceView.retryAllowed`/`helpAvailable`/`isProve` (`src/lib/lx/teaching-experience.ts`) are the only existing "is help/retry allowed right now" flags, UI-facing only, not evidence-shaping.

## 4. Existing misconception logic

Truth store: `misconception_signatures` (canonical, per-concept). Per-student lifecycle: `student_misconceptions` with `status ACTIVE|RESOLVED`, `resolved_by_evidence_id` FK to `learning_evidence`, full transition history in `decision_events`. Service: `src/services/misconception.service.ts`. **F8 reuses this truth store verbatim** (`getActiveMisconceptionSignatureIdsForConcept`) as one candidate KNOWLEDGE_GAP signal (repeated misconception = knowledge signal per task §6) — it never creates a second misconception store, per task §27.

Two *unrelated* existing "diagnosis"-shaped systems must not be confused with F8's new gap taxonomy:
- `cognitive-diagnosis.service.ts` (`DiagnosisState = SUSPECTED|LIKELY|DIAGNOSIS_REQUIRED|CONFIRMED|REJECTED`) — answers "which *prerequisite concept* is the root cause," a different question, root-cause-concept-scoped, not knowledge/skill/technique/speed-scoped.
- `remediation.service.ts` (`RemediationPattern = LOW_MASTERY|LOW_RETENTION|LOW_INDEPENDENCE|OVERCONFIDENT|TRANSFER_WEAKNESS|DEFAULT`) — a "minimum effective intervention" selector keyed on a confirmed root-cause diagnosis, not on F8's gap types.

F8 introduces a **new, distinctly-named** vocabulary (gap classification: `KNOWLEDGE_GAP|SKILL_GAP|EXAM_TECHNIQUE_GAP|SPEED_FLUENCY_GAP|MIXED|INSUFFICIENT_EVIDENCE`) rather than overloading `DiagnosisState`/`RemediationPattern`/`PrimaryBarrier`, all three of which already exist and mean something else. There are now, deliberately and by design, four adjacent-but-distinct "why/what" taxonomies in the codebase (legacy `PrimaryBarrier`, root-cause `DiagnosisState`, remediation `RemediationPattern`, and F8's gap classification); this document records that this is a known, accepted plurality — not a duplication to be silently collapsed — because each answers a genuinely different question at a different scope.

## 5. Available Evidence

`learning_evidence` (F5) already carries everything F8 needs to build on: `source_type`, `result`, `difficulty`, `score_percent`, `ai_assistance_type`, `hints_used`, `confidence_before_answer`, and an open `metadata jsonb` column already used for `skillIds`/`competencyIds` (F5 exact-tag convention: `metadata -> 'skillIds' @> to_jsonb($skillId)`), transfer-challenge tags, and `behavior.responseTimes` (timing, §6 below). F8's own metadata additions (framework, exam version, component, question type, command term id, reasoning requirement) follow this exact established convention — new `metadata` keys, never a new column, never a retrofit of historical rows.

`updateMastery()` (`src/services/mastery.service.ts:361`) is the one writer; F8 writes Evidence exclusively through it, exactly as F7's evidence bridge already does.

## 6. Available Timing Data

`src/lib/algorithms/response-timing.ts` is a complete, already-shipped, unused-by-F8-yet module: `normalizeResponseTiming({questionPresentedAt, answerSubmittedAt}) -> {responseTimeMs, quality: VALID|MISSING|INVALID|CLOCK_SKEW|OUTLIER}`. Explicit existing design invariant: timing never affects grading/mastery, purely observational. This `quality` field is exactly the gate task §9/INV-F8-09 requires ("Speed/fluency claims require valid timing context") — F8's Speed/Fluency Gap classifier must only consider rows where `quality === 'VALID'`.

**Gap**: there is no per-question or per-component "expected time" anywhere yet. `assessment_components.duration_minutes` (F7) is a whole-component budget, not a per-item expectation. F8 must derive an expected-time baseline from policy configuration (a versioned default, or a per-difficulty/per-questionType expectation in the diagnostic policy rules) rather than inventing a fabricated "official" per-item timing rule that doesn't exist in F7's schema. This is why task §9 requires "known timing expectation" as its own precondition, separate from "valid timing metadata" — F8 must be able to say INSUFFICIENT_EVIDENCE / speed diagnosis blocked when no expectation is configured for the given difficulty/question type, exactly as adversarial case H requires.

## 7. Assessment metadata available (F7)

- `resolveGenerationContext(blueprintObjectiveTargetId, studentId) -> GenerationContext` (`src/lib/assessment/generation-contract.service.ts:13`) — assembles concept/skill/competency ids (via F6's `resolveActivityMetadataForObjective`, PUBLISHED-only), `questionType`, `difficultyRange`, `reasoningRequirement`, `commandTerm{id,term}`, `toolContext`, `timingContext`. **F8 wraps/extends this, never re-resolves it.**
- `command_terms` table: only `term`, `expected_reasoning_type` (free text, no CHECK), `description` — **no per-framework meaning, no expected-answer-structure, no rubric-criteria mapping**. This is a genuine, confirmed gap: F8 needs a new companion table (`command_term_interpretations`, framework-scoped) to hold that data, additive to `command_terms`, never replacing it.
- `validateItemForExamContext`/`validateComponentSupported` (`validation.service.ts`) check only `{type, difficulty}` vs `{questionType, difficultyRange}`, tool-rule configuration, and mapping existence — **they never compare a candidate/response against `commandTerm`/`reasoningRequirement`/tool rule content.** F8's own validation is exactly this missing comparison, added alongside (not replacing) F7's validator.
- `student_exam_profiles` (`student_id, exam_definition_id, exam_version_id, ...`) is confirmed as **the** representation of "the learner's active academic/assessment framework" — F8 resolves framework identity from here, never invents a parallel concept of it.
- **Framework identity is not a direct column anywhere.** It is reachable only by walking `exam_version_id → exam_definition_id → (exam_family, academic_programme_id) → academic_organization`, or (for curriculum-side objectives) `learning_objective_id → structure_node_id → structure_version_id → academic_subject_id → programme → organization`. F8 needs one small resolver function for each direction; this is confirmed new code, not new schema for framework identity itself.
- `ib.ts::commandTermsForDifficulty()` is a live, hardcoded, un-migrated anti-pattern (`if (ibContext) {...}` in `quiz-generation.service.ts:2989`) that F7's `command_terms` table was explicitly built to replace. **F8 must not extend `ib.ts` or add any new `if (examFamily === X)` branch anywhere** — all framework-specific teaching flavor is expressed as rows a single generic renderer reads, exactly as `exam_family` is "just a row" on `exam_definitions`.

## 8. Gaps (what F8 must build from scratch)

1. The `KNOWLEDGE_GAP|SKILL_GAP|EXAM_TECHNIQUE_GAP|SPEED_FLUENCY_GAP|MIXED|INSUFFICIENT_EVIDENCE` taxonomy and its versioned, deterministic classifier — nothing today produces this vocabulary.
2. A versioned diagnostic policy (rules/thresholds) and a versioned intervention-selection policy — new tables, following F5's `aggregation_policy_versions` idiom exactly (one ACTIVE row per policy family, partial unique index, append-only history).
3. `command_term_interpretations` — per-framework (per-`academic_programme_id`) expected structure / rubric notes / common failure patterns for a command term, additive to `command_terms`.
4. A framework-identity resolver (walking the joins above), with the resolved result **frozen** at the moment an intervention session is created (mirroring F7's `exam_attempts.frozen_configuration` pattern) so a later mapping retirement cannot alter historical activity (adversarial case N).
5. A new "intervention session + attempt" persistence pair. `quiz_sessions` (extended additively by Canonical V2 for its own launch/authorization needs) does not fit F8's non-quiz interventions (Explain, Worked Example standalone, Contextual Help) or its retry/diagnosis-linkage requirements. `exam_attempts`/`exam_attempt_item_responses` (parent session + child attempts) is the closest structural precedent and is the pattern F8's own `intervention_sessions`/`intervention_attempts` follows.
6. An AI teaching-generation contract (new `AICapability`-routed call, using `executeAI`/`callModel` exactly as every existing AI call site does) and its own two-pass validation (deterministic schema/context check, then an independent stronger-model semantic pass) — modeled directly on the Quality Gate (`question-quality-contract.ts` + `question-quality-verifier.service.ts`), never reimplementing question generation itself.
7. New EXAM_TECHNIQUE-specific feedback reason codes (command-term mismatch, structure incomplete, rubric criteria missed, tool constraint violated) — additive alongside `GradingErrorType`, not replacing it.

## 9. Duplication risk register

| Risk | Mitigation adopted |
|---|---|
| A third "why is the learner struggling" enum colliding with `PrimaryBarrier`/`DiagnosisState`/`RemediationPattern` | New, distinctly-named vocabulary; no attempt to unify or replace the other three (§4) |
| A second misconception store | Reuse `misconception_signatures`/`student_misconceptions` verbatim as one KNOWLEDGE_GAP signal input |
| A second "error taxonomy" name colliding with `ErrorType` (learner mistakes) or `CanonicalErrorCode` (system failures) | F8's technique-failure reason codes are named distinctly (e.g. `COMMAND_TERM_MISMATCH`) and live alongside `GradingErrorType`, never renamed to "ErrorType" or "ErrorCode" |
| Re-deriving Canonical V2 stage/qualification logic | F8 calls `getCanonicalPedagogicalDecision` read-only; never imports `pedagogical-engine` internals |
| Re-resolving F6 concept/skill/competency mappings independently | F8 calls `resolveActivityMetadataForObjective` verbatim, same as F7 |
| A new hardcoded per-framework branch (anti-pattern already live in `ib.ts`) | All framework flavor expressed as data rows F8 reads generically |
| A second learning-session authority | `intervention_sessions`/`intervention_attempts`, scoped narrowly to F8's own diagnostic/teaching flow, additive, never touching `quiz_sessions` |
| Skill Gap fabricated from the F4/F6 concept→skill graph alone | F8's skill-evidence gate reuses F5's exact `metadata -> 'skillIds' @> to_jsonb($skillId)` predicate — concept→skill mapping existing is never sufficient by itself |
| Competency Evidence fabricated from contextual relevance | F8 never writes `competencyIds` metadata unless the evidence source (e.g. F7's evidence bridge) already qualified it; F8 introduces no new competency-attachment path of its own |

## 10. Canonical V2 collision risks — confirmed none, with specific guardrails

- F8 will call `getCanonicalPedagogicalDecision` for READ-ONLY context enrichment of a diagnosis (e.g. "is the learner currently LOCKED/WAITING") but never call `evaluateCanonicalLearningState`, `rebuildConceptCanonicalState`, or `qualifyEvidence`.
- F8 will never write to `pedagogical_requirement_recognition`, `canonical_prepared_activity`, `concept_transfer_state`, `concept_knowledge_state`, or any other Canonical-V2-owned table.
- F8 will never expose `PROVE_PASSED`/`PRACTICE_PASSED`/`RETAIN_PASSED`/`TRANSFER_PASSED`-shaped vocabulary from any of its own routes/services.
- F8's evidence writes go exclusively through `updateMastery()`; Canonical V2 then independently decides, under its own existing rules, whether that evidence qualifies for a stage transition. F8 diagnosis alone produces zero direct stage changes — this is asserted structurally (`f8-canonical-v2-noninterference.test.ts`, mirroring F5/F7's own test) and behaviorally (task §48: same Evidence fixtures before/after F8 → same Canonical decisions, proven in the real-Postgres certification).

## 11. Authorization/entitlement primitives confirmed reusable

- `LearnerPermission` already includes `LEARNER_INTERVENTION_CREATE` (`src/lib/authorization/permissions.ts:8`), already wired into `OWNER_PERMISSIONS` in `canAccessLearner` (`src/lib/authorization/index.ts:97`) — satisfiable today only by the learner themself (or whoever is the canonical owner of that profile), never by parent or teacher relationships. Its own inline comment notes it was reserved ahead of time for "no code path creates an intervention yet" — worded as anticipating a later phase (the comment's own label for that later phase does not match this roadmap's current F8/F9/F10/F11 numbering, which has evidently been revised since that comment was written). **F8 is the first real consumer of this permission**, using it unmodified to gate "start/create a teaching intervention" — no new permission value, no F2 code change, exactly the "extend the table" outcome that comment invited.
- `LEARNER_PROGRESS_VIEW`/`LEARNER_PROFILE_VIEW` (already satisfiable by owner, parent, and teacher) gate diagnosis/session read routes.
- `canUseCapability(actor, learner, 'LEARNING_FULL_ACCESS')` (F3) gates the one paid/resource-consuming action (AI teaching-content generation at intervention start), mirroring `session-eligibility`'s existing pattern exactly. Diagnosis itself (pure evidence classification, no AI) is not gated by entitlement — authorization and entitlement remain separate, per task §35.

## 12. Conclusion

No blocking collision was found. F8 has a clear, additive path: new tables (diagnostic/intervention policy versions, gap diagnoses, intervention sessions/attempts, command-term interpretations), new services following established F5/F6/F7 idioms exactly (versioned policy, pure classification algorithm, read-only explainability, fail-controlled validation, `executeAI`-routed generation), and zero required changes to any existing file's *behavior* (only new call sites reading existing exports). Implementation may proceed.
