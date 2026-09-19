# F10 — Current Parent Experience Assessment

Baseline: `origin/f9/exam-readiness-simulation` @ `c8699950c848dcf6831276c08ad82111f0d02809`
Date: 2026-09-19
Status: written before any F10 source change, per task §3.

## 1. A substantial Parent experience already exists

Confirmed, contrary to a from-scratch assumption: `src/services/parent.service.ts`, five live routes (`src/app/api/parent/{requests,children,link-child,child-overview,relationships/revoke}/route.ts`), a dashboard page (`src/app/dashboard/parent/page.tsx`), and a student-side inbox widget (`ParentRequestsPanel.tsx`). F10 is a **correction-and-extension** phase, not a greenfield build — this matches the task's own instruction not to build a second relationship table, generalized: do not build a second *anything* the existing system already gets right.

## 2. F2's relationship model — the real table, reused as-is

`public.parent_student_relationships`: `(parent_id, student_id)` PRIMARY KEY, both FK to `profiles(id)`, `status varchar(20) CHECK IN ('pending','accepted','declined','revoked')` (lowercase — **not** the task's assumed `REQUESTED/PENDING/ACCEPTED/REVOKED`), `created_at`, `responded_at`, `relationship_type text DEFAULT 'PARENT'` (added by F2's own migration, available for future non-parent relationship kinds without a new table). `students.id` and `profiles.id` are the **same UUID** for a student (confirmed via `src/lib/auth.ts`'s own doc comment) — so `parent_student_relationships.student_id` is directly usable as the `studentId` every F5–F9 route already expects.

`src/lib/authorization/index.ts::isActiveParentOf` (F2's canonical check, used by `canAccessLearner('LEARNER_PROGRESS_VIEW'|'LEARNER_PROFILE_VIEW', ...)`) requires `status = 'accepted'` and joins `parent_student_relationships.parent_id → profiles.id` where `profiles.user_id = actorUserId` (the F1 canonical `users.id`).

**F10 will not create a second relationship table** — this satisfies task §5's own conditional exactly: no missing concept was found that F2 cannot safely extend.

## 3. A real, load-bearing authorization bug — found here, fixed in F10

`src/lib/auth.ts::getOrCreateParentId` creates a `profiles` row (`user_type='parent'`) but **never sets `profiles.user_id`**. F2's `isActiveParentOf` requires exactly that column to resolve the canonical actor. Consequence: **any parent identity created via the existing `link-child` flow is invisible to F2's own `canAccessLearner`** — `isActiveParentOf` silently returns `false` for a relationship that `verifyParentAccess` (the existing routes' own parallel check) correctly reports as `accepted`. The one-time `src/services/identity-backfill.service.ts` (F1) is not wired to any route/cron and would not fix a parent profile created after it ran, if it ever ran at all in a given environment.

**This is the central architectural correction F10 makes**: `getOrCreateParentId` is fixed to resolve/attach the canonical `users.id` (via the same `getOrCreateCanonicalUser` every other F1+ identity resolver uses) so that `profiles.user_id` is always correct, present and future. This is what makes the task's own "Correct" architecture diagram (`Parent → F2 Relationship Authorization → Parent Read Model`) actually true end-to-end — without this fix, any new F10 route built on `canAccessLearner` would incorrectly deny every real parent.

## 4. `child-overview`'s authorization — a second, parallel implementation of the same rule

`child-overview/route.ts` uses `verifyParentAccess(parentId, studentId)` (a direct, second query against `parent_student_relationships`, keyed on `profiles.id`) rather than F2's `canAccessLearner`. It happens to enforce the same rule (`status = 'accepted'`) but is a structurally separate code path from every other learner-permission consumer in the codebase (F5 readiness, F7 exam profiles, F8 diagnostics/interventions, F9 readiness/simulation all use `canAccessLearner` exclusively). **F10's own new routes use `canAccessLearner` directly** (task §12/§29's own explicit requirement), consistent with every prior phase. The existing `child-overview` route is left functionally as-is (its own check still works, and now works *correctly* thanks to the §3 fix) — this document records the inconsistency rather than silently rewriting a live, shipped route beyond what safety requires.

## 5. Legacy readiness — confirmed present in the existing parent surface, must not spread further

`getChildOverview`'s `upcomingExams[].examReadiness` traces, transitively, to the legacy `src/services/exam-readiness.service.ts::calculateExamReadiness` (a single hardcoded-weight percentage plus a fabricated `predictedExamScore` — documented as the anti-pattern in F9's own `docs/implementation/f9/F9_CURRENT_READINESS_SIMULATION_ASSESSMENT.md`). Path: `child-overview` → `getChildOverview` → `getUpcomingForStudent` (`assessment.service.ts`) → reads the cached `assessment_occurrences.exam_readiness` column → which is written **only** by `/api/exam-readiness/score/route.ts`, which calls the legacy service directly.

**F10 does not remove this** (task §16: "Do not remove legacy behavior blindly... retirement may be deferred unless immediate safety requires containment" — no immediate safety issue exists here, since it's the *existing* Student-facing feature's own established behavior, not a new one). **F10 adds zero new callers of the legacy service** and builds its own new exam-preparation surface exclusively on F9's real `readiness.service.ts` (`computeReadinessSnapshot`/`getLatestReadinessSnapshot`). A structural guard test asserts no F10 file imports `exam-readiness.service.ts`. Full inventory of every existing legacy caller in `F10_LEGACY_READINESS_CONTAINMENT.md`.

## 6. Account enumeration — a real, unmitigated risk, fixed in F10

`linkChildByEmail` queries `students` by email and the route (`link-child/route.ts`) returns a distinct `404 NO_STUDENT_FOUND` (with the explicit message "No student account exists with that email yet") versus a `200` success — a direct oracle for whether an email has a student account (task §6's own named risk). **F10 fixes this**: the route always returns the same generic success response regardless of match; the "no such student" case is logged server-side only, never surfaced to the caller in a way that distinguishes it from "invite sent."

## 7. Re-request after decline/revoke — a real usability bug, fixed in F10

`linkChildByEmail`'s `INSERT ... ON CONFLICT DO NOTHING` against the `(parent_id, student_id)` primary key means **once any row exists for a pair, in any status, it can never be replaced** — a parent whose request was declined, or whose access was later revoked, can never send a new request through this function; the call still returns a fake "pending" success with no actual database change. **F10 fixes this** with a real upsert: `ON CONFLICT (parent_id, student_id) DO UPDATE SET status = 'pending', responded_at = NULL WHERE parent_student_relationships.status IN ('declined', 'revoked')` — re-requesting after a decline or revoke is now possible; re-requesting while already `pending`/`accepted` is a safe no-op (never silently resets an active relationship).

## 8. F3 Parent/Payer separation — already correct, preserved

Confirmed no coupling exists between `parent_student_relationships` and F3's billing/entitlement layer (`src/lib/entitlements/*`, `src/app/api/billing/subscription/route.ts`) — the billing route's own header comment states this design decision explicitly. **F10 preserves this separation exactly** (INV-F10-18) — no new code anywhere checks "is this user a payer" to decide learner-progress-read access, or vice versa.

## 9. Notifications — informational only, correctly non-authoritative

`parent.service.ts` writes directly to the `notifications` table on request/accept (not via the dead-code `notifications.service.ts::sendNotification`). Confirmed non-authoritative: access is decided solely by `parent_student_relationships.status` at read time, never by notification existence. F10 preserves this; no new authority is added.

## 10. Missing read models (task §12's own list)

None of `getParentLearners`, `getParentSubjectProgress`, `getParentRecentActivity`, `getParentExamPreparation`, `getParentAttentionAreas` exist today. `getChildOverview` is a single combined payload covering only subjects+mastery+debt+legacy-exam-readiness — no concept of "recent activity" or "attention areas" exists anywhere in the current parent surface. These are new, additive F10 work — not a duplication of anything (F8's diagnostics and F9's readiness are the certified sources; nothing today projects them into a parent-safe shape).

## 11. Cross-child leakage paths — none found structurally, but nothing currently tests for it

No existing code combines two students' data in one response. `getLinkedChildren`/`child-overview` are both correctly scoped to one `parent_id`/`studentId` pair per call. The risk is untested, not present — F10's real-Postgres certification adds the explicit two-children-isolation proof (task §38/§39 case G) the existing code has never been checked against.

## 12. Schema — no new table needed

Per task §36's own "prefer existing tables" directive, and given §2–§9 above account for every real gap via service-logic fixes rather than schema changes, **F10 requires no new migration**. `relationship_type` (already present, unused beyond its `'PARENT'` default) is available for a future non-parent relationship kind without any new table, if ever needed.

## 13. Conclusion

No blocking collision found. F10's real work is: one authorization-correctness fix (`profiles.user_id` population), one security fix (enumeration), one usability fix (re-request after decline/revoke), a new Parent Read Model layer built on F2 authorization + F5/F6/F7/F8/F9 certified sources (never the legacy readiness service), a privacy classification convention, and the adversarial/concurrency/E2E certification the existing feature has never had. Implementation may proceed.
