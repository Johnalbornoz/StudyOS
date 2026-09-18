# F4 — Canonical Catalog Migration Spec

Written before implementation, per task §20. One migration file:
`database/migrations/20260922_1000_f4_learning_architecture_2.sql`, fully idempotent
(`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`), never auto-applied.

## Per-table specification

### canonical_subjects — NEW / ADDITIVE
- Current role: none (does not exist).
- Target: shared subject catalog entry.
- PK: `id uuid`. No FK dependencies in. FK dependents: `canonical_concepts.canonical_subject_id`.
- Ownership: none — globally readable catalog data, not learner-owned.
- Operation: `CREATE TABLE`.
- Backfill: none — seeded only with the small fixture set needed for certification (task §9/§10
  are explicit that this is not a full production catalog).
- Unresolved behavior: n/a (no correspondence needed — this table has no predecessor).
- Rollback: `DROP TABLE canonical_subjects CASCADE` is safe pre-Preview; **not** offered as an
  automated down-migration (task's own migration governance treats migrations as immutable once
  applied — a corrective migration would be written instead, never an edit or a scripted rollback
  of an applied file). Documented here only as the manual recovery path for the *pre-application*
  ephemeral-Postgres certification, not as a supported production operation.
- Evidence impact: none.

### canonical_concepts — NEW / ADDITIVE
- Same classification as above. FK dependents: `canonical_concept_skills`,
  `canonical_concept_competencies`, `canonical_concept_prerequisites` (both columns),
  `concept_catalog_mapping.canonical_concept_id`, `concept_catalog_mapping_candidates`.
- No uniqueness on `name` (see catalog model doc — load-bearing for INV-F4-04/AC-F4-07).

### skills — NEW / ADDITIVE
- FK dependents: `canonical_concept_skills.skill_id`, `skill_competencies.skill_id`.

### competencies — NEW / ADDITIVE
- FK dependents: `skill_competencies.competency_id`, `canonical_concept_competencies.competency_id`.
- `code` is UNIQUE (closed internal taxonomy, not user/AI-generated text — see catalog model doc).

### contexts — NEW / ADDITIVE
- No FK dependents this phase (unwired, per target architecture doc).

### canonical_concept_skills, skill_competencies, canonical_concept_competencies — NEW / ADDITIVE
- Composite PK junction tables. No backfill (empty until seeded/edited).

### canonical_concept_prerequisites — NEW / ADDITIVE
- Composite PK, self-referencing FK to `canonical_concepts.id` on both columns,
  `CHECK (prerequisite_concept_id <> concept_id)`.
- Not backfilled from the existing (empty, per assessment §4) `concept_relationships` table —
  that table stays exactly as-is; no data flows from it into this one.

### concept_catalog_mapping — NEW / CORRESPONDENCE
- Current role: does not exist; this IS the correspondence layer the task requires.
- PK: `id uuid`. FK in: `learner_concept_id → concepts(id)` (**UNIQUE** — exactly one mapping per
  existing concept), `canonical_concept_id → canonical_concepts(id)` (nullable),
  `reviewed_by → users(id)` (nullable, F1).
- Ownership: not learner-owned in the F2/F0-S sense (it references a learner concept but is
  catalog-curation metadata, read by admin tooling only this phase — see §19 API section below).
- Operation: `CREATE TABLE`, then **BACKFILL** (see algorithm below) — the only operation in this
  migration that touches every existing `concepts` row, and it does so by *inserting new rows
  into a new table*, never by updating `concepts` itself.
- Unresolved behavior: explicit `UNRESOLVED` status row created for every concept with no safe
  candidate — never left absent (AC-F4-09).
- Rollback: `DROP TABLE` pre-application only, per canonical_subjects note above.
- Evidence impact: **none** — this table has no FK relationship to any of the 19 evidence/state
  tables and the backfill never reads or writes them.

### concept_catalog_mapping_candidates — NEW / CORRESPONDENCE (child of the above)

