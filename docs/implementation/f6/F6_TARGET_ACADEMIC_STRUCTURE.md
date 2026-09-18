# F6 — Target Academic Structure

## Design principle

Canonical knowledge (F4) exists once. Frameworks reference it through explicit, versioned,
editorially-governed mappings — never a second knowledge identity per framework (INV-F6-01/02).

```
academic_organizations  (Cambridge International, International Baccalaureate, ICFES/PAA body)
        │ 1:N
academic_programmes  (programme_type: CURRICULUM | ASSESSMENT_FRAMEWORK | ADMISSION_EXAM)
        │ 1:N
academic_qualifications  (optional layer -- "where applicable", task §6)
        │ 1:N
academic_subjects  (org+programme+qualification+subject+level scoped, task §7)
        │ 1:N
structure_versions  (DRAFT -> PUBLISHED -> SUPERSEDED/RETIRED; task §7/§8)
        │ 1:N (self-referencing tree, variable depth, variable nomenclature)
structure_nodes  ──┬── structure_node_localizations (optional translated label)
        │ 1:N
learning_objectives
        │ M:N (separate concrete junction tables, mirroring F4's own pattern)
        ├── objective_concept_mappings ──→ canonical_concepts (F4)
        ├── objective_skill_mappings ──→ skills (F4)
        └── objective_competency_mappings ──→ competencies (F4, "where justified")

academic_resources (editorial citation/reference, NOT file storage)
        │ M:N
resource_objective_links ──→ learning_objectives

curriculum_editorial_grants (user_id, EDITOR|REVIEWER|PUBLISHER -- separate from F1 Role)
coverage_policy_versions (versioned coverage rules, mirrors aggregation_policy_versions)
```

## Why this shape

- **INV-F6-01/02** (no duplicate canonical concept authority): `objective_concept_mappings`,
  `objective_skill_mappings`, `objective_competency_mappings` only ever *point at* F4's existing
  `canonical_concepts`/`skills`/`competencies` — no framework ever gets its own concept table.
- **INV-F6-05/06/07** (curriculum structure ≠ assessment blueprint ≠ textbook structure):
  `structure_nodes.node_type` is free text, never a fixed `Chapter→Unit→Topic` hierarchy, and
  carries no assessment-weight/distribution field — see `F6_STRUCTURE_VERSION_MODEL.md` and the
  blueprint-boundary discussion there. A separate, unrelated `academic_resources` entity models
  textbook/content citation, never merged into `structure_nodes`.
- **INV-F6-08/09** (mappings versioned, historical mappings never rewritten): every mapping row
  belongs to a `mapping_group_id`; a "change" retires the old row (`status = 'RETIRED'`) and
  inserts a new one in the same group with an incremented `version` — the exact retire-and-insert
  shape F5's `aggregation_policy_versions` already established, reused verbatim.
- **INV-F6-10** (mapping approval ≠ content approval): `objective_concept_mappings.status` and
  `academic_resources.status` are two entirely independent workflow columns on two entirely
  independent tables — approving one has zero effect on the other.
- **INV-F6-15** (no framework-specific learner state): nothing in this schema has a `student_id`
  column. Every table here is canonical/framework-scoped, exactly like F4's catalog.

## Visible product surface — unchanged

Per task §41, F6 builds only enough admin/editorial API to prove the model (browse structure,
propose/review/publish mapping, inspect coverage) — no learner-facing UI changes, no final
institutional content-management experience. F10+ own user-facing curriculum alignment display.

## Explicitly out of scope (task §32/§40, carried into the residual risk register)

- Assessment Blueprint Engine, Exam Readiness, exam scoring/timing — F7+.
- Framework-specific learner state (a "learner's IB DP progress") — forbidden by INV-F6-15,
  would duplicate F5's evidence-derived state with a framework-scoped shadow copy.
- Automatic elevation of Teacher/Institution Admin to Editor/Reviewer/Publisher — editorial
  privileges are always a separate, explicit grant (task §32).
