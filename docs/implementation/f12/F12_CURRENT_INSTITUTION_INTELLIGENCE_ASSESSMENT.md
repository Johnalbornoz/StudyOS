# F12 — Current Institution Intelligence Assessment (inspect-first)

Real inspection of F1/F2/F3/F4/F5/F6/F7/F8/F9/F10/F11 before any source change, per task §4.

## Current institution model (F2)

`institutions` (id, name, status DRAFT/ACTIVE/SUSPENDED/ARCHIVED) → `institution_memberships` (institution_id, user_id, `membership_role` CHECK IN **('TEACHER', 'INSTITUTION_ADMIN')** — only two roles exist today, no "Academic Coordinator" or any third role) → `grades` (institution_id, name) → `classes` (institution_id, grade_id nullable, name — **no status column**) → `class_enrollments` (class_id, student_id, status ACTIVE/ENDED) → `teacher_assignments` (institution_membership_id, grade_id, class_id, status ACTIVE/ENDED). Authorization primitives already exist and are reused unchanged: `canAccessInstitution` (APPROVED INSTITUTION_ADMIN membership only), `canAccessClass` (institution admin of the class's institution, OR a TEACHER with an ACTIVE assignment covering that exact class/grade), `canAccessLearner`/`isOwner`/`isActiveParentOf` (F1/F2, per-learner, never institution-scoped).

## Current authorization

No institution-wide "read all learners" primitive exists today, by design — `canAccessInstitution` only proves institution-admin identity; it says nothing about learner data. F11's Teacher Workspace deliberately never granted institution admins learner-level access either. F12 must add its OWN scope-resolution layer on top of `canAccessInstitution`/`canAccessClass`, never a new authorization primitive that bypasses them (INV-F12-22).

## Current analytics/reporting

**None exists.** Grep across `src/app` and `src/services`/`src/lib` for dashboard/analytics/reporting/aggregate/institution-stats/class-progress/grade-progress/teacher-metrics/school-metrics/coverage-report/student-progress/student-count/active-learners returns zero institution-level results. `src/app/api/admin/institutions` and `src/app/api/institutions` exist but are pure CRUD/membership-lifecycle routes (create institution, invite admin, request/decide/revoke membership, assignments) — no read/analytics surface. There is no legacy institution dashboard to displace or reconcile.

## Existing metrics and their real, current definitions (verified by reading the actual code, not assumed)

- **Concept-level "Knowledge State"**: `src/services/knowledge-state.service.ts`, table `concept_knowledge_state`. `MasteryState` = `UNKNOWN | LEARNING | DEVELOPING | PROVISIONAL_MASTERY | VALIDATED_MASTERY | AT_RISK | INTERVENTION_REQUIRED`. `ValidationReadiness` includes `INSUFFICIENT_EVIDENCE` explicitly. Computed by the real, unmodified `recalculateConceptKnowledgeState` — F12 only ever reads this table's already-materialized rows, never recomputes.
- **Skill/Competency state**: F5's `learner_skill_state`/`learner_competency_state`, `DimensionState` = `NO_EVIDENCE | INSUFFICIENT_EVIDENCE | EMERGING | CONSISTENT_INDEPENDENT` — a genuinely DIFFERENT taxonomy from Concept's `MasteryState`. These must never be collapsed into one score (task §13); F12 reports each dimension's own named states against its own population denominator.
- **Curriculum coverage (F6)**: `src/lib/curriculum/coverage.service.ts`, `computeMappingCoverage(structureVersionId)` / `computeContentCoverage(structureVersionId)`, backed by `coverage_policy_versions` (ACTIVE policy required, `countedMappingStatuses`/`fullCoverageRelationTypes`/`partialCoverageRelationTypes`). **Structure/subject-scoped, never student-scoped** — computing it once per curriculum structure, not once per learner, is what keeps institution-level coverage cheap (no N+1). Explicitly separate from F9's own PER-STUDENT `classifyBlueprintTargetCoverage` (exam-blueprint evidence coverage) — task §15 requires these stay distinguishable; conflating them would silently turn a per-student exam-readiness concept into a general curriculum-coverage claim or vice versa.
- **F9 Readiness**: `src/lib/readiness/readiness.service.ts`, `readiness_snapshots` (append-only, one row per `computeReadinessSnapshot` call), `OverallReadinessStatus` = `INSUFFICIENT_EVIDENCE | EARLY_PREPARATION | DEVELOPING | SIMULATION_READY | FULL_MOCK_ELIGIBLE`, 7 named `ReadinessDimension`s, `ScoreProjectionAvailability` = `AVAILABLE | NOT_AVAILABLE_NO_CALIBRATION | NOT_AVAILABLE_INSUFFICIENT_DATA | NOT_APPLICABLE`. Scoped to one `(studentId, examProfileId, examVersionId)` triple — institution readiness must group by `examVersionId` and never average across different exam versions/definitions (INV-F12-17).
- **Legacy readiness**: `src/services/exam-readiness.service.ts` (`calculateExamReadiness`/`getMultiSubjectReadiness`/`getOverallExamReadiness`) — a live, still-existing, pre-F9 module producing a single opaque percentage + a fabricated predicted score. F12 must never import from this file (source-guard required, task §33/§58).
- **F8 diagnosis**: `src/lib/diagnostics/diagnosis.service.ts`, real persisted table `learner_gap_diagnoses` (written by `runDiagnosis`/`replayDiagnosis`). F12 aggregates by reading this EXISTING table (`GROUP BY primary_gap_type`, joined to institution scope), never by re-invoking `runDiagnosis` per learner — this is what keeps diagnostic aggregation N+1-free and keeps F8 the sole diagnostic authority.
- **F11 interventions**: `teacher_interventions`/`teacher_intervention_executions` (F11-B/C1-C4), statuses `ASSIGNED/IN_PROGRESS/COMPLETED/CANCELLED/EXPIRED` (the last derived lazily via `getEffectiveStatus`, never persisted) and four `intervention_type` values. F12 reads these tables directly, grouped by class/type/status/time window — never a second intervention registry.

## Duplicate-truth risks identified and avoided

- A per-learner loop calling F9's `computeReadinessSnapshot`/F8's `runDiagnosis`/F6's per-student blueprint coverage at institution scale would both violate N+1 guidance (§45) AND risk silently becoming a second, institution-specific classification. F12's design reads only already-materialized rows (`readiness_snapshots`, `learner_gap_diagnoses`, `learner_skill_state`, `learner_competency_state`, `concept_knowledge_state`) via set-based `GROUP BY` queries scoped by institution membership, never per-row service re-invocation.
- `exam-readiness.service.ts` (legacy) must never be imported — confirmed no current F9/F11 code imports it either (it is orphaned/legacy but still live for whatever pre-F9 caller uses it), so F12 introduces zero new dependency on it.

## Privacy risks identified

- Institution admins have never had learner-level access before F12; the FIRST thing F12 must not do is grant it merely because an admin CAN reach the institution. Any learner drill-down must independently re-verify the specific learner belongs to the authorized institution's active enrollment (never inferred from a client-supplied `learnerId` alone).
- Small cohorts (a class or grade with very few learners) can make an aggregate individually identifying. No approved production threshold exists yet (confirmed: no prior F12 product decision beyond the discovery branch's own non-final architecture proposal, itself not independently re-confirmed in this session) — task §27 explicitly forbids inventing one; a TEST POLICY only will be used for certification, versioned so a real product decision can replace it later without a code change.

## Cross-institution leakage risks

`canAccessInstitution`/`canAccessClass` already fail closed (return `false` inside try/catch on any error, never throw a distinguishing error an attacker could use to enumerate institutions) — F12's own scope-resolution layer reuses these unchanged rather than re-deriving institution membership from any other signal (e.g., never inferring institution from a class id supplied by the client without checking that class's own `institution_id` matches the authorized institution).

## Double-counting risks

A learner enrolled in two `ACTIVE` classes within the same institution must count once in `UNIQUE_LEARNERS` and twice in total `ACTIVE_ENROLLMENTS` — both numbers are reported, explicitly labeled, never conflated (INV-F12-16, task §30).

## Legacy readiness dependencies

None found calling into F12's own future code (F12 doesn't exist yet); the risk is purely prospective (a future contributor importing the legacy service into an F12 file) — mitigated by an explicit source guard.

