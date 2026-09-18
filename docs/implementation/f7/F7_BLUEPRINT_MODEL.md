# F7 — Blueprint Model

## Assessment Blueprint (task §8)

One blueprint per exam version (`assessment_blueprints.exam_version_id UNIQUE`) — a blueprint
change rides along with a new exam version rather than being independently versioned, avoiding a
second, redundant versioning axis for the same underlying "what does this exam look like" concept.

| Column | Notes |
|---|---|
| `exam_version_id` | FK, unique. |
| `status` | `CHECK (DRAFT\|PUBLISHED\|RETIRED)`. |

## Blueprint Component Allocation

| Column | Notes |
|---|---|
| `blueprint_id` | FK. |
| `assessment_component_id` | FK. |
| `item_count` | Nullable integer — how many items this component contributes. Null = not yet configured. |
| `weight` | Nullable numeric — component weight, "where configured" (task §8) — never defaulted to an equal split when absent. |

## Blueprint Objective Target (task §8/§9/§11/§12/§13)

The actual sampling definition — one row per (objective, target) the blueprint wants covered:

| Column | Notes |
|---|---|
| `blueprint_id` | FK. |
| `learning_objective_id` | FK → F6's `learning_objectives`. **Never** a `structure_node_id` or curriculum-tree position — the blueprint samples objectives, not tree nodes (INV-F6-05/INV-F7-05). |
| `target_item_count` | Nullable integer. |
| `question_type` | Nullable free text — constrains generation to one of the **existing** `QuestionType` values, when the blueprint cares; null means any supported type. |
| `command_term_id` | Nullable FK → `command_terms`. |
| `reasoning_requirement` | Nullable free text, documented as aligning with the existing `CognitiveLevel` vocabulary (task §12 — explicitly item metadata, never a progression signal). |
| `difficulty_min` / `difficulty_max` | Nullable integers, `CHECK (BETWEEN 1 AND 5)`. |
| `skill_id` | Nullable FK → F4's `skills` — when the blueprint wants to target a specific skill's evidence, not just a concept. |

## Task §9 — blueprint coverage (Full Mock guard precondition)

A Full Mock may only be offered when, for every `blueprint_objective_targets` row under the
`PUBLISHED` blueprint:

1. The referenced `learning_objective_id` has at least one **`PUBLISHED`** `objective_concept_mapping`
   or `objective_skill_mapping` (F6's own discipline, reused verbatim — INV-F7-06).
2. The objective's `assessment_components` (via the blueprint's component allocations) all have
   `support_status = 'SUPPORTED'`.
3. Every such component has `timing_status = 'CONFIGURED'` and `tool_rule_status = 'CONFIGURED'`.
4. `exam_versions.scoring_model_id` is not null.

If any condition fails, the guard returns `NO` with the specific missing piece named — never a
silent partial mock presented as a full one (see `F7_FULL_MOCK_GUARD.md`). A **Mini Mock** /
partial simulation may still be offered for exactly the subset of objectives/components that do
pass all four checks — "scope is clear" (task §9) means the caller receives the passing subset
explicitly, never an implicit "best effort."

## Curriculum tree order never becomes blueprint distribution (task §8, adversarial case K)

`blueprint_objective_targets` has no `order_index`/`sequence` column and never joins against
`structure_nodes.order_index` for sampling weight. A blueprint's distribution is 100% the explicit
`target_item_count`/`weight` values an editor configured — a curriculum tree with objectives in a
particular presentation order has zero influence on how often the blueprint samples them.
