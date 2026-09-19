# F11-C2 — Skill Evidence Contract

## The chain, verified by direct code inspection (not assumed)

```
teacher_interventions.skill_id (explicit Teacher target)
        ↓
startSkillReinforcementExecution resolves ONE deterministic concept context
        ↓
storeQuiz(..., targetSkillIds: [skillId])   -- NEW, additive, optional param
        ↓
quiz_sessions.target_skill_ids = [skillId]  -- NEW, additive, nullable column
        ↓
(student submits through the EXISTING, UNMODIFIED /api/quizzes/generate-and-take route)
        ↓
metadata: { ...existing fields, ...(quizSession.targetSkillIds ? { skillIds: quizSession.targetSkillIds } : {}) }
        ↓
updateMastery({ ..., metadata })   -- F5, real, unmodified
        ↓
learning_evidence.metadata.skillIds = [skillId]   -- the REAL evidence writer's own row
        ↓
projectSkillStateForNewEvidence(client, studentId, metadata)  -- ALREADY called by updateMastery, unconditionally, for every call
        ↓
learner_skill_state upserted by F5's own projector -- ZERO F11-C2 code involved in this step
```

## Why this is the smallest possible extension

Three files touched outside newly-created F11-C2 files, each by exactly one additive, optional, default-safe change:

| File | Change | Behavior when omitted (100% of pre-existing callers) |
|---|---|---|
| `src/services/quiz-persistence.service.ts` | `storeQuiz`'s new last parameter `targetSkillIds?: string[] \| null`; `QuizSession.targetSkillIds` field; `getQuizSession` selects/maps the new column | `undefined` → column stays `NULL` → field reads back `null` |
| `src/app/api/quizzes/generate-and-take/route.ts` | One conditional spread line in the existing metadata object literal, guarded on `quizSession.targetSkillIds` being non-empty AND matching the current bucket's `conceptId` | Spread contributes `{}` — metadata byte-identical to pre-F11-C2 |
| `database/migrations/...` | One new nullable column, one widened CHECK | No existing row affected |

No route-to-route call. No copied route logic. No fork of the Practice engine. Confirmed by re-running the full existing Practice/quiz test suite (88 files, 1532 tests, including the specific `canon-r5r1`/`canon-r6`/`lx9`/`quiz-persistence-evidence-mode` suites that directly assert on `storeQuiz`'s exact INSERT shape) — all pass after updating 4 tests whose assertions hardcoded the *positional index from the end* of the params array (see `F11_C2_QA_REPORT.md` §Bugs for the real regression this surfaced and how it was fixed).

## Traceability, not inference

`metadata.skillIds` on a real `learning_evidence` row can be traced backward: `learning_evidence.metadata.skillIds` → `quiz_sessions.target_skill_ids` (same quiz id, via `learning_evidence.metadata`'s own `context.interventionSessionId`-style pattern is not used here — the trace is via the quiz id embedded in `identity.operationId`) → `teacher_intervention_executions.execution_reference` → `teacher_interventions.skill_id` (the original Teacher-set target). At no point does this chain pass through `canonical_concept_skills` — that table is read exactly once, at concept-context-resolution time, for a completely different purpose (finding *which* concept to practice), never to decide *which skill* the evidence should be tagged with.

## Competency non-fabrication (structural, not defensive)

`learner_competency_state` is projected from a **completely separate** metadata key, `metadata.competencyIds` (`src/lib/learner-state/competency-state.service.ts`). F11-C2 never writes that key anywhere — confirmed by a source guard (`f11c2-skill-execution-source-guard.test.ts`) and by real-Postgres certification (`learner_competency_state` count is 0 across every student touched by the entire F11-C2 certification run, despite F4 potentially defining Skill→Competency edges for the tested skill).
