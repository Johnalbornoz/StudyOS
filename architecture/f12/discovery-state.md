# F12 Institution Intelligence — Discovery State

- **Date:** 2026-09-19
- **Phase:** 1 — purpose and scope
- **Status:** active discovery; no F12 product implementation started
- **Objective:** design a safe institution-level intelligence capability for StudyUS.
- **Known foundation:** F2 already provides institutions, memberships, grades, classes, enrollments, teacher assignments, and scoped authorization. Institution administrators do not receive direct learner access. F10 establishes an allow-list privacy model and classifies cohort-level aggregates as institution-internal.
- **Authorized scope:** discovery and architecture preparation following successful F11 integrated certification.
- **Excluded pending definition:** individual learner drill-down, final UI, batch assignment, automated interventions, production deployment.

## Traceability

| ID | Type | Status | Statement | Source / validation |
|---|---|---|---|---|
| REQ-F12-01 | Requirement | assumed by existing architecture | Institution capability must build on F2 institutional entities rather than duplicate them. | F2 Next Phase Handoff |
| REQ-F12-02 | Requirement | confirmed | Institution administration alone must not grant direct learner-level learning access. | F2 authorization architecture and permission matrix |
| REQ-F12-03 | Requirement | confirmed | Institution output must be allow-listed and cohort-aggregate by default. | F10 privacy model |
| ASM-F12-01 | Assumption | to validate | The first F12 delivery is an aggregate institutional read model, not a learner-detail dashboard. | Existing phase boundaries; user requested F12 without a detailed scope |
| Q-F12-01 | Open decision | blocking implementation | Which aggregate outcomes must an institution see and at what cohort minimum? | Product owner TBD |
| Q-F12-02 | Open decision | blocking implementation | Which institution roles may read which scopes: entire institution, grade, class, or subject? | Product owner / privacy owner TBD |
| Q-F12-03 | Open decision | blocking implementation | What measurable decision should this intelligence improve? | Product owner TBD |
| Q-F12-04 | Open decision | blocking implementation | Which jurisdictional privacy and retention rules govern pilot institutions? | Legal/privacy owner TBD |

## Next discovery questions

1. What decision should an institution administrator make better with F12: identify cohorts needing support, compare curriculum coverage, measure exam readiness, or another defined outcome?
2. Should the first release show only institution-wide aggregates, or also grade/class/subject aggregates? State the minimum cohort size required to display a result.
3. Who will use it first: institution admin, academic coordinator, teacher, or a combination? What action should each role be able to take after viewing it?
4. For the pilot, which country/jurisdiction and age groups apply, and who owns the privacy decision?
