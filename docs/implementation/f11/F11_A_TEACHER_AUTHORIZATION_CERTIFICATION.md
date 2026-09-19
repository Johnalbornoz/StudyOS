# F11-A — Teacher Authorization & Teacher Read Model — Certification

## 1. Objective

Establish and certify the Teacher-scoped authorization boundary and a Teacher Read Model before any Teacher UI or intervention workflow is built, reusing F1–F10's existing canonical authorities and introducing no parallel authorization or learning-state system.

## 2. Baseline

Branch: `f11/teacher-authorization-read-model`
Starting HEAD: `fc802a4` (F10 implementation fix `78fb15d` + F10 documentation `fc802a4`, closed and frozen — not modified in this phase)
Certified HEAD (this phase): see §12

## 3. Authority Map

```
authenticated Clerk user
  → verifyAuth() + getOrCreateCanonicalUser()                    [F1, unchanged]
  → canTeacherAccessLearner(actorUserId, learnerId)               [F2, unchanged, reused directly]
       institution_memberships: user_id = actor, role='TEACHER', status='APPROVED'
       ⋈ teacher_assignments: status='ACTIVE',
           (class_id = student's class OR (class_id IS NULL AND grade_id = that class's grade))
       ⋈ class_enrollments: student_id = learner, status='ACTIVE'
       ⋈ classes: institution_id matches the membership's institution
  → ALLOW / DENY (fails closed)
```

For class-scoped operations (roster): `canAccessClass(actorUserId, classId, 'TEACHER_ASSIGNMENT_MANAGE')` — pre-existing F2 primitive, previously exported with zero callers anywhere in the codebase; F11-A is its first real consumer. It resolves to the class's institution and allows either an APPROVED `INSTITUTION_ADMIN` of that institution, or an ACTIVE teacher assignment covering the class — the `permission` argument itself is not internally differentiated (confirmed by inspection; pre-existing behavior, unchanged here).

Neither primitive was modified. F1's `user_roles.role='TEACHER'` (workspace-selection only) is never queried by either — confirmed by source inspection, which is why "TEACHER role alone" was already structurally unable to grant access before this phase began.

## 4. Read-Model Architecture

`src/lib/teacher/read-model.service.ts` — new file, mirrors `src/lib/parent/read-model.service.ts`'s architecture (F10) without modifying it. Every exported function that takes a `studentId` or `classId` re-validates authorization as its own first action, through the Teacher-specific primitive, never the generic `canAccessLearner`:

| Function | Authorization gate | Data sources |
|---|---|---|
| `getTeacherAssignedClasses(actorUserId)` | None needed — the query itself IS the relationship (identical join criteria to `canTeacherAccessLearner`, projected as a class list instead of a boolean over one learner) | `teacher_assignments` ⋈ `institution_memberships` ⋈ `classes` |
| `getTeacherClassRoster(actorUserId, classId)` | `canAccessClass(actorUserId, classId, 'TEACHER_ASSIGNMENT_MANAGE')` | `class_enrollments` (status='ACTIVE' only) ⋈ `students` |
| `getTeacherStudentOverview(actorUserId, studentId)` | `canTeacherAccessLearner(actorUserId, studentId)` | F5 `mastery.service.ts::getStudentMastery`, F5 `learning-debt.service.ts::getActiveDebts`, F9 `readiness.service.ts::getLatestReadinessSnapshot`, plus a narrow `student_exam_profiles` lookup (no reusable "active exam profile by student" export exists anywhere — see §10) |

No new mastery/readiness/competency/exam-scoring calculation exists anywhere in this file — every learning number is a direct call into, or count over, an existing F5/F9 read function.

## 5. API Surface

| Route | Method | Delegates to |
|---|---|---|
| `/api/teacher/classes` | GET | `getTeacherAssignedClasses` |
| `/api/teacher/classes/[classId]/roster` | GET | `getTeacherClassRoster` |
| `/api/teacher/students/[studentId]/overview` | GET | `getTeacherStudentOverview` |

Each route: `verifyAuth()` → `getOrCreateCanonicalUser()` → exactly one read-model call → maps `TeacherAccessDeniedError` to `403`. No route contains its own authorization logic, no route falls back to Parent or Owner. No non-GET handler exists on any of them.

## 6. Multi-Role Semantics

Proven for real (§8): a single actor holding both an accepted Parent relationship (to Student A) and an active Teacher assignment (covering Student B, no relationship to A) gets: Teacher API → A **DENY**, Teacher API → B **ALLOW**, Parent API → A **ALLOW**, Parent API → B **DENY**. Neither read model ever satisfies the other's relationship type. This was proactively designed in from the start (the Teacher Read Model was written calling `canTeacherAccessLearner` directly from its first version), applying F10's own multi-role finding rather than rediscovering it — see §11 for why no bug was found here.

## 7. Test Matrix

```
AUTOMATED_DOMAIN_UNIT:
  executed: 5525 (13 net new: f11-teacher-read-model-source-guard x5, f11-teacher-api-routes-security x8)
  passed:   5525
  failed:   0
  environment: vitest, in-process, no database

REAL_POSTGRES (F11-A):
  executed: 25 assertions (8 required adversarial cases + 6 multi-role isolation + 5 class isolation + setup checks)
  passed:   25
  failed:   0
  environment: ephemeral local Postgres (unix socket, never Neon/Preview/Production)

F2_REGRESSION:
  unit: 6 files / 58 tests -- PASS, unchanged
  real Postgres (f2-authorization-migration-cert.sh): PASS, unchanged

F10_REGRESSION:
  unit: 5 files / 31 tests -- PASS, unchanged
  real Postgres (f10-parent-experience-migration-cert.sh): PASS, unchanged (11 sections, 40 assertions)
  multi-role check (f10-multi-role-authorization-check.sh): PASS, unchanged

FULL_REPO_SUITE: 5525/5525 PASS
TSC: clean, zero errors
BUILD: clean, all 3 new routes present
```

