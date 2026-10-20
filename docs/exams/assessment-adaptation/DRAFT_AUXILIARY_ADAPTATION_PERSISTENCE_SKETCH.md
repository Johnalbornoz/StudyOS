# AUXILIARY DRAFT — adaptation-layer persistence sketch

> **AUXILIARY DRAFT — NOT EA-1A, NOT CERTIFIED.**
> - This document is **not** the EA-1A deliverable. Its scope was **inferred** when no EA-1A brief had been received, and it was rejected as EA-1A.
> - Nothing in it is certified, reviewed or approved. **Its tables must not be implemented.**
> - It predates the LearningApproachProfile layer and the locked policy rulings (certified profiles for evidence-bearing content, version-bound component profiles, no dev-test content in protected mock pools, `INSTITUTION_POLICY` authority, deferred ingestion of dev-test content), and is wrong wherever it disagrees with them.
> - It is **superseded by the persistence section of the real EA-1A document**, `EA1A_LEARNING_APPROACH_PROFILES_AND_STEM_PLUS.md`, which revisits every table below.
> - It is kept only as the working sketch that revision started from. No SQL file and no migration was ever created from it; every `CREATE` below is prose in a design note, read from `database/migrations/` and never run.

Companion: `EA1_TRANSVERSAL_ASSESSMENT_ADAPTATION_ARCHITECTURE.md` (the domain model and the decisions of 2026-10-11).

## 1. What is persisted, and what stays code

| Persisted | Why | Stays code-only | Why |
|---|---|---|---|
| Task families and versions | Identity must outlive releases; items reference the exact version | The specialisation registry and schemas (`MATH_PROBLEM`, …) | Validation logic; content is validated by code before it is written |
| System and component profiles, versions, rules, rule sources | Review history; OFFICIAL lineage as rows | `resolveProfile`, rule-consistency checks | Pure functions over the rows |
| Discipline policies (versions) | Audit of what a specification was produced under | The engine `adapt()` and its refusals | Deterministic; a refusal is not stored |
| Assessment applicability, its evidence, threshold policies | The fact production reads; must be auditable and scoped | `resolveApplicability`, `applicabilityStatusOf` | Derivation over the rows |
| Adaptation specifications (when an item was produced from one) | Reproducibility: it is part of the prompt hash | The POC matrix, the demand estimate | Analysis artifacts |
| Item task-family lineage (generated or authored) | B2 / B3 need it; cannot be recomputed | Instance policy table (`instancePolicyFor`) | Contract; enforced at the gates named in §6 |

## 2. Existing objects referenced (verified names)

| Object | Defined in | Used for |
|---|---|---|
| `canonical_subjects(id, name, status)` | `20260922_1000_f4_learning_architecture_2.sql` | Family subject |
| `canonical_concepts(id, canonical_subject_id, name, status)` | same | Family PRIMARY concept; applicability concept. **No stable-id column exists**: a certified concept is found by (subject, name), as `paa-concept-identity.ts` documents |
| `structure_nodes(id, structure_version_id, parent_id, node_type, code, source, source_locator, status)` | `20260924_1000_f6_curriculum_standards_mapping.sql` | Applicability evidence: an official Topic node |
| `learning_objectives(id, structure_node_id, code)` | same | via mappings |
| `objective_concept_mappings(id, learning_objective_id, canonical_concept_id, relation_type, status, reviewed_by, reviewed_at, published_at, mapping_group_id, version)` | same | Applicability evidence: a reviewed catalogue link, with its real review state |
| `assessment_sources(id, source_key UNIQUE, framework, confidence, …)` | `20261020_1000_track_b_exam_architecture_v2.sql` | Source of an OFFICIAL rule |
| `exam_definitions(id, exam_family text)`, `exam_versions(id, exam_definition_id, status)` | `20260925_1000_f7_assessment_framework_engine.sql` | Exam family of a profile; version a component belongs to |
| `assessment_components(id, exam_version_id, name, component_type, duration_minutes, tool_rules)` | same | Optional anchor of a component profile |
| `approved_items(id, bank_item_id, bank_lifecycle_status, created_by, …)` | `20260925_1000…`, extended by `20261026_1000_track_b_question_bank_factory.sql` | The item **version**: lineage is per version |
| `question_bank_items(id, provenance, generation_request_id, generation_metadata, exam_version_id, assessment_component_id)` | `20261026_1000…`, `20261110_1000…` | Item identity; provenance |
| `question_bank_item_concepts(approved_item_id, canonical_concept_id, role)` | `20261110_1300_qb_item_concept_attribution.sql` | PRIMARY attribution, compared with the lineage's family |
| `question_bank_pool_memberships`, `question_bank_pool_membership_guard()` | `20261110_1400_qb_pool_memberships.sql` | Enforcement point (§6) |
| `question_bank_quality_guard()` | `20261110_1500_qb_review_authority_originality.sql` | Enforcement point (§6) |
| `question_bank_review_authority_guard()` | `20261110_1500…`, replaced by `20261112_1000_qb_review_requires_primary_attribution.sql` | Already takes the reviewer's subject from the PRIMARY concept × exam family (D1's qualification rule) |
| `question_bank_authored_version_guard()` | `20261110_1000_qb_provenance_rights_content_sources.sql` | Authored content carries no generation lineage — unchanged by this design |
| `users(id, is_system)` | baseline | Authors, reviewers |

