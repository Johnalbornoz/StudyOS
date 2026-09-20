# 04 — Identity, Roles, and Authorization

## The identity model (F1, additive — real design, not idealized)

Two identity spaces pre-date F1 and are **never replaced**:
- `students` (`id`, `clerk_id`, `email`, ...) — the original student-identity anchor.
- `profiles` (`id`, `user_type` ∈ `{admin, parent, student}`, `clerk_id`, ...) — the original parent/admin-identity anchor; a `profiles` row with `user_type='student'` shares its `id` with the corresponding `students` row by convention (not a foreign key — a pre-existing, documented contract F1 relies on rather than re-derives).

F1 adds, additively, on top:

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id text NOT NULL UNIQUE,
  email text,
  status text DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  active_workspace text CHECK (active_workspace IN ('STUDENT','PARENT','TEACHER','INSTITUTION','ADMIN'))
);

CREATE TABLE user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('STUDENT','PARENT','TEACHER','INSTITUTION_ADMIN','STUDYUS_ADMIN')),
  status text DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  granted_via text NOT NULL CHECK (granted_via IN ('SELF_REGISTRATION','BACKFILL','INVITATION')),
  UNIQUE (user_id, role)
);

ALTER TABLE students ADD COLUMN user_id uuid REFERENCES users(id);
ALTER TABLE profiles ADD COLUMN user_id uuid REFERENCES users(id);
```

**Why additive, not a rewrite**: every learning-domain table (`learning_evidence`, `simulation_attempts`, `exam_attempts`, dozens more) already keyed off `students.id`/`profiles.id`. Re-pointing all of them to `users.id` in one migration would have been exactly the kind of big-bang rewrite this program's own standing rule ("no architecture rewrite") forbids. `user_id` on `students`/`profiles` is the bridge; the learning domain never needed to change.

## The backfill (idempotent by construction, not by luck)

`src/services/identity-backfill.service.ts`'s `runIdentityBackfill()`:

1. One `users` row per `students.clerk_id` (`ON CONFLICT (clerk_id) DO NOTHING`).
2. One `users` row per `profiles(user_type='parent').clerk_id` not already covered by step 1 (a parent who is also a student shares the clerk_id — correctly reuses the same row).
3. `students.user_id` backfilled by exact `clerk_id` match.
4. `profiles(user_type='parent').user_id` backfilled by exact `clerk_id` match.
5. `profiles(user_type='student').user_id` backfilled via the documented `profiles.id = students.id` share — **never** by name/email similarity (an explicit invariant, INV-F1-11/12).
6. `STUDENT` role granted to every user resolved from a `students` row; `PARENT` role granted to every user resolved from a parent profile.

Every insert is `ON CONFLICT ... DO NOTHING` — re-running to completion is always safe. **LIVE VERIFIED**: run twice against the real Preview database on 2026-09-20; the second run produced zero new writes.

Ambiguous rows (`profiles(user_type='student')` with no matching `students` row) are counted and listed as `orphanedProfileIds`, never silently assigned or merged — this run reported **0**.

## Role vocabulary

| Role | Granted via | Meaning |
|---|---|---|
| `STUDENT` | Backfill or self-registration | Owns their own learning data |
| `PARENT` | Backfill, self-registration, or invitation | Views a child's data once a `parent_student_relationships` row is `accepted` |
| `TEACHER` | Invitation | Views/intervenes on a student's data once membership + assignment + enrollment are all active |
| `INSTITUTION_ADMIN` | Invitation | Manages memberships/assignments for one institution; **never** granted direct access to individual learner data (see below) |
| `STUDYUS_ADMIN` | Out of band | Platform operator role |

## Permission model (F2, real code — not a database-driven RBAC table)

`src/lib/authorization/` implements a small, explicit vocabulary (`LearnerPermission`/`InstitutionPermission` TypeScript types) with satisfaction rules as code (`PARENT_PERMISSIONS`/`TEACHER_PERMISSIONS`/`OWNER_PERMISSIONS`), not database rows. **This was a deliberate scope decision**: a generic `permissions`/`role_permissions` table would be a full RBAC platform for what is, in practice, 5 permissions — not built, and not missing by accident.

### Permission × Actor matrix (F2, real, each cell test-backed)

| Actor | `LEARNER_PROGRESS_VIEW` | `LEARNER_PROFILE_VIEW` | `LEARNER_INTERVENTION_CREATE` | `INSTITUTION_MEMBER_APPROVE` | `TEACHER_ASSIGNMENT_MANAGE` |
|---|---|---|---|---|---|
| Owner (Student) | ✅ | ✅ | ✅ | — | — |
| Parent, relationship `accepted` | ✅ | ✅ | ❌ | — | — |
| Parent, `pending`/`declined`/`revoked` | ❌ | ❌ | ❌ | — | — |
| Teacher, membership `APPROVED` + active assignment covering the student's class | ✅ | ✅ | ✅ (as of F11) | — | — |
| Teacher, any other state | ❌ | ❌ | ❌ | — | — |
| Institution Admin, `APPROVED` in the exact institution | ❌ (never — see below) | ❌ (never) | ❌ | ✅ | ✅ |
| Institution Admin, different institution | ❌ | ❌ | ❌ | ❌ | ❌ |
| Anonymous | ❌ | ❌ | ❌ | ❌ | ❌ |

**Why Institution Admin never satisfies `LEARNER_*`**: no branch of `canAccessLearner` consults `institution_memberships` at all. Deliberate — administering an institution was never meant to grant direct access to an individual student's learning data; institution-level visibility is F12's own separate, cohort-suppressed aggregate metrics (see [06_EXAM_READINESS_AND_INTERVENTIONS.md](06_EXAM_READINESS_AND_INTERVENTIONS.md)), not row-level access.

**Test evidence**: `tests/unit/f2-authorization-service.test.ts` (unit, mocked) and `scripts/operations/f2-authorization-migration-cert.sh` (real Postgres) — **TESTED**. Each row of the matrix above is exercised, not just asserted.

## Multi-role and negative-authorization posture

A single `users` row may hold multiple `user_roles` (e.g. a person who is both a Parent and a Teacher). Authorization checks are always **per-role, per-request-scope** — a request presenting itself through the Parent route only ever grants Parent-level access, never silently upgraded by an unrelated Teacher role the same user also happens to hold. This exact class of bug was found and fixed once already (F10: a Parent-scoped route incorrectly treated Owner/Parent/Teacher as equivalent) — see [02_PHASES_F0S_TO_F15.md](02_PHASES_F0S_TO_F15.md).

Institution boundary: an Institution Admin's `INSTITUTION_MEMBER_APPROVE`/`TEACHER_ASSIGNMENT_MANAGE` permissions are scoped to the **exact institution** their own membership is `APPROVED` in — cross-institution access is explicitly denied and negative-tested.

## Status

- Identity model, backfill, and F2 permission matrix: **IMPLEMENTED**, **TESTED** (unit + real-Postgres).
- Live database state (11 users/students, 15 profiles/user_roles, 0 broken links): **LIVE VERIFIED** (see [03_DATABASE_SCHEMA_AND_MIGRATIONS.md](03_DATABASE_SCHEMA_AND_MIGRATIONS.md)).
- Live authenticated exercise of this authorization matrix (a real logged-in user actually hitting these boundaries): **BLOCKED pending operator-assisted login** — see [13_PILOT_RUNBOOK.md](13_PILOT_RUNBOOK.md).
