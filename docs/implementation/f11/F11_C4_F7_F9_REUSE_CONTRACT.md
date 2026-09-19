# F11-C4 — F7/F9 Reuse Contract

## Functions F11-C4 calls directly (never via HTTP route-to-route)

| Function | Owner | Purpose in F11-C4 |
|---|---|---|
| `getStudentExamProfile` | F7 (`student-exam-profile.service.ts`) | Ownership + exam definition/version resolution |
| `getExamVersion` / `getPublishedExamVersion` | F7 (`exam-definition.service.ts`) | Version validity (must be PUBLISHED) |
| `getSimulationEligibility` | F9 (`eligibility.service.ts`) | The ONLY gate before creating any attempt -- includes the real Full Mock Guard |
| `startSimulationAttempt` | F9 (`attempt.service.ts`) | Creates the real plan + F7 exam attempt + F9 wrapper row |
| `getSimulationAttempt` | F9 (`attempt.service.ts`) | Completion observation (`reconcileCompletionsForStudent`) |

## Functions F11-C4 deliberately never calls (reused ONLY by the Student's own real completion flow, exercised directly by the certification's simulated "student" for verification, never by F11-C4 itself)

| Function | Owner | Why F11-C4 stays out |
|---|---|---|
| `recordSimulationItemResponse` | F9 | Grading + Evidence writing is the Student's own real submission flow's job |
| `completeSimulationAttempt` | F9 | Finalization is triggered by the Student's own real completion request |
| `runPostExamDiagnosis` | F9 (wraps F8's real `runDiagnosis`) | Post-exam diagnosis is invoked by the real completion route, never duplicated |
| `computeReadinessSnapshot` | F9 | Readiness recomputation is invoked by the real completion route, never duplicated |
| `determineNextAction` | F9 | A recommendation surface, not an execution-orchestration concern |

Source-guard tests assert every one of the second table's functions has zero call sites in the orchestration file.

## No duplicate authority (AC-C4-04/05/06)

- **No duplicate Assessment authority**: F11-C4 never creates `exam_definitions`/`exam_versions`/`assessment_blueprints`/`assessment_components` rows, never re-implements generation/evaluation.
- **No duplicate Simulation authority**: F11-C4 never re-implements plan-building, attempt lifecycle, pause/resume/navigation, or scoring.
- **No duplicate Readiness authority**: F11-C4 never computes or writes a readiness dimension, snapshot, or Full Mock eligibility verdict of its own.

## No route-to-route HTTP calls

Every function above is called as a direct, in-process TypeScript import, exactly mirroring how C1-C3 call `generatePracticeQuestions`/`storeQuiz`/`getQuizSession` directly rather than fetching `/api/quizzes/generate-and-take`.
