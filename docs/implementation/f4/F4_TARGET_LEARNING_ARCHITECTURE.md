# F4 — Target Learning Architecture

## Design principle

Everything the current-architecture assessment found is preserved exactly as-is. F4 adds a
**new, parallel canonical catalog domain** plus **one explicit correspondence layer** between it
and the existing per-student `concepts` table. It changes zero existing tables' shape, zero
existing FKs, and zero existing service behavior.

```
CANONICAL CATALOG (new, shared, cross-student)          LEARNER DOMAIN (existing, unchanged)
────────────────────────────────────────────           ──────────────────────────────────────
canonical_subjects                                       subjects (student_id)
   │ 1:N                                                    │ 1:N
canonical_concepts ──────┐                                topics → subtopics
   │ M:N        │ M:N     │ M:N (prerequisites,               │ 1:N
skills       competencies │  self-referencing)             concepts (subject_id, canonical_id)
   │ M:N                  │                                   │
   └── skill_competencies ┘                                   │ FK from all 19 evidence/state
                                                                │ tables (learning_evidence,
contexts (taxonomy only, unwired this phase)                   │ mastery_records, concept_
                                                                │ knowledge_state, etc.)
                          concept_catalog_mapping (NEW — the correspondence layer)
                          ┌──────────────────────────────────────────────────────┐
                          │ learner_concept_id (FK → concepts.id, UNIQUE)         │
                          │ canonical_concept_id (FK → canonical_concepts.id,     │
                          │                        NULL unless status=MATCHED)   │
                          │ status: MATCHED | PROPOSED | AMBIGUOUS | UNRESOLVED   │
                          └──────────────────────────────────────────────────────┘
                          concept_catalog_mapping_candidates (NEW — 0..N per mapping,
                          for PROPOSED/AMBIGUOUS review)
```

## Why this shape

- **INV-F4-06/07/08** (canonical vs. learner state separated; private content stays private;
  mapping never publishes content): satisfied structurally — `concept_catalog_mapping` only
  ever *points from* a private `concepts.id` *to* a shared `canonical_concepts.id`. Nothing about
  a canonical concept ever exposes which students reference it, and nothing about mapping a
  concept changes who can read `content_sources`/`content_chunks`/`learning_evidence` for it.
- **INV-F4-02/03/12/13/14** (Evidence/ownership untouched, no orphans, no duplication): satisfied
  by construction — none of the 19 dependent tables, nor `concepts` itself, are modified. The
  migration is 100% additive new tables plus one new nullable-pointer correspondence table.
- **AC-F4-09** (unresolved mappings allowed and auditable): every existing `concepts` row gets
  exactly one `concept_catalog_mapping` row after backfill (via `UNIQUE(learner_concept_id)`),
  even when `status = 'UNRESOLVED'` — "no canonical match found" is a recorded fact, not a
  silent gap.
- **AC-F4-07/08** (no name-only merge; ambiguity stays explicit): the backfill algorithm (see
  migration spec) only sets `status = 'MATCHED'` when there is exactly one candidate with a safe,
  auditable match method; two or more candidates produce `AMBIGUOUS` with every candidate
  recorded in `concept_catalog_mapping_candidates`, never an arbitrary pick.

## Visible product architecture — unchanged

Per task §2, Skill/Competency are never inserted into learner-visible navigation. The learner
still sees Subject → Topic → Concept → Activity exactly as today; `concept_catalog_mapping` and
the canonical catalog tables are consumed only by admin/editor tooling (§19 of the task) and by
future F5/F6 phases. No student-facing route changes in F4.

## Component summary

| Component | New/Changed | Cardinality with concepts |
|---|---|---|
| `canonical_subjects` | New | 1:N with `canonical_concepts` |
| `canonical_concepts` | New | M:N with `skills`, M:N with `competencies` (where justified), self-referencing M:N for prerequisites |
| `skills` | New | M:N with `canonical_concepts`, M:N with `competencies` |
| `competencies` | New | M:N with `skills`, M:N with `canonical_concepts` (only where justified — not implied by every skill link) |
| `contexts` | New | Standalone taxonomy; not wired into any evidence/activity table this phase |
| `concept_catalog_mapping` | New | 1:1 with existing `concepts.id` (every concept gets exactly one mapping row) |
| `concept_catalog_mapping_candidates` | New | 1:N per mapping row |
| `concepts`, `subjects`, `topics`, `subtopics`, all 19 evidence/state tables | **Unchanged** | n/a |

## What F4 explicitly does NOT build (deferred to F5/F6 per task §33)

- No `context_id` column added to `learning_evidence`, `quiz_sessions`, or any activity table —
  contexts is taxonomy-only this phase.
- No learner-facing Skill State or Competency State (percentages, mastery-per-skill) — F5.
- No framework-specific codes (IB/Cambridge/PAA) inside `canonical_concepts` — F6.
- No editorial publish/version workflow — F6. The admin tooling this phase provides is read +
  fixture-review only (§19).

## Compatibility boundary with Canonical V2

No change. Canonical V2 continues to receive `(studentId, conceptId)` pairs resolved through the
unchanged `resolveConceptSubjectForStudent`/`verifyConceptOwnership` gates. It never sees a
`canonical_concept_id`. If a future phase wants Canonical V2-aware canonical reporting, that is
an explicit, separate compatibility boundary to design then — not introduced here (INV-F4-01,
INV-F4-16 §16 of the task).
