# F11-C2 — Canonical Evidence Reconciliation

Per task §31/§18/§28 — before/after counts across the full certification run, proving Skill Evidence is added only for explicit Skill executions, never fabricated from the Concept graph or into Competency State, with zero cross-learner contamination and zero direct Canonical stage writes.

## Case-by-case reconciliation (real Postgres, this certification run)

| Checkpoint | `learning_evidence` (per student/concept) | `learner_skill_state` | `learner_competency_state` | Canonical V2 stage tables |
|---|---|---|---|---|
| Happy-path Skill execution (Case E/F/G) | 0 → 1 (real writer only) | none created yet (single evidence < threshold) | 0 | untouched |
| Concept-only negative-inference proof (Case D) | 0 → 1 (real writer only) | **no row for Skill S** despite Concept C → Skill S graph edge | 0 | untouched |
| Mismatched Skill/Concept (Case I) | unchanged (0 new rows) | unchanged | 0 | untouched |
| Skill aggregation (Case H) | +3 (one per independent execution) | **created**, `evidence_count = 3` (the real, currently-seeded F5 `minimumEvidenceCount`), correct `student_id`/`skill_id`, state past the insufficient-evidence floor | 0 | untouched |
| Full run total (Case P) | sum of the above, all attributable to an explicit Skill or Concept execution | exactly the Skill-S rows the certification itself produced | **0 across every student in the entire run** | untouched |

## Zero fabrication, verified not assumed

- **Zero Skill evidence fabricated from the Concept graph**: Case D directly proves a real Concept-only execution against a concept that *does* map to Skill S produces no `learner_skill_state` row for S (`getSkillState` returns `null`).
- **Zero Competency evidence fabricated**: `learner_competency_state` count is `0` for every student touched by this entire certification run (query scoped to all 4+ students that received real evidence), confirmed after the Skill-aggregation case specifically (the one most likely to tempt a Skill→Competency shortcut).
- **Zero direct Canonical stage write**: source-guard proves no F11-C2 file references `pedagogical_requirement_recognition`/`canonical_prepared_activity`/`concept_transfer_state`/`concept_knowledge_state`; the full Canonical V2 regression suite (part of the 88-file/1532-test named regression run) passes unchanged.
- **Zero cross-learner contamination**: every count above is scoped by `student_id`; the adversarial matrix (§ Authorization Certification) independently proves no student's data is reachable by another actor.

## C1 orphan-session residual (task §23, mandatory)

The real concurrency case (two `Promise.all` start calls, same idempotency key) produced exactly one genuine orphaned `quiz_sessions` row in this run (an accepted, pre-documented residual carried forward from F11-C1). Verified: the orphan is never the execution reference returned to either concurrent caller (both received the same, single canonical reference); the orphan is never submitted in this certification (only the canonical reference ever is); `getSkillState` for the affected student/skill pair shows zero evidence attributable to the orphan. **No academic effect. No fix required beyond what F11-C1 already documented** — this residual is re-confirmed harmless under the Skill path using the identical mechanism, not a new or worsened risk.
