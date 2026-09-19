# F12 Institution Intelligence — Discovery State

- **Date:** 2026-09-19
- **Phase:** 4 — architecture proposal
- **Status:** architecture baseline drafted; no F12 product implementation started
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
| DEC-F12-01 | Decision | accepted | Institution administrators approve teacher memberships and use aggregate-only intelligence. | User clarification, 2026-09-19 |
| DEC-F12-02 | Decision | accepted | First dashboard supports dynamic cross-filters and comparisons by institution, grade, class and subject. | User clarification, 2026-09-19 |
| DEC-F12-03 | Decision | accepted | Minimum displayed cohort is 10 active learners. | User accepted recommendation, 2026-09-19 |
| DEC-F12-04 | Decision | accepted | `STUDYUS_ADMIN` administers the platform; `INSTITUTION_ADMIN` administers its exact tenant and approves teacher memberships; an institution-scoped Academic Coordinator leads aggregate academic analysis. | User clarification, 2026-09-19 |
| ASM-F12-01 | Assumption | to validate | The first F12 delivery is an aggregate institutional read model, not a learner-detail dashboard. | Existing phase boundaries; user requested F12 without a detailed scope |
| Q-F12-01 | Open decision | blocking implementation | Which aggregate outcomes must an institution see and at what cohort minimum? | Product owner TBD |
| Q-F12-02 | Open decision | blocking implementation | Which institution roles may read which scopes: entire institution, grade, class, or subject? | Product owner / privacy owner TBD |
| Q-F12-03 | Open decision | blocking implementation | What measurable decision should this intelligence improve? | Product owner TBD |
| Q-F12-04 | Open decision | blocking implementation | Which jurisdictional privacy and retention rules govern pilot institutions? | Legal/privacy owner TBD |

## Next discovery questions

1. What decision should an institution administrator make better with F12: identify cohorts needing support, compare curriculum coverage, measure exam readiness, or another defined outcome?
2. Should the first release show only institution-wide aggregates, or also grade/class/subject aggregates? State the minimum cohort size required to display a result.
3. Who will use it first: institution admin, academic coordinator, teacher, or a combination? What action should each role be able to take after viewing it? Coordinator lifecycle remains TBD.
4. For the pilot, which country/jurisdiction and age groups apply, and who owns the privacy decision?