## Performance/query risks

Institution-scale aggregation is the heaviest query surface in the codebase to date. The design avoids N+1 by using `GROUP BY`/set-based SQL against already-materialized tables for every dimension (roster, learning state, coverage, readiness, diagnosis, interventions) — no per-learner loop anywhere in the read model. Bounded pagination is required for roster-shaped lists (teachers, classes, learner summaries) since institution population can grow arbitrarily.

## Missing institutional hierarchy semantics

`classes` has no `status` column — "active class" has no stored truth and must be defined operationally in the metric catalog (documented, not invented ad hoc): a class counts as part of the roster if it exists in an ACTIVE institution; "recently active" activity-based metrics use enrollment/intervention timestamps instead of a class-level status that does not exist. `institution_memberships` and `teacher_assignments` DO have real status fields (`APPROVED`/`REVOKED`, `ACTIVE`/`ENDED`) which the roster metrics use directly.

## Discovery branch findings (origin/f12/institution-intelligence-discovery)

Inspected per task §1. Its merge-base with the final certified F11 SHA (`fa21298`) is `cf16bf98` — the PRE-final integrated-certification candidate, confirming the discovery branch predates final F11 certification. Per task rule, it is NOT used as an implementation baseline; `f12/institution-intelligence` was created directly from `fa21298` instead. The branch contains real code stubs (a migration, two route files, a service file, a dashboard page, a test file) built on that stale base — none of this code is reused. Its documentation (`architecture/f12/README.md`, `discovery-state.md`) records exploratory decisions from a prior session, including a proposed new "Academic Coordinator" institution-membership role and a candidate minimum-cohort size of 10. Neither is adopted as-is in this implementation: the "Academic Coordinator" role does not exist in F2's real schema (confirmed above — only `TEACHER`/`INSTITUTION_ADMIN`) and this session's own task text never requests it, so introducing it now would be an unrequested new authority; the candidate cohort size of 10 is used ONLY as this certification's explicit TEST POLICY value (clearly labeled, versioned, never silently promoted to a product default), consistent with task §27's requirement.
