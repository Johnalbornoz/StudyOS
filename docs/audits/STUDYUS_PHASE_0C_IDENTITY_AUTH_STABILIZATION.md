# StudyUs Phase 0C — Identity & Subject Authorization Stabilization

Read-only + narrow-implementation phase. No database schema was modified. No migration was applied. No deploy occurred. Date: 2026-08-26.

---

## 1. Executive Summary

- **The `verifySubjectAccess` defect was real but dormant**: it queried a `student_subjects` table confirmed absent from the live database (Phase 0B), but had **zero callers anywhere in the repository** — no live code path was ever throwing or silently failing because of it.
- **Fixed** `verifySubjectAccess` in `src/lib/auth.ts` to use the real, live ownership model: `subjects.id` + `subjects.student_id`, the exact pattern already used by ~10 other call sites across the codebase.
- **Fail-closed behavior preserved exactly**: missing subject, wrong owner, and DB errors all still resolve to `false` — the `try/catch` structure was not touched.
- **Subject ownership model confirmed**: one subject row belongs to exactly one student (`subjects.student_id`, a direct FK, `NOT NULL`) — no many-to-many junction table exists or is needed.
- **Identity provisioning audited**: exactly one canonical write path (`getOrCreateStudentId` → `upsertStudentRecord`/`ensureProfileRows` in `src/lib/auth.ts`), one dead/dangerous alternate path (`src/services/student.service.ts`'s `createStudent`/`getStudent`, zero callers, now marked `@deprecated` with an explanation — not removed).
- **Dual-identity contract documented explicitly** in `src/lib/auth.ts` with an ASCII diagram, stating plainly there is no FK between `students.id` and `profiles.id` and that this is a compatibility contract, not a target design.
- **`ACTIVE_QUERIES_REMAINING = 0`** — repository-wide search confirms the only remaining `student_subjects` reference anywhere in `src/` is the explanatory comment inside the fix itself.
- **10 new regression tests added**, all passing: 6 for subject access (ownership, denial, missing subject, DB-error fail-closed, correct query shape, no `student_subjects` reference), 4 for identity provisioning (new-student dual creation, matching UUIDs, idempotency, self-repair).
- **Live read-only re-check**: 0 students without a matching student-profile, 0 student-profiles without a student, 0 subjects whose `student_id` doesn't resolve to both a `profiles` row and a `students` row with the same UUID.
- **Duplicated subject-ownership logic found and reported, deliberately left unchanged**: ~10 files inline the same `WHERE id = $1 AND student_id = $2` check independently rather than calling `verifySubjectAccess` — centralizing this was explicitly out of scope for this phase.
- **Validation**: `tsc` clean, 620/620 tests passing (610 baseline + 10 new), `npm run build` exit 0, no lint configured.
- **Zero database schema changes.** Only two source files touched plus one new test file.

---

## 2. Previous Confirmed Problem

`src/lib/auth.ts`'s `verifySubjectAccess(studentId, subjectId)` queried:
```sql
SELECT 1 FROM student_subjects WHERE student_id = $1 AND subject_id = $2 LIMIT 1
```
Phase 0B's live-database forensics confirmed `student_subjects` does not exist anywhere in the live `neondb` schema (50 tables inventoried, none named `student_subjects`). Every call to this function would have thrown a Postgres "relation does not exist" error, been caught by the function's own `try/catch`, logged via `console.error`, and returned `false` — a real defect, but one that (per §3 below) was never actually reachable in production.

---

## 3. Reachability Analysis

| Caller | Path | Reachability | Role | Previous Behavior | Risk |
|---|---|---|---|---|---|
| *(none found)* | repo-wide `grep -rln "verifySubjectAccess" src` returns only `src/lib/auth.ts` itself | **DEAD_OR_ORPHANED** | n/a | n/a — never invoked | None currently; latent risk if ever wired up (would silently deny every access request) |

No importer of `verifySubjectAccess` exists anywhere in `src/` or `tests/` (checked both before and after this phase's changes). It is exported, documented as general-purpose "subject/concept access" infrastructure, and sits alongside the actively-used `verifyStudentAccess`/`requireAuth`, but nothing in the current application calls it. Every actual subject-ownership check in the live application is instead performed inline, per-route, via a directly-embedded `SELECT ... FROM subjects WHERE id = $1 AND student_id = $2`-shaped query (see §10).

**Conclusion**: the defect was real (a genuinely broken query) but **not reachable** in the current application. Fixing it was still correct and required — it's live-callable exported infrastructure that should work correctly regardless of whether it currently has a caller, per this phase's explicit objective.

---

## 4. Confirmed Subject Ownership Model

Live schema (confirmed Phase 0B, re-verified this phase): `subjects.student_id uuid NOT NULL REFERENCES profiles(id)`.

Every subject-scoped ownership check found anywhere in the live application (10+ independent call sites across API routes, Server Component pages, and services — see §10 for the full list) uses the identical shape:
```sql
SELECT ... FROM subjects WHERE id = $1 AND student_id = $2
```
No junction table, no many-to-many relationship, no alternate ownership representation exists or is referenced anywhere in live code.

**Confirmed model: ONE SUBJECT RECORD BELONGS TO ONE STUDENT** — a direct, single-valued foreign key, not a many-to-many enrollment model.

---

## 5. Confirmed Student Identity Contract

Documented in full in `src/lib/auth.ts` (top-of-file doc comment, reproduced here):

```
  Clerk User (authenticated account)
          |
          v
  Shared Student UUID  <-- one value, minted once, by this file only
     |            |
     v            v
 students.id   profiles.id  (+ student_profiles.id, same value)
```

- Clerk identifies the authenticated account (`userId` from `auth()`).
- `students.id` is the Learning OS / learning-engine identity.
- `profiles.id` (+ `student_profiles.id`) is used by the original/legacy application domains.
- **There is NO foreign key between `students.id` and `profiles.id`** — confirmed absent from the live schema in Phase 0B, and the documentation explicitly says so rather than implying one exists.
- Both IDs currently must hold the exact same UUID value, for every student — enforced only by application convention, never by the database.
- `getOrCreateStudentId` is the sole canonical provisioning path.
- New code must not invent another student identifier or write directly to `students`/`profiles`/`student_profiles` from anywhere else.
- Any future consolidation is explicitly out of scope for this phase and any phase before it — described as a compatibility contract, not an endorsed target design.

---

## 6. Implementation Changes

| File | Change | Reason |
|---|---|---|
| `src/lib/auth.ts` | (a) Added a file-level "Current StudyUs Student Identity Contract" doc block with the ASCII diagram from §5. (b) Rewrote `verifySubjectAccess`'s query from `SELECT 1 FROM student_subjects WHERE student_id = $1 AND subject_id = $2` to `SELECT 1 FROM subjects WHERE id = $1 AND student_id = $2`, with an explanatory comment. Function signature, return type, and fail-closed `try/catch` structure are unchanged. | Phase objective: correct the subject-access contract to match the live schema; document the dual-identity invariant explicitly. |
| `src/services/student.service.ts` | Added `@deprecated` JSDoc to `createStudent` and `getStudent`, explaining they are dead code (zero callers) and would violate the shared-UUID identity contract if ever reactivated. No behavior change — code is untouched, only documented. | Phase objective: prevent future code from accidentally reviving a second, incompatible identity-provisioning mechanism. |
| `tests/unit/auth-identity-and-subject-access.test.ts` (new) | 10 regression tests covering subject access and identity provisioning (§10 below). | Phase objective: add regression tests. |

No other file was modified. `getOrCreateStudentId`, `ensureProfileRows`, `upsertStudentRecord`, `upsertStudentFromWebhook`, `getOrCreateParentId`, `verifyStudentAccess`, `verifyAuth`, `requireAuth`, `checkRateLimit` are all **unchanged** — they already correctly maintained the shared-UUID invariant (confirmed by tracing every write path, §8), so per the phase's own instruction ("if current code already guarantees this correctly, do not rewrite it unnecessarily"), nothing there was touched.

---

## 7. Subject Authorization After Change

```
Caller (studentId, subjectId)
        |
        v
verifySubjectAccess(studentId, subjectId)
        |
        v
SELECT 1 FROM subjects WHERE id = $1 AND student_id = $2 LIMIT 1
        |
   +----+----+
   |         |
 row found  no row / DB error
   |         |
   v         v
 return true return false   (fails closed in every case: wrong owner, missing subject, or any exception)
```
`studentId` is the shared student UUID (`students.id` === `profiles.id`) — the same value every other live ownership check in the codebase already passes as `subjects.student_id`, so this fix requires no caller-side changes to adopt correctly whenever this function is eventually wired up.

---

## 8. Identity Provisioning Analysis

| Function | File | Classification | Evidence |
|---|---|---|---|
| `getOrCreateStudentId` | `src/lib/auth.ts` | **CANONICAL** | 21 live callers across the app; resolves by `students.clerk_id`, self-repairs missing `profiles`/`student_profiles` rows on every call via `ensureProfileRows` |
| `upsertStudentRecord` (private) | `src/lib/auth.ts` | **CANONICAL** | the actual transactional writer behind `getOrCreateStudentId`/`upsertStudentFromWebhook`; single `BEGIN`/`COMMIT`/`ROLLBACK` transaction writing all three tables with one UUID |
| `ensureProfileRows` (private) | `src/lib/auth.ts` | **CANONICAL** | idempotent `ON CONFLICT (id) DO NOTHING` mirror into `profiles`/`student_profiles`, called on every `getOrCreateStudentId` invocation (both new- and existing-student paths) |
| `upsertStudentFromWebhook` | `src/lib/auth.ts` | **CANONICAL** | called from `src/app/api/webhooks/clerk/route.ts`; same underlying `upsertStudentRecord` |
| `getOrCreateParentId` | `src/lib/auth.ts` | **CANONICAL (parent identity — separate contract)** | called from 3 parent-facing routes; parents intentionally have no `students` row — resolves via `profiles.clerk_id` instead, by design |
| `student.service.ts`'s `createStudent` | `src/services/student.service.ts` | **DEAD** (flagged **DANGEROUS if reactivated**) | zero callers anywhere in the repo; writes the raw Clerk `userId` directly as `profiles.id` and never creates a `students` row at all — would violate the shared-UUID contract if ever called |
| `student.service.ts`'s `getStudent` | `src/services/student.service.ts` | **DEAD** | zero callers anywhere in the repo; reads `profiles` by an arbitrary `userId` param unrelated to the canonical flow |

No other function anywhere in `src/` writes to `students`, `profiles`, or `student_profiles` (confirmed by a repo-wide `INSERT INTO students|profiles|student_profiles` search, §9). Both dead functions were left in place, not deleted, and are now explicitly marked `@deprecated` — consistent with the phase's "do not aggressively delete" instruction.

---

## 9. `student_subjects` Dependency Verification

```
ACTIVE_QUERIES_REMAINING = 0
```
```
$ grep -rn "student_subjects" src --include="*.ts" --include="*.tsx"
src/lib/auth.ts:272: * Phase 0C fix: this previously queried a `student_subjects` junction
```
The single remaining hit is the explanatory comment inside the fixed function itself — not executable code. No `SELECT`/`INSERT`/`UPDATE`/`DELETE` against `student_subjects` exists anywhere in `src/` after this change.

---

## 10. Tests Added / Modified

New file: `tests/unit/auth-identity-and-subject-access.test.ts` — 10 tests, all passing:

**Subject access:**
1. student owns subject → access allowed
2. student does not own subject → access denied
3. subject does not exist → access denied
4. DB error → access denied (fails closed, never throws)
5. authorization query reads `subjects.id`/`subjects.student_id` with the correct parameter order
6. no query anywhere in the function references `student_subjects`

**Identity provisioning** (exercised through the real, unmocked `getOrCreateStudentId`, with `@/lib/db` and `@clerk/nextjs/server` mocked):
7. a brand-new student's provisioning creates both a `students` row and `profiles`/`student_profiles` rows
8. the `profiles`/`student_profiles` rows are written with the exact same UUID `students.id` returned
9. an existing student with an already-matching profile is idempotent — no duplicate `students` row, no Clerk API call needed
10. an existing student whose `profiles`/`student_profiles` rows are missing is self-repaired via the same canonical path (`ON CONFLICT (id) DO NOTHING` confirmed in the executed SQL)

No modification was made to any existing test file.

**Duplicated ownership logic found (§4), reported per Step 10, deliberately left unchanged**: the identical `SELECT ... FROM subjects WHERE id = $1 AND student_id = $2` pattern is independently inlined in at least: `src/app/api/subjects/[id]/route.ts` (×2), `src/app/api/subjects/[id]/concepts/route.ts`, `src/app/api/concepts/create/route.ts`, `src/app/api/concepts/suggest/route.ts`, `src/app/api/learning-debt/error-guidance/route.ts`, `src/app/dashboard/subjects/[id]/page.tsx`, `src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx`. Centralizing these onto `verifySubjectAccess` was explicitly out of this phase's scope ("do not undertake a broad auth refactor") and was not attempted.

---

## 11. Validation Results

```
TypeScript:  npx tsc --noEmit     → clean, exit 0
Tests:       npx vitest run       → 54 test files, 620 tests, all passed (620 = 610 baseline + 10 new), ~0.9s
Build:       npm run build        → exit 0, clean route manifest, no errors
Lint:        LINT_NOT_CONFIGURED  → no ESLint config file, no `lint` script in package.json
```

---

## 12. Live Read-Only Integrity Check

```
students_without_student_profile                          = 0
student_profiles_without_students                          = 0
subjects_studentid_without_matching_profile                = 0
subjects_studentid_without_matching_students_same_uuid      = 0
```
Read-only aggregate queries only; no individual student data was output, no row was modified.

---

## 13. Git Diff Summary

```
 src/lib/auth.ts                 | 74 +++++++++++++++++++++++++++++++++++++----
 src/services/student.service.ts | 15 +++++++++
 2 files changed, 83 insertions(+), 6 deletions(-)
```
New (untracked) file: `tests/unit/auth-identity-and-subject-access.test.ts`.

No other file in the working tree was touched by this phase. (The working tree also contains unrelated uncommitted changes from earlier sessions — the mastery-contract hotfix and Phase 0A/0B audit reports — none of which were modified or re-touched during this phase; confirmed via `git status --short` showing only the three files above as new changes since this phase began.)

No migration file was created or modified. No database write occurred. No mastery, learning-evidence, verification, or quiz-scoring code was touched.

---

## 14. Remaining Identity Risks

1. The `students.id` ↔ `profiles.id` invariant is still enforced only by application convention, not by a database constraint — a future bug in `ensureProfileRows`/`upsertStudentRecord` could silently desynchronize them with nothing in the schema to catch it (unchanged from Phase 0B; explicitly out of scope to fix here).
2. `student.service.ts`'s dead functions remain in the codebase (now documented, not removed) — a future contributor could still technically re-import and call them, though the `@deprecated` warning now makes the consequence explicit.
3. Duplicated subject-ownership-check logic (§10) means a future change to the ownership rule would need to be applied in ~10 places, not one — reported, not fixed, per this phase's scope.
4. `verifySubjectAccess` remains uncalled by any live code — this phase corrected it but did not wire it into any route; whether it should be adopted as the single ownership-check implementation is a decision for a future phase, not this one.
5. `canTeacherAccessStudent` (adjacent in the same file) is an unrelated, pre-existing `TODO: Implement` stub that always returns `false` — noted for completeness, not touched, out of scope.

---

## 15. Phase 0C Definition of Done

- [x] No executable dependency on nonexistent `student_subjects` — confirmed, §9, `ACTIVE_QUERIES_REMAINING = 0`.
- [x] Student subject access uses actual live ownership model — confirmed, §6/§7, `subjects.id`/`subjects.student_id`.
- [x] Unauthorized access fails closed — confirmed, §10 tests 2/3/4, `try/catch` structure unchanged.
- [x] Student/profile shared UUID contract documented — confirmed, §5, doc block + ASCII diagram added to `src/lib/auth.ts`.
- [x] Canonical student provisioning tested — confirmed, §10 tests 7-10, all against the real `getOrCreateStudentId`.
- [x] No database schema modified — confirmed, §13, only 2 `.ts` files + 1 new test file changed, zero migrations.
- [x] Existing tests pass — confirmed, §11, 610/610 baseline tests still passing.
- [x] New tests pass — confirmed, §11, 10/10 new tests passing.
- [x] Build passes — confirmed, §11, exit 0.

---

## 16. Final Decision

**A. Was the `student_subjects` defect real?**
**YES.** Confirmed by Phase 0B's live-schema inventory — the table genuinely does not exist.

**B. Was it reachable?**
**NO.** Repo-wide search found zero callers of `verifySubjectAccess` before this phase. The defect existed in exported, documented infrastructure, but nothing in the live application ever exercised it.

**C. Is it now corrected?**
**YES.** The query now reads the real, live `subjects.id`/`subjects.student_id` ownership model; behavior (fail-closed on any error/mismatch) is preserved exactly.

**D. Is subject authorization aligned with the live DB schema?**
**YES**, for `verifySubjectAccess` specifically (now fixed) and for the ~10 pre-existing inline checks elsewhere (already correct, they were never broken — only this one centralized helper was).

**E. Is the dual student/profile identity invariant currently preserved?**
**YES**, confirmed by both the code trace (§8: single canonical write path, self-repairing) and the live read-only re-check (§12: zero drift in either direction, across both the students/profiles tables and every live subject's `student_id`).

**F. Did this phase introduce any DB schema change?**
**NO.**

**G. Is Phase 0C ready to certify?**
**YES.**

**H. Remaining issues (max five)** — see §14 in full; summarized: (1) no DB-level FK enforcing the shared UUID, (2) dead identity-provisioning code still present (documented, not removed), (3) duplicated ownership-check logic across ~10 files, (4) the now-fixed `verifySubjectAccess` still has no live caller to actually exercise it in production, (5) an unrelated pre-existing `canTeacherAccessStudent` stub always returns `false`.

---

*End of report. No database schema, migration, mastery, learning evidence, verification, or quiz-scoring logic was modified. No deploy occurred.*