Conventions followed (as in the `20261110_*` migrations): `uuid` keys with `gen_random_uuid()`; `text` + `CHECK` for enumerations; guards as `BEFORE` triggers raising `'<CODE>: …' USING ERRCODE = 'check_violation'`; append-only by refusing `UPDATE` / `DELETE` in the guard; a header comment with the rollback and the `schema_migrations` line; no row created for existing content.

## 3. Tables (DDL sketch)

### 3.1 Task families (owner: Question Bank)

```sql
CREATE TABLE public.question_bank_task_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_key text NOT NULL UNIQUE CHECK (family_key ~ '^tf\.[a-z0-9]+([.-][a-z0-9]+)*$'),
  family_type text NOT NULL CHECK (family_type ~ '^[A-Z][A-Z0-9_]{2,59}$'),
  canonical_subject_id uuid NOT NULL REFERENCES public.canonical_subjects(id),
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  retire_reason text,
  CONSTRAINT qb_task_families_retired_reason CHECK (retired_at IS NULL OR retire_reason IS NOT NULL)
);

CREATE TABLE public.question_bank_task_family_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.question_bank_task_families(id),
  version text NOT NULL CHECK (length(btrim(version)) > 0),
  contract_version integer NOT NULL,                       -- TASK_FAMILY_CONTRACT_VERSION
  specialization_version text NOT NULL,
  content jsonb NOT NULL,                                   -- the validated family, without its concept rows
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  invariant_hash char(64) NOT NULL CHECK (invariant_hash ~ '^[0-9a-f]{64}$'),
  authoring_kind text NOT NULL CHECK (authoring_kind IN ('STUDYUS_AUTHORED', 'STUDYUS_GENERATED')),
  lifecycle text NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle IN ('DRAFT', 'IN_REVIEW', 'CERTIFIED', 'RETIRED')),
  review_status text NOT NULL DEFAULT 'UNREVIEWED' CHECK (review_status IN ('UNREVIEWED', 'IN_REVIEW', 'REVIEWED')),
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.users(id),
  reviewed_at timestamptz,
  CONSTRAINT qb_task_family_versions_unique UNIQUE (family_id, version),
  CONSTRAINT qb_task_family_versions_certified_reviewed CHECK (lifecycle <> 'CERTIFIED' OR review_status = 'REVIEWED'),
  CONSTRAINT qb_task_family_versions_review_complete CHECK ((review_status = 'REVIEWED') = (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CONSTRAINT qb_task_family_versions_reviewer_not_author CHECK (reviewed_by IS NULL OR reviewed_by <> created_by)
);
CREATE INDEX qb_task_family_versions_family ON public.question_bank_task_family_versions (family_id);

CREATE TABLE public.question_bank_task_family_concepts (
  family_version_id uuid NOT NULL REFERENCES public.question_bank_task_family_versions(id),
  canonical_concept_id uuid NOT NULL REFERENCES public.canonical_concepts(id),
  role text NOT NULL DEFAULT 'PRIMARY' CHECK (role = 'PRIMARY'),
  PRIMARY KEY (family_version_id, canonical_concept_id)
);
CREATE INDEX qb_task_family_concepts_concept ON public.question_bank_task_family_concepts (canonical_concept_id);
```

Guard `question_bank_task_family_version_guard()` (BEFORE INSERT OR UPDATE OR DELETE):

- `QB_TASK_FAMILY_VERSION_NO_DELETE`.
- On UPDATE only `lifecycle`, `review_status`, `reviewed_by`, `reviewed_at` may change (`QB_TASK_FAMILY_VERSION_CONTENT_IMMUTABLE`); lifecycle moves forward only (`DRAFT → IN_REVIEW → CERTIFIED → RETIRED`, or to `RETIRED` from any); a reviewed version is not un-reviewed.
- `QB_TASK_FAMILY_REVIEWER_IS_SYSTEM_ACCOUNT` when `users.is_system` (the rule the item review already follows).

Guard on `question_bank_task_family_concepts` (BEFORE INSERT OR UPDATE OR DELETE): rows may be written only while the version is `DRAFT`; the concept's `canonical_subject_id` must equal the family's (`QB_TASK_FAMILY_CONCEPT_OF_ANOTHER_SUBJECT`); the concept must be `ACTIVE`. A deferred constraint trigger requires at least one concept row once the version leaves `DRAFT`.

