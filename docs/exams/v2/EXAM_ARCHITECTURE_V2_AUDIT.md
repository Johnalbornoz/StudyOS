# Exam Architecture V2 — audit (section 0)

- **Base:** Track B DEV-certified `52de4150`.
- **Branch:** `track-b/exam-architecture-v2`.
- **Scope:** DEV only. Stage, Production and Track A are not touched.

## CURRENT_EXAM_ARCHITECTURE

| Area | Today | File(s) |
|---|---|---|
| Hierarchy | F6 `academic_programmes` → `academic_qualifications` → `academic_subjects`, then `structure_versions` / `structure_nodes` (node_type is free text, used for curriculum trees). The exam side is `exam_definitions` (family, programme, subject, aggregation group) → `exam_versions` → `assessment_components` (SECTION, PAPER, WRITTEN, ORAL, PRACTICAL, COURSEWORK). There is no generic typed assessment hierarchy: PISA domain / process / context and Saber competency / assertion / evidence cannot be expressed. | `database/migrations/20260924…f6`, `…f7`, `20261019…track_b` |
| Versioning | Version label, effective dates, optional year / session. There is no curriculum version, first or last assessment, syllabus code or framework version. | `exam_versions` |
| Sources | `structure_versions.source_locator` (free text) only. There is no source registry, confidence or verification date. | — |
| Components | Name, type, duration, tool rules, subject, `sequence_order`, `section_key`. There are no max marks, weighting, calculator policy, response types, AOs, difficulty distribution or rubric reference. | `assessment_components` |
| Blueprint | Objective targets carry question type, command term, difficulty range and skill. They have no context, process, cognitive demand, stimulus requirement or response format. | `blueprint_objective_targets` |
| Delivery | Server-held items, sections, server clocks, breaks, navigation, autosave, compare-and-swap writes, hand-in. The form is sourced lazily during the attempt, so a Mock is not frozen before start. | `src/lib/simulation/item-resolution.service.ts` |
| Modes | Simulation types are TOPIC, DOMAIN, MINI_MOCK and FULL_MOCK; timing modes are UNTIMED, TRAINING and OFFICIAL. There is no Practice / Mock / Challenge separation and no adaptivity. | `src/lib/simulation/*` |
| Scoring | `exam-scoring-v1`: RAW / WEIGHTED_ITEMS / SECTION_WEIGHTED / CRITERIA strategies, transforms, provenance, frozen policy, one result per attempt. There is no item-level scoring-strategy enum and no strict-readiness metric. | `src/lib/exam-core/scoring/*` |
| Grading | `gradeStructuredAnswer` (deterministic), `gradeAnswer` (AI, single pass), exam-core accepted answers and numeric tolerance, mark-scheme parts. There is no double assessor, no persisted assessor records and no REVIEW_REQUIRED. | `src/lib/exam-core/item-grading.ts` |
| Math | `src/lib/grading/math-equivalence.ts`: mathjs parse with a whitelist, single variable, numeric equivalence, a few units, equation solving. `MathExpressionEditor` (MathLive) emits LaTeX `MathResponse`. Missing: multi-variable algebraic equivalence, required form, SI / derived units, intervals, inequalities. | `src/lib/grading/math-equivalence.ts`, `src/components/MathExpressionEditor.tsx`, `src/lib/lx/math-response-contract.ts` |
| Generation | The existing gated generator, plus blueprint validation (type, difficulty, objective, answer validity). It receives no component contract. `question_bank_candidates` has `content_fingerprint` / `template_signature` (activity delivery only). | `src/lib/exam-core/item-sourcing.service.ts`, `src/services/quiz-generation.service.ts` |
| Bank | `approved_items` with workflow statuses. There is no `content_origin` column (only `contentStatus` inside the JSON), no difficulty index and no fingerprints. | F7 |
| Evidence bridge | Valid response → owner concept → `updateMastery(EXAM_SIMULATION, NONE)`. Results show mapped concepts and their canonical state, but nothing groups gaps into a "reinforce" CTA or creates a concept proposal. | `scoring.service.ts`, `result-view.service.ts` |
| Media | None. `/api/content/upload` extracts text and stores a filename only. Anthropic vision is available through the AI gateway (`callAnthropicMessages` image blocks). | `src/services/ai.service.ts` |
| Delete / reset | Abandon only (ABANDONED). There is no delete, soft delete or "new attempt from zero" lifecycle. | `attempt.service.ts` |
| Verticals | Eight `DEV_CERT_FIXTURE` configurations (PAA, PISA, IB ×2, Cambridge, AICE ×2, ICFES), applied with `apply-vertical-config.service.ts`. | `src/lib/exam-core/verticals/*` |

