# F10 — Next Phase Handoff

## What F10 delivered

- Fixed a load-bearing identity gap: parent `profiles.user_id` is now always populated, making F2's canonical `canAccessLearner` reliable for Parent access (previously only the parallel `verifyParentAccess` function worked correctly).
- Fixed a permanent-lockout bug (decline/revoke could never be re-requested) and an account-enumeration oracle in `link-child`.
- Added the Parent Read Model (`src/lib/parent/read-model.service.ts`, 6 methods) and 6 new GET-only routes under `/api/parent/learners/*`, sourced exclusively from F5/F7/F8/F9's certified data, never the legacy `exam-readiness.service.ts`.
- Certified the full lifecycle, authorization boundary, multi-child isolation, Parent/Payer decoupling, read-only boundary, and concurrency for real against ephemeral Postgres (11 sections, 40 assertions, all passing).
- Deployed and smoke-tested a real Vercel Preview on the correct existing project (after catching and correcting a deployment-target mistake mid-process).

## What F11 (or whichever phase builds the next Parent-facing layer) should know

1. **Use `canAccessLearner` for every new Parent route, never `verifyParentAccess`.** The latter still exists (for the one pre-existing `child-overview` route) but is not the pattern to extend — it duplicates logic `canAccessLearner` already owns.
2. **`getSubjectConcepts` has no active/inactive filter.** If a future phase needs an accurate "active concepts" count, add the filter to that shared function (benefiting every caller), don't reinvent it in a Parent-only query.
3. **No reusable "list simulation attempts for a student" function exists.** `getParentRecentActivity` queries `simulation_attempts` directly for exactly this reason. If F11+ needs richer simulation history, consider promoting a real `listSimulationAttempts(studentId)` export from `src/lib/simulation/attempt.service.ts` rather than every caller re-deriving its own query.
4. **No reusable "active exam profile for a student" function exists.** Both F7's own `/api/exam-profiles/route.ts` and F10's `read-model.service.ts::getActiveExamProfile` independently query `student_exam_profiles` directly. A future phase should consider promoting one canonical `getActiveExamProfile(studentId)` export.
5. **The legacy `exam-readiness.service.ts` is still live** (2 real callers: `/api/exam-readiness/score/route.ts`, `/api/quizzes/generate-and-take/route.ts`) and still transitively reaches the pre-existing Parent `child-overview` surface. Its retirement remains deferred (task §16); F13/F14 is the suggested target, per F10's own containment decision.
6. **`LEARNER_INTERVENTION_CREATE` remains unsatisfiable by any actor** (owner/parent/teacher permission sets all exclude it) — still reserved for whichever future phase implements Parent- or Teacher-initiated interventions. Extend the existing `PARENT_PERMISSIONS`/`TEACHER_PERMISSIONS` arrays in `src/lib/authorization/index.ts` rather than inventing a second permission system.
7. **The two deferred IVG items (`IVG-F10-01`, `IVG-F10-02`)** need real multi-session Clerk credentials against Preview to close — the same standing gap every phase since F7 has carried.

## What F11 should NOT do

- Do not build a second Parent-facing read path that bypasses `read-model.service.ts` — extend it.
- Do not add a new relationship/consent table — `parent_student_relationships` (F2) has everything needed, including the still-unused `relationship_type` column for a future non-parent relationship kind.
- Do not wire any new surface to the legacy `exam-readiness.service.ts`, even indirectly.