The concept is a foreign key, never a copy. Nothing in these tables holds a concept name, a per-exam id or a definition.

### 3.2 Profile hierarchy (owner: shared assessment architecture)

```sql
CREATE TABLE public.assessment_system_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_key text NOT NULL UNIQUE CHECK (profile_key ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  exam_family text,                                         -- as exam_definitions.exam_family; NULL when the taxonomy has none
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.assessment_system_profile_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_profile_id uuid NOT NULL REFERENCES public.assessment_system_profiles(id),
  version text NOT NULL,
  status text NOT NULL DEFAULT 'PROVISIONAL_ILLUSTRATIVE' CHECK (status IN ('PROVISIONAL_ILLUSTRATIVE', 'CERTIFIED')),
  basis text NOT NULL CHECK (basis IN ('MIXED_AUTHORITY', 'STUDYUS_POLICY_ONLY')),
  component_dependent_dimensions text[] NOT NULL DEFAULT '{}',
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  published_at timestamptz,                                 -- NULL = being assembled; set once, then immutable
  certified_by uuid REFERENCES public.users(id),
  certified_at timestamptz,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asp_versions_unique UNIQUE (system_profile_id, version),
  CONSTRAINT asp_versions_certification CHECK ((status = 'CERTIFIED') = (certified_by IS NOT NULL AND certified_at IS NOT NULL))
);

CREATE TABLE public.assessment_component_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_profile_id uuid NOT NULL REFERENCES public.assessment_system_profiles(id),
  component_key text NOT NULL UNIQUE CHECK (component_key ~ '^[A-Z][A-Z0-9_]{1,39}(\.[A-Z0-9_]{1,40}){1,4}$'),
  local_subject text,                                       -- the exam's own label; never joined to canonical_subjects
  assessment_component_id uuid REFERENCES public.assessment_components(id),   -- optional anchor; see open question Q2
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.assessment_component_profile_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_profile_id uuid NOT NULL REFERENCES public.assessment_component_profiles(id),
  version text NOT NULL,
  system_profile_version_id uuid NOT NULL REFERENCES public.assessment_system_profile_versions(id),  -- the parent version the overrides were written against
  status text NOT NULL DEFAULT 'PROVISIONAL_ILLUSTRATIVE' CHECK (status IN ('PROVISIONAL_ILLUSTRATIVE', 'CERTIFIED')),
  basis text NOT NULL CHECK (basis IN ('MIXED_AUTHORITY', 'STUDYUS_POLICY_ONLY')),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  published_at timestamptz,
  certified_by uuid REFERENCES public.users(id),
  certified_at timestamptz,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acp_versions_unique UNIQUE (component_profile_id, version),
  CONSTRAINT acp_versions_certification CHECK ((status = 'CERTIFIED') = (certified_by IS NOT NULL AND certified_at IS NOT NULL))
);

-- One row per rule: a system version's rule (all fifteen dimensions) or a component version's override (a subset).
CREATE TABLE public.assessment_profile_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_profile_version_id uuid REFERENCES public.assessment_system_profile_versions(id),
  component_profile_version_id uuid REFERENCES public.assessment_component_profile_versions(id),
  dimension text NOT NULL CHECK (dimension IN ('responseFormats', 'timePressure', 'commandTerms', 'markStructure', 'reasoningDepth', 'contextExpectations', 'calculatorPolicy',
    'stimulusExpectations', 'responseLength', 'rubricStyle', 'competencyEmphasis', 'competencyElicitation', 'transferExpectations', 'authenticityRequirements', 'blueprintConstraints')),
  rule_key text NOT NULL,
  value jsonb NOT NULL,
  authority text NOT NULL CHECK (authority IN ('OFFICIAL', 'STUDYUS_POLICY')),
  assumption text,                                          -- required for STUDYUS_POLICY
  CONSTRAINT apr_one_owner CHECK ((system_profile_version_id IS NULL) <> (component_profile_version_id IS NULL)),
  CONSTRAINT apr_policy_states_assumption CHECK ((authority = 'STUDYUS_POLICY') = (assumption IS NOT NULL AND length(btrim(assumption)) >= 10)),
  CONSTRAINT apr_elicitation_is_policy CHECK (dimension <> 'competencyElicitation' OR authority = 'STUDYUS_POLICY')
);
CREATE UNIQUE INDEX apr_one_rule_per_system_dimension ON public.assessment_profile_rules (system_profile_version_id, dimension) WHERE system_profile_version_id IS NOT NULL;
CREATE UNIQUE INDEX apr_one_rule_per_component_dimension ON public.assessment_profile_rules (component_profile_version_id, dimension) WHERE component_profile_version_id IS NOT NULL;

CREATE TABLE public.assessment_profile_rule_sources (
  rule_id uuid NOT NULL REFERENCES public.assessment_profile_rules(id),
  source_key text NOT NULL REFERENCES public.assessment_sources(source_key),
  locator text NOT NULL CHECK (length(btrim(locator)) >= 3),
  PRIMARY KEY (rule_id, source_key)
);
```

