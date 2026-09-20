# F15 — Pilot Data & User Model

## Real, existing fixture/seed capability already in this codebase (reused, not invented)

Every real-Postgres certification script this program has built (F2 through F12, all re-run this phase) already contains real, working, repeatable fixture-creation functions — not ad hoc Production mutations. These are the actual, already-proven building blocks for a Pilot data strategy:

| Entity | Existing mechanism |
|---|---|
| Students | `seedStudent(name)` (used throughout every cert script) — creates a real `students` row |
| Institution + admin | F12 cert script's own `seedFullTeacherClassFixture` / institution-admin fixture helpers — creates a real institution, an APPROVED `INSTITUTION_ADMIN` membership |
| Teachers + classes + grades | Same fixture helpers — real `classes`/`grades`/`teacher_assignments`/`class_enrollments` rows |
| Multi-role identities | F12 cert script's own Case W fixture (a real Parent+Teacher multi-role actor) — proves the mechanism, not merely asserts it |
| Exam profiles | `student-exam-profile.service.ts::createStudentExamProfile` (real, already used by the self-service `/api/exam-profiles` POST route) |
| Parent-child links | `linkChildByEmail`/`respondToRequest` (real functions used by F10's own cert script and the actual `/api/parent/link-child` route) |

**None of this requires inventing new tooling** — every piece already exists, tested, and proven against real Postgres. A Pilot data strategy should compose these EXACT functions (ideally via a small, new, explicitly-labeled `scripts/operations/pilot-seed.ts` — not built this phase, since no real Pilot cohort/roster was provided to seed) rather than manual, ad hoc SQL against a live database.

## What this phase did NOT do

No Pilot-specific seed script was written this phase (no real Pilot institution/roster exists yet to seed data for — writing one without a concrete target would be speculative). This is a real, scoped-out deliverable, not an oversight: the BUILDING BLOCKS are proven; assembling them into a `pilot-seed.ts` is a small, mechanical follow-up once a real pilot institution/class list exists.

## Recommended Pilot user/data creation workflow (not yet built, but concretely specified)

1. A real Institution row + an APPROVED `INSTITUTION_ADMIN` membership for the actual pilot institution's real admin contact (via `institution.service.ts`'s already-real `inviteInstitutionAdmin`/`decideMembership` — the same functions the live app itself uses, not a bypass).
2. Real Grades/Classes created by that Institution Admin through the ALREADY-BUILT `/dashboard/institution` flows (F12's own real write paths — `createGrade`/`createClass` in `institution.service.ts`) — no seed script needed for this part at all, since the Institution Admin UI already supports it.
3. Real Teachers invited via the existing `requestTeacherMembership`/`decideMembership` flow.
4. Real Students created via the app's own real Clerk sign-up + `getOrCreateStudentId` (never a direct DB insert bypassing identity) — enrolled into classes via the existing `enrollStudent` function (already used by every cert script).
5. Real Exam Profiles created by Students themselves via the existing self-service `/api/exam-profiles` (or by a Teacher-guided walkthrough) — never fabricated rows.

## Avoiding manual ad hoc Production mutations

Every step above uses an existing, already-authorized application code path (a real API route or a real service function already covered by authorization) — never a raw `UPDATE`/`INSERT` against a live database outside the app's own write paths. This is the same discipline this entire program's own real-Postgres certification scripts have followed throughout (`assignTeacherIntervention`, `enrollStudent`, etc. — never a bespoke fixture SQL statement for anything the app itself can already do correctly).
