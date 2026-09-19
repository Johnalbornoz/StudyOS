# F10 — Parent Read-Only Boundary

## Enforcement mechanism

Every F10 Parent route under `src/app/api/parent/learners/**` is `GET` only — there is no `POST`/`PATCH`/`PUT`/`DELETE` handler exported from any of them. `read-model.service.ts`'s six methods each perform exactly one thing: resolve authorization, run `SELECT`-only queries (via F5/F8/F9's own existing read functions), and return a DTO. None of them call any F4/F5/F8/F9 write function (`updateMastery`, evidence insert, diagnostic write, intervention write, readiness-snapshot write, simulation write).

## What remains mutable, and by whom (unchanged by F10)

- Relationship lifecycle writes (`linkChildByEmail`, `unlinkChild`, `respondToRequest`, `revokeRelationshipByStudent`) are the *relationship's own* state, not learner academic truth — these remain, as before, the only writes a Parent-side actor can trigger, and they only ever touch `parent_student_relationships` + `notifications`.
- Mastery, Knowledge/Skill/Competency State, Canonical stage, readiness snapshots, diagnostic results, simulation results, institution policy, curriculum mappings: written only by their existing owning services (F4/F5/F6/F7/F8/F9), none of which F10 adds a Parent-reachable call path to.

## Certification

`F10_AUTHORIZATION_CERTIFICATION.md`'s real-Postgres run includes an explicit attempt, as an authenticated Parent actor, to call each write-capable service function directly (bypassing the route layer, calling the service function with a Parent-relationship-only actor context) and asserts each either (a) has no Parent-reachable HTTP route at all, or (b) is correctly rejected by its own existing, unmodified authorization gate (which already requires a Student or Teacher/Institution actor, never a bare Parent relationship).
