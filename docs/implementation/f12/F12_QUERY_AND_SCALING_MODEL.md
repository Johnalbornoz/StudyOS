# F12 — Query and Scaling Model

## N+1 avoidance (task section 45)

Every institutional aggregate is a single set-based SQL statement (or a small, fixed number of `Promise.all`-parallel statements) — never a loop that issues one query per learner/teacher/class. Structurally guarded: `f12-institution-intelligence-source-guard.test.ts` scans every file in the module for a `for`/`forEach`/`map` loop body containing a `db.query` call and fails the build if one exists.

Concretely:
- Roster counts: one `GROUP BY`/`COUNT DISTINCT` query per metric, never per-learner.
- Learning distributions: one `GROUP BY` over `learner_skill_state`/`learner_competency_state`/`concept_knowledge_state` filtered by `student_id = ANY($1::uuid[])` — a single query covers the entire cohort regardless of size.
- Coverage: one query per structure version (never per-learner at all — coverage is student-independent).
- Readiness: one `DISTINCT ON` query per exam version, covering every learner's latest snapshot in one round trip.
- Diagnostics: one `DISTINCT ON` + `GROUP BY` query, covering every learner's latest diagnosis per (concept, scope) in one round trip.
- Interventions: one query filtered by `institution_id`/`class_id`, aggregated in application code (a single small in-memory loop over the RESULT ROWS, not a loop that issues additional queries).

## Pagination (task section 46, AC-F12-28)

`getInstitutionClasses` and `getInstitutionTeachers` return `PaginatedResult<T>` (`items`, `limit`, `offset`, `totalCount`), bounded to `MAX_PAGE_SIZE = 100` (default 25), with deterministic ordering (`ORDER BY name, id` / `ORDER BY id`) so page N is reproducible across calls. No route returns an unbounded whole-institution roster by default.

## Local performance characterization (task section 44) — see `F12_PERFORMANCE_BASELINE.md`

At a 50-learner synthetic scale, `getInstitutionOverview`/`getInstitutionLearnerSummary`/`getInstitutionClasses` all complete in low single-digit milliseconds (p95 <= 2.1ms) against a real, unindexed-beyond-defaults local Postgres instance — consistent with the set-based query design above, not a coincidence of a small dataset alone (the query SHAPE does not change as the learner count grows; only the row count scanned does, and every hot filter column — `student_id`, `class_id`, `institution_id`, `exam_version_id` — already has a real index from its owning phase's own migration).

## Export (task section 47)

No broad institutional export was implemented or widened in this phase — none existed before F12, and F12 adds none. Bulk export remains explicitly out of scope, requiring its own future privacy/security review.
