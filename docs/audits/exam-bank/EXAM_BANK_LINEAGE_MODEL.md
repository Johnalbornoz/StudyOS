# Exam Bank lineage model

Track B · 2026-10-14 · Documentation only. Historical PAA lineage is not changed. The baseline is frozen at `610d3c6`.

## 1. Lineage chain

```
Assessment system ─► system version ─► component node
        │                                   │
        └──────────────► Adapter (version + profile) ◄┘
                               │
Blueprint classification ─► blueprint bucket            Construct core ─► core applicability (per adapter)
        │                        │                              │
        │                        └──────────────┐               │
        │                                       ▼               ▼
        │                     Renderer ─► renderer envelope ─► CANDIDATE (rendered instance, not persisted)
        │                                                        │
        │                                     certification (object certification / pilot item certification)
        │                                                        │
        │                                         CERTIFIED INSTANCE (assessment_item_instances)
        │                                                        │  projection (bank-projection-2)
        │                                       Exam Bank item (question_bank_items) ─► bank version (approved_items)
        │                                                        │
        └──────────── runtime blueprint (assessment_blueprints) ─► ATTEMPT FORM (frozen form / exam_instances.form)
                                                                 │
                                                       attempt ─► RESPONSE ─► EVIDENCE
```

## 2. Steps, identities and digests

| # | Step | Table / type | Stable identity | Digest | Link to the previous step |
|---|---|---|---|---|---|
| 1 | Assessment system | `assessment_systems`; `AssessmentSystem` | `system_id` | — | — |
| 2 | Version | `assessment_system_versions` | (`system_id`, `version_id`) | — | FK → system |
| 3 | Component node | `assessment_system_nodes` | (`node_id`, `version_id`) | — | FK → version; parent node |
| 4 | Adapter (version/profile) | `assessment_adapters`; `adapterOfComponent` | (`adapter_id`, `adapter_version` = system.version+component.version) | `content_hash` | FK → version, node |
| 5 | Blueprint | `assessment_blueprint_classifications` | (`blueprint_id`, `classification_version`) | `content_hash` | FK → version; **adapter by text only** |
| 6 | Bucket | `assessment_blueprint_buckets` | (`bucket_id`, `classification_version`) | — | FK → classification |
| 6a | Runtime blueprint | `assessment_blueprints` + `blueprint_objective_targets` | uuid | — | FK → `exam_versions` |
| 7 | Core | `assessment_construct_cores` | (`construct_family_id`, `family_version`) | `content_hash` | standalone |
| 8 | Applicability | `assessment_construct_core_applicability` | (`core_id`, `adapter_id`) | `content_hash` | FK → core, system; **adapter by text** |
| 9 | Renderer / envelope | `assessment_instance_renderers`, `assessment_renderer_envelopes` | `renderer_version`; `envelope_hash` (PK) | `envelopeHashOf` | FK → renderer |
| 10 | Candidate | not persisted: `RenderedInstance`, `ItemInstanceLineage` | `seed` | `parameterSetId`, `adaptationSpecificationId` | carries core, adapter, version, bucket, renderer |
| 11 | Certification | `assessment_object_certifications` (append-only), `assessment_certifications` (human), `assessment_certification_policies`; pilot: `exam_bank_pilot_item_certifications` | uuid; object (type, id, version) | `content_hash`, `evidence_hash`, `policy_hash` | polymorphic text → `assessment_certified()` |
| 12 | Certified instance | `assessment_item_instances` | uuid; unique `certification_digest`; unique (core, adapter, version, bucket, parameter set, renderer) | `content_hash` = `instanceContentHashOf`, `certification_digest` = `lineageHashOf` | FK → core, adapter, version, renderer, envelope, policy; **bucket text, no blueprint column** |
| 13 | Exam Bank item | `question_bank_items` (`lineage_class` LEGACY / CORE_DERIVED / PILOT_CERTIFIED) | uuid; (`learning_objective_id`, `item_key`) | — | FK `item_instance_id` (CORE_DERIVED) |
| 14 | Bank version | `approved_items` | uuid; (`bank_item_id`, `version_number`), `supersedes_version_id` | `content_hash` (sha256 of content); `content.lineage.digest` = instance `certification_digest` | FK → bank item; rights `question_bank_content_rights`; concepts `question_bank_item_concepts` |
| 14a | Pilot-generated version (PAA) | `exam_bank_pilot_item_certifications`, `exam_bank_pilot_stimuli`, view `exam_bank_pilot_deliverable_versions` | `approved_item_id` unique | `item_digest` (`selectedResponseDigest`), stimulus `content_digest`, `candidateDigest` | FK → version, bank item, stimulus, policy |
| 15 | Attempt form | `assessment_frozen_forms` (+ positions) **or** `exam_instances.form` | uuid | `form_hash` (frozen only); **none for practice/mock** | positions → `approved_items` |
| 16 | Attempt | `exam_attempts`, `simulation_attempts` | uuid | — | FK → profile, version, blueprint |
| 17 | Response | `exam_attempt_item_responses` | uuid; (`exam_attempt_id`, `idempotency_key`) | none as a column (the `item_snapshot` holds `certifiedLineage`) | FK → attempt, `approved_item_id` |
| 18 | Evidence | `learning_evidence` | uuid; `operation_key` | — | **no FK**: `metadata.examScope` / `context.examAttemptId` |

