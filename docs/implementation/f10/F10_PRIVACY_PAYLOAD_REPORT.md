# F10 — Privacy Payload Report

Per task §57: verifies Parent-facing response payloads for data minimization. Method: source-level inspection of every field the read model actually returns (each DTO is hand-shaped, never a raw row pass-through — see `F10_PARENT_PRIVACY_MODEL.md`), corroborated by the real-Postgres run's actual returned objects.

## What was checked, per method

| Method | Fields returned | Absent (verified by reading the DTO shape) |
|---|---|---|
| `getParentLearners` | studentId, name, activeSince | email of other parents, relationship internals, any other student's data |
| `getParentLearnerOverview` | studentId, name, subjectCount, conceptsWithEvidence (count only), areasNeedingAttentionCount (count only), latestReadinessStatus (enum only), lastActivityAt | raw mastery scores, raw evidence rows, AI provider/model, diagnostic confidence internals |
| `getParentSubjectProgress` | subjectId, name, totalConcepts, conceptsWithQualifyingEvidence, activeAreasNeedingAttention (counts only) | per-concept mastery scores, per-item response data |
| `getParentRecentActivity` | kind, occurredAt, subjectId | question/response text, AI prompt/response content, hints used, confidence-before-answer, provider metadata (all present in `learning_evidence` but never selected into this DTO) |
| `getParentExamPreparation` | examName, examDate, dimension name+status only (never the raw sub-score), scoreProjectionAvailability (enum), fullMock.{eligible, reasonCategory, reasons}, availableSimulationTypes | raw dimension `detail` object, `evidenceIncludedIds`/`evidenceExcludedIds`, `blueprintTargetsConsidered` (all present on F9's `DimensionReadinessResult` but never spread into the Parent DTO — only `dimension`/`status` are destructured) |
| `getParentAttentionAreas` | category (fixed enum), explanation (a template string built from a label/severity/dimension name), subjectId | raw diagnostic confidence, internal algorithm weights, other learners' data |

## Cross-cutting checks

- No method ever does `SELECT *` and forwards the row; every SQL query in `read-model.service.ts` selects only the columns the DTO actually uses.
- No method combines two students' data in one response (each takes exactly one `studentId`, or none for the actor-derived list).
- `getParentRecentActivity` explicitly avoids `learning_evidence.metadata`/`activity_type`/`ai_assistance_type`/`confidence_before_answer` — confirmed by reading its SQL, which selects only `"timestamp"` and `subject_id`.
- Institution/teacher-internal fields (teacher notes, institution policy internals) are never queried by any F10 file — confirmed by the same guard test that checks for legacy-readiness imports (`f10-legacy-readiness-noninterference.test.ts` asserts the full F10 file list; none import `@/lib/teaching/*` intervention-note fields or `@/lib/readiness/institution-policy-comparison.service.ts`).

## Verdict

**PASS.** Every Parent-facing payload is an allow-list of `SAFE_PARENT_SUMMARY`-classified fields (per `F10_PARENT_PRIVACY_MODEL.md`); no `LEARNER_PRIVATE`, `TEACHER_INTERNAL`, `INSTITUTION_INTERNAL`, or `SYSTEM_INTERNAL` field was found reachable from any of the 6 new routes.
