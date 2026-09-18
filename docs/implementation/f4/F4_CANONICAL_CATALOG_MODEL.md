# F4 — Canonical Catalog Model

## canonical_subjects

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text NOT NULL | e.g. "Mathematics". No uniqueness constraint (a future F6 framework may need two subjects with the same display name in different contexts). |
| status | text CHECK (DRAFT\|ACTIVE\|RETIRED) DEFAULT 'ACTIVE' | |
| created_at, updated_at | timestamptz | |

Index: `(name)` for candidate lookup only — never unique.

## canonical_concepts

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | Stable identity — this is the F4 "canonical concept" per task §6. |
| canonical_subject_id | uuid NOT NULL FK → canonical_subjects | |
| name | text NOT NULL | Display name. **Deliberately not unique** — task §8 requires same-name/different-definition, same-name/different-level, same-name/different-scope to all be representable as distinct rows. |
| description | text NULL | The "definition" dimension distinguishing concepts beyond name. |
| level | text NULL | Free-text scope/level marker (e.g. "SL", "HL", a grade band) — deliberately generic, no framework-specific vocabulary (task §6: "do not embed IB, Cambridge, PAA... directly"). |
| status | text CHECK (DRAFT\|ACTIVE\|DEPRECATED) DEFAULT 'ACTIVE' | |
| created_at, updated_at | timestamptz | |

Index: `(canonical_subject_id, name)` — advisory candidate-search index, **not** a uniqueness
constraint. This is the single most important modeling decision in this document: a
`UNIQUE(canonical_subject_id, name)` constraint would silently make F4 do exactly what INV-F4-04
forbids (merge by name) the moment two legitimately-different concepts share a display name.

## skills

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text NOT NULL | e.g. "interpret", "factor polynomial". |
| skill_type | text CHECK (TRANSVERSAL\|DISCIPLINE_SPECIFIC) NOT NULL | Task §9's two families. |
| description | text NULL | |
| status | text CHECK (DRAFT\|ACTIVE\|RETIRED) DEFAULT 'ACTIVE' | |
| created_at | timestamptz | |

No uniqueness on `name` either, for the same reason as `canonical_concepts` — a transversal
"analyze" and a discipline-specific "analyze [primary source]" could plausibly both exist as
distinct rows; the fixture set stays small and reviewed (task §9), not deduplicated by a
database constraint.

## competencies

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| code | text UNIQUE NOT NULL | e.g. `C1`..`C10`. This IS our own closed, internally-defined taxonomy (task §10), so uniqueness on `code` is intentional and safe — unlike `canonical_concepts.name`, this is not user/AI-generated open text. |
| name | text NOT NULL | e.g. "Recall". |
| description | text NULL | |
| sequence | integer NULL | The C1→C10 ladder position — informational ordering only, never implies a mandatory linear progression requirement (task §10 explicitly: this is a taxonomy, not a learner-state model). |
| status | text CHECK (DRAFT\|ACTIVE\|RETIRED) DEFAULT 'ACTIVE' | |
| created_at | timestamptz | |

## contexts

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| code | text UNIQUE NOT NULL CHECK (FAMILIAR\|ALTERED\|REAL_WORLD\|UNFAMILIAR\|CROSS_DOMAIN) | Task §11's fixed vocabulary — a closed taxonomy, uniqueness intentional. |
| name | text NOT NULL | |
| description | text NULL | |
| sequence | integer NULL | |
| created_at | timestamptz | |

Not wired into `learning_evidence`/`quiz_sessions`/any activity table this phase — see target
architecture doc. Table exists so F5 can add a nullable `context_id` FK without another schema
design pass.

## Many-to-many junctions

### canonical_concept_skills
`(canonical_concept_id FK, skill_id FK)`, composite PK. One canonical concept may reference many
skills; one skill may be referenced by many canonical concepts (task §9/§12, fixtures J/K).

### skill_competencies
`(skill_id FK, competency_id FK)`, composite PK. One skill may map to many competencies; one
competency may be reached via many skills (task §12, fixture L).

### canonical_concept_competencies
`(canonical_concept_id FK, competency_id FK)`, composite PK. "Where justified" (task §12) — this
is a direct link for cases where a competency is assessed at the concept level without needing to
route through a skill; not implied automatically by any `canonical_concept_skills` +
`skill_competencies` chain (INV-F4-09: competency completion is never inferred from concept
completion, and this table's mere existence of a row is taxonomy, not a completion claim).

### canonical_concept_prerequisites
`(prerequisite_concept_id FK, concept_id FK)`, composite PK, `CHECK (prerequisite_concept_id <>
concept_id)`. Many-to-many, self-referencing on `canonical_concepts`. **Distinct from, and does
not replace,** the existing per-student `concept_relationships` table (task §13: "do not confuse
presentation order with prerequisite dependency" — this is the canonical-level dependency graph;
the existing table remains the per-student one, untouched). Cycle prevention is enforced in
application code at write time (see migration spec §"Cycle detection"), not by a DB constraint,
since Postgres has no native DAG-enforcement primitive; a recursive CTE checks reachability from
the proposed prerequisite back to the concept before insert.

## concept_catalog_mapping (the correspondence layer, task §7)

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| learner_concept_id | uuid UNIQUE NOT NULL FK → concepts(id) | Exactly one mapping row per existing learner concept — enforced by the UNIQUE constraint itself, not by application discipline. |
| canonical_concept_id | uuid NULL FK → canonical_concepts(id) | Set only when `status = 'MATCHED'`. NULL for PROPOSED/AMBIGUOUS/UNRESOLVED (the candidates live in the child table below). |
| status | text CHECK (MATCHED\|PROPOSED\|AMBIGUOUS\|UNRESOLVED) NOT NULL | Task §7's vocabulary. |
| mapping_method | text CHECK (EXACT_LABEL_MATCH\|MANUAL_REVIEW\|SEED_FIXTURE) NULL | Provenance — auditability (task §7: "auditable correspondence"). |
| reviewed_by | uuid NULL FK → users(id) | F1 canonical user, when a human confirms/changes a mapping. |
| reviewed_at | timestamptz NULL | |
| created_at, updated_at | timestamptz | |

## concept_catalog_mapping_candidates

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| mapping_id | uuid NOT NULL FK → concept_catalog_mapping(id) | |
| canonical_concept_id | uuid NOT NULL FK → canonical_concepts(id) | |
| confidence | numeric NULL CHECK (0..1) | |
| rationale | text NULL | Free text — why this candidate was proposed (e.g. "exact label match within same canonical subject"). |
| created_at | timestamptz | |

For an `AMBIGUOUS` mapping, 2+ candidate rows exist and none has been promoted; for `PROPOSED`,
exactly one candidate exists awaiting human confirmation; for `UNRESOLVED`, zero candidates exist;
for `MATCHED`, the confirmed candidate's `canonical_concept_id` also appears on the parent
mapping row.

## Explicitly not modeled here (F6 scope, task §19/§33)

Structure versions, official curriculum codes, editorial publish/review/publish workflow,
coverage percentages, per-framework identity on `canonical_concepts`.
