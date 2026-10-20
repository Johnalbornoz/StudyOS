# Exam Core — implementation (Track B)

- **Base:** `2f94a1f` (foundation, frozen). **Branch:** `track-b/exam-core-verticals`.
- **Implementation commit:** `fcc32eeb6335af271fd9037655de854999e92032` (deployed to hosted DEV as `dpl_GnYqmZ63voUAhVbDuQwPfXGbCZp4`).
- **Principle:** one Exam Core. PAA, PISA, IB, Cambridge, AICE and ICFES are configuration. The Exam Core owns exam truth (delivery, timing, scoring, result). The Learning Engine owns cognitive truth. The two meet only through `updateMastery`.

## Model (reused F6/F7/F9 + additive Track B)

```
academic_programmes → qualifications → subjects → structure → learning_objectives
exam_definitions (exam_family, config_key*, academic_subject_id*, aggregation_group*)
  → exam_versions (exam_year*, exam_session*, navigation_rules = delivery policy, scoring_model_id)
    → assessment_components (sequence_order*, section_key*) = sections / papers / areas
    → assessment_blueprints → component allocations, objective targets (type, command term, difficulty)
    → scoring_models.config = scoring policy (exam-scoring-v1)
    → approved_items (PUBLISHED bank: stimulus, marks, mark-scheme parts, accepted answers)
student_exam_profiles → simulation_plans (sections) → exam_attempts (frozen config + scoring policy)
  ⇄ simulation_attempts.navigation_state (server-held items, drafts, section clock, policy, rev)
  → exam_attempt_item_responses (target_index*, item_source*; UNIQUE attempt+position)
  → exam_attempt_results* (one per attempt; provenance; SCORED | INVALIDATED)
```
`*` marks the additive items from migration `20261019_1000_track_b_exam_core_verticals.sql`. All of them are nullable, and the migration adds a new table but never drops one.

## Modules (`src/lib/exam-core/`)

| Module | Role |
|---|---|
| `taxonomy.ts` | The six families. AICE belongs to the Cambridge ecosystem. |
| `vertical-config.ts`, `apply-vertical-config.service.ts` | Validated vertical documents, applied in one transaction. Idempotent by natural keys and immutable once published (a fingerprint change needs a new version label). Items go through the real workflow states with creator ≠ reviewer (system identities). |
| `scoring/scoring-policy.ts`, `scoring/scoring-engine.ts` | Strategies: RAW, WEIGHTED_ITEMS, SECTION_WEIGHTED, CRITERIA. Transforms: NONE, LINEAR, PIECEWISE, BANDS. Supports partial credit and invalid / missing / excluded responses. Pure and deterministic, with policy and response-set hashes. An absent policy yields `NO_SCORING_POLICY` (never a default formula). A policy can be labelled official only with a non-fixture source. |
| `delivery-policy.ts` | Navigation (LINEAR, FREE_ORDER_WITHIN_SECTION), breaks, item feedback, result review, allowed modes, permitted resources. Integrity cannot be loosened. Official timing means a HARD limit, no pause and no feedback. |
| `items.ts`, `item-grading.ts` | The exam item, structural validation, and the key-free client item plus a leak detector. Grading reuses `gradeStructuredAnswer` / `gradeAnswer` and adds shape validation, accepted / numeric answers and mark-scheme parts mapped to criteria. |
| `item-sourcing.service.ts` | Published bank first: deterministic per-attempt variants, stimulus units kept together. Otherwise the existing AI generator for the owner's concept, validated against the target (type, difficulty, objective, answer validity). One retry, then UNAVAILABLE. |
| `navigation-state.ts` | Navigation state v2 and the legacy upgrade path. |
| `results.service.ts` | Scoring from committed responses and the frozen policy. One result per attempt. Reproducibility check, invalidation, and the derived lifecycle (NOT_STARTED, IN_PROGRESS, PAUSED, SUBMITTED, SCORED, INVALIDATED, ABANDONED). |
| `result-view.service.ts`, `catalog.service.ts` | Student views: result, family-grouped catalog, areas, history, AICE aggregate. |

`src/lib/simulation/item-resolution.service.ts` handles server-authoritative delivery:
- It keeps the server-held item and serves autosave and refresh recovery.
- It runs section clocks on server timestamps (pause excluded). A HARD deadline closes the section, commits drafts and marks the rest MISSING.
- It handles breaks, inactivity expiry and compare-and-swap writes.
- On hand-in it commits drafts first.

## Integrity and evidence

- The client sends only its answer string, plus a position and an idempotency key. Request bodies are strict.
- A second commit for the same item is structurally impossible.
- The Tutor is restricted while any exam simulation is ACTIVE or PAUSED (`ACTIVE_EXAM_SIMULATION`).
- Evidence is written only from a valid response to a server-held item, through `updateMastery(EXAM_SIMULATION, aiAssistanceType NONE, EXAM_SIMULATION_RESPONSE identity)`, and only for the attempt owner's concept.
- Results, completion and invalidation never write cognition.
- DEV fixture objectives map to no concept, so they produce no evidence.

## Database

- Migration `20261019_1000` is additive and DEV-only.
- It was certified on an ephemeral PG18 instance with `scripts/operations/track-b-exam-core-migration-cert.sh`: legacy rows intact, 15 constraint probes, rollback inside a transaction, idempotent re-apply, all eight verticals applied and re-applied as no-ops.
- The rollback statements are in the migration header.
- The exam-family taxonomy is enforced by the application layer. A DB CHECK is deferred until after merge, because DEV is shared with Track A, whose foundation scenarios use a test family label.

## Operations

- `scripts/operations/track-b-apply-verticals.ts [--write]` — DEV-fingerprint guarded, idempotent.
- `scripts/operations/track-b-exam-scenarios.ts` — DEV functional, security and integrity harness. It creates fixtures and removes them all.
- Admin APIs (StudyUS admin only): `GET/POST /api/admin/assessment/verticals` (dry-run by default) and `POST /api/admin/assessment/attempt-results/invalidate`.