## 8. Real PostgreSQL Certification (`f11-a-teacher-authorization-migration-cert.sh` → `f11-a-teacher-authorization-cert-runner.ts`)

All 8 required adversarial cases, both multi-role directions, and class isolation executed against real ephemeral Postgres, real service/read-model calls, never mocked:

| Case | Result |
|---|---|
| 1. Teacher assigned Class A, Student A enrolled Class A | **ALLOW** |
| 2. Teacher assigned Class A, Student B not enrolled | **DENY** |
| 3. Teacher not assigned Class B, Student B enrolled there | **DENY** |
| 4. Teacher Institution A, student only in Institution B | **DENY** |
| 5. Institution membership REVOKED, else valid | **DENY** (immediately after revocation) |
| 6. Teacher assignment ENDED, else valid | **DENY** |
| 7. Class enrollment ENDED, else valid | **DENY** |
| 8. F1 TEACHER role, zero institution assignment | **DENY** (`getTeacherAssignedClasses` also correctly empty, not an error) |
| Multi-role: Teacher API → Parent-only Student A | **DENY** |
| Multi-role: Teacher API → Teacher-only Student B | **ALLOW** |
| Multi-role: Parent API → Parent-only Student A | **ALLOW** |
| Multi-role: Parent API → Teacher-only Student B | **DENY** |
| Class isolation: roster(A) includes A's own enrolled student | **ALLOW** (present) |
| Class isolation: roster(A) excludes a student only in class B (same teacher) | **DENY** (absent) |
| Class isolation: roster(A) excludes an ENDED enrollment in A itself | **DENY** (absent) |
| Class isolation: roster(A) excludes a student from another institution | **DENY** (absent) |
| Class isolation: roster of another institution's class, requested by this teacher | **DENY** (throws) |

## 9. Regression Results

Zero regressions. F2's own real-Postgres lifecycle certification, F10's real-Postgres lifecycle certification, and F10's multi-role authorization check were all re-run in full (not just their unit-test mirrors) and produced byte-identical pass results to their last certified runs.

## 10. Known / Open Decisions

- **`getActiveExamProfile`-equivalent duplication (3rd occurrence)**: F7's own `/api/exam-profiles/route.ts`, F10's `read-model.service.ts`, and now F11-A's `read-model.service.ts` each independently query `student_exam_profiles` for the same "active profile for this student" lookup, because no reusable service export exists. F10 is frozen so it wasn't touched; a future phase should promote one canonical `getActiveExamProfile(studentId)` export now that three call sites confirm the need (already flagged once in `F10_NEXT_PHASE_HANDOFF.md`, item 4 — this document reconfirms it rather than re-raising it as new).
- **`canAccessClass`'s `permission` argument is not internally differentiated** — every `InstitutionPermission` value currently gates the identical real check. Not a defect for F11-A's purposes (the check itself is correct), but worth a real distinction if a future phase needs, e.g., a "view roster" permission that Institution Admins should have but a specific `TEACHER_ASSIGNMENT_MANAGE`-labeled action should not (or vice versa).
- `getTeacherStudentOverview`'s field set is intentionally minimal (mirrors Parent's overview shape) — F11-B will need to decide what additional teacher-specific fields (e.g., per-subject breakdown, diagnostic gap detail) the actual Teacher Workspace UI requires, sourced from the same F5/F8/F9 authorities, never a new calculation.

## 11. F11-B Intervention Architecture Collision — OPEN DECISION

**Recorded, not resolved, per explicit instruction.** F8 already built a full "intervention" concept: `src/lib/teaching/{intervention-policy,intervention-selection,session,ai-teaching-contract}.service.ts`, the `intervention_sessions` table, and `POST /api/teaching/interventions`. That route gates on `canAccessLearner(actor, studentId, 'LEARNER_INTERVENTION_CREATE')`, and `LEARNER_INTERVENTION_CREATE` is in `OWNER_PERMISSIONS` only — today, only the learner themself can trigger one; it is self-service, AI-selected remediation for their own diagnosed gap.

F2's own `F2_PERMISSION_MATRIX.md` reserved `LEARNER_INTERVENTION_CREATE` explicitly for "F11 (Teacher Workspace & Interventions)" — but F8 already partially colonized that same permission name for a different actor (the owner) and a different meaning (self-service, not teacher-assigned).

**F11-B must decide, explicitly, before writing any teacher-intervention code**, between at least two paths — neither implemented here:
- (a) Extend `TEACHER_PERMISSIONS` to also include `LEARNER_INTERVENTION_CREATE`, reusing F8's existing `intervention_sessions` model as-is for a teacher-initiated trigger (same table, same session lifecycle, an added authorized actor).
- (b) Treat "teacher-assigned support" as a conceptually distinct thing from F8's "AI-selected self-remediation," requiring its own vocabulary — but this risks exactly the kind of parallel-authority problem this phase was told to avoid, and should not be chosen lightly.

Neither `intervention_sessions` nor the `LEARNER_INTERVENTION_CREATE` permission set was modified in F11-A.

## 12. Certified Commit SHA

Recorded after the commit is made — see the final report's §M.
