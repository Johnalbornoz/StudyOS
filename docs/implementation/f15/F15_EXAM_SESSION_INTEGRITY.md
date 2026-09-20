# F15 — Exam Session Integrity (Workstream B)

## The required invariant, verified end to end

```
Teacher assignment
      ↓ assignTeacherIntervention (F11-B) -- pedagogical intent only
specific learning/exam session
      ↓ startTeacherInterventionExecution (F11-C1..C4) -- creates the REAL execution_reference
        (a quizId for CONCEPT/SKILL/COMPETENCY, a simulationAttempt.id for EXAM)
Student executes SAME session
      ↓ F14's GET /api/quizzes/session/[quizId] (Practice) or
        F15's GET /api/simulation/attempts/[id]/next-item (Exam)
submission
      ↓ /api/quizzes/generate-and-take submit branch, or
        /api/simulation/attempts/[id]/next-item POST (delegates to recordSimulationItemResponse)
existing reconciliation
      ↓ reconcileCompletionsForStudent (F11-C1, unchanged) checks the EXACT execution_reference
assignment/intervention state updated
```

This chain was traced by reading the actual code (not assumed) for both the CONCEPT/SKILL/COMPETENCY path (F14's own work) and the EXAM path (new this phase). `reconcileCompletionsForStudent` (`src/lib/student/teacher-intervention-execution.service.ts:149`) checks `getSimulationAttempt(execution_reference).status === 'COMPLETED'` for `EXAM_PRACTICE` executions — meaning a Teacher-assigned Exam intervention's completion is now genuinely reachable through F15's real item-taking flow (`ItemRunner` → `submitSimulationItemAnswer` → eventually `/complete`), closing a loop that had no real content path before this phase.

## Session-swap prevention

Verified (both by code reading and by the new unit tests) that a Student cannot accidentally generate a separate, unrelated session when resuming an assigned Exam:
- `getNextSimulationItem` is idempotent — a repeated fetch for the same target index returns the SAME server-held question rather than generating a new one (test: "returns the SAME pending question on a repeated fetch").
- The Assignment Practice runner (F14) resumes the EXACT `quizId` `startConceptReinforcementExecution` created via the new `GET /api/quizzes/session/[quizId]` adapter — it never calls the self-service generate endpoint.
- Both mechanisms were necessary specifically because `reconcileCompletionsForStudent` keys off one exact `execution_reference` — a second, freshly-generated session would never be observed as the intervention's own completion.

## Regression tests added

`tests/unit/f15-simulation-item-resolution.test.ts` (11 tests) directly exercises this integrity chain at the service layer: idempotent generation, ownership enforcement, and that `submitSimulationItemAnswer`/`skipUnavailableSimulationItem` only ever advance the SAME attempt's own `navigation_state` — never create or reference a second session.

## Exam answering security (IDOR matrix — task's own explicit test list)

| Scenario | Enforcement | Verified by |
|---|---|---|
| Student A cannot fetch Student B's session (`GET next-item`) | `isOwner(actorUserId, attempt.studentId)` inside `loadOwnedActiveAttempt` — throws `SimulationItemAccessDeniedError` → route maps to 403 | Unit test: "IDOR: throws SimulationItemAccessDeniedError when the actor does not own the attempt" |
| Student A cannot submit into Student B's session | Same `loadOwnedActiveAttempt` check inside `submitSimulationItemAnswer` | Unit test: "IDOR: throws SimulationItemAccessDeniedError for a non-owning actor" |
| Student A cannot alter a Teacher intervention directly | Unchanged F11-B/F11-C1 authorization: `assignTeacherIntervention` requires a real Teacher-class-student relationship; `startTeacherInterventionExecution`/execution routes are `isOwner`-only (Student's own identity) — no route lets a Student mutate `teacher_interventions` directly at all (only `status` transitions via the execution dispatcher, and `cancelTeacherIntervention` is Teacher-only) | Code inspection (unchanged this phase) |
| Parent cannot submit an exam | No Parent-scoped route exists anywhere that reaches `submitSimulationItemAnswer`/`recordSimulationItemResponse`/`assignTeacherIntervention`'s write paths — Parent's only real routes (`/api/parent/*`) are GET-only except `link-child` (relationship management, never academic data) | Code inspection; F13/F14's own already-certified Parent read-only invariant, unextended |
| Teacher cannot impersonate a Student submission | `submitSimulationItemAnswer`/`startTeacherInterventionExecution` both use `isOwner` exclusively — never `canTeacherAccessLearner`/`canTeacherManageIntervention` — a Teacher's own real relationship to a class/student never satisfies `isOwner` | Code inspection (F11-C1's own documented invariant, unchanged; re-verified for the new EXAM item-answering path this phase adds) |
| Institution cannot submit a learner's exam | No Institution-scoped route reaches any exam-answering function; `institution-intelligence` module is read-only by its own structural source guard (`f12-institution-intelligence-source-guard.test.ts`, unchanged) | Code inspection |
| Attempt not ACTIVE cannot be answered | `loadOwnedActiveAttempt` throws `SimulationItemNotActiveError` for PAUSED/COMPLETED/ABANDONED | Unit test: "throws SimulationItemNotActiveError when the attempt is PAUSED/COMPLETED/ABANDONED" |
| Answering before fetching an item | `submitSimulationItemAnswer` throws `SimulationItemNoPendingItemError` when `navigation_state` has no pending question | Unit test: "throws SimulationItemNoPendingItemError when no item was fetched first" |

All of the above are enforced server-side, independent of any client-side route visibility (task's own "UI hiding is not authorization" principle, unchanged from F13/F14).
