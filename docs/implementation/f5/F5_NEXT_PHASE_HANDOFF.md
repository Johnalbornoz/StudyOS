# F5 — Next Phase Handoff

Branch: `f5/evidence-learner-state-2`, pushed to `origin`. Certified SHA for F6 to branch from:
see the final report for the exact tip SHA after all F5 commits.

## What F6 inherits

- **Identity/Authorization/Entitlement** (F1-F3): unchanged, unaffected by F5.
- **Canonical catalog** (F4): unchanged. `skills`/`competencies`/`contexts` and their junction
  tables are now consumed (read-only) by F5's projectors.
- **Analytical Learner State** (F5, this phase): `learner_skill_state`, `learner_competency_state`,
  `learner_transfer_analytics`, `aggregation_policy_versions`, and explainability/replay
  functions in `src/lib/learner-state/`. Knowledge State (`concept_knowledge_state`) remains
  exactly as it was — F5 added only a read-only explanation wrapper, no new storage.
- **Evidence tagging contract**: `learning_evidence.metadata` may now carry `skillIds`,
  `competencyIds`, `contextCode` — optional, additive, currently unpopulated by any production
  caller (see residual risk register RR-F5-01).

## Non-negotiable invariants F6 must continue to respect

1. Canonical V2 remains the sole pedagogical progression authority — F6's curriculum-mapping work
   (structure versions, IB/Cambridge/PAA codes) must never read F5's analytical state tables to
   make a PRACTICE/PROVE/RETAIN/TRANSFER decision.
2. Competency completion must never be inferred from Concept completion, Skill performance, or
   framework-mapping coverage alone — F5 established this precedent for its own aggregation;
   F6's framework work must not introduce a shortcut that violates it (e.g. "this concept covers
   80% of the IB syllabus, therefore competency X is demonstrated" would be exactly the kind of
   fabrication F5 spent its whole certification proving against).
3. `src/lib/learner-state` must remain structurally independent from `src/lib/authorization` (F2)
   and `src/lib/entitlements` (F3) — extend the `f5-canonical-v2-noninterference.test.ts` pattern
   for any new cross-cutting concern F6 introduces.
4. Any new aggregation rule change must be a new `aggregation_policy_versions` row (never an edit
   to an existing one) — F6, if it introduces framework-specific evidence interpretation, should
   follow the same versioning discipline rather than inventing a parallel mechanism.
5. Evidence tagging (`skillIds`/`competencyIds`/`contextCode`) remains opt-in metadata — F6 must
   not retroactively assign these tags via any curriculum-mapping graph, for the same reason F5
   never assigned them via the F4 concept→skill/competency graph.

## Suggested F6 starting points (not prescriptive — F6's own spec governs)

- A decision on which real content-generation paths (quiz generation, transfer generation) start
  populating `metadata.skillIds`/`competencyIds`/`contextCode`, informed by whatever curriculum
  framework F6 introduces (an IB/Cambridge assessment objective could plausibly map to a
  specific competency, giving F6 a natural place to start real tagging).
- Framework-specific mapping tables should reference F4's `canonical_concepts`/`skills`/
  `competencies` by id, never duplicate or fork them.
- If F6 wants coverage reporting ("how much of this framework's syllabus has demonstrated
  Competency evidence"), it should compose F5's existing `learner_competency_state` reads with
  its own framework-mapping tables — read-only composition, not a new write path into F5's tables.

## What F6 must NOT assume

- That any real learner has meaningful Skill/Competency/Transfer-analytics state yet — almost all
  will read `NO_EVIDENCE`/empty until a real content-generation change starts tagging evidence
  (RR-F5-01).
- That `learner_transfer_analytics.canonical_concept_id` is always fresh — it only updates when
  that concept's evidence is re-processed (RR-F5-06).
- That the F5 migration has been applied to any remote database — it has not (see Preview
  certification doc); confirm ledger status before building on these tables in any environment.