Guards:

- `assessment_profile_version_guard()` on both version tables: no DELETE; once `published_at` is set, nothing changes but certification columns (`ASSESSMENT_PROFILE_VERSION_IMMUTABLE`).
- `assessment_profile_rule_guard()` on rules and rule sources: writable only while the owning version is unpublished; `ASSESSMENT_PROFILE_RULE_SOURCE_ONLY_FOR_OFFICIAL` (a source row on a policy rule is refused: provenance is not laundered either way).
- **Publish check** (in the version guard, when `published_at` goes from NULL to a value) — the invariants of `resolveProfile` and of the schema, in SQL:
  1. system version: exactly fifteen rule rows, one per dimension (`ASSESSMENT_SYSTEM_PROFILE_INCOMPLETE`);
  2. every `OFFICIAL` rule has at least one source row (`ASSESSMENT_PROFILE_OFFICIAL_RULE_WITHOUT_SOURCE`);
  3. `basis = 'STUDYUS_POLICY_ONLY'` ⇒ no OFFICIAL rule;
  4. system version: no OFFICIAL rule on a dimension listed in `component_dependent_dimensions` (`ASSESSMENT_COMPONENT_DEPENDENT_FALLBACK_IS_NOT_OFFICIAL`);
  5. component version: every override's dimension is in the parent version's `component_dependent_dimensions` (`ASSESSMENT_COMPONENT_OVERRIDE_NOT_ALLOWED`), the parent version is published, and the component's system is the parent's.
- Cross-rule consistency of the *resolved* rules (elicitation matches competencies, command-term vocabulary, stimulus default) stays in code and is asserted by the certification script, because it reads inside `value`.

**Inheritance resolution** (code, `resolveProfile`): `rules_in_force(component_version) = rules(parent system version) overridden by rules(component version)` on `dimension`; origin is `COMPONENT` where an override row exists, `SYSTEM` otherwise. A view can expose it for reads:

```sql
-- sketch
CREATE VIEW public.assessment_component_rules_in_force AS
SELECT cv.id AS component_profile_version_id, s.dimension,
       COALESCE(c.id, s.id) AS rule_id, CASE WHEN c.id IS NULL THEN 'SYSTEM' ELSE 'COMPONENT' END AS origin
  FROM public.assessment_component_profile_versions cv
  JOIN public.assessment_profile_rules s ON s.system_profile_version_id = cv.system_profile_version_id
  LEFT JOIN public.assessment_profile_rules c ON c.component_profile_version_id = cv.id AND c.dimension = s.dimension;
```

A component version is bound to one parent version. A new system version does not silently re-parent existing component versions: each needs a new version written against it.

### 3.3 Discipline policies

```sql
CREATE TABLE public.assessment_discipline_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key text NOT NULL,
  version text NOT NULL,
  discipline text NOT NULL,
  family_types text[] NOT NULL CHECK (cardinality(family_types) >= 1),
  status text NOT NULL DEFAULT 'PROVISIONAL' CHECK (status IN ('PROVISIONAL', 'CERTIFIED')),
  content jsonb NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT adp_unique UNIQUE (policy_key, version)
);
```

Insert-only (guard refuses UPDATE of anything but `status` and DELETE).

### 3.4 Assessment applicability (owner: shared assessment architecture, reading Curriculum mappings)

