# F10 — Target Parent Architecture

## Flow (task §2, "Correct")

```
Parent (Clerk actor)
  -> getOrCreateCanonicalUser(clerkId)          [F1, fixed to also back-fill profiles.user_id for parents]
  -> F2 canAccessLearner(actorUserId, studentId, 'LEARNER_PROGRESS_VIEW')
  -> src/lib/parent/read-model.service.ts        [NEW — the only thing UI/routes call]
       -> F4/F6  catalog + curriculum structure (names, subjects, blueprint)
       -> F5     Knowledge/Skill/Competency State, concept mastery
       -> F7     Student Exam Profile, Exam Version
       -> F8     diagnostics, interventions
       -> F9     computeReadinessSnapshot / getLatestReadinessSnapshot, simulation history
  -> Parent-safe DTOs (privacy-classified, see F10_PARENT_PRIVACY_MODEL.md)
```

Never: Parent role alone -> data; Parent -> raw learner table join in a route/UI; Parent action -> learner mastery/stage/diagnosis mutation.

## Layering

| Layer | File | Responsibility |
|---|---|---|
| Identity | `src/lib/auth.ts::getOrCreateParentId` (fixed) | Resolve/create parent `profiles` row, **with `user_id` populated** |
| Relationship (F2, unchanged) | `src/services/parent.service.ts` | Lifecycle: request/accept/decline/revoke, `getLinkedChildren` |
| Authorization (F2, unchanged) | `src/lib/authorization/index.ts::canAccessLearner` | The one gate every new F10 route calls |
| Read Model (NEW) | `src/lib/parent/read-model.service.ts` | 6 methods (task §12), each re-validates authorization itself |
| Privacy (NEW) | `src/lib/parent/privacy-classification.ts` | Field-tagging convention + DTO shaping helpers |
| Routes (NEW) | `src/app/api/parent/learners/`, `.../learners/[studentId]/{overview,subjects/[subjectId],activity,exam-prep,attention}` | Thin: resolve actor, call one read-model method, return |
| UI (extended) | `src/app/dashboard/parent/page.tsx` + new subject/exam-prep views | Consumes read-model routes only |

## Why no new relationship table, no new migration

F2's `parent_student_relationships` already carries every fact F10 needs (status, timestamps, `relationship_type` for future extension). The read model is a **projection layer**, not a new source of truth — it holds no state of its own beyond in-memory shaping of certified reads. This satisfies task §36 directly.

## What changes in existing files, and why it's safe

1. `src/lib/auth.ts::getOrCreateParentId` — adds canonical `users.id` resolution + `profiles.user_id` backfill on both the create path and the existing-row path (a parent profile created before this fix gets repaired on next login, mirroring the exact self-healing pattern `getOrCreateStudentId` already uses via `ensureProfileRows`). Additive: no existing caller's return shape changes (still returns `profiles.id`).
2. `src/services/parent.service.ts::linkChildByEmail` — upsert instead of `ON CONFLICT DO NOTHING` (fixes permanent-decline bug), and the route wrapping it stops branching on whether a student was found (fixes enumeration). No signature change to `getLinkedChildren`/`verifyParentAccess`/`unlinkChild`/`revokeRelationshipByStudent`/`respondToRequest` — zero risk to already-certified F2 behavior.
3. Everything else in `parent.service.ts` and its 5 routes is untouched.