## 3. Required stable identities and digests (contract for every exam system)

| Object | Required identity | Required digest |
|---|---|---|
| System / version / component | `system_id`, `version_id`, `node_id` | — |
| Blueprint | `blueprint_id` + `blueprint_version` | `content_hash` |
| Bucket | `bucket_id` within the blueprint version | — |
| Core | family + version | `content_hash` |
| Adapter | id + version | `content_hash` |
| Renderer | `renderer_version` | `envelope_hash` |
| Certified instance | uuid | `content_hash` (what the learner sees + the key) and `certification_digest` (content + lineage + difficulty + envelope) |
| Bank version | uuid | `content_hash`; must carry the instance `certification_digest` |
| Form | uuid | **`form_hash` for every form** (proposed) |
| Response | uuid | **`content_hash` of the delivered version** (proposed) |
| Evidence | `operation_key` | FK to the response (proposed, via `exam_readiness_evidence.response_id`) |

## 4. Gaps (proposals; none executed during the freeze)

| Gap | Risk | Proposal |
|---|---|---|
| Bucket on the instance is text with no FK, and there is no blueprint id/version column | an instance can name a bucket no blueprint holds | add `blueprint_id`, `classification_version` + composite FK → `assessment_blueprint_buckets` |
| Applicability and blueprint name the adapter by text | an adapter version change is invisible | FK (`adapter_id`, `adapter_version`) |
| Bank version → instance digest only inside jsonb | a JSON edit breaks lineage silently | generated column `lineage_digest` + FK to `assessment_item_instances.certification_digest` (the guard trigger already checks equality) |
| `lineageHashOf` vs `certifiedLineage.digest` are two different hashes | confusion when auditing | document both names; prefer `certification_digest` as the single external id |
| Practice/mock forms have no hash | a form cannot be proven unchanged after start | `form_hash` on `exam_instances` at freeze |
| Responses do not store the delivered content hash | re-scoring cannot prove which content was answered | `delivered_content_hash` column on `exam_attempt_item_responses` |
| Evidence has no FK to the response | provenance by JSON only | `exam_readiness_evidence.response_id` FK (separation audit §4.1) |
| Speed strategy has no persisted identity | association lives in code + `grading_detail.coach` | `SPEED_STRATEGY_PERSISTENCE_DESIGN.md` |

The PAA pilot rows (14a) already carry the full chain: policy hash, item digest, stimulus digest, candidate digest and content hash. They are unchanged.
