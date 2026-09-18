# F6 — Next Phase Handoff

Branch: `f6/curriculum-standards-mapping`, pushed to `origin`. Certified SHA for F7 to branch
from: see the final report for the exact tip SHA after all F6 commits.

## What F7 inherits

- **Identity/Authorization/Entitlement/Catalog/Learner State** (F1-F5): unchanged, unaffected.
- **Versioned academic structure** (F6, this phase): `academic_organizations` →
  `academic_programmes` → `academic_qualifications` → `academic_subjects` → `structure_versions`
  → `structure_nodes` → `learning_objectives`, with three concrete mapping tables pointing at
  F4's existing `canonical_concepts`/`skills`/`competencies`.
- **Editorial workflow**: `curriculum_editorial_grants` (EDITOR/REVIEWER/PUBLISHER, separate from
  F1's `Role`), the DRAFT→PROPOSED→IN_REVIEW→APPROVED→PUBLISHED→REJECTED/RETIRED state machine
  shared by mappings and `academic_resources`.
- **Coverage**: computed on read via `coverage.service.ts`, never persisted, never combined with
  learner mastery.
- **Activity metadata bridge**: `resolveActivityMetadataForObjective` — a read-only contract F7
  can call to resolve an objective's published concept/skill/competency ids.

## Non-negotiable invariants F7 must continue to respect

1. Canonical V2 remains the sole pedagogical progression authority — F7's Assessment Framework/
   Exam Readiness work must never read F6's coverage/mapping state to make a PRACTICE/PROVE/
   RETAIN/TRANSFER decision (INV-F6-16, extended).
2. Curriculum Structure and Assessment Blueprint remain separate authorities (INV-F6-05) — F7's
   own Assessment Blueprint Engine should reference `learning_objectives` by id, never encode
   assessment weight/distribution as columns on `structure_nodes`.
3. Coverage and learner mastery remain separate metrics (INV-F6-04) — F7 must not build a single
   "readiness score" that silently blends F6's coverage percentage with F5's mastery state
   without being explicit about which is which.
4. Mapping/structure versioning discipline (retire-and-insert, never edit a PUBLISHED row in
   place) should be extended, not replaced, if F7 introduces its own versioned entities (e.g. an
   Assessment Blueprint version).
5. `curriculum_editorial_grants` should be extended (new grant roles, if F7 needs them) rather
   than duplicated with a second permission mechanism.
6. AI may propose but never auto-publish (INV-F6-11) — this discipline should extend to any new
   AI-assisted authoring F7 introduces (e.g. AI-drafted assessment items).

## Suggested F7 starting points (not prescriptive — F7's own spec governs)

- Assessment Framework Engine: blueprint definitions that reference `learning_objectives` by id,
  with their own versioning, never merged into `structure_nodes`.
- Exam Readiness: a genuinely new derived metric combining (but not conflating) F6's coverage and
  F5's mastery — with an explicit, documented formula, not an invented heuristic.
- Wiring the activity metadata bridge into a real content-generation path, so
  `learning_evidence.metadata.skillIds`/`competencyIds`/`contextCode` (F5) finally get populated
  from real, published F6 mappings for at least one framework (closing RR-F6-03/RR-F5-01).
- A minimal editorial-grant management UI, if F7's scope needs curriculum editors to be
  self-service rather than engineer-provisioned (closing RR-F6-04).

## What F7 must NOT assume

- That any real framework (PAA, Cambridge, IB, or otherwise) has meaningful published content
  yet — only the small pilot fixture exists, and it is certification data, not production
  content (RR-F6-01).
- That any evidence has ever been tagged via the activity metadata bridge — nothing calls it from
  a live path yet (RR-F6-03).
- That the F6 migration has been applied to any remote database — it has not; confirm ledger
  status before building on these tables in any environment.
