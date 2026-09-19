# F12 — Institution Metric Catalog

Every metric below is returned through the same `MetricEnvelope<T>` shape (task section 10) — no institutional number is ever a bare integer.

| metric_id | Name | Scope | Time Window | Numerator | Denominator | Data Source | Exclusions |
|---|---|---|---|---|---|---|---|
| `INSTITUTION_ACTIVE_TEACHER_COUNT` | Active Teachers | INSTITUTION | LIFETIME | count of APPROVED TEACHER memberships | n/a | `institution_memberships` | PENDING/REJECTED/REVOKED |
| `INSTITUTION_CLASS_COUNT` | Classes | INSTITUTION | LIFETIME | count of classes | n/a | `classes` | none (no status column exists -- documented limitation) |
| `INSTITUTION_UNIQUE_ACTIVE_LEARNERS` | Unique Active Learners | INSTITUTION | LIFETIME | distinct students with an ACTIVE enrollment | n/a | `class_enrollments` JOIN `classes` | ENDED enrollments |
| `INSTITUTION_ACTIVE_ENROLLMENT_COUNT` | Active Enrollments | INSTITUTION | LIFETIME | count of ACTIVE enrollment rows | n/a | `class_enrollments` JOIN `classes` | ENDED enrollments |
| `LEARNING_UNIQUE_LEARNER_COUNT` | Unique Learners in Scope | INSTITUTION/CLASS | LIFETIME | distinct active learners in scope | n/a | `class_enrollments` | — |
| `LEARNING_EVIDENCE_PRESENCE` | Learners With vs Without Any Evidence | INSTITUTION/CLASS | LIFETIME | learners with >=1 `learning_evidence` row | unique learners in scope | `learning_evidence` | — |
| (unnamed distribution) | Concept Knowledge State Distribution | INSTITUTION/CLASS | LIFETIME | count per `mastery_state` | n/a (reported per-state) | `concept_knowledge_state` | — |
| (unnamed distribution) | Skill State Distribution | INSTITUTION/CLASS | LIFETIME | count per `state` | n/a | `learner_skill_state` | — |
| (unnamed distribution) | Competency State Distribution | INSTITUTION/CLASS | LIFETIME | count per `state` | n/a | `learner_competency_state` | — |
| `CURRICULUM_MAPPING_COVERAGE` | Curriculum Objective Mapping Coverage | INSTITUTION (structure-scoped) | LIFETIME | fully-mapped objective count | total PUBLISHED objectives | `objective_concept_mappings`/`objective_skill_mappings`/`objective_competency_mappings` | DRAFT/PROPOSED/IN_REVIEW/REJECTED/RETIRED |
| `CURRICULUM_CONTENT_COVERAGE` | Curriculum Objective Content Coverage | INSTITUTION (structure-scoped) | LIFETIME | objectives with >=1 PUBLISHED resource | total PUBLISHED objectives | `resource_objective_links`/`academic_resources` | DRAFT/rejected/retired resources; duplicate resources never inflate |
| `READINESS_LEARNER_COUNT` | Learners With a Readiness Snapshot for This Exam Version | INSTITUTION/CLASS (exam-version-scoped) | LIFETIME (latest snapshot per profile) | learners with >=1 snapshot for the named exam version | n/a | `readiness_snapshots` | snapshots for a DIFFERENT exam version |
| (unnamed distribution) | Overall/Dimension/Score-Projection Readiness Distribution | INSTITUTION/CLASS (exam-version-scoped) | LIFETIME (latest per profile) | count per status | n/a | `readiness_snapshots` | — |
| `DIAGNOSTIC_GAP_DISTRIBUTION` | Latest Diagnosed Gap Type Distribution | INSTITUTION/CLASS | LIFETIME (latest per student/concept/scope) | count per `primary_gap_type` | n/a | `learner_gap_diagnoses` | superseded/replayed historical diagnoses (only the latest counts) |
| `INTERVENTION_STATUS_DISTRIBUTION` | Teacher Intervention Status/Type Distribution | INSTITUTION/CLASS | LIFETIME or ROLLING_DAYS (explicit) | count per status/type | n/a | `teacher_interventions` | — |

## Reproducible numerator/denominator (AC-F12-23)

Every metric above states its exact source table(s) and exclusion rules — never an opaque "82%" with no stated population. `evidencedFraction`-style ratios (F6 coverage) are `null`, not `0` or `NaN`, when the denominator is genuinely zero.

## What this catalog deliberately does NOT contain

No `School Score`, no cross-subject "mastery percentage," no Teacher quality/ranking metric, no predictive risk score — none of these are computed anywhere in F12 (task section 10/23/36).
