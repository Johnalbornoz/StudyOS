# F10 — Parent Privacy Model

## Classification (task §23)

| Tag | Meaning | Example fields |
|---|---|---|
| `SAFE_PARENT_SUMMARY` | Explicitly designed for Parent consumption | learner display name, subject names, evidence-coverage counts, readiness dimension statuses, attention-area categories, activity timestamps/kinds |
| `LEARNER_PRIVATE` | Learner-owned, not automatically Parent-visible | raw `learning_evidence` rows, individual question/response text, AI prompt/response content, per-item confidence scores |
| `TEACHER_INTERNAL` | Teacher-authored/scoped | teacher notes, class rosters, teacher-only intervention rationale |
| `INSTITUTION_INTERNAL` | Institution configuration | institution policy documents, curriculum mapping internals, cohort-level aggregates |
| `SYSTEM_INTERNAL` | Operational/debug | AI provider name/model/token counts, internal operation keys, idempotency keys, DB row ids beyond what routing needs |

Default posture: a field is `LEARNER_PRIVATE` (or stricter) unless explicitly classified `SAFE_PARENT_SUMMARY` — the read model is an allow-list, not a filter over a full learner record (task §23's "don't assume every learner-owned field is automatically Parent-visible").

## Field-by-field decisions (read model outputs only)

| Source | Field | Tag | In Parent DTO? |
|---|---|---|---|
| F5 learning_evidence | `mastery_score` (aggregated to a coverage/qualifying-count) | SAFE_PARENT_SUMMARY | Yes, aggregated only |
| F5 learning_evidence | raw prompt/response text | LEARNER_PRIVATE | No |
| F5 learning_evidence | AI provider/model | SYSTEM_INTERNAL | No |
| F8 diagnostics | gap category | SAFE_PARENT_SUMMARY | Yes |
| F8 diagnostics | internal confidence/algorithm weights | SYSTEM_INTERNAL | No |
| F8 interventions | teacher-authored rationale text | TEACHER_INTERNAL | No |
| F9 readiness | dimension status enum | SAFE_PARENT_SUMMARY | Yes |
| F9 readiness | raw numeric sub-scores feeding the dimension | SYSTEM_INTERNAL | No (status only, not the internal number, per task §35 "without exposing raw internal algorithms") |
| F9 simulation | attempt date/completion status | SAFE_PARENT_SUMMARY | Yes |
| F9 simulation | per-item responses | LEARNER_PRIVATE | No |
| Institution | policy comparison internals | INSTITUTION_INTERNAL | No |

## Minimization (task §24)

The read model never does `SELECT *` and never forwards a DB row directly — every DTO is hand-shaped field-by-field in `read-model.service.ts`. This is enforced structurally (each method's return type is a narrow interface) and verified by `F10_PRIVACY_PAYLOAD_REPORT.md`'s payload-inspection tests.
