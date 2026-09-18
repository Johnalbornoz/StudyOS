# F4 — Next Phase Handoff

Branch: `f4/learning-architecture-2`, pushed to `origin`. Certified SHA for F5 (and, structurally,
F6) to branch from: the tip of this branch after all F4 commits (see final report for the exact
SHA).

## What F5/F6 inherit

- **Identity** (F1), **Authorization** (F2), **Entitlement** (F3): all unchanged, unaffected by F4.
- **Canonical catalog** (F4, this phase): `canonical_subjects`, `canonical_concepts`, `skills`,
  `competencies`, `contexts`, their many-to-many junctions, and the self-referencing acyclic
  `canonical_concept_prerequisites` graph.
- **Correspondence layer** (F4): `concept_catalog_mapping` / `concept_catalog_mapping_candidates`
  — every existing learner concept has exactly one mapping row (`MATCHED`/`AMBIGUOUS`/
  `UNRESOLVED`/`PROPOSED`), auditable, never merged by name alone.
- **Service layer**: `src/lib/catalog/canonical-catalog.service.ts`,
  `src/lib/catalog/prerequisite.service.ts`, `src/lib/catalog/mapping.service.ts`.
- **Minimal admin API**: `/api/admin/catalog/{subjects,concepts,mappings,mappings/confirm,taxonomy}`.

## Non-negotiable invariants F5/F6 must continue to respect

1. `concepts`, `subjects`, `topics`, `subtopics`, and all 19 evidence/state tables remain the
   single source of learner-owned identity and history — F4 never moved them, and neither should
   any later phase without a deliberate, separately-certified migration.
2. A canonical concept is not learner mastery (INV-F4-05/09/10) — F5's learner-state work must add
   its OWN tables for skill/competency state, never infer them from `canonical_concept_skills`/
   `canonical_concept_competencies` existing.
3. `canonical_concepts.name` must never gain a uniqueness constraint — same-name/different-scope
   concepts are a real, intended case (see the catalog model doc).
4. `src/lib/catalog` must remain structurally independent from `src/lib/authorization` (F2) and
   `src/lib/entitlements` (F3) — no cross-imports. Extend the
   `f4-canonical-v2-noninterference.test.ts` pattern for any new cross-cutting concern F5/F6
   introduces.
5. Any future write to `canonical_concept_prerequisites` must go through the same cycle-checked
   path (`addCanonicalPrerequisite`) — never a raw INSERT that bypasses the recursive-CTE check.
6. Framework-specific identity (IB/Cambridge/PAA codes, structure versions, official curriculum
   codes) belongs on new F6 tables/columns, never embedded directly into `canonical_concepts`
   (task §6's own instruction, carried forward here as a binding constraint on F6's design).

## Suggested F5/F6 starting points (not prescriptive — each phase's own spec governs)

- F5: learner-level Skill State and Competency State tables, keyed off
  `(student_id, skill_id)`/`(student_id, competency_id)`, populated from evidence — a genuinely
  new aggregation, not inferred from the F4 taxonomy's mere existence.
- F5: a `context_id` FK added to `learning_evidence` or a new activity-metadata table, wiring the
  F4 `contexts` taxonomy into real evidence classification for the first time.
- F6: Structure Versions, editorial publish/review/publish workflow, framework-specific mapping
  tables (IB/Cambridge/PAA), replacing F4's read-only admin tooling with the full editorial
  surface task §19 explicitly deferred.
- F6: a decision on `AMBIGUOUS`/`UNRESOLVED` concepts accumulated since F4 — either a bulk review
  tool built on top of `/api/admin/catalog/mappings`, or an AI-assisted `PROPOSED`-status
  candidate generator (the status already exists in the schema, unused by F4's deterministic-only
  algorithm).

## What F5/F6 must NOT assume

- That any real canonical concepts exist in Production — none were seeded there; F4 shipped only
  the small, reviewed skill/competency/context taxonomy, not academic content.
- That the F4 migration has been applied to any remote database — it has not (see Preview
  certification doc); confirm ledger status (`npm run db:status`) before building on these tables
  in any environment.
- That `concept_relationships` (the old per-student prerequisite table) has any real data to
  build on — it is empty in production, independent of and unrelated to the new
  `canonical_concept_prerequisites` graph.
