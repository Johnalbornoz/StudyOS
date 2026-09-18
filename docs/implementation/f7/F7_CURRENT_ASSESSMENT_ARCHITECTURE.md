# F7 — Current Assessment Architecture Assessment

Branch: `f7/assessment-framework-engine`, baseline `f6/curriculum-standards-mapping` @
`cd221ccf3ca6a2435f2557dbe3f14a75a2ba6c58`

Written before any F7 source change, per task §3. Based on a full-repo code trace of question
generation, AI validation, grading/evaluation, framework hard-coding, and institution-policy
precedent.

## 1. Current generation authority

`src/services/quiz-generation.service.ts` (3144 lines) is the one generation engine, orchestrated
per pedagogical stage by `canonical-prove-generation.service.ts`, `canonical-retain-generation.service.ts`,
`canonical-transfer-generation.service.ts`, all funneling through the shared
`gated-question-generation.service.ts` pipeline: generate → deterministic Quality Gate → independent
semantic verify (different model) → exact-duplicate novelty filter → bounded recovery. This
pipeline is **already exam-family-agnostic** — F7 must plug into it, never replace it.

`GeneratedQuestion` already has real, generic, reusable vocabulary F7 should extend rather than
duplicate:
- `type: QuestionType` — 18-value union, mapped exhaustively to a smaller `answerFormat`.
- `difficulty: number` — **1-5 integer scale**, with one canonical prose description per tier
  (`describeDifficultyTier`) shared verbatim by the generator and the semantic verifier.
