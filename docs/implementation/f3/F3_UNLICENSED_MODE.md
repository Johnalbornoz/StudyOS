# F3 — Unlicensed ("demo") mode

Written definition of what a Student without a learning licence can and cannot do. Ruling D-8, Orchestrator, 2026-10-11. Implemented by L11 (EN-2).

The machine-readable copy is `src/lib/entitlements/unlicensed-policy.ts`. `tests/unit/l11-unlicensed-policy.test.ts` fails if the routes and that file disagree.

## The rule

A Student is licensed when `decideLearningAccess` says so: an administrative grant that has not expired, or a paid subscription in a status that grants access. Everything below is decided on the server, from the database, on every request.

| Group | Unlicensed Student | Routes |
|---|---|---|
| **(a) Learning activity** — instructional execution, AI teaching content, AI grading, mastery, evidence | Refused: `403 { error: 'ENTITLEMENT_REQUIRED' }` | Start or generate a session, quiz, simulation, exam instance, study plan; tutor; hints; in-quiz answer check; explain and transfer challenges (generate and submit); remediation start; exam readiness score; guided practice; concept explanation; interactive formula; error-pattern guidance; starting a teacher-assigned task |
| **(b) Content setup** — building the learning setup with AI help | Allowed, under the existing rate limits | Concept suggestions; document analysis / import; concept extraction; content upload, process and search |
| **(c) Continuation** — finishing something already open when the licence ends | **Not ruled.** Unchanged: ownership only | Simulation attempt next-item, pause, resume, complete, abandon; quiz answer submission (`quizzes/verify`); question localisation |
| **Always free** | Allowed in every subscription state | Own history and progress (`LEARNING_HISTORY_VIEW`); billing; profile; reads that return only metadata or a launch target |

Group (b) unlocks nothing in group (a): a demo Student can build subjects and concepts, and is refused when the actual learning activity starts.

## Where it is enforced

One decision, one way to ask:

- Decision: `canUseCapability(actor, student, 'LEARNING_FULL_ACCESS')` → `resolveLearningAccess` → `decideLearningAccess`.
- Shared enforcement point: `src/lib/entitlements/learning-gate.ts` (`learningLicenceRequiredResponse`, `learningLicenceRequiredResponseForActor`). A route calls it after its ownership check and before any generation, grading or write.
- Routes enforced before L11 call `canUseCapability` directly or `requireOwnerOf(..., { entitled: true })`. They resolve the same decision and return the same error.

## Adding or changing a route

1. Decide its group from the table above. If it does not fit, ask for a ruling; do not pick.
2. Add it to `LEARNING_ROUTE_POLICY`.
3. For group (a), call the shared gate. For (b) and (c), add no licence check.

## Open

- **D-8(c)** continuation. Until it is ruled, a Student whose licence ends mid-attempt can finish that attempt and cannot start another.
- A previously generated concept explanation is not served to an unlicensed Student, because the route cannot tell a cached read from a new generation. Serving cached content would need a change in `concept-explanation.service.ts`.