```sql
CREATE TABLE public.assessment_applicability_threshold_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key text NOT NULL,
  version text NOT NULL,
  rules jsonb NOT NULL,           -- [{ basis, minimumReviewState }]
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aatp_unique UNIQUE (policy_key, version)
);

CREATE TABLE public.assessment_applicability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_concept_id uuid NOT NULL REFERENCES public.canonical_concepts(id),   -- a reference; the concept is never copied
  system_profile_id uuid NOT NULL REFERENCES public.assessment_system_profiles(id),
  component_profile_id uuid REFERENCES public.assessment_component_profiles(id), -- NULL = the system as a whole
  local_subject text,                                                           -- the exam's label; informational
  basis text NOT NULL CHECK (basis IN ('OFFICIAL_EXAM_STRUCTURE', 'REVIEWED_CATALOGUE_LINK')),
  recorded_by uuid NOT NULL REFERENCES public.users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  retire_reason text,
  CONSTRAINT aa_retired_reason CHECK (retired_at IS NULL OR retire_reason IS NOT NULL)
);
CREATE UNIQUE INDEX aa_one_active_per_scope ON public.assessment_applicability
  (canonical_concept_id, system_profile_id, COALESCE(component_profile_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE retired_at IS NULL;
CREATE INDEX aa_by_system ON public.assessment_applicability (system_profile_id, component_profile_id);

CREATE TABLE public.assessment_applicability_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicability_id uuid NOT NULL REFERENCES public.assessment_applicability(id),
  kind text NOT NULL CHECK (kind IN ('OFFICIAL_STRUCTURE_NODE_WITH_CERTIFIED_CONCEPT', 'OBJECTIVE_CONCEPT_LINK')),
  structure_node_id uuid REFERENCES public.structure_nodes(id),
  objective_concept_mapping_id uuid REFERENCES public.objective_concept_mappings(id),
  source_reference text,                                    -- e.g. the guide page of the node
  review_state text NOT NULL CHECK (review_state IN ('UNREVIEWED', 'DECLARED_REVIEWED', 'CERTIFIED')),
  CONSTRAINT aae_kind_matches_reference CHECK (
    (kind = 'OFFICIAL_STRUCTURE_NODE_WITH_CERTIFIED_CONCEPT' AND structure_node_id IS NOT NULL AND objective_concept_mapping_id IS NULL AND source_reference IS NOT NULL)
    OR (kind = 'OBJECTIVE_CONCEPT_LINK' AND objective_concept_mapping_id IS NOT NULL AND structure_node_id IS NULL))
);
CREATE INDEX aae_by_applicability ON public.assessment_applicability_evidence (applicability_id);
```

There is no row for `NONE`: absence is the fact. Guard `assessment_applicability_guard()`:

- Append-only: a record is retired, never rewritten or deleted (the pool-membership pattern).
- `ASSESSMENT_APPLICABILITY_COMPONENT_NOT_OF_SYSTEM`.
- Evidence must be about **this** concept, by key and not by name:
  - `OBJECTIVE_CONCEPT_LINK`: `objective_concept_mappings.canonical_concept_id = applicability.canonical_concept_id`; otherwise `ASSESSMENT_APPLICABILITY_EVIDENCE_IS_OF_ANOTHER_CONCEPT`.
  - `OFFICIAL_STRUCTURE_NODE_WITH_CERTIFIED_CONCEPT`: the node is `ACTIVE`, and a published mapping ties an objective under that node to the concept (how the certified Topic → concept relation is materialised is open question Q3).
- Basis cannot exceed evidence: `OFFICIAL_EXAM_STRUCTURE` requires at least one official-node evidence row; `REVIEWED_CATALOGUE_LINK` requires at least one link row and no official-node row (deferred constraint trigger, so the record and its evidence commit together).
- The concept's canonical subject is not compared with anything: `local_subject` is a label.

**Review state, once persisted.** In code today a catalogue link is `DECLARED_REVIEWED` because the TypeScript modules say "reviewed links" and name no reviewer. In the database the mapping row carries the truth: `status = 'PUBLISHED'` with `reviewed_by` and `reviewed_at` set ⇒ evidence state `CERTIFIED`; `PUBLISHED` without a reviewer ⇒ `DECLARED_REVIEWED`; anything else ⇒ `UNREVIEWED`. The evidence row stores the state at recording time; the certification script (§9) re-derives it and fails on drift. Whether the threshold should then require `CERTIFIED` for links is open question Q1.

**What applicability does not do.** It grants no reviewer qualification, certifies no concept, establishes no right. The review guard (`20261112_1000`) keeps deciding qualification from the PRIMARY concept's subject × exam family, untouched. Under D1 a PAA item whose PRIMARY concept is owned by `Mathematics` needs a `Mathematics × PAA` qualification — which the guard already demands and only a person can grant.

### 3.5 Specifications and item lineage (owner: Question Bank)