### concepts, subjects, topics, subtopics, and all 19 evidence/state tables named in the assessment — UNCHANGED
- Explicitly listed here to make the "no destructive removal, no schema change" commitment
  auditable table-by-table, not just asserted in prose. **Zero ALTER statements touch any of
  these in this migration.**

## Backfill algorithm (runs inside the migration's own PL/pgSQL block, transactional)

For every existing `concepts` row without a `concept_catalog_mapping` row yet (idempotent — a
second run only processes newly-created concepts, if any, added between runs):

1. Read the concept's display label from `concept_localizations` (preferring `language = 'en'`,
   falling back to any available row; a concept with no localization row at all is treated as
   having no comparable label).
2. Look up `canonical_concepts` rows in the **same-named** `canonical_subjects` entry (matched by
   the learner's `subjects.name`, case-insensitive) whose `name` exactly matches the label
   (case-insensitive, whitespace-trimmed) — call this the *candidate set*.
3. Decide status:
   - **Zero candidates, or no comparable label at all** → `status = 'UNRESOLVED'`, zero candidate
     rows.
   - **Exactly one candidate** → insert one `concept_catalog_mapping_candidates` row
     (`mapping_method = 'EXACT_LABEL_MATCH'`, `confidence = 1.0`), set the parent row's
     `status = 'MATCHED'` and `canonical_concept_id` to that candidate.
   - **Two or more candidates** → insert one candidate row per match, set
     `status = 'AMBIGUOUS'`, leave `canonical_concept_id` NULL on the parent row. **Never picks
     one automatically** (INV-F4-04, AC-F4-07/08) — this is the direct handling of task §8's
     "same name, different scope/level/definition" adversarial case: if the canonical catalog
     legitimately contains two concepts with that name (because they really are different
     concepts), the backfill surfaces that as ambiguity for human review rather than guessing.
4. Never compares two *learner* concepts to each other — the backfill only ever compares one
   learner concept's label against the (separately, independently seeded) canonical catalog. Two
   learners with the genuinely equivalent concept and identical labels will each independently
   resolve to `MATCHED` against the *same* canonical row, without their concepts ever being
   compared to one another (task §8's "Student A / Student B, same name" case).

Because no production canonical catalog exists yet at F4's certified SHA (per the assessment's
finding of zero prior art), the overwhelming majority of real production concepts will backfill
to `UNRESOLVED` — this is expected and explicitly valid per task §21 ("Expected unresolved count
may be > 0. That is valid.").

## Migration requirements checklist (task §21)

| Requirement | How satisfied |
|---|---|
| Governed migration | Standard `database/migrations/<timestamp>_f4_...sql`, applied only via `npm run db:migrate`, recorded in `schema_migrations` with checksum. |
| Checksum / idempotency | `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`; backfill re-run only processes unmapped concepts (`WHERE NOT EXISTS (SELECT 1 FROM concept_catalog_mapping WHERE learner_concept_id = c.id)`). |
| Transactional safety | Applied inside `db-migrate.ts`'s existing per-migration `BEGIN`/`COMMIT`/`ROLLBACK` wrapper — no change needed to that script. |
| Duplicate detection | `concept_catalog_mapping.learner_concept_id UNIQUE` makes a duplicate backfill structurally impossible, not just unlikely. |
| Orphan detection | Every FK in every new table is `NOT NULL ... REFERENCES`, enforced by Postgres at insert time. |
| Cycle detection | Application-level recursive CTE check before any `canonical_concept_prerequisites` insert (see skill/competency graph doc). |
| FK integrity | All new FKs declared with standard Postgres `REFERENCES`; no deferred/disabled constraints. |
| Reconciliation counts | Produced by the lifecycle cert runner and written into `F4_CATALOG_RECONCILIATION_REPORT.md`. |
| Safe second execution | Re-running the full migration file a second time is a no-op (all `IF NOT EXISTS` + backfill re-check). |

## Explicit non-goal

This migration does not attempt to reach 100% `MATCHED` coverage of existing concepts. A high
`UNRESOLVED` count after real-world application is the correct, expected outcome given no
canonical catalog existed before this phase — not a defect to be masked.
