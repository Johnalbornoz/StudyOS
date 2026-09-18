# F7 — Exam Version Model

## Exam Definition (task §5)

| Column | Notes |
|---|---|
| `academic_programme_id` | Nullable FK → F6's `academic_programmes` — an optional, explicit link to the curriculum-layer classification (PAA's programme already has `programme_type = 'ADMISSION_EXAM'`). Nullable because an Exam Definition could exist before its curriculum-layer programme does, or never need one. |
| `name` | e.g. "PAA", "IB DP Subject Assessment". |
| `exam_family` | Free text category — deliberately **not** constrained to a fixed enum shared with `academic_programmes.programme_type`, since an Exam Definition might exist for a purpose F6 never classified (e.g. a diagnostic-only assessment). |
| `purpose` | Free text, e.g. "university admission", "end-of-programme certification". |
| `domains` | `text[]` — e.g. `{Reading,Writing,Mathematics,English}` for PAA. |
| `status` | `CHECK (DRAFT\|ACTIVE\|RETIRED)`. |

No timing/scoring/blueprint data lives here (task §5's explicit instruction) — that is exclusively
`exam_versions`' job.

## Exam Version (task §6)

| Column | Notes |
|---|---|
| `exam_definition_id` | FK, required. |
| `version_label` | Free text, e.g. "2024", "First examination 2027". |
| `effective_from` / `effective_to` | Nullable dates. |
| `navigation_rules` | Nullable jsonb — e.g. `{allowBacktrack: false}`. Absence means "not configured," never "no restrictions." |
| `scoring_model_id` | Nullable FK → `scoring_models`. **Null is a real, valid, checkable state** (INV-F7-09) — never defaulted to a formula. |
| `supported_modalities` | `text[]`, e.g. `{ONLINE,PAPER}`. |
| `status` | `CHECK (DRAFT\|PUBLISHED\|SUPERSEDED\|RETIRED)` — identical versioning discipline to F6's `structure_versions`: at most one `PUBLISHED` per `exam_definition_id` (partial unique index), publishing a new version transitions the old one to `SUPERSEDED`, never deletes it. |

Section/component structure lives in `assessment_components` (below), keyed to the exam version,
not embedded as columns here — a version's component list can grow without a schema change.

## Assessment Component (task §7)

| Column | Notes |
|---|---|
| `exam_version_id` | FK, required. |
| `name` | e.g. "Mathematics Section", "Paper 1", "Oral Component". |
| `component_type` | `CHECK (SECTION\|PAPER\|WRITTEN\|ORAL\|PRACTICAL\|COURSEWORK)` — task §7's explicit list; a component is never forced into a multiple-choice-only shape. |
| `modality` | Free text, e.g. "WRITTEN", "ORAL", "ONLINE". |
| `academic_subject_id` | Nullable FK → F6's `academic_subjects` — optional domain scoping (e.g. PAA's Mathematics component points at PAA's Mathematics `academic_subjects` row). |
| `timing_status` | `CHECK (NOT_CONFIGURED\|CONFIGURED)`. |
| `duration_minutes` | Nullable integer — only meaningful when `timing_status = 'CONFIGURED'`. |
| `tool_rule_status` | `CHECK (NOT_CONFIGURED\|CONFIGURED)`. |
| `tool_rules` | Nullable jsonb — e.g. `{"calculator": "PROHIBITED", "formulaSheet": "PROVIDED"}`. Absence (task §15's explicit instruction: "if unknown, do not invent it") is represented by `tool_rule_status = 'NOT_CONFIGURED'` **and** `tool_rules IS NULL` together — never one without the other (enforced at the service layer). |
| `rubric_reference` | Nullable free text/citation. |
| `simulation_capable` | Boolean, default `false` — whether this component currently has enough generation/bank support to be simulated at all. |
| `support_status` | `CHECK (UNSUPPORTED\|SUPPORTED)` — the explicit flag the Full Mock Guard and INV-F7-08 (adversarial case G) key off. |

## Scoring Model (task §16)

| Column | Notes |
|---|---|
| `name` | e.g. "PAA Mathematics Binary + Partial Credit v1". |
| `scoring_type` | `CHECK (BINARY\|PARTIAL_CREDIT\|RUBRIC\|MARK_SCHEME\|MULTI_PART)`. |
| `config` | jsonb — the actual rule definition (mark allocation, rubric criteria) for whichever `scoring_type` this is. Never a computed percentage-to-grade formula (task §16: "do not convert raw percentage into official score unless a verified model exists") — F7 stores configuration, never invents a projection. |
| `status` | `CHECK (DRAFT\|ACTIVE\|RETIRED)`. |

## Command Terms (task §11)

| Column | Notes |
|---|---|
| `term` | Unique, e.g. "define", "explain", "compare", "analyze", "justify", "evaluate". |
| `expected_reasoning_type` | Nullable free text — documented as expected to align with the **existing** `ExpectedReasoningType` vocabulary (`FACTUAL\|PROCEDURAL\|CONCEPTUAL\|METACOGNITIVE`) already used by `quiz-generation.service.ts`, reused rather than duplicated. Never a DB CHECK against that TS union (F7 doesn't import application code into a migration), but documented as the intended values. |
| `description` | Nullable. |
| `status` | `CHECK (DRAFT\|ACTIVE\|RETIRED)`. |

A command term never automatically implies a competency (task §11's explicit instruction) — no FK
from `command_terms` to `competencies` exists; any such relevance is expressed only through the
blueprint's own separate `competency_id`/`skill_id` fields on the objective target, not derived
from the term.

## Difficulty (task §13)

No new difficulty scale. `blueprint_objective_targets.difficulty_min`/`difficulty_max` reuse the
**existing 1-5 integer scale** verbatim (`CHECK (difficulty_min BETWEEN 1 AND 5)`, etc.), the same
scale `GeneratedQuestion.difficulty` and `describeDifficultyTier` already use. An optional
`exam_versions.difficulty_scale_notes` free-text field exists for documenting a framework's own
difficulty labels in relation to this scale (e.g. "PAA describes items informally as
Basic/Intermediate/Advanced, corresponding roughly to 2/3/4 on the internal scale") — never a
forced numeric mapping formula, since none is verified for any real framework yet.
