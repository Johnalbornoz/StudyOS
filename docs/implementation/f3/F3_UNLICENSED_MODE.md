# F3 — Unlicensed ("demo") mode

Written definition of what a Student without a learning licence can and cannot do. Ruling D-8, Orchestrator, 2026-10-11. Implemented by L11 (EN-2).

The machine-readable copy is `src/lib/entitlements/unlicensed-policy.ts`. `tests/unit/l11-unlicensed-policy.test.ts` fails if the routes and that file disagree.

## The rule

A Student is licensed when `decideLearningAccess` says so: an administrative grant that has not expired, or a paid subscription in a status that grants access. Everything below is decided on the server, from the database, on every request.

| Group | Unlicensed Student | Routes |
|---|---|---|
| **(a) Learning activity** — instructional execution, AI teaching content, AI grading, mastery, evidence | Refused: `403 { error: 'ENTITLEMENT_REQUIRED' }` | Start or generate a session, quiz, simulation, exam instance, study plan; tutor; hints; explain and transfer challenges; remediation start; exam readiness score; guided practice; concept explanation; interactive formula; error-pattern guidance; starting a teacher-assigned task |
| **(b) Content setup** — building the learning setup with AI help | Allowed, under the existing rate limits | Concept suggestions; document analysis / import; concept extraction; content upload, process and search |
| **(c) Continuation** — finishing an attempt that was started while the licence was valid | Allowed for that same attempt only (ruled 2026-10-11) | Reopen, answer, complete and read the result of an existing simulation / exam attempt or quiz; answer check inside an open quiz; submit the answer to an Explain or Transfer task already issued; "Continue" on a teacher-assigned task already started |
| **Always free** | Allowed in every subscription state | Own history and progress (`LEARNING_HISTORY_VIEW`); billing; profile; reads that return only metadata or a launch target |

Group (b) unlocks nothing in group (a): a demo Student can build subjects and concepts, and is refused when the actual learning activity starts.

## Continuation, precisely

An attempt that was legitimately started while the licence was valid may be reopened, answered, completed, graded as far as finishing it requires, and its result read, after the licence ends. Because every route that starts an attempt requires the licence, a server-side record of an open attempt owned by the Student is the proof.

It does not allow starting a new attempt, restarting a completed one, creating another instructional session, or reaching new paid activity (tutor, hints, guided practice, explanations stay refused). The attempt's own rules still apply: session status and expiry, attempt inactivity expiry, task expiry, assignment due date. No ownership check is relaxed.

| Route | What counts as the open attempt |
|---|---|
| `simulation/attempts/[id]/*`, `exams/attempts/[id]`, `exams/instances/[id]` and its submissions, `quizzes/session/[quizId]`, `quizzes/verify`, the submit branch of `quizzes/generate-and-take` | The route only acts on an existing attempt; no licence check |
| `quizzes/session/[quizId]/check` | The quiz session is active and not past its expiry |
| `cognitive/explain/submit` | The Student's own task, not expired, not yet answered |
| `cognitive/transfer/submit` | The Student's own server-minted task and its exact prompt. A submission with no server task needs the licence |
| `student/teacher-interventions/[id]/start` | An execution already exists for this task and idempotency key, so the dispatcher only recovers it |

## Where it is enforced

One decision, one way to ask:

- Decision: `canUseCapability(actor, student, 'LEARNING_FULL_ACCESS')` → `resolveLearningAccess` → `decideLearningAccess`.
- Shared enforcement point: `src/lib/entitlements/learning-gate.ts` (`learningLicenceRequiredResponse`, `learningLicenceRequiredResponseForActor`, and the `...UnlessOpenAttempt` forms for routes that serve both a start and a continuation). A route calls it after its ownership check and before any generation, grading or write.
- Routes enforced before L11 call `canUseCapability` directly or `requireOwnerOf(..., { entitled: true })`. They resolve the same decision and return the same error.

## Adding or changing a route

1. Decide its group from the table above. If it does not fit, ask for a ruling; do not pick.
2. Add it to `LEARNING_ROUTE_POLICY`.
3. For group (a), call the shared gate. For (b), add no licence check. For (c), add none if the route only acts on an existing attempt; if it can also start one, use the `...UnlessOpenAttempt` form and pass a server-side proof of the open attempt.

## Open

- A Transfer task has no expiry and no "answered" marker, so an unlicensed Student can submit to an old task of their own again. Mastery and evidence are idempotent for the same task; the AI grading runs again. Closing that needs a marker on `transfer_task_instances` (schema).
- A previously generated concept explanation is not served to an unlicensed Student, because the route cannot tell a cached read from a new generation. Serving cached content would need a change in `concept-explanation.service.ts`.