```sql
CREATE TABLE public.question_bank_adaptation_specifications (
  specification_id char(64) PRIMARY KEY CHECK (specification_id ~ '^[0-9a-f]{64}$'),   -- content-addressed
  family_version_id uuid NOT NULL REFERENCES public.question_bank_task_family_versions(id),
  system_profile_version_id uuid NOT NULL REFERENCES public.assessment_system_profile_versions(id),
  component_profile_version_id uuid REFERENCES public.assessment_component_profile_versions(id),
  discipline_policy_id uuid NOT NULL REFERENCES public.assessment_discipline_policies(id),
  primary_concept_id uuid NOT NULL REFERENCES public.canonical_concepts(id),
  invariant_hash char(64) NOT NULL,
  content_use_class text NOT NULL CHECK (content_use_class IN ('DEV_TEST_CONTENT', 'EVIDENCE_BEARING')),
  applicability_status text NOT NULL CHECK (applicability_status IN ('ESTABLISHED', 'NOT_ESTABLISHED')),
  applicability_id uuid REFERENCES public.assessment_applicability(id),
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qas_evidence_bearing_needs_applicability CHECK (content_use_class <> 'EVIDENCE_BEARING' OR (applicability_status = 'ESTABLISHED' AND applicability_id IS NOT NULL))
);

CREATE TABLE public.question_bank_item_task_family_lineage (
  approved_item_id uuid PRIMARY KEY REFERENCES public.approved_items(id),        -- one optional row per item VERSION
  family_version_id uuid NOT NULL REFERENCES public.question_bank_task_family_versions(id),
  invariant_hash char(64) NOT NULL,
  lineage_kind text NOT NULL CHECK (lineage_kind IN ('GENERATED', 'AUTHORED')),
  specification_id char(64) REFERENCES public.question_bank_adaptation_specifications(specification_id),
  content_use_class text NOT NULL CHECK (content_use_class IN ('DEV_TEST_CONTENT', 'EVIDENCE_BEARING')),
  parameterization_hash char(64),                           -- identity of the values the instance fixed; NULL until instances are parameterised
  variant_family_key text,                                  -- NULL until variant families exist
  generation_run_id text,
  recorded_by uuid NOT NULL REFERENCES public.users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qitfl_generated_has_specification_and_run CHECK (lineage_kind <> 'GENERATED' OR (specification_id IS NOT NULL AND generation_run_id IS NOT NULL)),
  CONSTRAINT qitfl_authored_has_no_generation_field CHECK (lineage_kind <> 'AUTHORED' OR generation_run_id IS NULL)
);
CREATE INDEX qitfl_by_family_version ON public.question_bank_item_task_family_lineage (family_version_id);
```

Guards:

- Specifications: insert-only (`QB_ADAPTATION_SPECIFICATION_IMMUTABLE`); the application verifies `specification_id = sha256(canonical content)` before insert and the certification script re-verifies every row; an insert of an existing id with the same content is a no-op (`ON CONFLICT DO NOTHING` is acceptable here because the key *is* the content). At insert: `EVIDENCE_BEARING` requires the family version to be `CERTIFIED` / `REVIEWED` (`QB_ADAPTATION_SPECIFICATION_FAMILY_NOT_REVIEWED`).
- Lineage `question_bank_item_task_family_lineage_guard()`:
  - no UPDATE; DELETE only while the version is not yet in use (the frozen states of `question_bank_item_curriculum_node_guard`: `ACTIVE`, `CALIBRATED`, `SUSPENDED`, `RETIRED`, `SUPERSEDED`, `REJECTED`);
  - the item version is a bank version (`approved_items.bank_item_id IS NOT NULL`);
  - `lineage_kind` agrees with provenance: `GENERATED` ⇔ `question_bank_items.provenance = 'STUDYUS_GENERATED'`; `AUTHORED` ⇔ `'STUDYUS_AUTHORED'`. `OFFICIAL`, `LICENSED` and `FIXTURE` items take no lineage (`QB_TASK_FAMILY_LINEAGE_NOT_FOR_THIS_PROVENANCE`);
  - with a specification: its family version, invariant hash and use class are the row's;
  - `invariant_hash` equals the family version's.

**Generated and authored, one table.** Authorship stays where it is (`question_bank_items.provenance`, immutable; `question_bank_authored_version_guard` keeps authored versions free of generation lineage). Task-family lineage is this separate row, so a human-authored item can have a family without acquiring a generation request, and the existing CHECK `provenance <> 'STUDYUS_AUTHORED' OR (generation_request_id IS NULL AND generation_metadata IS NULL)` is untouched.

**Attribution consistency** is checked where attribution is set, not here: when a PRIMARY row is written to `question_bank_item_concepts` for a version that has a lineage row, the concept must be one of the family version's concepts (`QB_PRIMARY_IS_NOT_OF_THE_ITEMS_TASK_FAMILY`) — an addition to `question_bank_item_concept_guard()` (§6).

## 4. Versioning and content-hash rules

| Object | Version key | Hash | Immutable when |
|---|---|---|---|
| Family version | `(family_id, version)` | `content_hash` = sha256 of canonical JSON of the validated family; `invariant_hash` = sha256 of the invariants | Always for content; lifecycle and review columns move forward |
| System / component profile version | `(profile_id, version)` | sha256 of canonical JSON of the profile object as code serialises it (rules ordered by dimension) | From `published_at` |
| Discipline policy | `(policy_key, version)` | sha256 of content | Always |
| Threshold policy | `(policy_key, version)` | — | Always |
| Specification | the hash itself | `specification_id` | Always |

Canonical JSON is the one implementation the code already has twice and tests equal (`canonical-hash.ts`, `generator/provider.ts`): keys sorted at every depth, `undefined` dropped. Hashes are computed by the application, stored, and re-computed by the certification script; the database does not compute them. A specification embeds the content hashes of its family, system profile, component profile and policy, so an unversioned edit of any of them is detected when the stored version's hash no longer matches.

