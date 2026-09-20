# F15 — Authorization Negative Test Report

Live authenticated negative-auth E2E was not possible this phase (see F15_AUTHENTICATED_E2E_REPORT.md). Every case below is verified either by a real real-Postgres regression run (genuine evidence, not code-reading) or by direct source inspection, clearly labeled per case.

| Case | Expected | Evidence | Verified how |
|---|---|---|---|
| Parent → Teacher route | Denied | No Parent-authenticated identity ever satisfies `canTeacherManageIntervention`/`canAccessClass` (different authorization primitive entirely) | Code inspection (unchanged F11/F13) |
| Student → Institution route | Denied | `requireInstitutionAccess` requires an APPROVED `INSTITUTION_ADMIN` membership row; a Student identity has none | Code inspection (unchanged F12) |
| Teacher → unrelated Student | Denied | F12 cert script **Case V**: "a TEACHER role alone (APPROVED membership, real class assignment) does not grant institution-admin intelligence access" — **real-Postgres regression, re-run this phase, PASS** | Real-Postgres (`f12-institution-intelligence-migration-cert.sh`) |
| Teacher → unrelated Class | Denied | F12 cert script **Case F**: "class belonging to a DIFFERENT institution → DENY" — **real-Postgres regression, PASS**. Also F11-A's own teacher-authorization cert (unchanged, re-run, PASS) covers a Teacher's own cross-class access at the F11 layer. | Real-Postgres |
| Institution A → Institution B | Denied | F12 cert script **Case D**: "Institution A admin cannot access Institution B's overview" — **real-Postgres regression, PASS** | Real-Postgres |
| Student A → Student B session (exam) | Denied (403) | New this phase — `SimulationItemAccessDeniedError` via `isOwner` check | Unit test (`f15-simulation-item-resolution.test.ts`) — deterministic, not live, but a real assertion against real service code |
| Deep-link bypass (guessing a URL) | 404/403, never a data leak | Every F13/F14/F15 page independently re-derives ownership/access server-side from the AUTHENTICATED actor's own identity — never trusts a route param alone (re-verified by reading `/dashboard/exam-prep/[examProfileId]`, `/dashboard/exam-prep/attempt/[attemptId]`, both check `x.studentId !== studentId` → `notFound()`) | Code inspection |
| Stale URL after workspace switch | Server re-resolves on next request, never serves stale-role data | Architecture unchanged from F13/F14 (`router.refresh()` + every page a Server Component re-fetching fresh) — see F15_CACHE_AND_CONTEXT_ISOLATION.md | Code inspection (not live this phase) |
| Parent + Teacher multi-role, no widening | Each workspace independently scoped | F12 cert script **Case W**: "PARENT + TEACHER multi-role actor (real Teacher role + real accepted Parent relationship) still cannot access institution intelligence — no widening" — **real-Postgres regression, PASS** | Real-Postgres |

## What makes the real-Postgres cases stronger evidence than code-reading alone

Each "real-Postgres" row above is not a re-read of source code — it is a live assertion (`assert(...)`) executed against an actual, ephemeral, freshly-migrated PostgreSQL database, with real fixture identities (a real Institution A admin, a real Institution B, a real cross-institution Teacher, a real multi-role Parent+Teacher actor) and a real HTTP-equivalent service call. This is the same evidentiary bar F2 through F12's own certification scripts have used throughout this program, and it was re-confirmed passing this phase (16/16, see F15_QA_REPORT.md) after this phase's own MIN_COHORT_POLICY changes.

## Gaps (disclosed)

The specific NEW surface this phase built (`next-item` IDOR) is verified only by deterministic unit tests with mocked dependencies, not a live database or a live HTTP request — a real, if modest, gap relative to the F2-F12 precedent's own real-Postgres bar. Registered as `IVG-F15-04`: add a real-Postgres regression case for the exam-taking IDOR matrix, ideally alongside a future F9/F11 cert script update.
