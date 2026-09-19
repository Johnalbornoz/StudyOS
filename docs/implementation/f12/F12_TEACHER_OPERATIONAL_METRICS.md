# F12 — Teacher Operational Metrics

## What is measured (task section 23)

| Field | Meaning | Source |
|---|---|---|
| `activeAssignmentCount` | Real, ACTIVE `teacher_assignments` rows | `teacher_assignments` |
| `activeLearnerCount` | Distinct learners reachable through those active assignments (class-specific or grade-wide) | `teacher_assignments` JOIN `classes` JOIN `class_enrollments` |
| `interventionsAssigned` | Count of `teacher_interventions` this teacher assigned | `teacher_interventions.assigned_by_user_id` |
| `interventionsCompleted` | Of those, count currently `COMPLETED` | `teacher_interventions.status` |
| `lastInterventionAssignedAt` | Recency signal | `MAX(teacher_interventions.assigned_at)` |

`getInstitutionTeachers` (roster listing) additionally reports `activeAssignmentCount`/`activeLearnerCount` per teacher inline, for the same reason.

## What is deliberately absent

No score, no percentage, no rank, no comparison across teachers, no "completion rate" ratio that could be read as a quality proxy. Task section 23's own explicit prohibition ("Do not create a Teacher performance ranking from Student outcomes... No BEST TEACHER, WORST TEACHER, TEACHER QUALITY SCORE") is enforced structurally: no function in `interventions.service.ts` or anywhere else in the module sorts an array of teachers by any numeric field, and no field name in any teacher-related type suggests a quality judgment (structurally guarded by regex in `f12-institution-intelligence-source-guard.test.ts`).

## Teacher activity is not Teacher quality (INV-F12-13/14)

`interventionsAssigned`/`interventionsCompleted` are operational counts of ACTIONS TAKEN, not judgments of their effect. A teacher who assigns many interventions is not thereby scored as "better" or "worse" than one who assigns few — the catalog has no field that would let a caller construct that comparison from this data alone without independently deciding to (which is outside F12's own responsibility and would require a separately-approved methodology, per task section 23's own framing).