## 5. Legacy compatibility

- No column is added to `approved_items` or `question_bank_items`. No `NOT NULL`. No backfill of any kind.
- An item version with no row in `question_bank_item_task_family_lineage` is exactly what every item is today. Every existing guard, reader and gate ignores the new tables.
- Official, licensed and fixture items never take lineage.
- The `task_family_id` column name is avoided on purpose: `transfer_task_instances.task_family_id` is the transfer engine's `TransferTaskFamily` hash, another concept. The new tables say `family_version_id` and are prefixed `question_bank_`.

## 6. Dev-test content vs certified content — enforcement points

`DEV_TEST_CONTENT` is a use class of the specification and of the lineage row. It never becomes evidence and never enters a certified pool. Where each rule attaches:

| Rule | Attaches to | Existing object | Change |
|---|---|---|---|
| A DRAFT / UNREVIEWED family produces `DEV_TEST_CONTENT` specifications only | insert of a specification | new guard | — |
| Evidence-bearing specification needs established applicability | insert of a specification | new CHECK + guard | — |
| An item version with `DEV_TEST_CONTENT` lineage is never activated | `approved_items.bank_lifecycle_status` → `ACTIVE` / `CALIBRATED` | `question_bank_quality_guard()` (`20261110_1500`), which already blocks unreviewed StudyUs content from those states | one added branch: `QB_DEV_TEST_CONTENT_NEVER_ACTIVE` |
| It is never placed in a pool | insert into `question_bank_pool_memberships` | `question_bank_pool_membership_guard()` (`20261110_1400`) | one added branch: refuse when the item's current version has `DEV_TEST_CONTENT` lineage (`QB_DEV_TEST_CONTENT_NOT_POOLABLE`) |
| It is never in a frozen form | position rows of a frozen form | `assessment_frozen_form_position_guard()` (`20261110_1700`) | none needed if positions already require an eligible active version; the certification script asserts it |
| A lineage row's use class is the specification's | insert of lineage | new guard | — |
| PRIMARY attribution agrees with the family | `question_bank_item_concepts` | `question_bank_item_concept_guard()` (`20261110_1300`) | one added branch |
| Reviewer qualification = PRIMARY concept subject × exam family | approving review | `question_bank_review_authority_guard()` (`20261112_1000`) | **none** — it already does this |
| Rights | rights record | `question_bank_content_rights_guard()` (`20261110_1000`) | **none** — a family or a specification is not rights evidence |

Dynamic dev-test instances that are never ingested (generated and shown in DEV only) do not touch these tables at all; the rules above matter only if dev-test content is ingested. Whether it may be ingested at all is open question Q4.

Three existing functions get one added branch each. Each is a `CREATE OR REPLACE FUNCTION` of the whole body, as `20261112_1000` did, with the previous body named in the rollback.

## 7. Proposed migration split and order (placeholders; no file created)

| # | Placeholder name | Contents | Depends on |
|---|---|---|---|
| 1 | `<date>_1000_assessment_system_component_profiles.sql` | §3.2 tables, guards, publish check | `assessment_sources`, `assessment_components` |
| 2 | `<date>_1100_assessment_discipline_policies.sql` | §3.3 | — |
| 3 | `<date>_1200_qb_task_families.sql` | §3.1 | `canonical_subjects`, `canonical_concepts` |
| 4 | `<date>_1300_assessment_applicability.sql` | §3.4 | 1; `structure_nodes`, `objective_concept_mappings` |
| 5 | `<date>_1400_qb_adaptation_specifications.sql` | §3.5 specifications | 1–4 |
| 6 | `<date>_1500_qb_item_task_family_lineage.sql` | §3.5 lineage + its guard | 3, 5 |
| 7 | `<date>_1600_qb_gates_know_content_use_class.sql` | the three `CREATE OR REPLACE FUNCTION` of §6 | 6 |

All additive. 1–6 create tables that nothing reads; 7 is the only one that changes behaviour of existing objects, and only for rows that have a lineage row — of which there are none at that moment. 7 ships separately so that it can be held back or rolled back alone.

No content is seeded by a migration. Families, profiles, policies and applicability records are written by services (not designed here) from reviewed input; the POC data stays in code as illustrative fixtures.

## 8. Ephemeral certification plan

A script in the style of the existing `*-cert.sh`: an ephemeral database, baseline + all migrations, then assertions. It would assert:

Structure
1. Each migration applies on the baseline and is idempotent where the repository's convention requires.
2. No existing table gained or lost a column; `approved_items` and `question_bank_items` are byte-identical in definition.
3. Existing row counts unchanged; zero rows in every new table after migration.

