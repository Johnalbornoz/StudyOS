# B2-B0 — Persistence and Question Bank schema design

Date: 2026-10-10 · Branch `feat/assessment-b2-blueprint-core` (after `c04d97a`). **Design only.** No migration, schema, data or runtime change accompanies this document. Table and column names are proposals.

Inputs: B0 (frozen architecture), B1 (foundation contracts), B2 / B2-A (`src/lib/assessment-blueprint/`), `docs/exams/question-bank/Q1_I2_B2_ALIGNMENT_CONTENT_CARRIER_DECISION.md`, and the DEV schema as read on this date.

## 1. Ownership

| Owner | Owns | Never owns |
|---|---|---|
| Question Bank | authored and reviewed content and its metadata: items, stimuli, assets, attribution, pool membership, provenance, rights, review, originality | selection, forms, evidence |
| B2 | blueprint variants, their requirements, frozen forms | content, rights rules, lifecycle |
| Curriculum Authority | Domain / Topic hierarchy, objectives, canonical concepts | exam structure, items |
| B3 | evidence consumption | selection, content |

A fact is stored once, by its owner. The only copies are immutable snapshots: a frozen form records which item versions it holds, not their content.

## 2. Ownership matrix (hard gate)

| Entity | Owner | Status |
|---|---|---|
| `assessment_blueprints` (+ purpose, form number, revision, pool) | B2 | existing, extended |
| `blueprint_objective_targets`, `blueprint_component_allocations` | B2 | existing, unchanged |
| `assessment_blueprint_requirements` | B2 | new |
| `assessment_blueprint_requirement_sources` | B2 | new |
| `assessment_frozen_forms` | B2 | new |
| `assessment_frozen_form_positions` | B2 | new |
| `exam_instances.frozen_form_id` | EXISTING_SHARED (exam runtime) | new nullable column |
| `question_bank_items`, `approved_items`, `question_bank_reviews`, `question_bank_lifecycle_events` | QUESTION_BANK | existing |
| `question_bank_stimuli`, `question_bank_stimulus_versions`, `question_bank_stimulus_parts` | QUESTION_BANK | new |
| `question_bank_item_stimulus` | QUESTION_BANK | new |
| `question_bank_assets`, `question_bank_item_assets` | QUESTION_BANK | new |
| `question_bank_item_concepts` | QUESTION_BANK | new (the data behind B1's `ITEM_ATTRIBUTION`) |
| `question_bank_item_context_tags` | QUESTION_BANK | new, optional; outside attribution |
| `question_bank_pool_memberships` | QUESTION_BANK | new |
| `question_bank_content_rights`, `question_bank_content_sources` | QUESTION_BANK | new |
| `question_bank_reviewer_qualifications` | QUESTION_BANK | new |
| `question_bank_originality_checks` | QUESTION_BANK | new |
| `assessment_sources` (+ `source_access`) | EXISTING_SHARED | existing, one column added |
| `exam_item_usage` | EXISTING_SHARED | existing, unchanged |
| `exam_answer_reveals` | EXISTING_SHARED (exam runtime) | new, may be deferred |
| `structure_nodes`, `learning_objectives`, `canonical_concepts`, mappings | CURRICULUM | existing; hierarchy content still to be added by its owner |
| `question_bank_item_curriculum_nodes` | QUESTION_BANK, referencing CURRICULUM | new, **blocked** until the hierarchy exists |
| Any Q1 Domain / Topic table | — | DO_NOT_CREATE |
| A B2 stimulus, asset or rights table | — | DO_NOT_CREATE |
| A second item-attribution or concept-weight table | — | DO_NOT_CREATE |
| Reuse of `exam_media_objects` for authored assets | — | DO_NOT_CREATE (section 6) |

## 3. Blueprint persistence (B2)

DEV today: `assessment_blueprints(id, exam_version_id UNIQUE, status)`, with slots in `blueprint_objective_targets`. The unique constraint is the one-blueprint-per-version assumption.

Extend `assessment_blueprints`:

| Column | Type | Rule |
|---|---|---|
| `purpose` | text, nullable | `FULL`, `REDUCED`, `DIAGNOSTIC`. NULL = legacy blueprint whose purpose was never declared |
| `form_number` | integer, default 1 | ≥ 1 |
| `revision` | integer, default 1 | ≥ 1 |
| `pool` | text, nullable | the logical pool the variant draws from; NULL for legacy |
| `status` | existing | `DRAFT`, `PUBLISHED`, `RETIRED` |

Constraints: replace `UNIQUE (exam_version_id)` by (a) a partial unique index on `(exam_version_id)` where `purpose IS NULL` — legacy keeps one per version; (b) `UNIQUE (exam_version_id, purpose, form_number, revision)` where `purpose IS NOT NULL`; (c) a partial unique index on `(exam_version_id, purpose, form_number)` where `status = 'PUBLISHED'`. Identity is these columns; no name is involved. Legacy rows are not classified: their fidelity is still decided at runtime by B1, as today.

Slots stay in `blueprint_objective_targets` (objective, component, question type, difficulty range, `constraints`). Everything that is not a slot is a requirement row.

`assessment_blueprint_requirements`:

| Column | Notes |
|---|---|
| `id`, `blueprint_id` | FK to the variant |
| `requirement_key` | unique within the blueprint |
| `kind` | total / section item count, section order, scored minutes, response format, tool policy, domain allocation, difficulty distribution, reduced size, diagnostic evidence depth, pool policy, exposure policy, stimulus-set requirement |
| `assessment_component_id` | nullable; the section the requirement is about |
| `value` | jsonb, validated by the B2-A schema |
| `authority` | `OFFICIAL` or `STUDYUS_POLICY` |
| `policy_id`, `policy_version` | required when the authority is StudyUs policy (CHECK) |

`assessment_blueprint_requirement_sources (requirement_id, assessment_source_id)` gives source lineage. An official requirement must have at least one row; reduced size, pool, exposure and diagnostic depth can never be official (CHECK on kind and authority). A stimulus-set requirement names the set kind, how many sets, and the minimum and maximum questions per set; it is what makes a slot a `STIMULUS_GROUP` requirement. Primary-concept and Exam Skill requirements are further kinds, added when their data exists.

## 4. Frozen forms (B2)

`assessment_frozen_forms`: `id`, `blueprint_id`, `fidelity` (`FULL` / `REDUCED`), `attempt_type` (`FULL_MOCK` / `REDUCED_MOCK`), `pool`, `form_hash` (unique), `status` (`DRAFT`, `PUBLISHED`, `RETIRED`), `frozen_at`, `frozen_by`. Purpose, form number and revision are read from the blueprint row, not copied.

`assessment_frozen_form_positions`: `form_id`, `slot_index`, `approved_item_id` (the item **version**, which is immutable), `stimulus_version_id` (nullable), `unit_position` (order inside a stimulus group). Primary key `(form_id, slot_index)`; `UNIQUE (form_id, approved_item_id)`.

A trigger makes a published form and its positions immutable. Attempts reach the form through `exam_instances.frozen_form_id` (nullable; existing instances keep their per-instance `form` JSON and `form_frozen_at`). No item content is stored in a form.

## 5. Stimulus model (Question Bank)

Same identity / version split as items.

- `question_bank_stimuli`: `id`, `stimulus_key` (unique), `kind` (passage, paired passage, poem, numbered text, draft paragraph, table, graph, figure, data set, composite), `language`, `provenance`, `current_version_id`, `retired_at`, `retire_reason`.
- `question_bank_stimulus_versions`: `id`, `stimulus_id`, `version_number`, `lifecycle_status` (the item lifecycle values), `content_hash`, `topic_line`, `selection_min_items`, `selection_max_items` (NULL = the group is taken whole), `created_by`. Immutable once it leaves draft, by trigger.
- `question_bank_stimulus_parts`: `id`, `stimulus_version_id`, `position`, `label` (e.g. A, B), `part_kind` (text, numbered text, verse, table, graph, figure, data set, source note), `body` (structured jsonb: paragraphs, numbered statements, table cells), `asset_id` (nullable). `UNIQUE (stimulus_version_id, position)`.

Parts are an entity because review, rendering and rights all work per part: a paired passage is one set with parts A and B; a composite is text, then a graph, then a source note, each possibly with a different source. A stimulus is not tied to an exam version, so it can serve several exams.

`question_bank_item_stimulus (approved_item_id PK, stimulus_version_id, position)` with `UNIQUE (stimulus_version_id, position)`. An item has no row (standalone) or exactly one. Two questions share a stimulus when their rows point at versions of the same `stimulus_id` — derivable without reading item content.

## 6. Assets (Question Bank)

`question_bank_assets`: `id`, `asset_key`, `kind` (diagram, graph, chart, image, data visualisation), `media_type`, `storage_backend`, `storage_ref`, `sha256`, `size_bytes`, `width`, `height`, `alt_text` (per language), `provenance`, `lifecycle_status`, `created_by`. Tables are structured `body` in a stimulus part or item, with an image only as a fallback.

`question_bank_item_assets (approved_item_id, asset_id, role, position)` attaches an asset to one item version; a stimulus part references an asset through `asset_id`.

`exam_media_objects` is not reused: `owner_student_id` is NOT NULL with a foreign key to `students`, its only backend is `POSTGRES_DEV`, it is capped at 4 MB, and its deletion and purge rules implement a Student's data lifecycle. Authored assets have no Student owner and must never be purged with one. Its scanning and thumbnail code can be reused; the table cannot.

## 7. Item attribution (Question Bank, B1 contract)

`question_bank_item_concepts`: `approved_item_id`, `canonical_concept_id`, `role` (`PRIMARY` or `SUPPORTING` — B1's names; Q1's SECONDARY is `SUPPORTING`), `attributed_by`, `attributed_at`. Primary key `(approved_item_id, canonical_concept_id)`; a partial unique index allows one `PRIMARY` per item version. No weight column.

It is version-level and frozen with the version, because attribution is reviewed content. An item version with no row is unattributed legacy: B1 keeps reporting its concepts as derived from the objective mapping, never as direct.

CONTEXT is not attribution. If recorded, it goes in `question_bank_item_context_tags (approved_item_id, canonical_concept_id)`, which no eligibility, selection or evidence code reads.

## 8. Curriculum references

Items already reference a learning objective (immutable per version). Under B0 X.11 the Domain and Topic layers are curriculum structure: `structure_nodes` with objectives hanging from them. Traceability is therefore item → objective → node, plus, where an objective is coarser than a Topic, `question_bank_item_curriculum_nodes (approved_item_id, structure_node_id)`.

Dependency, stated exactly: the foreign key target is `structure_nodes.id`, for nodes of a PAA structure version typed as Domain and Topic and published by the Curriculum Authority. Those nodes do not exist yet (282 of 283 nodes on DEV are bootstrap `EXAM_SECTION` groupings). Until they do, this table is not created and eligibility condition 5 cannot be met.

## 9. Rights

Representation: a normalised record, not an enum change.

`question_bank_content_rights`: `id`; exactly one of `approved_item_id`, `stimulus_version_id`, `asset_id` (CHECK); `source_access` (`PUBLICLY_ACCESSIBLE`, `PRIVATE`, `LICENSED_SOURCE`, `NOT_APPLICABLE`); `reuse_rights` (`STUDYUS_OWNED`, `LICENSED_FOR_USE`, `OFFICIAL_AUTHORIZED`, `UNKNOWN`, `PROHIBITED`); `rights_holder`; `permitted_use`; `attribution_text`; `licence_reference`; `valid_from`, `valid_to`; `recorded_by`, `recorded_at`.

`question_bank_content_sources`: the rights record, `assessment_source_id`, `usage` (`REFERENCE_ONLY`, `ADAPTED`, `REPRODUCED`), `locator`. This separates specification sources (reference only) from content sources (adapted or reproduced).

`assessment_sources` gains `source_access`, backfilled from `license_status` (`PUBLIC` → `PUBLICLY_ACCESSIBLE`). `license_status` stays for history and stops being read for eligibility.

B1 rule change (B-track code, no schema): delivery eligibility requires a rights record whose `reuse_rights` is `STUDYUS_OWNED`, `LICENSED_FOR_USE` or `OFFICIAL_AUTHORIZED`, valid on the day, for the item and for every stimulus and asset it uses. `PUBLIC` stops being a deliverable value. `PUBLICLY_ACCESSIBLE` grants nothing.

## 10. Provenance

`question_bank_items.provenance` (CHECK today: `OFFICIAL`, `LICENSED`, `STUDYUS_GENERATED`, `FIXTURE`) gains `STUDYUS_AUTHORED`. Stimuli and assets carry the same column.

| Class | Meaning | Lineage |
|---|---|---|
| `STUDYUS_AUTHORED` | written by an identified person working for StudyUs | `created_by`; no generation request (CHECK) |
| `STUDYUS_GENERATED` | drafted by a model | existing `generation_request_id`, `generation_metadata` (model, prompt, run) |
| `LICENSED` | third-party content used under licence | rights record `LICENSED_FOR_USE` |
| `OFFICIAL` | the exam body's own content, with authorisation | rights record `OFFICIAL_AUTHORIZED` |
| `FIXTURE` | technical fixture | none; never eligible |
| unknown / legacy | no value stored | read as fixture, as today |

Provenance is a fact of the bank identity, so a new version edited by a person keeps `STUDYUS_GENERATED`. The identity guard trigger is extended to make `provenance` immutable.

## 11. Review authority and originality

`question_bank_reviewer_qualifications`: `id`, `user_id`, `canonical_subject_id`, `exam_family`, `granted_by`, `valid_from`, `valid_to`, `status`.

`question_bank_reviews` gains nullable columns: `stimulus_version_id` (a review is of an item version or a stimulus version, exactly one), `checklist_key`, `checklist_version`, `reviewer_qualification_id`. A trigger refuses an approving review when the reviewer authored the version, or holds no valid qualification for the subject and exam family. Existing reviews (none on DEV) would stay valid as history without a qualification, and would not satisfy the new eligibility rule.

`question_bank_originality_checks`: `id`; item version or stimulus version; `method`, `method_version`; `compared_against` (source keys); `result` (`CLEAR`, `SIMILAR`, `MATCH`, `INCONCLUSIVE`); `max_similarity` (nullable); `performed_by_kind` (`SYSTEM`, `HUMAN`), `performed_by`, `performed_at`; `disposition` (`ACCEPTED`, `REWRITE_REQUIRED`, `REJECTED`). The schema records a result; it is not a similarity engine.

## 12. Pool membership (Question Bank)

`question_bank_pool_memberships`: `id`; exactly one of `bank_item_id`, `stimulus_id` (CHECK); `pool` (the six pilot pools); `policy_id`, `policy_version`; `assigned_by`, `assigned_at`; `retired_at`.

Membership is on the identity, not the version. A stimulus-bound item has no row of its own: it inherits its stimulus's pool, so a group is in one pool as a whole. Pilot rule `ZERO_INTENTIONAL_OVERLAP` = a partial unique index on the subject where `retired_at IS NULL`. A later multi-pool policy widens that index to include `pool`.

## 13. Selection-unit derivation (what B2 reads)

For every current, eligible item version:

- no `question_bank_item_stimulus` row → an `ITEM` unit: id = the item key, one member, pool from the item's membership;
- otherwise → one `STIMULUS_GROUP` unit per stimulus: id = the stimulus id, members = the eligible current versions linked to its current version in `position` order, integrity from `selection_min_items` / `selection_max_items` (NULL = whole), set kind from the stimulus, pool from the stimulus's membership.

Exposure of a unit for a Student comes from `exam_item_usage`: an item unit is exposed when any version of the item was delivered; a group when any member was. B2 receives facts only and stores none of them.

## 14. Exposure

| Fact | Source | New storage |
|---|---|---|
| Item delivered | `exam_item_usage` | none |
| Stimulus exposed | `exam_item_usage` joined to `question_bank_item_stimulus` | none (derived) |
| Answer revealed | no source today | `exam_answer_reveals (exam_instance_id, student_id, revealed_at, scope)`, one row when a result that shows answers is first served; the revealed items are that instance's delivered items |

Practice with per-item feedback reveals at delivery, so a `PRACTICE` delivery already implies reveal. Because every revealed item was also delivered, the reveal fact only matters if a policy ever allows reusing delivered-but-unrevealed items. It can be deferred without weakening the pilot rule.

## 15. Eligibility mapping (the twelve Q1-I2 conditions)

| # | Condition | Class |
|---|---|---|
| 1 | Active or calibrated, current version, not retired | already representable |
| 2 | Human review with an approving decision | already representable |
| 3 | Reviewer qualified for subject and exam family, not the author | representable after this schema; depends on an external review process to grant qualifications |
| 4 | Exactly one PRIMARY concept from the certified catalogue | representable after this schema |
| 5 | One official Domain and one certified Topic | depends on Curriculum |
| 6 | Response format allowed by the section | already representable (item type vs blueprint requirement) |
| 7 | Stimulus and assets reviewed and eligible | representable after this schema |
| 8 | Reuse rights established for item, stimulus, assets | representable after this schema, with the B1 rule change |
| 9 | Provenance complete | representable after this schema (authored class) |
| 10 | Originality check recorded | representable after this schema; depends on an external review process |
| 11 | Assigned to exactly one pool | representable after this schema |
| 12 | Fits a cell of a published blueprint | depends on B2 (persisted variants) |

## 16. Legacy compatibility

| Legacy | Treatment |
|---|---|
| 477 fixtures | untouched; no rights, attribution or pool rows; never eligible |
| 19 generated items (509 versions in all) | untouched; become eligible only through new reviewed versions that meet every condition |
| Items with no direct attribution | no row; B1 keeps `UNSPECIFIED` / derived coverage |
| Inline `content.stimulus.key` | stays in the item JSON; not migrated; such items are standalone for selection and cannot fill a stimulus-group requirement |
| `stimulus_fingerprint` | unchanged; still used by the existing form assembly |
| One blueprint per version | legacy rows keep `purpose IS NULL` and stay unique per version |
| Existing instances and attempts | unchanged; `frozen_form_id` NULL |
| F-DATA concepts and mappings | unchanged |

No metadata is fabricated for legacy content.

## 17. Migration plan (not executed)

| # | Migration | Change | Backfill | Rollback |
|---|---|---|---|---|
| 1 | Provenance and rights | widen the provenance CHECK; `assessment_sources.source_access`; rights and content-source tables | sources only | drop tables and column; restore CHECK while no authored row exists |
| 2 | Assets | asset registry, item-asset link | none | drop |
| 3 | Stimuli | stimuli, versions, parts, item-stimulus link, immutability trigger | none | drop |
| 4 | Attribution | item-concept table, optional context tags | none | drop |
| 5 | Pools | pool membership | none | drop |
| 6 | Review | reviewer qualifications; nullable review columns; originality checks; approval trigger | none | drop new objects |
| 7 | Blueprint variants | columns on `assessment_blueprints`; swap the unique constraint for the three indexes; requirement tables | none (legacy stays NULL) | restore `UNIQUE (exam_version_id)` only while no variant row exists |
| 8 | Frozen forms | forms, positions, `exam_instances.frozen_form_id` | none | drop |
| 9 | Answer reveal | reveal fact | none | drop |
| 10 | Curriculum link | item-node link | none | drop |

All additive except the constraint swap in 7, which relaxes a constraint and changes no row. Order: 1 → 2 → 3 (parts reference assets) → 4, 5, 6 in any order → 7 → 8 (references 3). Migration 9 is optional. Migration 10 waits for the Curriculum hierarchy. Each is certified on an ephemeral database before DEV, per the repository's migration governance.

## 18. Implementation order after approval

1. Schema migrations 1–8.
2. Rights correction in B1 eligibility and the coverage reader (moved ahead of the adapters, which depend on it).
3. Question Bank persistence services and coverage adapters: attribution feeding `ITEM_ATTRIBUTION`, stimulus facts, pool, provenance.
4. Curriculum hierarchy for PAA (Domains, Topics) — a parallel prerequisite, owned by the Curriculum Authority.
5. B2 persistence: variants, requirements, the new PAA version and its Full and Reduced blueprints, frozen forms.
6. Stimulus-group selection at runtime.
7. Protected start-path wiring.
8. B3 evidence consumption.
9. Content delivery.

Change proposed to the expected order: authoring and review of content can begin after steps 1–4, in parallel with 5–8. Items entered then cannot be delivered until step 7, but the 865-item requirement is the longest task and does not depend on the selector or on evidence consumption.

## 19. Decisions locked (B2-B1 authorization)

| # | Decision | Value |
|---|---|---|
| D1 | Attribution subject | `ITEM_VERSION` — attribution is reviewed content and stays historically correct per version |
| D2 | Rights record layout | one normalised record keyed by `content_type` (`ITEM_VERSION`, `STIMULUS_VERSION`, `ASSET`) + `content_id`. The repository already uses typed polymorphic references (`target_type`, `resource_type`) and has no rule against them; integrity is kept by a trigger that checks the referenced row exists, and the referenced rows cannot be deleted. This replaces the three-nullable-subject layout of section 9 |
| D3 | Asset storage | provider-agnostic registry: provider, storage key, hash, media type, size, dimensions, alt text, lifecycle. `exam_media_objects` is not reused |
| D4 | Answer reveal | deferred: migration 9 is not implemented. Delivery itself counts as exposure |
| D5 | Reviewer qualification | canonical subject × exam family, with grantor and validity |
| D6 | Schema owner | the B track implements the Question Bank and B2 persistence schema together. This is the explicit release of the item-schema work B0 listed as MUST WAIT |

Reuse-rights value names: `STUDYUS_OWNED`, `LICENSED_FOR_USE`, `OFFICIALLY_AUTHORIZED`, `UNKNOWN`, `PROHIBITED`.

One refinement made at implementation: stimulus reviews are recorded in their own typed table (`question_bank_stimulus_reviews`) instead of making `question_bank_reviews.approved_item_id` nullable, so the existing item-review constraints and trigger are not weakened. Migration 10 (curriculum-node link) still waits for the Curriculum hierarchy.
