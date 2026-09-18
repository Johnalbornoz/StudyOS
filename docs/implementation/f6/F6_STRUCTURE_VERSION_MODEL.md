# F6 — Structure & Version Model

## Organization / Programme / Qualification / Subject (task §6/§7)

| Table | Key columns | Notes |
|---|---|---|
| `academic_organizations` | `id`, `name`, `status` | e.g. "Cambridge International", "International Baccalaureate", "ICFES" (PAA's issuing body). No uniqueness on `name` — same discipline as F4's `canonical_subjects`/`canonical_concepts`, since two organizations could legitimately share a display name in different contexts. |
| `academic_programmes` | `id`, `organization_id`, `name`, `programme_type`, `stage`, `status` | `programme_type CHECK (CURRICULUM \| ASSESSMENT_FRAMEWORK \| ADMISSION_EXAM)` — task §5's explicit three-way classification, never forced onto every provider identically. `stage` is free text (e.g. "Lower Secondary", "Primary") — nullable, since not every programme has one. |
| `academic_qualifications` | `id`, `programme_id`, `name`, `status` | Optional layer ("where applicable", task §6) — e.g. IGCSE, AS Level, A Level, AICE Diploma under Cambridge. PAA's `academic_programmes` row has zero qualification children — that's valid, not an error. |
| `academic_subjects` | `id`, `programme_id`, `qualification_id` (nullable), `name`, `level` (nullable), `status` | The scoping unit task §7 asks for: organization is reachable via `programme_id`, qualification is optional, `level` is free text (e.g. "HL", "Higher Tier"). |

No table here has a `student_id` — these are canonical, shared, framework-owned (INV-F6-15).

## Structure / Structure Version / Structure Node (task §8)

`structure_versions` (one row per published/draft syllabus edition of one `academic_subjects`
row):

| Column | Notes |
|---|---|
| `academic_subject_id` | FK, required. |
| `version_label` | Free text (e.g. "2024 syllabus", "First examination 2027"). |
| `effective_from` / `effective_to` | Nullable dates. |
| `status` | `CHECK (DRAFT \| PUBLISHED \| SUPERSEDED \| RETIRED)`. |
| `source_locator` | Free text — a citation/URL to the real syllabus document, never the document itself. |

**Versioning semantics (task §7's "do not assume two versions share identical structure",
INV-F6-09, adversarial case L)**: at most one `PUBLISHED` structure version per subject at a time
(partial unique index), but publishing a new version **never deletes or mutates** the old one —
it transitions the old `PUBLISHED` row to `SUPERSEDED`. A `SUPERSEDED` version's nodes, objectives,
and mappings remain fully queryable — any historical mapping/attempt that referenced the old
version keeps working exactly as it did. This is the same retire-and-insert discipline as F5's
`aggregation_policy_versions`, applied at the structure-version grain instead of the policy grain.

`structure_nodes` (the tree, task §8's explicit field list, deliberately no fixed hierarchy depth
or name):

| Column | Notes |
|---|---|
| `structure_version_id` | FK, required — a node belongs to exactly one version, never shared across versions (case B: same source label, different version, is a *different* node row). |
| `parent_id` | Nullable self-FK — `NULL` for a root node. |
| `node_type` | Free text (e.g. "STRAND", "TOPIC", "UNIT", "DOMAIN") — never a fixed enum, since each framework/subject keeps its own nomenclature (task's explicit instruction against `Chapter → Unit → Topic` uniformity). |
| `source_label` | The framework's own label text. |
| `code` | Nullable — the framework's own official code, when it has one. |
| `order_index` | Presentation order only — **never** implies prerequisite order (task §9's explicit warning, INV consistent with F4's own concept-relationships-vs-display-order distinction). |
| `description` | Nullable free text. |
| `source` / `source_locator` | Provenance — where this node came from (manual entry, a specific document page). |
| `status` | `CHECK (ACTIVE \| RETIRED)`. |

`structure_node_localizations` (`structure_node_id`, `language`, `label`, `created_at`) — reuses
the exact four-times-repeated i18n shape already established by `concept_localizations`/
`topic_localizations`/`subtopic_localizations`/`concept_explanations` (assessment §10). The
node's own `source_label` is the default/source label; this table holds additional translations
only, never a duplicate "is source" flag.

## Structure validation (task §9)

| Rule | Enforcement |
|---|---|
| No cycles | Application-level recursive-CTE reachability check before every `parent_id` write — ports F4's `prerequisite.service.ts::wouldCreateCycle` verbatim (assessment §8), swapping in `structure_nodes`/`parent_id`/`id`. |
| No orphan nodes | `parent_id`, when non-null, is a real FK to another row in the *same* `structure_version_id` — enforced by an application-level check before insert (a bare FK constraint alone can't confirm same-version scope), never just "any node anywhere." |
| Valid parent scope | The above check also rejects a `parent_id` belonging to a different `structure_version_id`. |
| Duplicate code handling | `UNIQUE (structure_version_id, code) WHERE code IS NOT NULL` — scoped per version, never globally (two different syllabus versions may reuse the same official code). |
| Stable IDs | `uuid` primary keys, never re-used or renumbered. |
| Version consistency | A node's `structure_version_id` never changes after creation (no "move a node to a different version" operation — that would silently rewrite which syllabus edition a historical mapping referenced). |
| Presentation order ≠ prerequisite order | `order_index` is documented as display-only; nothing in F6 derives a prerequisite claim from it. |

## Learning Objectives / Knowledge Requirements (task §10)

`learning_objectives` (`id`, `structure_node_id`, `code` nullable, `description`, `status
CHECK (ACTIVE | RETIRED)`) — belongs to exactly one structure node (typically, but not
structurally required to be, a leaf). Many-to-many mapping to concepts/skills/competencies is
modeled by the three junction-style mapping tables in `F6_CURRICULUM_MAPPING_MODEL.md`, not by
columns on this table itself.

## Blueprint boundary (task §25, INV-F6-05)

`structure_nodes`/`learning_objectives` answer **what** knowledge belongs to the programme. They
carry no assessment-weight, item-count, or distribution field of any kind — an Assessment
Blueprint (how an exam samples/measures this content) is a distinct future authority (F7+) that
would reference `learning_objectives` by id, never be encoded as columns on this tree. This
boundary is enforced by omission (no such columns exist to misuse) and tested directly in the
adversarial certification (case K).

## Course/Textbook structure boundary (task §26, INV-F6-06/07)

`academic_resources` (see mapping model doc) links to `learning_objectives` via
`resource_objective_links` — a many-to-many relationship in **both directions**: one textbook
chapter may link to several objectives, and one objective may be covered by several chapters
across several resources. A resource's own internal chapter/unit numbering is never imported into
`structure_nodes` — a chapter number is data about a resource, never automatically an official
syllabus unit (INV-F6-07).