Guards (each with a positive and a negative case)
4. A family version's content cannot be updated; lifecycle cannot move backwards; `CERTIFIED` without review is refused; a reviewer who is the author or a system account is refused.
5. A family concept of another canonical subject is refused.
6. A system version cannot be published with fewer than fifteen rules, with an OFFICIAL rule lacking a source, with an OFFICIAL fallback on a component-dependent dimension, or with an OFFICIAL rule under `STUDYUS_POLICY_ONLY`.
7. A component override of a dimension the parent does not declare is refused at publish; a published version is immutable.
8. Applicability: evidence of another concept refused; basis above evidence refused; append-only; one active record per (concept, system, component).
9. Specification: insert-only; evidence-bearing with a draft family refused; evidence-bearing without established applicability refused.
10. Lineage: kind must match provenance; authored lineage with a run id refused; official / licensed / fixture items refused; frozen once the version is in use.
11. Gates: a version with dev-test lineage cannot become `ACTIVE` / `CALIBRATED`, cannot get a pool membership; a PRIMARY concept outside the family is refused.

Legacy and non-regression
12. A legacy item (no lineage) goes through draft → review → approval → pool membership exactly as before, with the same errors in the same order — the existing QB certifications re-run unchanged and green.
13. An authored item with family lineage still has no generation lineage and still passes `question_bank_authored_version_guard`.
14. The review authority guard is byte-identical to `20261112_1000`'s.

Code ↔ database parity
15. Loading the POC objects through the future services and reading them back gives objects whose `resolveProfile`, `resolveApplicability` and `specificationIdOf` results equal the in-code ones; every stored hash recomputes.
16. Evidence review states re-derive from `objective_concept_mappings` without drift.

## 9. Rollout and rollback

Order: ephemeral certification → DEV (migrations 1–6, then 7) → load one reviewed family and one certified profile through services → Preview / Stage (same order) → production only with real reviewed content. Environment promotion follows the repository's existing ledger discipline; alias, protection and environment changes stay with the operator.

Rollback:

- 1–6: `DROP` in reverse order while the tables are empty (the header convention of the `20261110_*` files); once rows exist, tables are retired in place, not dropped.
- 7: re-create the three functions exactly as in `20261110_1300`, `20261110_1400`, `20261110_1500`; independent of 1–6.
- No data migration exists, so no data rollback exists.

## 10. Risks

| Risk | Mitigation |
|---|---|
| `canonical_concepts` has no stable-id column; code identifies concepts by stable id, the database by uuid found through (subject, name) | Binding stays a read-only step per environment, as for requirement cells; never copy ids across environments (Q5) |
| Rule values are `jsonb`: the database cannot check them | Schema validation in the writing service + certification assertion 15 |
| Three existing guard functions are replaced | Migration 7 alone; whole-body replace with rollback text; legacy path re-certified (assertion 12) |
| Two "family" notions in one schema | Naming (`family_version_id`, `question_bank_` prefix); no join between them until B3 |
| Component profiles drift from `assessment_components` | The anchor is optional and informational until Q2 is settled |
| Applicability evidence goes stale when a mapping is retired | Certification assertion 16; a retired mapping should retire the applicability record (service rule) |
| Illustrative profiles reach evidence-bearing content | Open (Q6); simplest rule: evidence-bearing requires `status = 'CERTIFIED'` on both profile versions |

## 11. Open questions

- **Q1.** Once mappings are persisted with reviewers, should the threshold for `REVIEWED_CATALOGUE_LINK` rise from `DECLARED_REVIEWED` to `CERTIFIED`?
- **Q2.** Is a component profile anchored to an `assessment_components` row (per exam version), or to a version-independent component identity? The first ties profiles to exam versions; the second needs a key the schema does not have.
- **Q3.** How is the certified Topic → concept relation of the PAA hierarchy materialised in the database (today it is `certifiedConceptId` in `paa-hierarchy.ts`)? The official-structure evidence check needs it as rows.
- **Q4.** May `DEV_TEST_CONTENT` be ingested into the Question Bank at all, or does it live only in DEV fixtures? If never ingested, migration 7 shrinks to the attribution branch.
- **Q5.** Should `canonical_concepts` gain a stable-key column? Out of scope here (Curriculum), but it would remove the (subject, name) lookup.
- **Q6.** May a `PROVISIONAL_ILLUSTRATIVE` profile version feed evidence-bearing content?
- **Q7.** Dynamic dev-test instances in mock, benchmark, calibration and pilot-certification purposes: confirm the reading of D4.
- **Q8.** AICE: one system profile shared with Cambridge, or its own?
- **Q9.** Who reviews a task family — the item reviewer qualification (subject × exam family), or a family-level qualification that is exam-independent, like the family?
- **Q10.** Services and routes that write these tables are not designed here.