## REUSABLE_COMPONENTS (kept, extended)

- Exam Core attempt / delivery / scoring / results / evidence bridge, all certified in Track B.
- The vertical configuration applier: it is idempotent, transactional, and immutable once published.
- F6 mapping tables (objective → concept / skill / competency) for the learning bridge.
- `math-equivalence.ts` (whitelisted mathjs parser) as the base of the V2 math engine.
- `MathExpressionEditor` (MathLive) for math input.
- The AI gateway (`executeAI`, model routing, audit, limits) with OpenAI Terra and Anthropic vision, used to build the double assessor.
- Tutor integrity guard; DEV-guarded operator scripts; ephemeral migration certification.

## STRUCTURAL_GAPS → V2 work

1. A typed, generic assessment hierarchy (`assessment_structure_nodes`) and dynamic selection.
2. Curriculum versioning on versions and nodes, plus a source registry with confidence and licensing.
3. A component definition contract (marks, weighting, calculator, AOs, coverage, difficulty, strategy) that is given to the generator.
4. Exam instances with a lifecycle (DRAFT, READY, IN_PROGRESS, COMPLETED, ARCHIVED, DELETED). A Mock form is frozen before start. Practice, Mock and Challenge are separate modes, plus a STRICT_READINESS metric.
5. Item-level scoring strategies; math equivalence, units and required-form grading; method marks.
6. Double assessor with adjudication, persisted assessments and REVIEW_REQUIRED.
7. Multimodal submissions: secure media storage, scanning, signed URLs, deletion. A portfolio / performance engine for Arts.
8. Difficulty index and calibration suite; item novelty fingerprints and usage history; `content_origin`.
9. A learning bridge that groups gaps and offers "Reforzar ahora", plus `LearningConceptProposal` governance.
10. Delete and new-attempt-from-zero with owner security; a DEV fixture reset.

## MIGRATION_PLAN

- One governed, additive migration: `20261020_1000_track_b_exam_architecture_v2.sql`. `20261018_*` belongs to Track A and `20261019_1000` to Track B V1. Applied migrations are never edited.
- New tables:
  - `assessment_sources`, `assessment_structure_nodes`, `exam_instances`, `exam_response_assessments`;
  - `exam_media_objects`, `exam_submissions`, `exam_submission_artifacts`;
  - `learning_concept_proposals`, `exam_item_usage`, `assessment_calibration_cases`, `assessment_calibration_runs`.
- New nullable columns on: `exam_versions` (curriculum metadata, `source_ids`); `assessment_components` (`definition` jsonb, `max_marks`, `weighting_percent`, `calculator_policy`, `source_ids`); `approved_items` (`content_origin`, `difficulty_index`, fingerprints, `source_ids`); `exam_attempt_item_responses` (`normalized_response`, `grading_detail`, `review_status`, `content_origin`); `exam_attempt_results` (`strict_readiness`); `simulation_attempts` (`exam_instance_id`).
- Certification: ephemeral PG18 script (legacy rows, constraints, rollback, idempotency), then DEV apply with the 0 pending / 0 drift check.
- Rollback: documented in the migration header (drop the new tables, then the new columns).
