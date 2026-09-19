# F11-C3 — Competency Evidence Contract

## The chain, verified by direct code inspection (not assumed)

```
teacher_interventions.competency_id (explicit Teacher target)
        ↓
startCompetencyReinforcementExecution resolves ONE deterministic concept context
   (via canonical_concept_competencies -- the DIRECT edge, never routed through skill_competencies)
        ↓
storeQuiz(..., targetSkillIds: null, targetCompetencyIds: [competencyId])   -- NEW, additive, optional param
        ↓
quiz_sessions.target_competency_ids = [competencyId]  -- NEW, additive, nullable column, SEPARATE from target_skill_ids
        ↓
(student submits through the EXISTING, UNMODIFIED /api/quizzes/generate-and-take route)
        ↓
metadata: { ...existing fields, ...(quizSession.targetCompetencyIds ? { competencyIds: quizSession.targetCompetencyIds } : {}) }
        ↓
updateMastery({ ..., metadata })   -- F5, real, unmodified
        ↓
learning_evidence.metadata.competencyIds = [competencyId]   -- the REAL evidence writer's own row
        ↓
projectCompetencyStateForNewEvidence(client, studentId, metadata)  -- ALREADY called by updateMastery, unconditionally, for every call
        ↓
learner_competency_state upserted by F5's own projector -- ZERO F11-C3 code involved in this step
```

## Why this is the smallest possible extension

Three files touched outside newly-created F11-C3 files, mirroring F11-C2's own pattern exactly:

| File | Change | Behavior when omitted (100% of pre-existing callers) |
|---|---|---|
| `src/services/quiz-persistence.service.ts` | `storeQuiz`'s new last parameter `targetCompetencyIds?: string[] \| null` (after F11-C2's `targetSkillIds`); `QuizSession.targetCompetencyIds` field; `getQuizSession` selects/maps the new column | `undefined` → column stays `NULL` → field reads back `null` |
| `src/app/api/quizzes/generate-and-take/route.ts` | One conditional spread line, immediately after F11-C2's Skill line, guarded on `quizSession.targetCompetencyIds` being non-empty AND matching the current bucket's `conceptId` | Spread contributes `{}` — metadata byte-identical to pre-F11-C3 |
| `database/migrations/...` | One new nullable column, one further-widened CHECK | No existing row affected |

No route-to-route call. No copied route logic. No fork of the Practice engine. The full named regression suite (346 files, 5580 tests) passes unchanged after this addition, including the 4 files whose positional-index assertions (`params[params.length - N]`) were proactively re-shifted by one more position before the full suite was run (a known recurring consequence of `storeQuiz` growing a trailing parameter, first hit in F11-C2 — see `F11_C3_QA_REPORT.md`).

## Two independent tags, never conflated

`targetSkillIds` and `targetCompetencyIds` are separate parameters, separate columns, and separate metadata keys. The Competency path's `storeQuiz` call always passes `null` for `targetSkillIds`; the Skill path's call never references `competencyId` at all; the Concept path's call references neither. This is proven structurally (source guard regexing each function's exact `storeQuiz(...)` call) and behaviorally (Case T: a student with several Competency-K executions, where Skill S is a real S→K edge, ends the run with zero `learner_skill_state` rows for S).

## Traceability, not inference

`metadata.competencyIds` on a real `learning_evidence` row traces backward via the quiz id embedded in `identity.operationId` → `teacher_intervention_executions.execution_reference` → `teacher_interventions.competency_id` (the original Teacher-set target). At no point does this chain pass through `canonical_concept_competencies` or `skill_competencies` for the purpose of deciding *which* competency to tag — those tables are read exactly once, at concept-context-resolution time, for a completely different purpose (finding which concept to practice).

## Non-inference, proven in both graph directions (task §12/§13)

- **Concept→Competency (Case D)**: a real Concept C with a real `canonical_concept_competencies` edge to Competency K is practiced ordinarily (F11-C1 path, no `competencyIds` passed). Result: `getCompetencyState(studentId, K)` returns `null`.
- **Skill→Competency (Case E, "one of C3's highest-priority assertions")**: a real Skill S with a real `skill_competencies` edge to Competency K is practiced legitimately (F11-C2 path, `skillIds: [S]` passed, producing real Skill Evidence). Result: `getCompetencyState(studentId, K)` still returns `null` — Skill Evidence never becomes Competency Evidence, even when a real graph edge exists and the underlying Skill State was successfully created.

Both proofs ran against real ephemeral Postgres, real service calls, real graph edges — not mocked or assumed.
