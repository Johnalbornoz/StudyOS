# F6 — Curriculum Mapping Model

## Three concrete mapping tables, not one polymorphic table

Mirroring F4's own choice (`canonical_concept_skills`, `skill_competencies`,
`canonical_concept_competencies` as separate tables rather than one polymorphic edge table, for
real FK integrity):

- `objective_concept_mappings` — `learning_objective_id` → `canonical_concepts.id`
- `objective_skill_mappings` — `learning_objective_id` → `skills.id`
- `objective_competency_mappings` — `learning_objective_id` → `competencies.id` ("where
  justified", task §10 — expected to be the sparsest of the three)

All three share the identical column shape and workflow:

| Column | Notes |
|---|---|
| `id` | uuid PK |
| `learning_objective_id` | FK, required |
| `canonical_concept_id` / `skill_id` / `competency_id` | FK, required (the mapping target) |
| `relation_type` | `CHECK (FULL \| PARTIAL \| PREREQUISITE \| SUPPORTING)` — task §11's minimum vocabulary |
| `scope` | Free text — what portion of the objective this mapping addresses |
| `level` | Free text — e.g. depth/difficulty the mapping applies at |
| `rationale` | Free text — why this mapping was proposed |
| `provenance` | `CHECK (MANUAL \| AI_SUGGESTED)` |
| `confidence` | Nullable numeric 0–1 — only meaningful when `provenance = AI_SUGGESTED`; advisory only (task §16), never a publication gate |
| `status` | `CHECK (DRAFT \| PROPOSED \| IN_REVIEW \| APPROVED \| PUBLISHED \| REJECTED \| RETIRED)` — task §14 |
| `mapping_group_id` | uuid — links successive versions of "the same logical mapping" over time |
| `version` | integer — increments within a `mapping_group_id` |
| `created_by` | FK → `users.id` |
| `reviewed_by` | Nullable FK → `users.id` |
| `reviewed_at` | Nullable timestamptz |
| `published_at` | Nullable timestamptz |
| `created_at` | timestamptz |

## Relation-type semantics (task §11, INV-F6-13)

- **FULL** — the objective is completely addressed by this canonical concept/skill/competency.
- **PARTIAL** — only part of the objective is addressed. **A PARTIAL mapping can never, by
  itself or in combination with the coverage service's counting rule, cause the objective to be
  reported as fully covered** — see the coverage model doc's explicit numerator rule (AC-F6-08).
- **PREREQUISITE** — the canonical concept is a prerequisite for the objective, not a direct
  measurement of it.
- **SUPPORTING** — the canonical concept is related/supportive context, weaker than PARTIAL.

## Versioning (task §12, INV-F6-08/09)

A mapping's substantive fields (`relation_type`, `scope`, `level`, target id) become **immutable
once `status = 'PUBLISHED'`** — enforced at the service layer (`updateMapping` refuses to modify a
`PUBLISHED` row). To change a published mapping:

1. Insert a new row in the **same** `mapping_group_id`, `version = previous.version + 1`,
   `status = 'DRAFT'`.
2. The new row goes through the same review/approve/publish workflow independently.
3. Only at the moment the new row is published does the old row transition
   `PUBLISHED → RETIRED` — atomically, in the same transaction (mirrors F5's
   `aggregation_policy_versions` retire-and-insert).

A historical attempt/activity that resolved its metadata from the old `PUBLISHED` version (via
the activity metadata bridge, task §27) keeps the id it resolved — nothing rewrites what that
activity recorded, even after the mapping is retired (INV-F6-09).

## Editorial workflow (task §14, detailed in `F6_EDITORIAL_WORKFLOW.md`)

`DRAFT → PROPOSED → IN_REVIEW → APPROVED → PUBLISHED`, with `REJECTED` reachable from
`PROPOSED`/`IN_REVIEW` and `RETIRED` reachable only from `PUBLISHED` (via the version-replacement
flow above, or an explicit retirement action). Every transition is an explicit, versioned
service-layer state machine — never a raw `UPDATE status = ...` from a route handler.

## AI-assisted mapping boundary (task §16, INV-F6-11)

AI may create a row with `status = 'PROPOSED'`, `provenance = 'AI_SUGGESTED'`, and a `confidence`
score — **never** `status = 'APPROVED'` or `'PUBLISHED'` directly. The service layer's
`proposeMapping` function accepts `provenance` as an input but the publish/approve transitions are
separate functions that only a human-attributed `reviewed_by`/editorial-grant-holding caller can
invoke — there is no code path from "AI suggested this" to "this is now published" without a
human transition in between.

## Ambiguous F4 correspondence (task §18, reusing F4 semantics)

When proposing a mapping, the service resolves candidate canonical concepts via F4's own
`findCanonicalConceptsByExactName`/mapping-candidate machinery. If the underlying learner-side
correspondence (for content-derived mapping proposals) is `AMBIGUOUS` or `UNRESOLVED`, the
proposed mapping is created with `status = 'PROPOSED'` and an explicit note in `rationale` — never
silently promoted to `APPROVED`/`PUBLISHED`, and never used to fabricate a second canonical
concept merely to avoid the ambiguity (task §18's explicit instruction, mirrored from F4's own
INV-F4-04).

## Private content stays private (task §19, INV-F6-12)

`resource_objective_links`/mapping tables reference `canonical_concepts`/`learning_objectives` —
shared, ownerless entities. Nothing in this schema references a specific student's
`content_sources`/`content_chunks` row, and no F6 table has a `student_id` column. A private
upload's underlying per-student concept can be `MATCHED` (F4) to a canonical concept that
*happens* to also have a published objective mapping — this is purely an analytical join
(`getObjectiveAlignmentForContent`, read-only), never a change to who can read that content.