- `cognitiveLevel?: CognitiveLevel` — `RECALL | COMPREHENSION | APPLICATION | ANALYSIS | SYNTHESIS
  | EVALUATION` (Bloom's-style, already generic, already requested from the AI on every question).
- `expectedReasoningType?: ExpectedReasoningType` — `FACTUAL | PROCEDURAL | CONCEPTUAL |
  METACOGNITIVE`.
- `calculatorAllowed?: boolean` — the only existing tool-rule representation, per-question only.
- `learningObjectiveId?: string` — the field **already exists** but has never been populated by
  any generation call site (no curriculum-mapping input existed pre-F7).

## 2. Current evaluation authority — scattered, not unified

Four independent grading shapes exist, each with its own result type and its own call site:
1. `gradeStructuredAnswer()` — deterministic, selected-response types, partial credit for
   multi_choice/matching/ordering/classification.
2. `gradeAnswer()` — AI-graded free text, returns `{correct, score (0-1), feedback, confidence,
   errorType, reasoningValid, aiExecution}`.
3. `evaluateExplanation()` (`explain-defend.service.ts`) — a separate 0-4 rubric shape
   (`conceptAccuracy/reasoning/completeness/misconceptionDetected`), legacy Explain & Defend only.
4. `evaluateTransferResponse()` (`transfer.service.ts`) — a third shape, legacy pre-canonical
   Transfer only; canonical Transfer instead reuses `gradeAnswer()`.

F7's evaluation contract must wrap/reconcile these into one persistence envelope, never replace
the graders themselves (which are existing, tested, working code).

## 3. Framework hard-coding — one clean precedent (IB), nothing else

`src/lib/ib.ts` and an optional `ibContext` parameter threaded into `quiz-generation.service.ts`
are the **only** exam-family-specific code in the repo, and the pattern is already clean: IB
context is caller-supplied, data-driven, and only changes prompt **phrasing** (command-term
wording), never `types`/difficulty range/item count/answer-format logic. No `if
(examFamily==='IB')` branch exists inside the generation engine itself. Zero `Cambridge`/`IGCSE`/
`PAA` references exist in `src/` outside F6's curriculum-layer fixture data. **This is the pattern
to generalize** (task §2's "one configurable engine"), not an anti-pattern to remove.

`resolveActivityMetadataForObjective` (F6) has **zero callers anywhere** — the bridge exists but
nothing consumes it yet. F7 is the first real consumer.

## 4. Timing/calculator/tool rules — flags only, genuinely greenfield

`src/lib/assessment-profiles.ts`'s `AssessmentProfile.timed`/`.examStructure` are booleans only,
with an explicit doc comment: "Purely a config flag here — Phase 3B does not implement the timer
itself." No duration/time-limit column exists anywhere (`quiz_sessions.expires_at` is a session
idle-expiry, not an exam time limit). No section-level or exam-level calculator/tool-constraint
data exists — only the single per-question `calculatorAllowed` boolean. F7 must build this from
scratch.

## 5. Existing mock-exam concepts — already distinct, but structure-less

`MOCK_EXAM` and `CUMULATIVE_ASSESSMENT` are already distinct `ActivityType` values with their own
`AssessmentProfile` (verification strictness, `randomizeQuestions`, `examReadinessComparison`),
and `EXAM_SIMULATION` is an existing `EvidenceSourceType` with its own mastery weight (0.8) — this
is the exact source type F7's evidence bridge should reuse for assessment-attempt evidence,
**no new enum value needed**. `exam-result.service.ts`'s `recordExamResult` is a third, unrelated
concept (an offline school exam's reported score) — not touched by F7.

## 6. Validation layer already exists — F7 adds exam-context checks alongside it, never replaces it

The Quality Gate (`question-quality-contract.ts`, deterministic) + independent semantic verifier
(`question-quality-verifier.service.ts`, different model, "the generator can never self-certify")
+ exact-duplicate novelty filter (`exact-duplicate-novelty.ts`) already answer answerability,
schema validity, and duplication. **F7 must not reimplement these.** F7's own validation layer
(task §26) adds only the genuinely new exam-context checks this pipeline has no way to know about:
mapping compatibility (published only), exam-version/component compatibility, tool-rule
compatibility, command-term compatibility.

## 7. Institution/exam policy — genuinely greenfield

`institutions`/`institution_memberships` (F2) carry no policy/config data. F6's
`academic_programmes.programme_type = 'ADMISSION_EXAM'` is a curriculum-layer classification tag,
not an institution-scoped policy object. No precedent exists for Institution Exam Policy — F7
builds this from scratch.

## Migration risks

- `learning_evidence`, `mastery_records`, `concept_knowledge_state`, and every Canonical-V2-owned
  table remain untouched by F7's own schema — F7 only *calls* the existing, unmodified
  `updateMastery()` function when bridging an evaluated response to evidence, exactly the way F5's
  own metadata fields were designed to be used by a future caller.
- Recording evidence for an F6 `learning_objective` requires a **per-student** `conceptId`/
  `subjectId` (evidence is fundamentally per-student-scoped) — F7 does not attempt to
  auto-resolve or fabricate this mapping; the caller must already hold a per-student concept
  `MATCHED` (F4) to the objective's canonical concept, or evidence simply cannot be recorded yet
  for that student/objective pair. This is disclosed explicitly, not silently worked around.
- Four existing grading result shapes must be wrapped, not unified by rewrite — rewriting any of
  them risks regressing the existing, tested quiz/explain/transfer pipelines.

## High-risk consumers (must be regression-tested after F7)

- The complete Canonical V2 suite — F7 must not introduce any read/write path from assessment
  configuration or scoring into PRACTICE/PROVE/RETAIN/TRANSFER decisions.
- `updateMastery`'s transaction (F5) — F7 is a new *caller*, never a modifier, of this function.
- F6's `resolveActivityMetadataForObjective`, `objective_concept_mappings`/`_skill_mappings`/
  `_competency_mappings` PUBLISHED-only semantics.
- F4's `concept_catalog_mapping` MATCHED/AMBIGUOUS/UNRESOLVED semantics (reused for the reverse
  per-student-concept lookup).
- F1/F2 identity and authorization — Student Exam Profile management must compose with, never
  bypass, `canAccessLearner`/relationship scoping.
