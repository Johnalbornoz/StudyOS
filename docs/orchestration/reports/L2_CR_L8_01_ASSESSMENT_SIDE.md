# L2 — CR-L8-01 assessment side: subject-aware exam-gap aggregates (2026-10-11)

## LANE
L2 — ASSESSMENT ENGINE / QUESTION BANK — worktree `/Users/jalbornoz/PROYECTOS/studyos-qb-r1a`, branch `feat/l2-cr-l8-01-subject-aggregates` (local only), cut from the release base `4fb45b0` so it applies to the convergence line without the generator work.

## STATUS
READY_FOR_ORCHESTRATOR_REVIEW

| Gate | Result |
|---|---|
| CR_L8_01_ASSESSMENT_SIDE | PASS |
| SUBJECT_AWARE_AGGREGATES | PASS |
| L2_RELEASE_DEPENDENCY | CLOSED (assessment side; L10 / L8 still have to switch their caller to the option) |

## BASE SHA
4fb45b0

## FINAL SHA
The single commit on `feat/l2-cr-l8-01-subject-aggregates` whose parent is `4fb45b0` (`git rev-parse feat/l2-cr-l8-01-subject-aggregates`).

## FILES CHANGED
- `src/lib/exam-core/exam-gaps.service.ts` — `canonicalSubjectIds` option on `examGapsFor`; exported pure helpers
- `tests/unit/l2-cr-l8-01-subject-aware-gaps.test.ts` — 7 tests
- `scripts/operations/l2-cr-l8-01-subject-gaps-cert.sh`, `scripts/operations/l2-cr-l8-01/subject-gaps-cert.ts` — ephemeral-database certification of the real query
- `docs/orchestration/reports/L2_CR_L8_01_ASSESSMENT_SIDE.md`

Not changed: any authorization module, any Teacher / Institution route or read model, any schema or migration, `examGoalsFor`, `examParticipation`.

## LOCKS USED
Exam core (L2's own). No `SHARED_FOUNDATION`, no `SCHEMA_AND_MIGRATIONS`, no Stage, no shared database.

## TESTS
| Command | Result |
|---|---|
| `npx vitest run tests/unit/l2-cr-l8-01-subject-aware-gaps.test.ts` | 7 passed |
| `./scripts/operations/l2-cr-l8-01-subject-gaps-cert.sh` (temporary local Postgres: baseline + 82 migrations + catalogue seeds + two fixture Students) | 18 checks PASS, exit 0 |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `env -u DATABASE_URL npx vitest run` | 520 files / 9,297 tests passed |
| `npx next build` | exit 0 |

## FINDINGS

### The contract L8 / L10 must use

```ts
import { examGapsFor, type ExamGapOptions, type GapAggregate } from '@/lib/exam-core/exam-gaps.service';

examGapsFor(studentIds: string[], opts: {
  families?: string[];
  includePerStudent: boolean;
  canonicalSubjectIds?: readonly string[];   // NEW — canonical_subjects.id values
}): Promise<GapAggregate>
```

`GapAggregate` is unchanged in shape.

| `canonicalSubjectIds` | Behaviour |
|---|---|
| absent (`undefined`) | Unscoped, exactly as before. For callers whose authorization covers the whole learner (Institution intelligence route, internal use). |
| one or more valid ids | Every aggregate — `byDomain`, `byObjective`, `byConcept`, `perStudent` (and `perStudent[].gaps`, `studentsWithResults`) — is built only from gap objectives that have a PUBLISHED mapping to a canonical concept of one of those subjects. |
| objective mapped to concepts of several subjects | Contributes only its in-subject concepts; the objective appears in each of its subjects' slices. |
| objective with no published concept mapping | Omitted from every scoped answer (fail closed). |
| present but empty, or no valid UUID | Returns the empty aggregate without querying (fail closed). Never falls back to unscoped. |
| unknown subject id | Empty aggregate. |

Rules for the caller:

1. **Teacher surfaces must always pass the option.** Pass the class's `canonical_subject_id` as `[id]`. If the class has no linked subject, pass `[]` (or do not call): the answer is empty. Never pass `undefined` on a Teacher path — `undefined` means unscoped.
2. The service does not authorize. It never reads an actor, a role or a class and never widens `studentIds`. Which Students and which subject(s) is L10's decision (`getTeacherClassExamGaps`).
3. With the option, `getTeacherClassExamGaps` no longer needs to cut at concept level or withhold `byDomain` / `byObjective`: it can return the scoped aggregate as is. `perStudent[].gaps` is then the number of in-subject gap **objectives** (its original meaning), not concepts.
4. The subject is the canonical subject of the mapped concept. A PAA algebra objective is mapped to concepts of both `Matemáticas` and `Mathematics`; a class linked to one of them receives only that slice. Subjects are not bridged by name.

### What this does not cover
- Exam **goals** (`examGoalsFor`) and AICE syllabus entries have no governed link to a canonical subject, so they cannot be subject-scoped by this option. L10 currently returns them empty on the Teacher path; that stays correct. Subject attribution for goals, AICE syllabi and review items is the remainder of CR-L10-01 / CR-L10-08 and is not in this patch.
- No Teacher or Institution caller was changed here. Until L10 / L8 pass the option, behaviour on their branches is what it was.

### Evidence
The certification runs the real query with a real multi-subject exam (PAA) and the seeded catalogue: Matemáticas returns algebra and data; Mathematics returns algebra alone with Mathematics concepts only; Lectura returns the inference objective for both Students; the unmapped objective appears only unscoped; empty, malformed and unknown scopes return nothing; the Student set is never widened.

## BLOCKERS
NONE.

## CHANGE_REQUESTS
- To L10 (owner of `src/lib/authorization/teacher-exam-scope.ts`): call `examGapsFor(..., { canonicalSubjectIds: [classCanonicalSubjectId] })` (or `[]` when the class has no subject) and return the scoped `byDomain` / `byObjective`.

## MERGE RECOMMENDATION
Merge into the convergence line: one commit on `4fb45b0`, one application file. File overlap with L10: none (`exam-gaps.service.ts` was not edited there).

## NEXT SAFE ACTION
Orchestrator routes the caller change to L10 / L8.
