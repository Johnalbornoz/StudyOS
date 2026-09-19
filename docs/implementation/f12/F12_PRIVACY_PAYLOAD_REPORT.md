# F12 — Privacy Payload Report

Task section 42 — response payloads inspected directly (real JSON, not schema review alone).

## Learner drill-down payload (`getLearnerDrillDown`)

Real-Postgres proven, this certification run:
- Serialized JSON contains no `aiExecution`/`promptId`/`provider` substring — zero AI prompt or provider/model internal data.
- Contains no `rawResponse`/`criteriaBreakdown` substring — zero raw grading internals.
- Contains no reference to `studentB1`'s id (an unrelated, unauthorized learner) — zero unrelated-learner leakage.
- Fields present: `studentId`, `evidenceCount` (a bare number), three state-distribution maps, `calculatedAt`. Nothing else.

## Institution overview / learner summary / coverage / readiness / intervention payloads

Structurally reviewed (every field in every returned type is enumerated in `src/lib/institution-intelligence/*.ts`): none contain raw `learning_evidence` rows, AI internals, parent-relationship data, tokens/secrets, other-institution identifiers, teacher-private notes, or unrelated-learner identifiers. Every payload is either a plain count/distribution or a `MetricEnvelope` wrapping one — no payload shape in the module includes a raw table row from `learning_evidence`, `exam_attempt_item_responses`, or any AI-execution-adjacent table.

## Cross-institution payload isolation

Every denied case (D/F/H) throws BEFORE any query that could populate a response body runs — there is no code path where a denied request's response accidentally includes a partial result from the wrong institution.

## What was NOT tested at the payload level in this phase

Full HTTP-response-body fuzzing across every route/filter combination was not exhaustively performed — the certification directly inspects the SERVICE-layer return values (the same objects the thin route wrappers return verbatim via `NextResponse.json({ success: true, data })`), which is the same level of rigor every prior phase's own cert runner applied (F11-C1 through F11-integrated never ran an HTTP server in certification either). See `F12_IVG_DEFERRED_TEST_REGISTER.md` for the remote/live-HTTP payload verification this defers.
