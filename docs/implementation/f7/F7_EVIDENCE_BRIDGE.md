# F7 — Evidence Bridge

## The genuine architectural gap this document resolves

`learning_evidence` (F5) is fundamentally **per-student-concept**-scoped
(`student_id`+`concept_id`, where `concept_id` is a per-student row). F6's `learning_objectives`
are **canonical**-scoped. F7's evidence bridge therefore requires the caller to already know
**which of the student's own concepts** corresponds to the objective being assessed — it does not,
and cannot, invent this correspondence itself.

`bridgeExamResponseToEvidence(params: { studentId, conceptId, subjectId, learningObjectiveId,
result, difficulty, scorePercent, telemetry? })`:

1. Calls F6's unmodified `resolveActivityMetadataForObjective(learningObjectiveId)`.
2. Builds `metadata` = `{ skillIds, competencyIds }`, **including a key only when its array is
   non-empty** — never `competencyIds: []` sitting on the evidence row implying "checked, found
   none," and never a fabricated id.
3. Calls F5's **real, unmodified** `updateMastery()` with `evidence.sourceType = 'EXAM_SIMULATION'`
   — an **existing** `EvidenceSourceType` value with its own established mastery weight (0.8),
   requiring zero changes to `src/lib/algorithms/mastery.ts`.

If the caller cannot supply a `conceptId` (because the student has no per-student concept `MATCHED`
to this objective's canonical concept yet), evidence simply cannot be recorded for that pairing —
this is a real, disclosed limitation (see the current-architecture assessment and residual risk
register), never worked around by fabricating a concept.

## Never inferring Competency evidence from mere relevance (task §28, INV-F7-18, adversarial M)

If `resolveActivityMetadataForObjective` returns an empty `competencyIds` array (the objective has
no `PUBLISHED` `objective_competency_mapping`, even though a competency might be informally
"relevant" via the skill/competency taxonomy graph), the bridge attaches **no** `competencyIds`
key at all — F5's own `learner_competency_state` projector (unmodified) then correctly produces
`NO_EVIDENCE` for that competency, exactly as F5's own certification already proved for the
general case. F7 adds no new inference path here.

## Only attaching what the activity configuration actually supports (task §28)

`skillIds`/`competencyIds` are attached **only** when the specific `blueprint_objective_targets`
row (or the objective's own published mappings) actually name them — never "every skill this
framework theoretically cares about." The bridge is a strict pass-through of F6's own PUBLISHED-
mapping resolution, adding no interpretation of its own.

## Canonical V2 boundary (task §29, INV-F7-01/02/20)

`bridgeExamResponseToEvidence` calls `updateMastery()` exactly the way any other evidence writer
does — Canonical V2's own qualification logic (`evidence-qualification.ts`, unmodified) then
independently decides whether this evidence, combined with whatever else exists, satisfies
PRACTICE/PROVE/RETAIN/TRANSFER requirements. **F7 never writes to
`pedagogical_requirement_recognition` or `concept_knowledge_state` directly, never calls
`evaluateCanonicalLearningState`/`rebuildConceptCanonicalState`, and computes no stage verdict of
its own.** An exam score of 82% becoming "PROVE passed" happens only if Canonical V2's own,
unmodified rules — checking independence, item count, difficulty, prerequisite satisfaction —
already say so from the resulting evidence; F7 asserts nothing about pedagogical stage, ever.
