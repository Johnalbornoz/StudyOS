# F11-C4 — Evidence / Readiness / Diagnostic Boundary

## Zero direct writes (task §21/§24/§25, AC-C4-17/18/19/20)

Source-guard proven and real-Postgres proven:

- Zero `learning_evidence`/`mastery_records` writes -- confirmed structurally (no `updateMastery(` call in the orchestration file) and behaviorally (Case W: starting an Exam Reinforcement execution produces zero new `learning_evidence` rows).
- Zero `learner_skill_state`/`learner_competency_state` writes -- F11-C4 never calls any F5 projector directly; whatever Skill Evidence a simulation response produces flows entirely through F9's own `recordSimulationItemResponse` → `updateMastery`, exactly as F9 is already certified to do.
- Zero `readiness_snapshots` writes -- confirmed structurally (no `computeReadinessSnapshot(` call) and behaviorally (Case X: starting an execution produces zero new readiness snapshots; Case AD: exactly one new snapshot appears only after the Student's OWN real completion flow explicitly calls `computeReadinessSnapshot`).
- Zero diagnostic-state writes -- confirmed structurally (no `runDiagnosis(`/`runPostExamDiagnosis(` call) and behaviorally (Case AC: diagnosis only runs when the certification's simulated "Student completion flow" explicitly invokes the real F9/F8 function itself).
- Zero Canonical V2 stage writes -- confirmed structurally (no reference to `pedagogical_requirement_recognition`/`canonical_prepared_activity`/`concept_transfer_state`/`concept_knowledge_state` anywhere in the orchestration file); the full named Canonical V2 regression suite passes unchanged.

## Evidence semantics (task §22)

Whatever Skill/Concept/Competency dimensions a simulation response's Evidence carries is decided entirely by F9's own `recordSimulationItemResponse` (via `resolveActivityMetadataForObjective`) — F11-C4 never adds a metadata key merely because the Teacher's intent was "exam reinforcement." No fabricated Skills, no fabricated Competencies: as documented in `F11_C4_CURRENT_EXAM_EXECUTION_ASSESSMENT.md`, the current simulation-response path only ever attaches `skillIds` (never `competencyIds`) — a real, current-state fact F11-C4 preserves rather than works around.

## F8 post-exam diagnosis reused, not duplicated (task §23, AC-C4-21)

`runPostExamDiagnosis` is F9's own real function, itself calling F8's real `runDiagnosis` per touched (concept, scope) pair. F11-C4 never classifies Knowledge/Skill/Technique/Speed gaps itself — a Teacher intervention may later read the resulting signals, but never produces them.

## F9 readiness boundary (task §24, AC-C4-22)

F9 remains the sole readiness authority. Completing a Teacher-assigned Exam Reinforcement execution may legitimately produce new qualifying Evidence; F9 recomputes readiness according to its own existing, unmodified rules, whenever the Student's own real completion flow calls `computeReadinessSnapshot` — never because F11-C4 itself decided to.

## Score projection / admission-claim safety (task §19/20/38/39, AC-C4-13/14/15)

F11-C4 never computes a raw, partial-credit, rubric, scaled, or predicted score — all scoring is F7/F9's own (`getSimulationScoreSummary`, `recordExamAttemptItemResponse`'s persisted `score`/`max_score`). F11-C4 never references `score_conversion_models`, `institution_exam_policies`, or any admission-comparison function — confirmed by source guard and by the real-Postgres run (`score_conversion_models` count for PAA remains 0; `institution_exam_policies` rows are untouched).
