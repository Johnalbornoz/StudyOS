# F11-C3 — Canonical Evidence Reconciliation

Per task §33 — before/after counts across `learning_evidence`, `learner_skill_state`, `learner_competency_state`, `teacher_intervention_executions`, `quiz_sessions`, mastery, and Canonical stage, proving Competency Evidence is added only for explicit Competency executions, never fabricated from either graph direction, with zero cross-learner contamination and zero direct Canonical stage writes.

## Case-by-case reconciliation (real Postgres, this certification run)

| Checkpoint | `learning_evidence` (per student/concept) | `learner_skill_state` | `learner_competency_state` | Canonical V2 stage tables |
|---|---|---|---|---|
| Happy-path Competency execution (Case F/G/H) | 0 → 1 (real writer only) | untouched | none created yet (single evidence < threshold) | untouched |
| Concept→Competency negative-inference proof (Case D) | 0 → 1 (real writer only) | untouched | **no row for Competency K** despite Concept C → K graph edge | untouched |
| Skill→Competency negative-inference proof (Case E) | 0 → 1 (real writer only) | **created** for Skill S (legitimate Skill Evidence) | **no row for Competency K** despite Skill S → K graph edge and real Skill Evidence existing | untouched |
| Assisted evidence (Case L) | 0 → 1 (real writer only, `ai_assistance_type != NONE`) | untouched | **created**, `independentEvidenceCount = 0` — assisted evidence counted, never silently relabeled independent | untouched |
| Mismatched Competency/Concept (Case M) | unchanged (0 new rows) | untouched | 0 | untouched |
| Competency aggregation (Case I/J) | +3 (one per independent execution) | untouched | at `minimumEvidenceCount - 1` (2): state remains `INSUFFICIENT_EVIDENCE`; at the real threshold (3): row created/updated, `evidence_count = 3`, correct `student_id`/`competency_id`, state past the insufficient-evidence floor | untouched |
| No fabricated Skill Evidence (Case T) | n/a | **zero** rows for Skill S despite the same student completing multiple Competency-K executions and a real S→K edge existing | (see aggregation row above) | untouched |

## Zero fabrication, verified not assumed

- **Zero Competency evidence fabricated from the Concept graph**: Case D directly proves a real Concept-only execution against a concept that *does* map to Competency K produces no `learner_competency_state` row for K.
- **Zero Competency evidence fabricated from the Skill graph** ("one of C3's highest-priority assertions", Case E): a real, legitimate Skill execution that *does* produce genuine Skill Evidence for S, where S maps to Competency K, still produces no `learner_competency_state` row for K.
- **Zero Skill evidence fabricated from Competency executions** (Case T, the reverse direction): multiple legitimate Competency-K executions produce zero `learner_skill_state` rows for the mapped Skill S.
- **Zero direct Canonical stage write**: source-guard proves no F11-C3 file references `pedagogical_requirement_recognition`/`canonical_prepared_activity`/`concept_transfer_state`/`concept_knowledge_state`, and no `updateMastery(` call appears anywhere in the orchestration service; the full Canonical V2 regression suite (part of the 346-file/5580-test named regression run) passes unchanged.
- **Zero cross-learner contamination**: every count above is scoped by `student_id`; the adversarial matrix (§ Authorization Certification) independently proves no student's data is reachable by another actor.

## Orphan-session residual (task §26, carried forward)

The real concurrency case (two `Promise.all` start calls, same idempotency key) produced one genuine orphaned `quiz_sessions` row in this run — the same accepted, pre-documented residual first identified in F11-C1 and re-confirmed harmless under the Skill path in F11-C2. Verified again here: the orphan is never the execution reference returned to either concurrent caller; the orphan is never submitted in this certification; `getCompetencyState` for the affected student/competency pair shows zero evidence attributable to it. **No academic effect. No new fix required** — this residual is re-confirmed harmless under the Competency path using the identical mechanism, not a new or worsened risk.
